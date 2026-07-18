import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { deflateSync } from 'node:zlib'

const require = createRequire(import.meta.url)
const contract = require('../scripts/acceptance-report-contract.cjs')

const {
  REQUIRED_FINAL_CAPTURES,
  collectHtmlReferences,
  formatFailures,
  inspectPng,
  verifyFinalEvidence,
  verifyTrackedReport,
} = contract

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const REPORT_RELATIVE_PATH = 'frontweb/public/reports/product-acceptance/report.html'
const NOTES_RELATIVE_PATH = 'docs/ui-refresh-20260718.md'
const acceptanceReportSource = readFileSync(new URL('../public/reports/product-acceptance/report.html', import.meta.url), 'utf8')

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

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii')
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])))
  return Buffer.concat([length, typeBuffer, data, checksum])
}

function createPng(width, height, options = {}) {
  const {
    bitDepth = 1,
    colorType = 0,
    filters = [0],
    idat,
    interlace = 0,
    chunksBeforeIdat = [],
    textChunks = [],
  } = options
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = bitDepth
  ihdr[9] = colorType
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = interlace

  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType]
  const rowBytes = Math.ceil(width * channels * bitDepth / 8)
  const rows = []
  for (let row = 0; row < height; row += 1) {
    rows.push(Buffer.from([filters[row % filters.length]]), Buffer.alloc(rowBytes))
  }
  const compressed = idat || deflateSync(Buffer.concat(rows))

  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    ...textChunks.map(([keyword, value]) => pngChunk('tEXt', Buffer.from(`${keyword}\0${value}`, 'latin1'))),
    ...chunksBeforeIdat.map(([type, data]) => pngChunk(type, data)),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

function jpegSegment(marker, data) {
  const length = Buffer.alloc(2)
  length.writeUInt16BE(data.length + 2)
  return Buffer.concat([Buffer.from([0xff, marker]), length, data])
}

function createJpeg(width = 8, height = 5, options = {}) {
  const app0 = Buffer.from([
    0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
  ])
  const sof = Buffer.alloc(9)
  sof[0] = 8
  sof.writeUInt16BE(height, 1)
  sof.writeUInt16BE(width, 3)
  sof[5] = 1
  sof[6] = 1
  sof[7] = 0x11
  sof[8] = 0
  const sos = Buffer.from([1, 1, 0, 0, 63, 0])
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    jpegSegment(0xe0, app0),
    ...(options.omitDimensions ? [] : [jpegSegment(0xc0, sof)]),
    jpegSegment(0xda, sos),
    Buffer.from([0x11, 0x22, 0x33]),
    Buffer.from([0xff, 0xd9]),
  ])
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

function withTempDir(prefix, callback) {
  const directory = mkdtempSync(path.join(tmpdir(), prefix))
  try {
    return callback(directory)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

function write(root, relativePath, value) {
  const target = path.join(root, ...relativePath.split('/'))
  mkdirSync(path.dirname(target), { recursive: true })
  writeFileSync(target, value)
  return target
}

function aggregateCodes(callback) {
  try {
    callback()
    assert.fail('expected verification to fail')
  } catch (error) {
    assert.ok(error instanceof AggregateError, `expected AggregateError, received ${error}`)
    return error.errors.map((failure) => failure.code)
  }
}

function aggregateFailure(callback) {
  try {
    callback()
    assert.fail('expected verification to fail')
  } catch (error) {
    assert.ok(error instanceof AggregateError, `expected AggregateError, received ${error}`)
    return error
  }
}

function thrownCode(callback) {
  try {
    callback()
    assert.fail('expected callback to throw')
  } catch (error) {
    return error.code
  }
}

function git(root, args, options = {}) {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    stdio: options.stdio || ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function validTrackedHtml(image = 'evidence.png') {
  return `<!doctype html>
<html>
<head>
  <meta name="localminidrama-evidence-authority" content="machine-artifact">
  <style>.ignored { background-image: url("missing-style.png"); }</style>
</head>
<body data-evidence-role="illustrative">
  <!-- <img src="missing-comment.png"> -->
  <script>const markup = '<img src="missing-script.png">'</script>
  <a href="#evidence">Evidence</a>
  <section id="evidence"><img src="${image}" alt="Illustrative evidence"></section>
</body>
</html>`
}

function validTrackedNotes(extra = '') {
  return `# Acceptance notes

Evidence authority: machine-artifact
Tracked evidence role: illustrative

Numeric context that is not a Git revision: 20260718, 1280x720, 295, deadbeef.
apiKey: REDACTED
token=null
password: ***
secret: 未配置
${extra}`
}

function createTrackedFixture(root, options = {}) {
  const report = write(root, REPORT_RELATIVE_PATH, options.html || validTrackedHtml(options.imageName))
  const notes = write(root, NOTES_RELATIVE_PATH, options.notes || validTrackedNotes())
  const image = path.join(path.dirname(report), options.imageName || 'evidence.png')
  if (!options.skipImage) {
    mkdirSync(path.dirname(image), { recursive: true })
    writeFileSync(image, options.png || createPng(8, 5, { bitDepth: 8, filters: [0, 1, 2, 3, 4] }))
  }
  return { report, notes, image }
}

function initRepository(root, { ignoreArtifacts = true } = {}) {
  git(root, ['init', '--quiet'])
  git(root, ['config', 'user.email', 'acceptance@example.invalid'])
  git(root, ['config', 'user.name', 'Acceptance Fixture'])
  write(root, '.gitignore', ignoreArtifacts ? 'artifacts/\n' : '*.nothing\n')
  write(root, 'source.txt', 'fixture source\n')
  git(root, ['add', '.gitignore', 'source.txt'])
  git(root, ['commit', '--quiet', '-m', 'fixture source'])
  return git(root, ['rev-parse', 'HEAD'])
}

function writeFinalFixture(root, options = {}) {
  const commit = initRepository(root, options)
  const evidenceRoot = path.join(root, 'artifacts', 'e2e-production')
  const manifestRoot = path.join(evidenceRoot, 'acceptance-report')
  const screenshotRoot = path.join(manifestRoot, 'screenshots')
  mkdirSync(screenshotRoot, { recursive: true })

  const evidence = {
    status: 'passed',
    source: { commit },
  }
  const evidencePath = write(evidenceRoot, 'evidence.json', `${JSON.stringify(evidence, null, 2)}\n`)
  const evidenceBuffer = readFileSync(evidencePath)

  const screenshots = REQUIRED_FINAL_CAPTURES.map((capture) => {
    const png = createPng(capture.width, capture.height)
    const relativePath = `screenshots/${capture.id}.png`
    write(manifestRoot, relativePath, png)
    return {
      id: capture.id,
      path: relativePath,
      sha256: sha256(png),
      bytes: png.length,
      mime: 'image/png',
      originalViewport: true,
      viewport: { width: capture.width, height: capture.height },
      theme: capture.theme,
      surface: capture.surface,
    }
  })

  const manifest = {
    schema: 'localminidrama.acceptance-screenshot-manifest.v1',
    source: { commit, repositoryClean: true },
    e2eEvidence: { path: '../evidence.json', sha256: sha256(evidenceBuffer) },
    screenshots,
  }
  const manifestPath = write(manifestRoot, 'manifest.json', `${JSON.stringify(manifest, null, 2)}\n`)
  return { commit, evidence, evidencePath, evidenceRoot, manifest, manifestPath, screenshotRoot }
}

function rewriteJson(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)
}

test('contract exposes the deterministic verifier API and exact final capture matrix', () => {
  assert.equal(typeof inspectPng, 'function')
  assert.equal(typeof collectHtmlReferences, 'function')
  assert.equal(typeof verifyTrackedReport, 'function')
  assert.equal(typeof verifyFinalEvidence, 'function')
  assert.equal(typeof formatFailures, 'function')
  assert.equal(REQUIRED_FINAL_CAPTURES.length, 20)
  assert.deepEqual(
    REQUIRED_FINAL_CAPTURES.map(({ surface, width, height, theme }) => `${surface}:${width}x${height}:${theme}`),
    [
      'project-readiness:1280x720:light',
      'project-readiness:1280x720:dark',
      'project-readiness:1366x768:light',
      'project-readiness:1366x768:dark',
      'project-readiness:1440x900:light',
      'project-readiness:1440x900:dark',
      'film-pipeline:1280x720:light',
      'film-pipeline:1280x720:dark',
      'film-pipeline:1366x768:light',
      'film-pipeline:1366x768:dark',
      'film-pipeline:1440x900:light',
      'film-pipeline:1440x900:dark',
      'ai-config-management:1280x720:light',
      'ai-config-management:1280x720:dark',
      'ai-config-management:1366x768:light',
      'ai-config-management:1366x768:dark',
      'ai-config-management:1440x900:light',
      'ai-config-management:1440x900:dark',
      'ai-config-coverage:1024x768:light',
      'ai-config-coverage:1024x768:dark',
    ],
  )
})

test('HTML scanner collects quoted attributes and skips comments, script, and style bodies', () => {
  const references = collectHtmlReferences(validTrackedHtml(), 'report.html')
  assert.deepEqual(
    references.map(({ attribute, value }) => [attribute, value]),
    [
      ['href', '#evidence'],
      ['id', 'evidence'],
      ['src', 'evidence.png'],
    ],
  )
})

test('HTML scanner rejects missing, unquoted, and unterminated relevant attributes', () => {
  for (const html of ['<img src>', '<img src=asset.png>', '<a href="unterminated>link</a>']) {
    const codes = aggregateCodes(() => collectHtmlReferences(html, 'report.html'))
    assert.ok(codes.includes('ARV_HTML_ATTRIBUTE'))
  }
})

test('PNG inspection validates CRC, deflate data, filters, and dimensions', () => {
  const valid = createPng(7, 5, { bitDepth: 8, filters: [0, 1, 2, 3, 4] })
  assert.deepEqual(inspectPng(valid, 'valid.png'), {
    width: 7,
    height: 5,
    colorType: 0,
    bitDepth: 8,
    text: [],
  })

  const truncated = valid.subarray(0, valid.length - 3)
  assert.equal(thrownCode(() => inspectPng(truncated, 'truncated.png')), 'ARV_PNG_DECODE')

  const badCrc = Buffer.from(valid)
  badCrc[badCrc.length - 5] ^= 0xff
  assert.equal(thrownCode(() => inspectPng(badCrc, 'bad-crc.png')), 'ARV_PNG_DECODE')

  const badDeflate = createPng(7, 5, { bitDepth: 8, idat: Buffer.from('not-deflate') })
  assert.equal(thrownCode(() => inspectPng(badDeflate, 'bad-deflate.png')), 'ARV_PNG_DECODE')

  const badFilter = createPng(7, 1, { bitDepth: 8, filters: [5] })
  assert.equal(thrownCode(() => inspectPng(badFilter, 'bad-filter.png')), 'ARV_PNG_DECODE')

  const reservedBit = createPng(7, 1, { bitDepth: 8, chunksBeforeIdat: [['abcd', Buffer.alloc(0)]] })
  assert.equal(thrownCode(() => inspectPng(reservedBit, 'reserved-bit.png')), 'ARV_PNG_DECODE')
})

test('tracked verification accepts illustrative PNGs without imposing final viewport dimensions', () => {
  withTempDir('arv-tracked-pass-', (root) => {
    createTrackedFixture(root, { png: createPng(1265, 712) })
    assert.deepEqual(verifyTrackedReport({ repoRoot: root }), { references: 2, pngs: 1 })
  })
})

test('tracked verification validates JPEG structure and dimensions for illustrative JPG references', () => {
  withTempDir('arv-tracked-jpeg-', (root) => {
    createTrackedFixture(root, {
      imageName: 'final-20260717/06-historical-screen.jpg',
      png: createJpeg(),
    })
    assert.deepEqual(verifyTrackedReport({ repoRoot: root }), { references: 2, pngs: 0 })
  })
})

test('tracked verification rejects JPEG bytes under PNG names and malformed JPG structures', () => {
  withTempDir('arv-tracked-format-', (root) => {
    createTrackedFixture(root, { imageName: 'unknown.png', png: createJpeg() })
    assert.ok(aggregateCodes(() => verifyTrackedReport({ repoRoot: root })).includes('ARV_PNG_DECODE'))
  })

  withTempDir('arv-tracked-bad-jpeg-', (root) => {
    const malformed = createJpeg(8, 5, { omitDimensions: true })
    createTrackedFixture(root, { imageName: 'malformed.jpg', png: malformed })
    assert.ok(aggregateCodes(() => verifyTrackedReport({ repoRoot: root })).includes('ARV_JPEG_DECODE'))
  })
})

test('tracked verification reports missing and escaping refs, schemes, anchors, and malformed attributes', () => {
  withTempDir('arv-tracked-refs-', (root) => {
    createTrackedFixture(root, {
      skipImage: true,
      html: `<!doctype html>
        <html><head><meta name="localminidrama-evidence-authority" content="machine-artifact"></head>
        <body data-evidence-role="illustrative">
          <img src="missing.png"><img src="../outside.png"><img src=https://example.invalid/x.png>
          <a href="#absent">missing</a><i id="duplicate"></i><b id="duplicate"></b>
        </body></html>`,
    })
    const codes = aggregateCodes(() => verifyTrackedReport({ repoRoot: root }))
    for (const code of [
      'ARV_LOCAL_REF_MISSING',
      'ARV_LOCAL_REF_ESCAPE',
      'ARV_HTML_ATTRIBUTE',
      'ARV_ANCHOR_MISSING',
      'ARV_ANCHOR_DUPLICATE',
    ]) assert.ok(codes.includes(code), `missing ${code}: ${codes.join(', ')}`)
  })

  withTempDir('arv-tracked-scheme-', (root) => {
    createTrackedFixture(root, {
      html: validTrackedHtml().replace('href="#evidence"', 'href="javascript:alert(1)"'),
    })
    assert.ok(aggregateCodes(() => verifyTrackedReport({ repoRoot: root })).includes('ARV_REF_SCHEME'))
  })

  withTempDir('arv-tracked-external-anchor-', (root) => {
    const fixture = createTrackedFixture(root, {
      html: validTrackedHtml().replace('href="#evidence"', 'href="other.html#target"'),
    })
    write(path.dirname(fixture.report), 'other.html', '<!doctype html><html><body><div id="target"></div></body></html>')
    assert.ok(aggregateCodes(() => verifyTrackedReport({ repoRoot: root })).includes('ARV_EXTERNAL_ANCHOR'))
  })
})

test('tracked verification enforces authority markers and rejects placeholders and stale claims', () => {
  withTempDir('arv-tracked-authority-', (root) => {
    createTrackedFixture(root, {
      html: validTrackedHtml().replace('<meta name="localminidrama-evidence-authority" content="machine-artifact">', ''),
      notes: validTrackedNotes(`
        PENDING
        Local candidate GO
        Tests passed 295/295
        abc1234
        f5812c2c828c0bc7806d203de2180dfbc9d29c79
      `),
    })
    const codes = aggregateCodes(() => verifyTrackedReport({ repoRoot: root }))
    assert.ok(codes.includes('ARV_AUTHORITY_MARKER'))
    assert.ok(codes.includes('ARV_PENDING_CLAIM'))
    assert.ok(codes.includes('ARV_STALE_CLAIM'))
    assert.ok(codes.includes('ARV_STALE_SHA'))
  })
})

test('tracked verification scans report text, filenames, and PNG text without echoing credentials', () => {
  withTempDir('arv-tracked-secret-', (root) => {
    const textSecret = 'fixture-report-password'
    const fileSecret = 'ghp_1234567890abcdefghijklmnopqrstuv'
    const pngSecret = 'sk-fixture-png-secret-value'
    createTrackedFixture(root, {
      imageName: `${fileSecret}.png`,
      notes: validTrackedNotes(`password=${textSecret}`),
      png: createPng(8, 5, { textChunks: [['Comment', `token=${pngSecret}`]] }),
    })
    const error = aggregateFailure(() => verifyTrackedReport({ repoRoot: root }))
    const output = formatFailures(error.errors)
    assert.match(output, /ARV_CREDENTIAL_PATTERN/)
    assert.match(output, /value redacted/)
    assert.doesNotMatch(output, new RegExp(textSecret))
    assert.doesNotMatch(output, new RegExp(fileSecret))
    assert.doesNotMatch(output, new RegExp(pngSecret))
  })
})

test('failure formatting is stable and redacts bearer and assignment values', () => {
  const output = formatFailures([
    { code: 'Z_CODE', file: 'z.html', line: 8, column: 3, detail: 'Authorization: Bearer fixture-bearer-secret' },
    { code: 'A_CODE', file: 'a.html', line: 2, column: 1, detail: 'password=fixture-password-secret' },
  ])
  assert.deepEqual(output.split('\n').map((line) => line.split(' ')[0]), ['A_CODE', 'Z_CODE'])
  assert.doesNotMatch(output, /fixture-bearer-secret|fixture-password-secret/)
})

test('failure formatting fully redacts quoted, spaced, unquoted, encoded, path, and detail credentials', () => {
  const output = formatFailures([
    {
      code: 'ARV_CREDENTIAL_PATTERN',
      file: 'reports/password%3D%22EncodedPiece%20EncodedTail%22/result.html',
      detail: 'password="DoublePiece DoubleTail" token=\'SinglePiece SingleTail\' secret=UnquotedPiece',
    },
  ])
  assert.doesNotMatch(
    output,
    /DoublePiece|DoubleTail|SinglePiece|SingleTail|UnquotedPiece|EncodedPiece|EncodedTail|%3D|%22|%20/i,
  )
})

test('tracked report labels every screenshot and historical run statement as illustrative context', () => {
  const labels = [...acceptanceReportSource.matchAll(/class="step-health">([^<]+)</g)].map((match) => match[1])
  assert.ok(labels.length >= 35)
  assert.ok(labels.every((label) => label === '说明性'), labels.join(', '))
  assert.doesNotMatch(acceptanceReportSource, /截图证明|均无横向溢出|播放到 ended|干净提交生产 E2E 已|本轮实际运行/)
})

test('final verification accepts exactly 20 ignored and untracked captures from a clean full commit', () => {
  withTempDir('arv-final-pass-', (root) => {
    const fixture = writeFinalFixture(root)
    const firstPath = path.join(fixture.screenshotRoot, `${REQUIRED_FINAL_CAPTURES[0].id}.png`)
    assert.doesNotThrow(() => git(root, ['check-ignore', '-q', firstPath]))
    assert.throws(() => git(root, ['ls-files', '--error-unmatch', '--', firstPath]))

    assert.deepEqual(verifyFinalEvidence({
      repoRoot: root,
      evidenceRoot: fixture.evidenceRoot,
      expectedCommit: fixture.commit,
    }), { commit: fixture.commit, screenshots: 20 })
  })
})

test('final verification rejects untracked and non-ignored source or config files', () => {
  withTempDir('arv-final-untracked-source-', (root) => {
    const fixture = writeFinalFixture(root)
    write(root, 'local-review.js', 'export const dirty = true\n')
    write(root, 'config/local-review.json', '{}\n')
    const codes = aggregateCodes(() => verifyFinalEvidence({
      repoRoot: root,
      evidenceRoot: fixture.evidenceRoot,
      expectedCommit: fixture.commit,
    }))
    assert.ok(codes.includes('ARV_REPOSITORY_STATE'))
  })
})

test('final verification rejects every bypass entry under the acceptance-report root', () => {
  withTempDir('arv-final-bypass-', (root) => {
    const fixture = writeFinalFixture(root)
    const acceptanceRoot = path.dirname(fixture.manifestPath)
    write(acceptanceRoot, 'notes.txt', 'not allowed\n')
    mkdirSync(path.join(acceptanceRoot, 'extra-directory'))

    let symlinkCreated = false
    try {
      symlinkSync(fixture.manifestPath, path.join(acceptanceRoot, 'manifest-link.json'), 'file')
      symlinkCreated = true
    } catch (error) {
      if (!['EPERM', 'EACCES', 'UNKNOWN'].includes(error.code)) throw error
    }

    let caseVariant = ''
    if (process.platform !== 'win32') {
      const capture = REQUIRED_FINAL_CAPTURES[0]
      const canonical = path.join(fixture.screenshotRoot, `${capture.id}.png`)
      caseVariant = `${capture.id.toUpperCase()}.png`
      writeFileSync(path.join(fixture.screenshotRoot, caseVariant), readFileSync(canonical))
    }

    const error = aggregateFailure(() => verifyFinalEvidence({
      repoRoot: root,
      evidenceRoot: fixture.evidenceRoot,
      expectedCommit: fixture.commit,
    }))
    const output = formatFailures(error.errors)
    assert.match(output, /notes\.txt/)
    assert.match(output, /extra-directory/)
    if (symlinkCreated) assert.match(output, /manifest-link\.json/)
    if (caseVariant) assert.match(output, new RegExp(caseVariant, 'i'))
  })
})

test('final verification rejects missing and extra captures, cropped dimensions, bytes, checksums, and JPG entries', () => {
  withTempDir('arv-final-matrix-', (root) => {
    const fixture = writeFinalFixture(root)
    const removed = fixture.manifest.screenshots.shift()
    fixture.manifest.screenshots.push({ ...removed, id: 'extra-surface-1280x720-light', surface: 'extra-surface' })
    const cropped = fixture.manifest.screenshots[0]
    const croppedPng = createPng(cropped.viewport.width, 376)
    write(path.dirname(fixture.manifestPath), cropped.path, croppedPng)
    cropped.bytes = croppedPng.length
    cropped.sha256 = sha256(croppedPng)
    fixture.manifest.screenshots[1].bytes += 1
    fixture.manifest.screenshots[2].sha256 = '0'.repeat(64)
    fixture.manifest.screenshots[3].path = fixture.manifest.screenshots[3].path.replace(/\.png$/, '.jpg')
    fixture.manifest.screenshots[3].mime = 'image/jpeg'
    rewriteJson(fixture.manifestPath, fixture.manifest)

    const codes = aggregateCodes(() => verifyFinalEvidence({
      repoRoot: root,
      evidenceRoot: fixture.evidenceRoot,
      expectedCommit: fixture.commit,
    }))
    assert.ok(codes.filter((code) => code === 'ARV_REQUIRED_CAPTURE').length >= 2)
    assert.ok(codes.includes('ARV_PNG_DIMENSIONS'))
    assert.ok(codes.includes('ARV_BYTE_COUNT'))
    assert.ok(codes.includes('ARV_CHECKSUM'))
    assert.ok(codes.includes('ARV_FINAL_FORMAT'))
  })
})

test('final verification rejects manifest, evidence, and repository commit or status mismatches', () => {
  withTempDir('arv-final-identity-', (root) => {
    const fixture = writeFinalFixture(root)
    const otherCommit = 'a1'.repeat(20)
    fixture.manifest.source.commit = otherCommit
    fixture.evidence.status = 'failed'
    fixture.evidence.source.commit = otherCommit
    rewriteJson(fixture.evidencePath, fixture.evidence)
    rewriteJson(fixture.manifestPath, fixture.manifest)
    write(root, 'source.txt', 'dirty source\n')

    const codes = aggregateCodes(() => verifyFinalEvidence({
      repoRoot: root,
      evidenceRoot: fixture.evidenceRoot,
      expectedCommit: fixture.commit,
    }))
    assert.ok(codes.includes('ARV_EVIDENCE_COMMIT'))
    assert.ok(codes.includes('ARV_EVIDENCE_STATUS'))
    assert.ok(codes.includes('ARV_CHECKSUM'))
    assert.ok(codes.includes('ARV_REPOSITORY_STATE'))
  })
})

test('final verification rejects tracked, non-ignored, escaping, and public-report final evidence', () => {
  withTempDir('arv-final-tracked-', (root) => {
    const fixture = writeFinalFixture(root)
    const firstPath = path.join(fixture.screenshotRoot, `${REQUIRED_FINAL_CAPTURES[0].id}.png`)
    git(root, ['add', '-f', firstPath])
    const codes = aggregateCodes(() => verifyFinalEvidence({
      repoRoot: root,
      evidenceRoot: fixture.evidenceRoot,
      expectedCommit: fixture.commit,
    }))
    assert.ok(codes.includes('ARV_TRACKED_FINAL'))
  })

  withTempDir('arv-final-not-ignored-', (root) => {
    const fixture = writeFinalFixture(root, { ignoreArtifacts: false })
    const codes = aggregateCodes(() => verifyFinalEvidence({
      repoRoot: root,
      evidenceRoot: fixture.evidenceRoot,
      expectedCommit: fixture.commit,
    }))
    assert.ok(codes.includes('ARV_FINAL_IGNORED'))
  })

  withTempDir('arv-final-location-', (root) => {
    const fixture = writeFinalFixture(root)
    fixture.manifest.screenshots[0].path = '../../../frontweb/public/reports/final.png'
    rewriteJson(fixture.manifestPath, fixture.manifest)
    const codes = aggregateCodes(() => verifyFinalEvidence({
      repoRoot: root,
      evidenceRoot: fixture.evidenceRoot,
      expectedCommit: fixture.commit,
    }))
    assert.ok(codes.includes('ARV_FINAL_LOCATION'))
  })

  withTempDir('arv-final-root-', (root) => {
    const fixture = writeFinalFixture(root)
    const codes = aggregateCodes(() => verifyFinalEvidence({
      repoRoot: root,
      evidenceRoot: path.join(root, 'some-other-ignored-root'),
      expectedCommit: fixture.commit,
    }))
    assert.ok(codes.includes('ARV_FINAL_LOCATION'))
  })
})

test('final verification rejects secret and stale metadata without echoing values', () => {
  withTempDir('arv-final-secret-', (root) => {
    const fixture = writeFinalFixture(root)
    const bearerSecret = 'fixture-final-bearer-secret'
    fixture.evidence.authorization = `Bearer ${bearerSecret}`
    fixture.evidence.previousCommit = 'b2'.repeat(20)
    rewriteJson(fixture.evidencePath, fixture.evidence)
    fixture.manifest.e2eEvidence.sha256 = sha256(readFileSync(fixture.evidencePath))
    rewriteJson(fixture.manifestPath, fixture.manifest)

    const error = aggregateFailure(() => verifyFinalEvidence({
      repoRoot: root,
      evidenceRoot: fixture.evidenceRoot,
      expectedCommit: fixture.commit,
    }))
    const output = formatFailures(error.errors)
    assert.match(output, /ARV_CREDENTIAL_PATTERN/)
    assert.match(output, /ARV_STALE_SHA/)
    assert.doesNotMatch(output, new RegExp(bearerSecret))
  })
})

test('CLI supports tracked mode and resolves final commit from the temporary Git repository', () => {
  withTempDir('arv-cli-tracked-', (root) => {
    createTrackedFixture(root)
    const result = spawnSync(process.execPath, [
      path.resolve('scripts/verify-acceptance-report.cjs'),
      '--mode=tracked',
      '--repo-root', root,
    ], { cwd: path.resolve('.'), encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(JSON.parse(result.stdout), {
      status: 'passed',
      mode: 'tracked',
      references: 2,
      pngs: 1,
    })
  })

  withTempDir('arv-cli-final-', (root) => {
    const fixture = writeFinalFixture(root)
    const result = spawnSync(process.execPath, [
      path.resolve('scripts/verify-acceptance-report.cjs'),
      '--mode=final',
      '--repo-root', root,
      '--evidence-root', fixture.evidenceRoot,
    ], { cwd: path.resolve('.'), encoding: 'utf8', env: { ...process.env, LOCALMINIDRAMA_BUILD_REVISION: '' } })
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(JSON.parse(result.stdout), {
      status: 'passed',
      mode: 'final',
      commit: fixture.commit,
      screenshots: 20,
    })
  })
})
