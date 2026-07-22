'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { TextDecoder } = require('node:util')

const MAX_JSON_BYTES = 4 * 1024 * 1024
const MAX_JSON_DEPTH = 128
const MAX_JSON_PROPERTIES = 100000
const MAX_DIAGNOSTIC_BYTES = 4096

class JsonScanSyntaxError extends Error {}

const ORDINAL_UPPERCASE_EXCLUSIONS = new Set(['\u0131', '\u017f'])

function ordinalIgnoreCaseKey(value) {
  return Array.from(value, (character) => {
    if (ORDINAL_UPPERCASE_EXCLUSIONS.has(character)) return character
    const upper = character.toUpperCase()
    return Array.from(upper).length === 1 ? upper : character
  }).join('')
}

function parseJsonWithUniqueObjectKeys(text, { rejectCaseCollisions = false } = {}) {
  if (typeof text !== 'string') throw new TypeError('rollback JSON input must be a string')
  if (Buffer.byteLength(text, 'utf8') > MAX_JSON_BYTES) {
    throw new Error(`rollback JSON exceeds the ${MAX_JSON_BYTES}-byte limit`)
  }

  let index = 0
  let propertyCount = 0

  const skipWhitespace = () => {
    while (index < text.length && /[\u0009\u000a\u000d\u0020]/.test(text[index])) index += 1
  }

  const scanString = () => {
    const start = index
    index += 1
    while (index < text.length) {
      const character = text[index]
      if (character === '"') {
        index += 1
        return text.slice(start, index)
      }
      if (character === '\\') {
        index += 2
      } else {
        index += 1
      }
    }
    throw new JsonScanSyntaxError('unterminated JSON string')
  }

  const scanScalar = () => {
    const start = index
    while (index < text.length && !/[\u0009\u000a\u000d\u0020,\[\]{}:]/.test(text[index])) index += 1
    if (index === start) throw new JsonScanSyntaxError('expected JSON value')
  }

  const scanValue = (depth) => {
    skipWhitespace()
    if (index >= text.length) throw new JsonScanSyntaxError('expected JSON value')
    if (text[index] === '{') return scanObject(depth + 1)
    if (text[index] === '[') return scanArray(depth + 1)
    if (text[index] === '"') {
      scanString()
      return
    }
    scanScalar()
  }

  const scanObject = (depth) => {
    if (depth > MAX_JSON_DEPTH) throw new Error(`rollback JSON exceeds the depth limit of ${MAX_JSON_DEPTH}`)
    index += 1
    skipWhitespace()
    if (text[index] === '}') {
      index += 1
      return
    }

    const exactKeys = new Set()
    const caseFoldedKeys = new Map()
    while (index < text.length) {
      skipWhitespace()
      if (text[index] !== '"') throw new JsonScanSyntaxError('expected JSON object property name')
      const rawKey = scanString()
      const decodedKey = JSON.parse(rawKey)
      propertyCount += 1
      if (propertyCount > MAX_JSON_PROPERTIES) {
        throw new Error(`rollback JSON exceeds the property limit of ${MAX_JSON_PROPERTIES}`)
      }
      if (exactKeys.has(decodedKey)) throw new Error('duplicate JSON object key')
      exactKeys.add(decodedKey)

      if (rejectCaseCollisions) {
        const foldedKey = ordinalIgnoreCaseKey(decodedKey)
        const priorKey = caseFoldedKeys.get(foldedKey)
        if (priorKey !== undefined && priorKey !== decodedKey) {
          throw new Error('case collision between JSON object keys')
        }
        caseFoldedKeys.set(foldedKey, decodedKey)
      }

      skipWhitespace()
      if (text[index] !== ':') throw new JsonScanSyntaxError('expected colon after JSON object property name')
      index += 1
      scanValue(depth)
      skipWhitespace()
      if (text[index] === '}') {
        index += 1
        return
      }
      if (text[index] !== ',') throw new JsonScanSyntaxError('expected comma between JSON object members')
      index += 1
    }
    throw new JsonScanSyntaxError('unterminated JSON object')
  }

  const scanArray = (depth) => {
    if (depth > MAX_JSON_DEPTH) throw new Error(`rollback JSON exceeds the depth limit of ${MAX_JSON_DEPTH}`)
    index += 1
    skipWhitespace()
    if (text[index] === ']') {
      index += 1
      return
    }
    while (index < text.length) {
      scanValue(depth)
      skipWhitespace()
      if (text[index] === ']') {
        index += 1
        return
      }
      if (text[index] !== ',') throw new JsonScanSyntaxError('expected comma between JSON array items')
      index += 1
    }
    throw new JsonScanSyntaxError('unterminated JSON array')
  }

  try {
    scanValue(0)
    skipWhitespace()
    if (index !== text.length) throw new JsonScanSyntaxError('unexpected trailing JSON content')
  } catch (error) {
    if (!(error instanceof JsonScanSyntaxError)) throw error
    JSON.parse(text)
    throw error
  }
  return JSON.parse(text)
}

function readStrictUtf8OrdinaryFile(filePath) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) {
    throw new Error('rollback JSON check path must be absolute')
  }

  const before = fs.lstatSync(filePath, { bigint: true })
  if (before.isSymbolicLink() || !before.isFile()) {
    throw new Error('rollback JSON check path must be an ordinary file')
  }
  if (before.size > BigInt(MAX_JSON_BYTES)) {
    throw new Error(`rollback JSON exceeds the ${MAX_JSON_BYTES}-byte limit`)
  }

  const descriptor = fs.openSync(filePath, 'r')
  try {
    const opened = fs.fstatSync(descriptor, { bigint: true })
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) {
      throw new Error('rollback JSON check path changed during open')
    }
    const bytes = fs.readFileSync(descriptor)
    if (bytes.length > MAX_JSON_BYTES) {
      throw new Error(`rollback JSON exceeds the ${MAX_JSON_BYTES}-byte limit`)
    }
    const after = fs.lstatSync(filePath, { bigint: true })
    if (after.isSymbolicLink() || !after.isFile() || after.dev !== opened.dev || after.ino !== opened.ino) {
      throw new Error('rollback JSON check path changed during read')
    }
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
  } catch (error) {
    if (error instanceof TypeError && /encoded data was not valid/i.test(error.message)) {
      throw new Error('rollback JSON must be strict UTF-8')
    }
    throw error
  } finally {
    fs.closeSync(descriptor)
  }
}

function boundedDiagnostic(error) {
  const message = String(error && error.message ? error.message : error)
    .replace(/[\r\n]+/g, ' ')
    .trim() || 'rollback JSON validation failed'
  const bytes = Buffer.from(message, 'utf8')
  if (bytes.length < MAX_DIAGNOSTIC_BYTES) return `${message}\n`
  const prefix = bytes.subarray(0, MAX_DIAGNOSTIC_BYTES - 64).toString('utf8')
  return `${prefix} [diagnostic truncated]\n`
}

function main(argv) {
  if (argv.length !== 2 || argv[0] !== '--check') {
    throw new Error('usage: rollback-json-contract.cjs --check <absolute-file>')
  }
  const text = readStrictUtf8OrdinaryFile(argv[1])
  parseJsonWithUniqueObjectKeys(text, { rejectCaseCollisions: true })
}

if (require.main === module) {
  try {
    main(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(boundedDiagnostic(error))
    process.exitCode = 1
  }
}

module.exports = {
  MAX_DIAGNOSTIC_BYTES,
  MAX_JSON_BYTES,
  MAX_JSON_DEPTH,
  MAX_JSON_PROPERTIES,
  parseJsonWithUniqueObjectKeys,
}
