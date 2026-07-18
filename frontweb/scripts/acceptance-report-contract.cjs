const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const zlib = require('node:zlib')
const { spawnSync } = require('node:child_process')

const MANIFEST_SCHEMA = 'localminidrama.acceptance-screenshot-manifest.v1'
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const MAX_PNG_SCANLINE_BYTES = 512 * 1024 * 1024
const REPORT_RELATIVE_PATH = 'frontweb/public/reports/product-acceptance/report.html'
const NOTES_RELATIVE_PATH = 'docs/ui-refresh-20260718.md'

const REQUIRED_FINAL_CAPTURES = Object.freeze([
  ...captureMatrix('project-readiness', [[1280, 720], [1366, 768], [1440, 900]]),
  ...captureMatrix('film-pipeline', [[1280, 720], [1366, 768], [1440, 900]]),
  ...captureMatrix('ai-config-management', [[1280, 720], [1366, 768], [1440, 900]]),
  ...captureMatrix('ai-config-coverage', [[1024, 768]]),
])

function captureMatrix(surface, viewports) {
  return viewports.flatMap(([width, height]) => ['light', 'dark'].map((theme) => Object.freeze({
    id: `${surface}-${width}x${height}-${theme}`,
    surface,
    width,
    height,
    theme,
  })))
}

function normalizePath(value) {
  return String(value || '').replaceAll('\\', '/')
}

function relativePath(root, target) {
  const relative = path.relative(root, target)
  return normalizePath(relative || path.basename(target))
}

function makeFailure(code, file, detail, line = 0, column = 0) {
  const failure = new Error(detail)
  failure.name = 'AcceptanceReportFailure'
  failure.code = code
  failure.file = normalizePath(file)
  failure.detail = detail
  failure.line = line
  failure.column = column
  return failure
}

function throwFailures(failures) {
  if (failures.length) throw new AggregateError(failures, 'Acceptance report verification failed')
}

function lineAndColumn(text, index) {
  const before = text.slice(0, index)
  const lines = before.split(/\r?\n/)
  return { line: lines.length, column: lines.at(-1).length + 1 }
}

function decodePercentEncoding(value) {
  return String(value).replace(/(?:%[0-9a-f]{2})+/gi, (encoded) => {
    try {
      return decodeURIComponent(encoded)
    } catch {
      return encoded
    }
  })
}

function redactFailureText(value) {
  return decodePercentEncoding(value)
    .replace(/(authorization["']?\s*[:=]\s*["']?\s*bearer\s*)"(?:\\.|[^"\\\r\n])*"/gi, '$1"<redacted>"')
    .replace(/(authorization["']?\s*[:=]\s*["']?\s*bearer\s*)'(?:\\.|[^'\\\r\n])*'/gi, "$1'<redacted>'")
    .replace(/(authorization["']?\s*[:=]\s*["']?\s*bearer\s+)(?!["'])[^\s"',;<>}]+/gi, '$1<redacted>')
    .replace(/((?:api[_-]?key|secret|token|password)["']?\s*[:=]\s*)"(?:\\.|[^"\\\r\n])*"/gi, '$1"<redacted>"')
    .replace(/((?:api[_-]?key|secret|token|password)["']?\s*[:=]\s*)'(?:\\.|[^'\\\r\n])*'/gi, "$1'<redacted>'")
    .replace(/((?:api[_-]?key|secret|token|password)["']?\s*[:=]\s*)(?!["'])[^\s"',;<>}\]]+/gi, '$1<redacted>')
    .replace(/-----BEGIN(?: [A-Z0-9]+)* PRIVATE KEY-----/gi, '<private-key-header-redacted>')
    .replace(/\b(?:ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{12,}|xox[baprs]-[A-Za-z0-9-]{12,}|AKIA[A-Z0-9]{16})\b/g, '<credential-redacted>')
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1<userinfo-redacted>@')
}

function formatFailures(failures) {
  const list = failures instanceof AggregateError ? failures.errors : failures
  return [...(list || [])]
    .map((failure) => ({
      code: String(failure.code || 'ARV_UNKNOWN'),
      file: redactFailureText(normalizePath(failure.file || '<unknown>')),
      line: Number(failure.line) || 0,
      column: Number(failure.column) || 0,
      detail: redactFailureText(failure.detail || failure.message || 'verification failed'),
    }))
    .sort((left, right) => (
      left.code.localeCompare(right.code)
      || left.file.localeCompare(right.file)
      || left.line - right.line
      || left.column - right.column
      || left.detail.localeCompare(right.detail)
    ))
    .map(({ code, file, line, column, detail }) => {
      const location = line ? `${file}:${line}${column ? `:${column}` : ''}` : file
      return `${code} ${location} ${detail}`
    })
    .join('\n')
}

function isNameCharacter(character) {
  return Boolean(character && /[A-Za-z0-9_:-]/.test(character))
}

function findTagEnd(html, start) {
  let quote = ''
  for (let index = start; index < html.length; index += 1) {
    const character = html[index]
    if (quote) {
      if (character === quote) quote = ''
    } else if (character === '"' || character === "'") {
      quote = character
    } else if (character === '>') {
      return index
    }
  }
  return -1
}

function scanHtml(html, sourcePath) {
  const attributes = []
  const tags = []
  const failures = []
  const lowerHtml = html.toLowerCase()
  let cursor = 0

  while (cursor < html.length) {
    const opening = html.indexOf('<', cursor)
    if (opening < 0) break

    if (html.startsWith('<!--', opening)) {
      const closing = html.indexOf('-->', opening + 4)
      if (closing < 0) {
        const location = lineAndColumn(html, opening)
        failures.push(makeFailure('ARV_HTML_ATTRIBUTE', sourcePath, 'unterminated HTML comment', location.line, location.column))
        break
      }
      cursor = closing + 3
      continue
    }

    let index = opening + 1
    let closingTag = false
    if (html[index] === '/') {
      closingTag = true
      index += 1
    }
    while (/\s/.test(html[index] || '')) index += 1

    const tagNameStart = index
    while (/[A-Za-z0-9:-]/.test(html[index] || '')) index += 1
    if (index === tagNameStart) {
      const end = findTagEnd(html, index)
      cursor = end < 0 ? html.length : end + 1
      continue
    }

    const tagName = html.slice(tagNameStart, index).toLowerCase()
    if (closingTag) {
      const end = findTagEnd(html, index)
      if (end < 0) {
        const location = lineAndColumn(html, opening)
        failures.push(makeFailure('ARV_HTML_ATTRIBUTE', sourcePath, `unterminated closing ${tagName} tag`, location.line, location.column))
        break
      }
      cursor = end + 1
      continue
    }

    const tagAttributes = []
    let terminated = false
    while (index < html.length) {
      while (/\s/.test(html[index] || '')) index += 1
      if (html[index] === '>') {
        index += 1
        terminated = true
        break
      }
      if (html[index] === '/' && html[index + 1] === '>') {
        index += 2
        terminated = true
        break
      }
      if (!isNameCharacter(html[index])) {
        const location = lineAndColumn(html, index)
        failures.push(makeFailure('ARV_HTML_ATTRIBUTE', sourcePath, `malformed attribute in ${tagName} tag`, location.line, location.column))
        const end = findTagEnd(html, index)
        index = end < 0 ? html.length : end + 1
        terminated = end >= 0
        break
      }

      const nameStart = index
      while (isNameCharacter(html[index])) index += 1
      const name = html.slice(nameStart, index).toLowerCase()
      while (/\s/.test(html[index] || '')) index += 1

      let value = ''
      let quoted = false
      if (html[index] === '=') {
        index += 1
        while (/\s/.test(html[index] || '')) index += 1
        const quote = html[index]
        if (quote === '"' || quote === "'") {
          quoted = true
          index += 1
          const valueStart = index
          const closingQuote = html.indexOf(quote, index)
          if (closingQuote < 0) {
            const location = lineAndColumn(html, nameStart)
            failures.push(makeFailure('ARV_HTML_ATTRIBUTE', sourcePath, `${name} has an unterminated quoted value`, location.line, location.column))
            index = html.length
            break
          }
          value = html.slice(valueStart, closingQuote)
          index = closingQuote + 1
        } else {
          const valueStart = index
          while (index < html.length && !/[\s>]/.test(html[index])) index += 1
          value = html.slice(valueStart, index)
          if (name === 'src' || name === 'href' || name === 'id') {
            const location = lineAndColumn(html, nameStart)
            failures.push(makeFailure('ARV_HTML_ATTRIBUTE', sourcePath, `${name} must use a quoted value`, location.line, location.column))
          }
        }
      } else if (name === 'src' || name === 'href' || name === 'id') {
        const location = lineAndColumn(html, nameStart)
        failures.push(makeFailure('ARV_HTML_ATTRIBUTE', sourcePath, `${name} must have a quoted value`, location.line, location.column))
      }

      const location = lineAndColumn(html, nameStart)
      const record = { tag: tagName, attribute: name, value, line: location.line, column: location.column, quoted }
      tagAttributes.push(record)
      if (quoted && (name === 'src' || name === 'href' || name === 'id')) attributes.push(record)
    }

    tags.push({ name: tagName, attributes: tagAttributes })
    if (!terminated && index >= html.length) {
      const location = lineAndColumn(html, opening)
      if (!failures.some((failure) => failure.line === location.line && failure.column === location.column)) {
        failures.push(makeFailure('ARV_HTML_ATTRIBUTE', sourcePath, `unterminated ${tagName} tag`, location.line, location.column))
      }
      break
    }

    cursor = index
    if (tagName === 'script' || tagName === 'style') {
      const closing = lowerHtml.indexOf(`</${tagName}`, cursor)
      if (closing < 0) {
        const location = lineAndColumn(html, opening)
        failures.push(makeFailure('ARV_HTML_ATTRIBUTE', sourcePath, `unterminated ${tagName} body`, location.line, location.column))
        break
      }
      const end = findTagEnd(html, closing + tagName.length + 2)
      if (end < 0) {
        const location = lineAndColumn(html, closing)
        failures.push(makeFailure('ARV_HTML_ATTRIBUTE', sourcePath, `unterminated closing ${tagName} tag`, location.line, location.column))
        break
      }
      cursor = end + 1
    }
  }

  return { attributes, tags, failures }
}

function collectHtmlReferences(html, sourcePath = '<html>') {
  const result = scanHtml(String(html), sourcePath)
  throwFailures(result.failures)
  return result.attributes
}

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngFailure(label, detail) {
  return makeFailure('ARV_PNG_DECODE', label, detail)
}

function channelsForColorType(colorType) {
  return { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType]
}

function validBitDepth(colorType, bitDepth) {
  const valid = {
    0: [1, 2, 4, 8, 16],
    2: [8, 16],
    3: [1, 2, 4, 8],
    4: [8, 16],
    6: [8, 16],
  }
  return Boolean(valid[colorType]?.includes(bitDepth))
}

function passSize(total, start, step) {
  return total <= start ? 0 : Math.ceil((total - start) / step)
}

function pngPasses(width, height, interlace) {
  if (!interlace) return [{ width, height }]
  return [
    [0, 0, 8, 8],
    [4, 0, 8, 8],
    [0, 4, 4, 8],
    [2, 0, 4, 4],
    [0, 2, 2, 4],
    [1, 0, 2, 2],
    [0, 1, 1, 2],
  ].map(([x, y, dx, dy]) => ({ width: passSize(width, x, dx), height: passSize(height, y, dy) }))
    .filter((pass) => pass.width && pass.height)
}

function paethPredictor(left, up, upperLeft) {
  const estimate = left + up - upperLeft
  const leftDistance = Math.abs(estimate - left)
  const upDistance = Math.abs(estimate - up)
  const upperLeftDistance = Math.abs(estimate - upperLeft)
  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) return left
  if (upDistance <= upperLeftDistance) return up
  return upperLeft
}

function expectedScanlineBytes(passes, channels, bitDepth) {
  let total = 0
  for (const pass of passes) {
    const rowBytes = Math.ceil(pass.width * channels * bitDepth / 8)
    total += pass.height * (rowBytes + 1)
    if (!Number.isSafeInteger(total) || total > MAX_PNG_SCANLINE_BYTES) return -1
  }
  return total
}

function validateScanlines(raw, passes, channels, bitDepth, label) {
  const bytesPerPixel = Math.max(1, Math.ceil(channels * bitDepth / 8))
  let offset = 0

  for (const pass of passes) {
    const rowBytes = Math.ceil(pass.width * channels * bitDepth / 8)
    let previous = Buffer.alloc(rowBytes)
    for (let row = 0; row < pass.height; row += 1) {
      if (offset + rowBytes + 1 > raw.length) throw pngFailure(label, 'inflated scanline data is truncated')
      const filter = raw[offset]
      offset += 1
      if (filter < 0 || filter > 4) throw pngFailure(label, `scanline uses illegal filter ${filter}`)
      const reconstructed = Buffer.alloc(rowBytes)
      for (let column = 0; column < rowBytes; column += 1) {
        const encoded = raw[offset + column]
        const left = column >= bytesPerPixel ? reconstructed[column - bytesPerPixel] : 0
        const up = previous[column]
        const upperLeft = column >= bytesPerPixel ? previous[column - bytesPerPixel] : 0
        let predictor = 0
        if (filter === 1) predictor = left
        else if (filter === 2) predictor = up
        else if (filter === 3) predictor = Math.floor((left + up) / 2)
        else if (filter === 4) predictor = paethPredictor(left, up, upperLeft)
        reconstructed[column] = (encoded + predictor) & 0xff
      }
      offset += rowBytes
      previous = reconstructed
    }
  }

  if (offset !== raw.length) throw pngFailure(label, 'inflated scanline data has trailing bytes')
}

function parseTextChunk(type, data, label) {
  try {
    if (type === 'tEXt') return data.toString('latin1')
    if (type === 'zTXt') {
      const separator = data.indexOf(0)
      if (separator <= 0 || data[separator + 1] !== 0) throw new Error('invalid zTXt header')
      return `${data.subarray(0, separator).toString('latin1')}\0${zlib.inflateSync(data.subarray(separator + 2)).toString('latin1')}`
    }
    if (type === 'iTXt') {
      const keywordEnd = data.indexOf(0)
      if (keywordEnd <= 0 || keywordEnd + 3 > data.length) throw new Error('invalid iTXt header')
      const compressionFlag = data[keywordEnd + 1]
      const compressionMethod = data[keywordEnd + 2]
      if (![0, 1].includes(compressionFlag) || compressionMethod !== 0) throw new Error('invalid iTXt compression')
      const languageEnd = data.indexOf(0, keywordEnd + 3)
      const translatedEnd = languageEnd < 0 ? -1 : data.indexOf(0, languageEnd + 1)
      if (languageEnd < 0 || translatedEnd < 0) throw new Error('invalid iTXt fields')
      const payload = data.subarray(translatedEnd + 1)
      const decoded = compressionFlag ? zlib.inflateSync(payload) : payload
      return `${data.subarray(0, keywordEnd).toString('latin1')}\0${decoded.toString('utf8')}`
    }
  } catch {
    throw pngFailure(label, `${type} text metadata is invalid`)
  }
  return ''
}

function inspectPng(buffer, label = '<png>') {
  if (!Buffer.isBuffer(buffer)) throw pngFailure(label, 'input is not a Buffer')
  if (buffer.length < PNG_SIGNATURE.length || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw pngFailure(label, 'PNG signature is invalid')
  }

  let offset = 8
  let width = 0
  let height = 0
  let bitDepth = -1
  let colorType = -1
  let interlace = -1
  let sawHeader = false
  let sawPalette = false
  let sawData = false
  let dataEnded = false
  let sawEnd = false
  const idatParts = []
  const text = []

  while (offset < buffer.length) {
    if (offset + 12 > buffer.length) throw pngFailure(label, 'PNG chunk header is truncated')
    const length = buffer.readUInt32BE(offset)
    const chunkEnd = offset + 12 + length
    if (chunkEnd > buffer.length) throw pngFailure(label, 'PNG chunk payload is truncated')
    const typeBuffer = buffer.subarray(offset + 4, offset + 8)
    const type = typeBuffer.toString('ascii')
    if (!/^[A-Za-z]{4}$/.test(type)) throw pngFailure(label, 'PNG chunk type is invalid')
    if (type[2] !== type[2].toUpperCase()) throw pngFailure(label, `${type} chunk sets the reserved bit`)
    const data = buffer.subarray(offset + 8, offset + 8 + length)
    const expectedCrc = buffer.readUInt32BE(offset + 8 + length)
    const actualCrc = crc32(Buffer.concat([typeBuffer, data]))
    if (expectedCrc !== actualCrc) throw pngFailure(label, `${type} chunk CRC does not match`)

    if (!sawHeader && type !== 'IHDR') throw pngFailure(label, 'IHDR must be the first chunk')
    if (type === 'IHDR') {
      if (sawHeader || length !== 13) throw pngFailure(label, 'PNG must contain one 13-byte IHDR')
      sawHeader = true
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
      interlace = data[12]
      if (!width || !height || width > 0x7fffffff || height > 0x7fffffff) throw pngFailure(label, 'IHDR dimensions are invalid')
      if (!validBitDepth(colorType, bitDepth)) throw pngFailure(label, 'IHDR bit depth and color type are incompatible')
      if (data[10] !== 0 || data[11] !== 0 || ![0, 1].includes(interlace)) throw pngFailure(label, 'IHDR compression, filter, or interlace method is invalid')
    } else if (type === 'PLTE') {
      if (sawPalette || sawData || length < 3 || length > 768 || length % 3 !== 0 || [0, 4].includes(colorType)) {
        throw pngFailure(label, 'PLTE chunk is invalid or out of order')
      }
      if (colorType === 3 && length / 3 > 2 ** bitDepth) throw pngFailure(label, 'PLTE has too many entries for indexed color')
      sawPalette = true
    } else if (type === 'IDAT') {
      if (dataEnded) throw pngFailure(label, 'IDAT chunks must be consecutive')
      if (colorType === 3 && !sawPalette) throw pngFailure(label, 'indexed PNG requires PLTE before IDAT')
      sawData = true
      idatParts.push(data)
    } else if (type === 'IEND') {
      if (!sawData || sawEnd || length !== 0) throw pngFailure(label, 'IEND chunk is invalid')
      sawEnd = true
      offset = chunkEnd
      if (offset !== buffer.length) throw pngFailure(label, 'PNG has trailing data after IEND')
      break
    } else {
      if (sawData) dataEnded = true
      if (type === 'tEXt' || type === 'zTXt' || type === 'iTXt') text.push(parseTextChunk(type, data, label))
      if (type[0] === type[0].toUpperCase()) throw pngFailure(label, `unsupported critical chunk ${type}`)
    }
    offset = chunkEnd
  }

  if (!sawEnd) throw pngFailure(label, 'PNG is missing IEND')
  const channels = channelsForColorType(colorType)
  const passes = pngPasses(width, height, interlace)
  const expectedBytes = expectedScanlineBytes(passes, channels, bitDepth)
  if (expectedBytes < 0) throw pngFailure(label, 'PNG scanline data exceeds the verification limit')

  let raw
  try {
    raw = zlib.inflateSync(Buffer.concat(idatParts), { maxOutputLength: expectedBytes + 1 })
  } catch {
    throw pngFailure(label, 'IDAT inflate failed')
  }
  if (raw.length !== expectedBytes) throw pngFailure(label, 'inflated scanline length does not match IHDR')
  validateScanlines(raw, passes, channels, bitDepth, label)

  return { width, height, colorType, bitDepth, text }
}

function jpegFailure(label, detail) {
  return makeFailure('ARV_JPEG_DECODE', label, detail)
}

function isJpegFrameMarker(marker) {
  return [
    0xc0, 0xc1, 0xc2, 0xc3,
    0xc5, 0xc6, 0xc7,
    0xc9, 0xca, 0xcb,
    0xcd, 0xce, 0xcf,
  ].includes(marker)
}

function inspectJpeg(buffer, label = '<jpeg>') {
  if (!Buffer.isBuffer(buffer)) throw jpegFailure(label, 'input is not a Buffer')
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    throw jpegFailure(label, 'JPEG SOI marker is invalid')
  }

  let cursor = 2
  let width = 0
  let height = 0
  let precision = 0
  let sawFrame = false
  let sawScan = false
  let sawEnd = false

  while (cursor < buffer.length) {
    if (buffer[cursor] !== 0xff) throw jpegFailure(label, 'JPEG marker boundary is invalid')
    while (buffer[cursor] === 0xff) cursor += 1
    if (cursor >= buffer.length) throw jpegFailure(label, 'JPEG marker is truncated')
    const marker = buffer[cursor]
    cursor += 1

    if (marker === 0xd9) {
      sawEnd = true
      if (cursor !== buffer.length) throw jpegFailure(label, 'JPEG has trailing data after EOI')
      break
    }
    if (marker === 0x00 || marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      throw jpegFailure(label, 'JPEG contains an out-of-place standalone marker')
    }
    if (cursor + 2 > buffer.length) throw jpegFailure(label, 'JPEG segment length is truncated')
    const segmentLength = buffer.readUInt16BE(cursor)
    if (segmentLength < 2 || cursor + segmentLength > buffer.length) {
      throw jpegFailure(label, 'JPEG segment length is invalid')
    }
    const dataStart = cursor + 2
    const segmentEnd = cursor + segmentLength

    if (isJpegFrameMarker(marker)) {
      if (sawFrame || segmentLength < 11) throw jpegFailure(label, 'JPEG frame header is invalid')
      precision = buffer[dataStart]
      height = buffer.readUInt16BE(dataStart + 1)
      width = buffer.readUInt16BE(dataStart + 3)
      const components = buffer[dataStart + 5]
      if (!precision || !width || !height || !components || segmentLength !== 8 + (3 * components)) {
        throw jpegFailure(label, 'JPEG frame dimensions or components are invalid')
      }
      sawFrame = true
    }

    cursor = segmentEnd
    if (marker !== 0xda) continue
    if (!sawFrame || segmentLength < 8) throw jpegFailure(label, 'JPEG scan appears before a valid frame')
    const scanComponents = buffer[dataStart]
    if (!scanComponents || segmentLength !== 6 + (2 * scanComponents)) {
      throw jpegFailure(label, 'JPEG scan header is invalid')
    }
    sawScan = true

    while (cursor < buffer.length) {
      if (buffer[cursor] !== 0xff) {
        cursor += 1
        continue
      }
      if (cursor + 1 >= buffer.length) throw jpegFailure(label, 'JPEG entropy data is truncated')
      const next = buffer[cursor + 1]
      if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) {
        cursor += 2
        continue
      }
      if (next === 0xff) {
        cursor += 1
        continue
      }
      break
    }
  }

  if (!sawFrame || !sawScan || !sawEnd) throw jpegFailure(label, 'JPEG is missing frame, scan, or EOI markers')
  return { width, height, precision }
}

const CREDENTIAL_PATTERNS = [
  {
    name: 'private-key',
    regex: /-----BEGIN(?: [A-Z0-9]+)* PRIVATE KEY-----/gi,
    value: () => 'private-key',
  },
  {
    name: 'bearer-token',
    regex: /authorization["']?\s*[:=]\s*["']?\s*bearer\s+"((?:\\.|[^"\\\r\n])*)"/gi,
    value: (match) => match[1],
  },
  {
    name: 'bearer-token',
    regex: /authorization["']?\s*[:=]\s*["']?\s*bearer\s+'((?:\\.|[^'\\\r\n])*)'/gi,
    value: (match) => match[1],
  },
  {
    name: 'bearer-token',
    regex: /authorization["']?\s*[:=]\s*["']?\s*bearer\s+(?!["'])([^\s"',;<>}]+)/gi,
    value: (match) => match[1],
  },
  {
    name: 'credential-assignment',
    regex: /(?:api[_-]?key|secret|token|password)["']?\s*[:=]\s*"((?:\\.|[^"\\\r\n])*)"/gi,
    value: (match) => match[1],
  },
  {
    name: 'credential-assignment',
    regex: /(?:api[_-]?key|secret|token|password)["']?\s*[:=]\s*'((?:\\.|[^'\\\r\n])*)'/gi,
    value: (match) => match[1],
  },
  {
    name: 'credential-assignment',
    regex: /(?:api[_-]?key|secret|token|password)["']?\s*[:=]\s*(?!["'])([^\s"',;<>}\]]*)/gi,
    value: (match) => match[1],
  },
  {
    name: 'token-prefix',
    regex: /\b(ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{12,}|xox[baprs]-[A-Za-z0-9-]{12,}|AKIA[A-Z0-9]{16})\b/g,
    value: (match) => match[1],
  },
  {
    name: 'url-userinfo',
    regex: /[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:[^\s/@]+@/gi,
    value: () => 'url-userinfo',
  },
]

function isEmptyCredential(value) {
  const normalized = String(value || '').trim().replace(/["']+$/g, '').toLowerCase()
  return !normalized || ['redacted', '***', 'null', 'undefined', 'none', '未配置'].includes(normalized)
}

function scanCredentials(text, file, failures) {
  const source = decodePercentEncoding(text)
  for (const pattern of CREDENTIAL_PATTERNS) {
    pattern.regex.lastIndex = 0
    for (const match of source.matchAll(pattern.regex)) {
      if (pattern.name === 'credential-assignment' && isEmptyCredential(pattern.value(match))) continue
      const location = lineAndColumn(source, match.index)
      failures.push(makeFailure(
        'ARV_CREDENTIAL_PATTERN',
        file,
        `matched ${pattern.name}; value redacted`,
        location.line,
        location.column,
      ))
    }
  }
}

function gitShaCandidates(text) {
  const matches = []
  const regex = /(?<![0-9a-f])[0-9a-f]{7,64}(?![0-9a-f])/gi
  for (const match of String(text).matchAll(regex)) {
    const candidate = match[0]
    if (candidate.length === 40 || candidate.length === 64 || (/[a-f]/i.test(candidate) && /\d/.test(candidate))) {
      matches.push({ value: candidate, index: match.index })
    }
  }
  return matches
}

function scanPlaceholders(text, file, failures) {
  const source = String(text)
  for (const match of source.matchAll(/\b(PENDING|TODO|TBD)\b/gi)) {
    const location = lineAndColumn(source, match.index)
    failures.push(makeFailure('ARV_PENDING_CLAIM', file, `contains forbidden placeholder ${match[0].toUpperCase()}`, location.line, location.column))
  }
}

function scanTrackedClaims(text, file, failures) {
  const source = String(text)
  scanPlaceholders(source, file, failures)
  for (const match of gitShaCandidates(source)) {
    const location = lineAndColumn(source, match.index)
    failures.push(makeFailure('ARV_STALE_SHA', file, 'contains a tracked Git SHA claim', location.line, location.column))
  }
  for (const regex of [/\bGO\b/gi, /\b(\d+)\s*\/\s*\1\b/g]) {
    for (const match of source.matchAll(regex)) {
      const location = lineAndColumn(source, match.index)
      failures.push(makeFailure('ARV_STALE_CLAIM', file, 'contains an obsolete exact acceptance claim', location.line, location.column))
    }
  }
}

function isInside(root, target) {
  const relative = path.relative(root, target)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

function regularFileWithin(root, target) {
  try {
    const stat = fs.lstatSync(target)
    if (!stat.isFile() || stat.isSymbolicLink()) return false
    return isInside(fs.realpathSync(root), fs.realpathSync(target))
  } catch {
    return false
  }
}

function decodeReferencePath(value) {
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}

function idCounts(scan) {
  const counts = new Map()
  for (const reference of scan.attributes.filter((item) => item.attribute === 'id')) {
    counts.set(reference.value, (counts.get(reference.value) || 0) + 1)
  }
  return counts
}

function scanAuthority(scan, file, failures) {
  const meta = scan.tags.some((tag) => {
    if (tag.name !== 'meta') return false
    const attributes = Object.fromEntries(tag.attributes.map((item) => [item.attribute, item.value]))
    return attributes.name === 'localminidrama-evidence-authority' && attributes.content === 'machine-artifact'
  })
  if (!meta) failures.push(makeFailure('ARV_AUTHORITY_MARKER', file, 'must declare machine-artifact authority'))

  const body = scan.tags.some((tag) => {
    if (tag.name !== 'body') return false
    return tag.attributes.some((item) => item.attribute === 'data-evidence-role' && item.value === 'illustrative')
  })
  if (!body) failures.push(makeFailure('ARV_AUTHORITY_MARKER', file, 'body must declare illustrative evidence role'))
}

function verifyTrackedReport(options = {}) {
  const repoRoot = path.resolve(options.repoRoot || path.resolve(__dirname, '..', '..'))
  const reportPath = path.resolve(options.reportPath || path.join(repoRoot, ...REPORT_RELATIVE_PATH.split('/')))
  const notesPath = path.resolve(options.markdownPath || path.join(repoRoot, ...NOTES_RELATIVE_PATH.split('/')))
  const reportRoot = path.dirname(reportPath)
  const reportFile = relativePath(repoRoot, reportPath)
  const notesFile = relativePath(repoRoot, notesPath)
  const failures = []
  let html = ''
  let notes = ''

  try {
    html = fs.readFileSync(reportPath, 'utf8')
  } catch {
    failures.push(makeFailure('ARV_LOCAL_REF_MISSING', reportFile, 'tracked HTML report does not name a regular file'))
  }
  try {
    notes = fs.readFileSync(notesPath, 'utf8')
  } catch {
    failures.push(makeFailure('ARV_LOCAL_REF_MISSING', notesFile, 'tracked Markdown report does not name a regular file'))
  }

  scanCredentials(html, reportFile, failures)
  scanCredentials(notes, notesFile, failures)
  scanTrackedClaims(html, reportFile, failures)
  scanTrackedClaims(notes, notesFile, failures)

  const scan = scanHtml(html, reportFile)
  failures.push(...scan.failures)
  scanAuthority(scan, reportFile, failures)
  const ids = idCounts(scan)
  for (const [id, count] of ids) {
    if (id && count > 1) failures.push(makeFailure('ARV_ANCHOR_DUPLICATE', reportFile, `id ${id} occurs ${count} times`))
  }

  const externalScans = new Map()
  const inspectedPngs = new Set()
  let referenceCount = 0
  for (const reference of scan.attributes) {
    if (reference.attribute === 'id') continue
    referenceCount += 1
    const { attribute, value, line, column } = reference
    if (!value) {
      failures.push(makeFailure('ARV_LOCAL_REF_MISSING', reportFile, `${attribute} is empty`, line, column))
      continue
    }
    scanCredentials(value, reportFile, failures)

    if (attribute === 'href' && value.startsWith('#')) {
      const fragment = decodeReferencePath(value.slice(1))
      if (!fragment || ids.get(fragment) !== 1) {
        failures.push(makeFailure('ARV_ANCHOR_MISSING', reportFile, `${attribute} ${value} has no matching id`, line, column))
      }
      continue
    }

    const scheme = value.match(/^([a-z][a-z0-9+.-]*):/i)
    if (scheme || value.startsWith('//')) {
      failures.push(makeFailure('ARV_REF_SCHEME', reportFile, `${attribute} uses forbidden scheme ${scheme?.[1]?.toLowerCase() || 'protocol-relative'}`, line, column))
      continue
    }
    if (value.includes('?')) {
      failures.push(makeFailure('ARV_REF_SCHEME', reportFile, `${attribute} must not contain a query string`, line, column))
      continue
    }

    const hashIndex = value.indexOf('#')
    const encodedPath = hashIndex < 0 ? value : value.slice(0, hashIndex)
    const encodedFragment = hashIndex < 0 ? '' : value.slice(hashIndex + 1)
    const decodedPath = decodeReferencePath(encodedPath)
    const fragment = decodeReferencePath(encodedFragment)
    if (decodedPath === null || fragment === null || !decodedPath) {
      failures.push(makeFailure('ARV_LOCAL_REF_MISSING', reportFile, `${attribute} contains an invalid local path`, line, column))
      continue
    }
    if (decodedPath.includes('\\') || path.isAbsolute(decodedPath) || /^[A-Za-z]:/.test(decodedPath)) {
      failures.push(makeFailure('ARV_LOCAL_REF_ESCAPE', reportFile, `${attribute} ${value} resolves outside report root`, line, column))
      continue
    }

    const target = path.resolve(path.dirname(reportPath), decodedPath)
    if (!isInside(reportRoot, target)) {
      failures.push(makeFailure('ARV_LOCAL_REF_ESCAPE', reportFile, `${attribute} ${value} resolves outside report root`, line, column))
      continue
    }
    const targetFile = relativePath(repoRoot, target)
    if (!regularFileWithin(reportRoot, target)) {
      failures.push(makeFailure('ARV_LOCAL_REF_MISSING', reportFile, `${attribute} ${value} does not name a regular file`, line, column))
      continue
    }

    scanCredentials(path.basename(decodedPath), targetFile, failures)
    const extension = path.extname(target).toLowerCase()
    if (hashIndex >= 0) {
      if (attribute !== 'href' || extension !== '.html') {
        failures.push(makeFailure('ARV_LOCAL_REF_MISSING', reportFile, `${attribute} ${value} must target a regular HTML file`, line, column))
        continue
      }
      if (!fragment) {
        failures.push(makeFailure('ARV_ANCHOR_MISSING', reportFile, `${attribute} ${value} has an empty fragment`, line, column))
        continue
      }

      let targetData = externalScans.get(target)
      if (!targetData) {
        const targetScan = scanHtml(fs.readFileSync(target, 'utf8'), targetFile)
        const targetIds = idCounts(targetScan)
        targetData = { scan: targetScan, ids: targetIds }
        externalScans.set(target, targetData)
        failures.push(...targetScan.failures)
        for (const [id, count] of targetIds) {
          if (id && count > 1) failures.push(makeFailure('ARV_ANCHOR_DUPLICATE', targetFile, `id ${id} occurs ${count} times`))
        }
      }
      if (targetData.ids.get(fragment) !== 1) {
        failures.push(makeFailure('ARV_ANCHOR_MISSING', reportFile, `${attribute} ${value} has no unique matching id`, line, column))
      }
      continue
    }

    if (extension === '.png' && !inspectedPngs.has(target)) {
      const buffer = fs.readFileSync(target)
      inspectedPngs.add(target)
      try {
        const png = inspectPng(buffer, targetFile)
        for (const text of png.text) scanCredentials(text, targetFile, failures)
      } catch (error) {
        failures.push(error.code ? error : pngFailure(targetFile, 'PNG inspection failed'))
      }
    } else if (extension === '.jpg' || extension === '.jpeg') {
      try {
        inspectJpeg(fs.readFileSync(target), targetFile)
      } catch (error) {
        failures.push(error.code ? error : jpegFailure(targetFile, 'JPEG inspection failed'))
      }
    }
  }

  throwFailures(failures)
  return { references: referenceCount, pngs: inspectedPngs.size }
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

function readJson(file, displayFile, failures) {
  let text = ''
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    failures.push(makeFailure('ARV_LOCAL_REF_MISSING', displayFile, 'does not name a regular JSON file'))
    return { text, value: null }
  }
  try {
    return { text, value: JSON.parse(text) }
  } catch {
    failures.push(makeFailure('ARV_MANIFEST_SCHEMA', displayFile, 'contains invalid JSON'))
    return { text, value: null }
  }
}

function hasExactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const actual = Object.keys(value).sort()
  return actual.length === expected.length && actual.every((key, index) => key === [...expected].sort()[index])
}

function fullCommit(value) {
  return typeof value === 'string' && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(value)
}

function scanFinalMetadata(value, file, failures, expectedCommit, key = '') {
  if (typeof value === 'string') {
    scanPlaceholders(value, file, failures)
    for (const candidate of gitShaCandidates(value)) {
      const allowedCommit = value === expectedCommit
      const allowedChecksum = key === 'sha256' && /^[0-9a-f]{64}$/i.test(value)
      if (!allowedCommit && !allowedChecksum) failures.push(makeFailure('ARV_STALE_SHA', file, 'contains metadata for a different Git SHA'))
    }
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) scanFinalMetadata(item, file, failures, expectedCommit, key)
    return
  }
  if (value && typeof value === 'object') {
    for (const [childKey, child] of Object.entries(value)) scanFinalMetadata(child, file, failures, expectedCommit, childKey)
  }
}

function gitResult(repoRoot, args, options = {}) {
  return spawnSync('git', ['-C', repoRoot, ...args], {
    encoding: 'utf8',
    input: options.input,
    windowsHide: true,
  })
}

function verifyGitArtifactState(repoRoot, files, failures) {
  const relativeFiles = files.map((file) => relativePath(repoRoot, file))
  const tracked = gitResult(repoRoot, ['ls-files', '--', ...relativeFiles])
  const trackedSet = new Set(String(tracked.stdout || '').split(/\r?\n/).filter(Boolean).map(normalizePath))

  const ignored = gitResult(repoRoot, ['check-ignore', '--stdin'], { input: `${relativeFiles.join('\n')}\n` })
  const ignoredSet = new Set(String(ignored.stdout || '').split(/\r?\n/).filter(Boolean).map(normalizePath))
  for (let index = 0; index < files.length; index += 1) {
    const displayFile = relativeFiles[index]
    if (trackedSet.has(displayFile)) {
      failures.push(makeFailure('ARV_TRACKED_FINAL', displayFile, 'must be ignored final evidence, but is tracked'))
    }
    if (!ignoredSet.has(displayFile)) {
      failures.push(makeFailure('ARV_FINAL_IGNORED', displayFile, 'must be ignored final evidence'))
    }
  }
}

function fileSystemPathKey(target) {
  const resolved = normalizePath(path.resolve(target))
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

function enumerateTree(root) {
  const entries = []
  if (!fs.existsSync(root)) return entries
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name)
    let type = 'nonregular'
    if (entry.isSymbolicLink()) type = 'symlink'
    else if (entry.isDirectory()) type = 'directory'
    else if (entry.isFile()) type = 'file'
    entries.push({ target, type })
    if (type === 'directory') entries.push(...enumerateTree(target))
  }
  return entries
}

function verifyAcceptanceTree(evidenceRoot, repoRoot, failures) {
  const acceptanceRoot = path.join(evidenceRoot, 'acceptance-report')
  const screenshotRoot = path.join(acceptanceRoot, 'screenshots')
  const allowed = new Map([
    [fileSystemPathKey(path.join(acceptanceRoot, 'manifest.json')), 'file'],
    [fileSystemPathKey(screenshotRoot), 'directory'],
    ...REQUIRED_FINAL_CAPTURES.map((capture) => [
      fileSystemPathKey(path.join(screenshotRoot, `${capture.id}.png`)),
      'file',
    ]),
  ])
  const seen = new Set()

  for (const entry of enumerateTree(acceptanceRoot)) {
    const key = fileSystemPathKey(entry.target)
    const expectedType = allowed.get(key)
    if (!expectedType) {
      failures.push(makeFailure('ARV_REQUIRED_CAPTURE', relativePath(repoRoot, entry.target), 'extra acceptance-report entry is not allowed'))
      continue
    }
    seen.add(key)
    if (entry.type !== expectedType) {
      failures.push(makeFailure('ARV_REQUIRED_CAPTURE', relativePath(repoRoot, entry.target), `must be a regular ${expectedType}`))
    }
  }

  for (const [key, type] of allowed) {
    if (!seen.has(key)) failures.push(makeFailure('ARV_REQUIRED_CAPTURE', relativePath(repoRoot, key), `required ${type} is missing`))
  }
}

function verifyFinalDirectoryRoot(target, parentPhysicalRoot, repoRoot, label, failures) {
  const displayFile = relativePath(repoRoot, target)
  let valid = true
  let physicalRoot = null
  try {
    const stat = fs.lstatSync(target)
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      failures.push(makeFailure('ARV_FINAL_LOCATION', displayFile, `${label} must be a real directory, not a symbolic link`))
      valid = false
    }
  } catch {
    failures.push(makeFailure('ARV_FINAL_LOCATION', displayFile, `${label} must exist as a real directory`))
    valid = false
  }

  try {
    physicalRoot = fs.realpathSync(target)
  } catch {
    failures.push(makeFailure('ARV_FINAL_LOCATION', displayFile, `${label} physical path cannot be resolved`))
    valid = false
  }
  if (!parentPhysicalRoot || !physicalRoot || !isInside(parentPhysicalRoot, physicalRoot)) {
    failures.push(makeFailure('ARV_FINAL_LOCATION', displayFile, `${label} physical path must remain within its parent evidence directory`))
    valid = false
  }
  return { physicalRoot, valid }
}

function verifyCanonicalLeaf(target, physicalRoot, repoRoot, label, failures) {
  const displayFile = relativePath(repoRoot, target)
  try {
    const stat = fs.lstatSync(target)
    if (!stat.isFile() || stat.isSymbolicLink()) {
      failures.push(makeFailure('ARV_FINAL_LOCATION', displayFile, `${label} must be a regular file, not a symbolic link`))
      return false
    }
  } catch {
    failures.push(makeFailure('ARV_FINAL_LOCATION', displayFile, `${label} must exist as a regular file`))
    return false
  }

  try {
    if (!physicalRoot || !isInside(physicalRoot, fs.realpathSync(target))) {
      failures.push(makeFailure('ARV_FINAL_LOCATION', displayFile, `${label} physical path must remain within its evidence directory`))
      return false
    }
  } catch {
    failures.push(makeFailure('ARV_FINAL_LOCATION', displayFile, `${label} physical path cannot be resolved`))
    return false
  }
  return true
}

function verifyFinalEvidence(options = {}) {
  const repoRoot = path.resolve(options.repoRoot || path.resolve(__dirname, '..', '..'))
  const evidenceRoot = path.resolve(options.evidenceRoot || path.join(repoRoot, 'artifacts', 'e2e-production'))
  const acceptanceRoot = path.join(evidenceRoot, 'acceptance-report')
  const screenshotRoot = path.join(acceptanceRoot, 'screenshots')
  const manifestPath = path.join(acceptanceRoot, 'manifest.json')
  const evidencePath = path.join(evidenceRoot, 'evidence.json')
  const canonicalScreenshotFiles = REQUIRED_FINAL_CAPTURES.map((capture) => path.join(screenshotRoot, `${capture.id}.png`))
  const canonicalArtifactFiles = [
    manifestPath,
    evidencePath,
    ...canonicalScreenshotFiles,
  ]
  const expectedCommit = String(options.expectedCommit || '').trim().toLowerCase()
  const failures = []
  const evidenceRootFile = relativePath(repoRoot, evidenceRoot)
  let rootsValid = true

  if (
    !isInside(repoRoot, evidenceRoot)
    || evidenceRootFile.toLowerCase() !== 'artifacts/e2e-production'
    || evidenceRootFile.toLowerCase().includes('frontweb/public/reports')
  ) {
    failures.push(makeFailure('ARV_FINAL_LOCATION', evidenceRootFile, 'final evidence root must be confined to the ignored artifact tree'))
    rootsValid = false
  }
  let physicalRepoRoot = null
  try {
    physicalRepoRoot = fs.realpathSync(repoRoot)
  } catch {
    failures.push(makeFailure('ARV_FINAL_LOCATION', relativePath(repoRoot, repoRoot), 'repository physical path cannot be resolved'))
    rootsValid = false
  }
  const evidenceLocation = verifyFinalDirectoryRoot(evidenceRoot, physicalRepoRoot, repoRoot, 'final evidence root', failures)
  const acceptanceLocation = verifyFinalDirectoryRoot(acceptanceRoot, evidenceLocation.physicalRoot, repoRoot, 'acceptance-report root', failures)
  const screenshotLocation = verifyFinalDirectoryRoot(screenshotRoot, acceptanceLocation.physicalRoot, repoRoot, 'screenshots root', failures)
  rootsValid = rootsValid && evidenceLocation.valid && acceptanceLocation.valid && screenshotLocation.valid

  if (!fullCommit(expectedCommit)) {
    failures.push(makeFailure('ARV_EVIDENCE_COMMIT', evidenceRootFile, 'expected commit must be a full 40- or 64-hex revision'))
  }

  const headResult = gitResult(repoRoot, ['rev-parse', 'HEAD'])
  const actualHead = headResult.status === 0 ? String(headResult.stdout).trim().toLowerCase() : ''
  if (!actualHead || actualHead !== expectedCommit) {
    failures.push(makeFailure('ARV_EVIDENCE_COMMIT', evidenceRootFile, 'repository HEAD differs from expected commit'))
  }
  const statusResult = gitResult(repoRoot, ['status', '--porcelain=v1', '--untracked-files=all'])
  if (statusResult.status !== 0 || String(statusResult.stdout).trim()) {
    failures.push(makeFailure('ARV_REPOSITORY_STATE', evidenceRootFile, 'source worktree must be clean except for ignored artifacts'))
  }

  if (!rootsValid) {
    verifyGitArtifactState(repoRoot, canonicalArtifactFiles, failures)
    throwFailures(failures)
  }

  const manifestFile = relativePath(repoRoot, manifestPath)
  const evidenceFile = relativePath(repoRoot, evidencePath)
  const manifestValid = verifyCanonicalLeaf(manifestPath, acceptanceLocation.physicalRoot, repoRoot, 'manifest.json', failures)
  const evidenceValid = verifyCanonicalLeaf(evidencePath, evidenceLocation.physicalRoot, repoRoot, 'evidence.json', failures)
  const canonicalLeafValidity = new Map(canonicalScreenshotFiles.map((file) => [
    fileSystemPathKey(file),
    verifyCanonicalLeaf(file, screenshotLocation.physicalRoot, repoRoot, 'canonical screenshot', failures),
  ]))
  if (!manifestValid || !evidenceValid) {
    verifyGitArtifactState(repoRoot, canonicalArtifactFiles, failures)
    throwFailures(failures)
  }

  const manifestRead = readJson(manifestPath, manifestFile, failures)
  const evidenceRead = readJson(evidencePath, evidenceFile, failures)
  scanCredentials(manifestRead.text, manifestFile, failures)
  scanCredentials(evidenceRead.text, evidenceFile, failures)
  scanFinalMetadata(manifestRead.value, manifestFile, failures, expectedCommit)
  scanFinalMetadata(evidenceRead.value, evidenceFile, failures, expectedCommit)

  const manifest = manifestRead.value
  const evidence = evidenceRead.value
  if (!hasExactKeys(manifest, ['schema', 'source', 'e2eEvidence', 'screenshots']) || manifest?.schema !== MANIFEST_SCHEMA) {
    failures.push(makeFailure('ARV_MANIFEST_SCHEMA', manifestFile, `schema must be ${MANIFEST_SCHEMA} with only supported top-level fields`))
  }
  if (!hasExactKeys(manifest?.source, ['commit', 'repositoryClean']) || manifest?.source?.repositoryClean !== true) {
    failures.push(makeFailure('ARV_MANIFEST_SCHEMA', manifestFile, 'source must contain a full commit and repositoryClean=true'))
  }
  if (!hasExactKeys(manifest?.e2eEvidence, ['path', 'sha256']) || manifest?.e2eEvidence?.path !== '../evidence.json') {
    failures.push(makeFailure('ARV_MANIFEST_SCHEMA', manifestFile, 'e2eEvidence must identify ../evidence.json and its sha256'))
  }
  if (!Array.isArray(manifest?.screenshots)) {
    failures.push(makeFailure('ARV_MANIFEST_SCHEMA', manifestFile, 'screenshots must be an array'))
  }

  for (const [source, file] of [[manifest?.source, manifestFile], [evidence?.source, evidenceFile]]) {
    const commit = source?.commit
    if (!fullCommit(commit) || String(commit).toLowerCase() !== expectedCommit) {
      failures.push(makeFailure('ARV_EVIDENCE_COMMIT', file, 'source.commit differs from expected commit'))
    }
  }
  if (evidence?.status !== 'passed') {
    failures.push(makeFailure('ARV_EVIDENCE_STATUS', evidenceFile, 'evidence.json status must be passed'))
  }
  if (manifest?.e2eEvidence?.sha256 !== sha256(Buffer.from(evidenceRead.text))) {
    failures.push(makeFailure('ARV_CHECKSUM', evidenceFile, 'sha256 does not match manifest'))
  }

  const required = new Map(REQUIRED_FINAL_CAPTURES.map((capture) => [capture.id, capture]))
  const seenIds = new Set()
  const seenPaths = new Set()
  const entries = Array.isArray(manifest?.screenshots) ? manifest.screenshots : []
  for (const entry of entries) {
    const id = typeof entry?.id === 'string' ? entry.id : '<invalid>'
    if (!hasExactKeys(entry, ['id', 'path', 'sha256', 'bytes', 'mime', 'originalViewport', 'viewport', 'theme', 'surface'])) {
      failures.push(makeFailure('ARV_MANIFEST_SCHEMA', manifestFile, `screenshot ${id} has unsupported or missing fields`))
    }
    if (seenIds.has(id)) failures.push(makeFailure('ARV_REQUIRED_CAPTURE', manifestFile, `duplicate screenshot id ${id}`))
    seenIds.add(id)
    if (typeof entry?.path === 'string' && seenPaths.has(entry.path)) {
      failures.push(makeFailure('ARV_REQUIRED_CAPTURE', manifestFile, `duplicate screenshot path ${entry.path}`))
    }
    if (typeof entry?.path === 'string') seenPaths.add(entry.path)

    const capture = required.get(id)
    if (!capture) {
      failures.push(makeFailure('ARV_REQUIRED_CAPTURE', manifestFile, `extra ${id}`))
    } else if (
      entry.surface !== capture.surface
      || entry.theme !== capture.theme
      || entry.viewport?.width !== capture.width
      || entry.viewport?.height !== capture.height
    ) {
      failures.push(makeFailure('ARV_REQUIRED_CAPTURE', manifestFile, `${id} metadata does not match the required capture`))
    }

    if (
      entry?.mime !== 'image/png'
      || entry?.originalViewport !== true
      || typeof entry?.path !== 'string'
      || !entry.path.endsWith('.png')
      || entry.path !== `screenshots/${id}.png`
    ) {
      failures.push(makeFailure('ARV_FINAL_FORMAT', manifestFile, `${id} must be an original PNG at its canonical screenshot path`))
    }

    if (typeof entry?.path !== 'string') continue
    const target = path.resolve(path.dirname(manifestPath), entry.path)
    const targetFile = relativePath(repoRoot, target)
    if (!isInside(screenshotRoot, target) || targetFile.toLowerCase().includes('frontweb/public/reports')) {
      failures.push(makeFailure('ARV_FINAL_LOCATION', targetFile, 'illustrative public-report evidence cannot be final evidence'))
      continue
    }
    const targetKey = fileSystemPathKey(target)
    if (!canonicalLeafValidity.has(targetKey)) {
      failures.push(makeFailure('ARV_FINAL_LOCATION', targetFile, 'does not name a canonical final screenshot'))
      continue
    }
    if (!canonicalLeafValidity.get(targetKey)) {
      continue
    }
    scanCredentials(entry.path, targetFile, failures)
    const buffer = fs.readFileSync(target)
    if (entry.bytes !== buffer.length) failures.push(makeFailure('ARV_BYTE_COUNT', targetFile, 'byte count does not match manifest'))
    if (entry.sha256 !== sha256(buffer)) failures.push(makeFailure('ARV_CHECKSUM', targetFile, 'sha256 does not match manifest'))
    try {
      const png = inspectPng(buffer, targetFile)
      if (png.width !== entry.viewport?.width || png.height !== entry.viewport?.height) {
        failures.push(makeFailure(
          'ARV_PNG_DIMENSIONS',
          targetFile,
          `manifest ${entry.viewport?.width}x${entry.viewport?.height}, PNG ${png.width}x${png.height}`,
        ))
      }
      for (const metadata of png.text) {
        scanCredentials(metadata, targetFile, failures)
        scanPlaceholders(metadata, targetFile, failures)
        for (const candidate of gitShaCandidates(metadata)) {
          if (candidate.value.toLowerCase() !== expectedCommit) failures.push(makeFailure('ARV_STALE_SHA', targetFile, 'PNG metadata contains a different Git SHA'))
        }
      }
    } catch (error) {
      failures.push(error.code ? error : pngFailure(targetFile, 'PNG inspection failed'))
    }
  }

  for (const capture of REQUIRED_FINAL_CAPTURES) {
    if (!seenIds.has(capture.id)) {
      failures.push(makeFailure('ARV_REQUIRED_CAPTURE', manifestFile, `missing ${capture.surface} ${capture.width}x${capture.height} ${capture.theme}`))
    }
  }

  verifyAcceptanceTree(evidenceRoot, repoRoot, failures)

  verifyGitArtifactState(repoRoot, canonicalArtifactFiles, failures)

  throwFailures(failures)
  return { commit: expectedCommit, screenshots: entries.length }
}

module.exports = {
  REQUIRED_FINAL_CAPTURES,
  collectHtmlReferences,
  formatFailures,
  inspectPng,
  verifyFinalEvidence,
  verifyTrackedReport,
}
