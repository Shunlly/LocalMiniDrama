'use strict'

const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fsp = require('node:fs/promises')
const path = require('node:path')
const { TextDecoder } = require('node:util')
const { DEFAULT_LIMITS } = require('../backend-node/src/services/dataBackupService')
const {
  MINIMUM_ZIP_ARCHIVE_BYTES,
  SUPPORTED_FORMAT_VERSIONS,
} = require('../backend-node/src/services/dataBackupFormatContract')

const EVIDENCE_SCHEMA = 'localminidrama.rollback-drill.v3'
const EVIDENCE_RELATIVE_PATH = 'artifacts/rollback-drill/summary.json'
const ROLLBACK_RESULT_SCHEMA = 'localminidrama.rollback-result.v1'
const ROLLBACK_RESULT_MARKER_PREFIX = 'LOCALMINIDRAMA_ROLLBACK_RESULT_V1='
const MAX_ROLLBACK_RESULT_EVIDENCE_BYTES = 512 * 1024
const MAX_ROLLBACK_RESULT_MARKER_BYTES = 1024 * 1024
const MAX_ROLLBACK_RESULT_STREAM_BYTES = 2 * 1024 * 1024
const VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/
const RESULT_ENVELOPE_FIELDS = Object.freeze([
  'schema',
  'evidence_utf8_base64url',
  'evidence_sha256',
  'diagnostic_relative_path',
])
const STRICT_UTF8_DECODER = new TextDecoder('utf-8', { fatal: true })

function comparablePath(value) {
  const normalized = path.normalize(value)
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function evidenceOutputPath(repoRoot) {
  return path.join(path.resolve(repoRoot), ...EVIDENCE_RELATIVE_PATH.split('/'))
}

function parseDrillArguments(args) {
  assert.ok(Array.isArray(args), 'rollback drill arguments must be an array')
  if (args.length === 0) {
    return {
      inputMode: 'standalone',
      archivePath: null,
      dataRoot: null,
    }
  }

  assert.equal(args.length, 4, 'checkpoint-bound rollback drill requires one --archive and one --data-root pair')
  const values = new Map()
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index]
    const value = args[index + 1]
    assert.ok(flag === '--archive' || flag === '--data-root', `unknown rollback drill argument: ${flag}`)
    assert.equal(values.has(flag), false, `duplicate rollback drill argument: ${flag}`)
    assert.equal(typeof value, 'string', `${flag} requires an absolute path`)
    assert.equal(path.isAbsolute(value), true, `${flag} requires an absolute path`)
    assert.equal(comparablePath(path.resolve(value)), comparablePath(value), `${flag} path must be fully resolved`)
    values.set(flag, value)
  }
  assert.equal(values.has('--archive'), true, 'checkpoint-bound rollback drill requires --archive')
  assert.equal(values.has('--data-root'), true, 'checkpoint-bound rollback drill requires --data-root')
  return {
    inputMode: 'checkpoint-bound',
    archivePath: values.get('--archive'),
    dataRoot: values.get('--data-root'),
  }
}

async function lstatIfExists(targetPath) {
  try {
    return await fsp.lstat(targetPath)
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

function statType(stat) {
  if (stat.isFile()) return 'file'
  if (stat.isDirectory()) return 'directory'
  return 'unsupported'
}

async function assertNoRedirectingPathComponents(targetPath) {
  const resolved = path.resolve(targetPath)
  assert.equal(comparablePath(resolved), comparablePath(targetPath), `${targetPath} must be an absolute resolved path`)
  const parsed = path.parse(resolved)
  const segments = resolved.slice(parsed.root.length).split(path.sep).filter(Boolean)
  let current = parsed.root
  for (const segment of segments) {
    current = path.join(current, segment)
    const stat = await fsp.lstat(current, { bigint: true })
    assert.equal(stat.isSymbolicLink(), false, `${current} must not contain a symbolic link or reparse point`)
    const realPath = await fsp.realpath(current)
    assert.equal(comparablePath(realPath), comparablePath(current), `${current} must resolve to its real path without reparse redirection`)
  }
  return resolved
}

async function capturePathIdentity(target, expectedType) {
  assert.ok(expectedType === 'file' || expectedType === 'directory', 'expected path type must be file or directory')
  const targetPath = typeof target === 'string' ? target : target?.path
  const handle = typeof target === 'object' && target !== null ? target.handle : null
  assert.equal(typeof targetPath, 'string', 'path identity target must include a path')
  const resolved = await assertNoRedirectingPathComponents(targetPath)
  const stat = handle
    ? await handle.stat({ bigint: true })
    : await fsp.lstat(resolved, { bigint: true })
  const type = statType(stat)
  assert.equal(type, expectedType, `${resolved} must be a regular ${expectedType}`)
  const realPath = await fsp.realpath(resolved)
  const identity = {
    dev: stat.dev,
    ino: stat.ino,
    type,
    size: stat.size,
    ctimeNs: stat.ctimeNs,
    realPath,
  }
  if (handle) {
    const pathStat = await fsp.lstat(resolved, { bigint: true })
    assertSamePathIdentity(identity, {
      dev: pathStat.dev,
      ino: pathStat.ino,
      type: statType(pathStat),
      size: pathStat.size,
      ctimeNs: pathStat.ctimeNs,
      realPath,
    }, 'open descriptor and path')
  }
  return identity
}

function assertSamePathIdentity(before, after, label) {
  assert.ok(before && after, `${label} identity is missing`)
  for (const field of ['dev', 'ino', 'type', 'size', 'ctimeNs']) {
    assert.equal(after[field], before[field], `${label} ${field} identity changed`)
  }
  assert.equal(
    comparablePath(after.realPath),
    comparablePath(before.realPath),
    `${label} real path identity changed`
  )
}

function isPathOutsideRoot(root, candidate, pathApi = path) {
  const relative = pathApi.relative(root, candidate)
  return pathApi.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${pathApi.sep}`)
}

async function assertCheckpointInputPaths(options) {
  assert.equal(options?.inputMode, 'checkpoint-bound', 'checkpoint input validation requires checkpoint-bound mode')
  assert.equal(path.isAbsolute(options?.archivePath || ''), true, 'checkpoint archive path must be absolute')
  assert.equal(path.isAbsolute(options?.dataRoot || ''), true, 'checkpoint data root must be absolute')
  assert.equal(
    comparablePath(path.resolve(options.archivePath)),
    comparablePath(options.archivePath),
    'checkpoint archive path must be fully resolved'
  )
  assert.equal(
    comparablePath(path.resolve(options.dataRoot)),
    comparablePath(options.dataRoot),
    'checkpoint data root must be fully resolved'
  )
  const archiveIdentity = await capturePathIdentity(options.archivePath, 'file')
  const dataRootIdentity = await capturePathIdentity(options.dataRoot, 'directory')
  assert.ok(
    isPathOutsideRoot(options.dataRoot, options.archivePath),
    'checkpoint archive must be outside the data root'
  )
  return { archiveIdentity, dataRootIdentity }
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'))
}

function normalizedRelativePath(value) {
  return value.split(path.sep).join('/')
}

function updateLengthFrame(hash, length) {
  const value = typeof length === 'bigint' ? length : BigInt(length)
  assert.ok(value >= 0n && value <= 0xffffffffffffffffn, 'fingerprint frame length is out of range')
  const frame = Buffer.allocUnsafe(8)
  frame.writeBigUInt64BE(value)
  hash.update(frame)
}

function updateBytesFrame(hash, value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8')
  updateLengthFrame(hash, bytes.length)
  hash.update(bytes)
}

function positiveSafeIntegerLimit(limits, key) {
  assert.ok(limits && typeof limits === 'object', 'rollback limits must be an object')
  const value = limits[key]
  assert.ok(Number.isSafeInteger(value) && value > 0, `rollback limit ${key} must be a positive safe integer`)
  return value
}

async function readFileIntoHash(handle, expectedSize, maxBytes, hash) {
  assert.ok(expectedSize <= maxBytes, 'fingerprinted file exceeds the file size limit')
  const buffer = Buffer.allocUnsafe(Math.min(1024 * 1024, Number(maxBytes)))
  let total = 0n
  while (true) {
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, null)
    if (bytesRead === 0) break
    total += BigInt(bytesRead)
    assert.ok(total <= maxBytes, 'fingerprinted file exceeds the file size limit while it is read')
    assert.ok(total <= expectedSize, 'fingerprinted file grew while it was read')
    hash.update(buffer.subarray(0, bytesRead))
  }
  assert.equal(total, expectedSize, 'fingerprinted file length changed while it was read')
}

async function readDirectoryNamesBounded(absolutePath, maxEntries) {
  const names = []
  const directory = await fsp.opendir(absolutePath)
  for await (const dirent of directory) {
    assert.ok(BigInt(names.length) < maxEntries, 'data root directory exceeds the discovered entry limit')
    names.push(dirent.name)
  }
  return names.sort(compareUtf8)
}

async function fingerprintDataRoot(root, hooks = {}, limits = DEFAULT_LIMITS) {
  const maxFiles = BigInt(positiveSafeIntegerLimit(limits, 'maxFiles'))
  const maxTotalBytes = BigInt(positiveSafeIntegerLimit(limits, 'maxTotalBytes'))
  const maxFileBytes = BigInt(positiveSafeIntegerLimit(limits, 'maxFileBytes'))
  const maxPathBytes = positiveSafeIntegerLimit(limits, 'maxPathBytes')
  const maxPathDepth = positiveSafeIntegerLimit(limits, 'maxPathDepth')
  const maxRegularFiles = maxFiles + 1n
  const maxEntries = (maxFiles * BigInt(maxPathDepth)) + 1n
  const resolvedRoot = path.resolve(root)
  assert.equal(comparablePath(resolvedRoot), comparablePath(root), 'data root path must be fully resolved')
  const rootIdentity = await capturePathIdentity(resolvedRoot, 'directory')
  const entries = []
  const directories = []
  let discoveredEntries = 0n
  let regularFiles = 0n
  let totalBytes = 0n

  async function discoverDirectory(absolutePath, relativePath) {
    const identity = await capturePathIdentity(absolutePath, 'directory')
    const children = []
    const directory = await fsp.opendir(absolutePath)
    for await (const dirent of directory) {
      const name = dirent.name
      const childAbsolutePath = path.join(absolutePath, name)
      const childRelativePath = normalizedRelativePath(relativePath ? path.join(relativePath, name) : name)
      discoveredEntries += 1n
      assert.ok(discoveredEntries <= maxEntries, 'data root exceeds the discovered entry limit')
      assert.ok(Buffer.byteLength(childRelativePath, 'utf8') <= maxPathBytes, `${childRelativePath} exceeds the path size limit`)
      assert.ok(childRelativePath.split('/').length <= maxPathDepth, `${childRelativePath} exceeds the path depth limit`)
      assert.equal(dirent.isSymbolicLink(), false, `${childRelativePath} must not be a symbolic link or reparse point`)
      const type = dirent.isFile() ? 'file' : dirent.isDirectory() ? 'directory' : 'unsupported'
      assert.notEqual(type, 'unsupported', `${childRelativePath} has an unsupported entry type`)
      const childIdentity = await capturePathIdentity(childAbsolutePath, type)
      if (type === 'file') {
        regularFiles += 1n
        assert.ok(regularFiles <= maxRegularFiles, 'data root exceeds the regular file limit')
        assert.ok(childIdentity.size <= maxFileBytes, `${childRelativePath} exceeds the file size limit`)
        totalBytes += childIdentity.size
        assert.ok(totalBytes <= maxTotalBytes, 'data root exceeds the aggregate byte limit')
      }
      const entry = {
        absolutePath: childAbsolutePath,
        name,
        relativePath: childRelativePath,
        type,
        identity: childIdentity,
      }
      entries.push(entry)
      children.push(entry)
    }
    const names = children.map((entry) => entry.name).sort(compareUtf8)
    directories.push({ absolutePath, relativePath, identity, names })
    for (const child of children.sort((left, right) => compareUtf8(left.relativePath, right.relativePath))) {
      if (child.type === 'directory') await discoverDirectory(child.absolutePath, child.relativePath)
    }
  }

  await discoverDirectory(resolvedRoot, '')
  entries.sort((left, right) => compareUtf8(left.relativePath, right.relativePath))

  const hash = crypto.createHash('sha256')
  hash.update('localminidrama-data-root-fingerprint-v1\0', 'utf8')
  for (const entry of entries) {
    await hooks.onEntry?.({
      absolutePath: entry.absolutePath,
      relativePath: entry.relativePath,
      type: entry.type,
    })
    const beforeRead = await capturePathIdentity(entry.absolutePath, entry.type)
    assertSamePathIdentity(entry.identity, beforeRead, `data root entry ${entry.relativePath}`)
    updateBytesFrame(hash, entry.type)
    updateBytesFrame(hash, entry.relativePath)
    updateLengthFrame(hash, entry.type === 'file' ? beforeRead.size : 0n)
    if (entry.type === 'file') {
      let handle
      try {
        handle = await fsp.open(entry.absolutePath, 'r')
        const descriptorIdentity = await capturePathIdentity({ handle, path: entry.absolutePath }, 'file')
        assertSamePathIdentity(beforeRead, descriptorIdentity, `data root entry ${entry.relativePath}`)
        assert.ok(beforeRead.size <= maxFileBytes, `${entry.relativePath} exceeds the file size limit before read`)
        await readFileIntoHash(handle, beforeRead.size, maxFileBytes, hash)
        const descriptorAfterRead = await capturePathIdentity({ handle, path: entry.absolutePath }, 'file')
        assertSamePathIdentity(descriptorIdentity, descriptorAfterRead, `data root entry ${entry.relativePath}`)
      } finally {
        if (handle) await handle.close()
      }
    }
    await hooks.afterEntryRead?.({
      absolutePath: entry.absolutePath,
      relativePath: entry.relativePath,
      type: entry.type,
    })
    const afterRead = await capturePathIdentity(entry.absolutePath, entry.type)
    assertSamePathIdentity(beforeRead, afterRead, `data root entry ${entry.relativePath}`)
  }

  for (const directory of [...directories].reverse()) {
    await hooks.beforeDirectoryPostCheck?.({
      absolutePath: directory.absolutePath,
      relativePath: directory.relativePath,
    })
    if (directory.relativePath === '') await hooks.beforeRootPostCheck?.({ absolutePath: directory.absolutePath })
    const names = await readDirectoryNamesBounded(directory.absolutePath, maxEntries)
    assert.deepEqual(names, directory.names, `data root directory ${directory.relativePath || '.'} entries changed`)
    const after = await capturePathIdentity(directory.absolutePath, 'directory')
    assertSamePathIdentity(directory.identity, after, `data root directory ${directory.relativePath || '.'}`)
  }
  const finalRootIdentity = await capturePathIdentity(resolvedRoot, 'directory')
  assertSamePathIdentity(rootIdentity, finalRootIdentity, 'data root')
  return hash.digest('hex')
}

async function ensureRealDirectory(targetPath) {
  const stat = await lstatIfExists(targetPath)
  if (stat) {
    assert.equal(stat.isSymbolicLink(), false, `${targetPath} must not be a symbolic link`)
    assert.equal(stat.isDirectory(), true, `${targetPath} must be a directory`)
  } else {
    await fsp.mkdir(targetPath)
  }
  const realPath = await fsp.realpath(targetPath)
  assert.equal(comparablePath(realPath), comparablePath(targetPath), `${targetPath} must be a real directory`)
}

async function ensureEvidenceDirectory(repoRoot) {
  const resolvedRoot = path.resolve(repoRoot)
  const artifactsRoot = path.join(resolvedRoot, 'artifacts')
  const evidenceRoot = path.join(artifactsRoot, 'rollback-drill')
  await ensureRealDirectory(artifactsRoot)
  await ensureRealDirectory(evidenceRoot)
  return evidenceRoot
}

async function prepareEvidenceTarget(repoRoot, version) {
  assert.match(version || '', VERSION_PATTERN, 'expected rollback evidence version is invalid')
  return ensureEvidenceDirectory(repoRoot)
}

function serializeEvidence(evidence) {
  return Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
}

function assertSafeDiagnosticRelativePath(relativePath) {
  assert.equal(typeof relativePath, 'string', 'rollback diagnostic relative path must be a string')
  assert.ok(Buffer.byteLength(relativePath, 'utf8') <= 240, 'rollback diagnostic relative path is too long')
  assert.match(
    relativePath,
    /^artifacts\/rollback-drill\/summary-v3-[a-f0-9]{40}-[a-f0-9]{32}\.json$/,
    'rollback diagnostic relative path is invalid'
  )
  return relativePath
}

function diagnosticRelativePathForEvidence(evidence) {
  return assertSafeDiagnosticRelativePath(
    `artifacts/rollback-drill/summary-v3-${evidence.source.commit}-${crypto.randomBytes(16).toString('hex')}.json`
  )
}

function assertSameDiagnosticIdentity(expected, actual, label) {
  assert.ok(expected && actual, `${label} identity is missing`)
  assert.equal(actual.isSymbolicLink(), false, `${label} must not be a symbolic link`)
  assert.equal(actual.isFile(), true, `${label} must be a regular file`)
  for (const field of ['dev', 'ino', 'size']) assert.equal(actual[field], expected[field], `${label} ${field} changed`)
}

async function writeDiagnosticFile(outputPath, evidenceBytes) {
  let handle
  let hasPrimaryError = false
  let primaryError
  try {
    handle = await fsp.open(outputPath, 'wx+', 0o600)
    await handle.writeFile(evidenceBytes)
    await handle.sync()
    const descriptorBefore = await handle.stat({ bigint: true })
    assert.equal(descriptorBefore.isFile(), true, 'rollback diagnostic descriptor must be a regular file')
    assert.equal(descriptorBefore.size, BigInt(evidenceBytes.length), 'rollback diagnostic descriptor length changed')
    const pathBefore = await fsp.lstat(outputPath, { bigint: true })
    assertSameDiagnosticIdentity(descriptorBefore, pathBefore, 'rollback diagnostic path')

    const actualBytes = Buffer.allocUnsafe(evidenceBytes.length)
    let offset = 0
    while (offset < actualBytes.length) {
      const { bytesRead } = await handle.read(actualBytes, offset, actualBytes.length - offset, offset)
      assert.notEqual(bytesRead, 0, 'rollback diagnostic bytes were truncated')
      offset += bytesRead
    }
    const extra = Buffer.allocUnsafe(1)
    const { bytesRead: extraBytesRead } = await handle.read(extra, 0, 1, evidenceBytes.length)
    assert.equal(extraBytesRead, 0, 'rollback diagnostic bytes grew during verification')
    assert.equal(crypto.timingSafeEqual(actualBytes, evidenceBytes), true, 'rollback diagnostic bytes changed')

    const descriptorAfter = await handle.stat({ bigint: true })
    const pathAfter = await fsp.lstat(outputPath, { bigint: true })
    assertSameDiagnosticIdentity(descriptorBefore, descriptorAfter, 'rollback diagnostic descriptor')
    assertSameDiagnosticIdentity(descriptorBefore, pathAfter, 'rollback diagnostic path')
  } catch (error) {
    hasPrimaryError = true
    primaryError = error
  }

  let hasCloseError = false
  let closeError
  if (handle) {
    try {
      await handle.close()
    } catch (error) {
      hasCloseError = true
      closeError = error
    }
  }
  if (hasPrimaryError) throw primaryError
  if (hasCloseError) throw closeError
}

async function publishEvidence(repoRoot, expectedVersion, evidence, limits = DEFAULT_LIMITS) {
  validateEvidenceV3(evidence, expectedVersion, limits)
  const evidenceRoot = await ensureEvidenceDirectory(repoRoot)
  const evidenceBytes = serializeEvidence(evidence)
  assert.ok(
    evidenceBytes.length <= MAX_ROLLBACK_RESULT_EVIDENCE_BYTES,
    'rollback evidence exceeds the result evidence byte limit'
  )
  const diagnosticRelativePath = diagnosticRelativePathForEvidence(evidence)
  const outputPath = path.join(evidenceRoot, path.basename(diagnosticRelativePath))
  await writeDiagnosticFile(outputPath, evidenceBytes)
  return { diagnosticRelativePath, evidenceBytes }
}

function decodeCanonicalBase64url(value, label, maximumBytes) {
  assert.equal(typeof value, 'string', `${label} must be a string`)
  assert.match(value, /^[A-Za-z0-9_-]+$/, `${label} must be canonical base64url`)
  const bytes = Buffer.from(value, 'base64url')
  assert.equal(bytes.toString('base64url'), value, `${label} must be canonical base64url`)
  assert.ok(bytes.length <= maximumBytes, `${label} exceeds its byte limit`)
  return bytes
}

function decodeStrictUtf8(bytes, label) {
  try {
    return STRICT_UTF8_DECODER.decode(bytes)
  } catch {
    assert.fail(`${label} must be strict UTF-8`)
  }
}

function createRollbackResultMarker(result, expectedVersion, limits = DEFAULT_LIMITS) {
  assertPlainObject(result, 'rollback result')
  assert.deepEqual(
    Object.keys(result).sort(),
    ['diagnosticRelativePath', 'evidence', 'evidenceBytes'],
    'rollback result properties are invalid'
  )
  validateEvidenceV3(result.evidence, expectedVersion, limits)
  assert.equal(Buffer.isBuffer(result.evidenceBytes), true, 'rollback result evidenceBytes must be a Buffer')
  assert.ok(
    result.evidenceBytes.length <= MAX_ROLLBACK_RESULT_EVIDENCE_BYTES,
    'rollback result evidence exceeds the byte limit'
  )
  assert.deepEqual(result.evidenceBytes, serializeEvidence(result.evidence), 'rollback result evidence bytes are not canonical')
  assertSafeDiagnosticRelativePath(result.diagnosticRelativePath)
  const envelope = {
    schema: ROLLBACK_RESULT_SCHEMA,
    evidence_utf8_base64url: result.evidenceBytes.toString('base64url'),
    evidence_sha256: crypto.createHash('sha256').update(result.evidenceBytes).digest('hex'),
    diagnostic_relative_path: result.diagnosticRelativePath,
  }
  const encodedEnvelope = Buffer.from(JSON.stringify(envelope), 'utf8').toString('base64url')
  const marker = `${ROLLBACK_RESULT_MARKER_PREFIX}${encodedEnvelope}`
  assert.ok(Buffer.byteLength(marker, 'utf8') <= MAX_ROLLBACK_RESULT_MARKER_BYTES, 'rollback result marker is too large')
  return marker
}

function parseRollbackResultStream(stream, options, limits = DEFAULT_LIMITS) {
  const streamBytes = Buffer.isBuffer(stream) ? stream : Buffer.from(stream, 'utf8')
  assert.ok(streamBytes.length <= MAX_ROLLBACK_RESULT_STREAM_BYTES, 'rollback result stream exceeds the byte limit')
  const streamText = decodeStrictUtf8(streamBytes, 'rollback result stream')
  const markers = streamText.split(/\r?\n/).filter((line) => line.startsWith(ROLLBACK_RESULT_MARKER_PREFIX))
  assert.equal(markers.length, 1, 'rollback result stream must contain exactly one machine marker')
  const marker = markers[0]
  assert.ok(Buffer.byteLength(marker, 'utf8') <= MAX_ROLLBACK_RESULT_MARKER_BYTES, 'rollback result marker is too large')
  const encodedEnvelope = marker.slice(ROLLBACK_RESULT_MARKER_PREFIX.length)
  const envelopeBytes = decodeCanonicalBase64url(
    encodedEnvelope,
    'rollback result envelope',
    MAX_ROLLBACK_RESULT_MARKER_BYTES
  )
  const envelopeText = decodeStrictUtf8(envelopeBytes, 'rollback result envelope')
  let envelope
  try {
    envelope = JSON.parse(envelopeText)
  } catch {
    assert.fail('rollback result envelope must contain JSON')
  }
  assertPlainObject(envelope, 'rollback result envelope')
  assert.deepEqual(Object.keys(envelope), RESULT_ENVELOPE_FIELDS, 'rollback result envelope property list is invalid')
  assert.equal(JSON.stringify(envelope), envelopeText, 'rollback result envelope JSON must be canonical')
  assert.equal(envelope.schema, ROLLBACK_RESULT_SCHEMA, 'rollback result envelope schema is invalid')
  assert.match(envelope.evidence_sha256 || '', /^[a-f0-9]{64}$/, 'rollback result evidence sha256 is invalid')
  assertSafeDiagnosticRelativePath(envelope.diagnostic_relative_path)

  const evidenceBytes = decodeCanonicalBase64url(
    envelope.evidence_utf8_base64url,
    'rollback result evidence base64url',
    MAX_ROLLBACK_RESULT_EVIDENCE_BYTES
  )
  const evidenceSha256 = crypto.createHash('sha256').update(evidenceBytes).digest('hex')
  assert.equal(evidenceSha256, envelope.evidence_sha256, 'rollback result evidence digest does not match')
  const evidenceText = decodeStrictUtf8(evidenceBytes, 'rollback result evidence')
  let evidence
  try {
    evidence = JSON.parse(evidenceText)
  } catch {
    assert.fail('rollback result evidence must contain JSON')
  }
  assert.deepEqual(evidenceBytes, serializeEvidence(evidence), 'rollback result evidence JSON must be canonical')
  assertPlainObject(options, 'rollback result validation options')
  assert.match(options.expectedVersion || '', VERSION_PATTERN, 'expected rollback result version is invalid')
  assert.match(options.expectedCommit || '', /^[a-f0-9]{40}$/, 'expected rollback result commit is invalid')
  assert.ok(
    options.expectedInputMode === 'standalone' || options.expectedInputMode === 'checkpoint-bound',
    'expected rollback result input mode is invalid'
  )
  validateEvidenceV3(evidence, options.expectedVersion, limits)
  assert.equal(evidence.source.commit, options.expectedCommit, 'rollback result commit does not match')
  assert.equal(evidence.input_mode, options.expectedInputMode, 'rollback result input mode does not match')
  return {
    schema: envelope.schema,
    evidence,
    evidenceBytes,
    evidenceSha256,
    diagnosticRelativePath: envelope.diagnostic_relative_path,
  }
}

function parseResultStreamValidationArguments(args) {
  assert.ok(Array.isArray(args), 'rollback result validator arguments must be an array')
  assert.equal(args[0], '--validate-result-stream', 'rollback result validator mode is required')
  assert.equal(args.length, 7, 'rollback result validator requires version, commit, and mode')
  const values = new Map()
  for (let index = 1; index < args.length; index += 2) {
    const flag = args[index]
    const value = args[index + 1]
    assert.ok(
      flag === '--expected-version' || flag === '--expected-commit' || flag === '--expected-mode',
      `unknown rollback result validator argument: ${flag}`
    )
    assert.equal(values.has(flag), false, `duplicate rollback result validator argument: ${flag}`)
    assert.equal(typeof value, 'string', `${flag} requires a value`)
    values.set(flag, value)
  }
  assert.equal(values.has('--expected-version'), true, 'rollback result validator requires --expected-version')
  assert.equal(values.has('--expected-commit'), true, 'rollback result validator requires --expected-commit')
  assert.equal(values.has('--expected-mode'), true, 'rollback result validator requires --expected-mode')
  return {
    expectedVersion: values.get('--expected-version'),
    expectedCommit: values.get('--expected-commit'),
    expectedInputMode: values.get('--expected-mode'),
  }
}

async function readBoundedResultStream(readable) {
  const chunks = []
  let byteLength = 0
  for await (const chunk of readable) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    byteLength += bytes.length
    assert.ok(
      byteLength <= MAX_ROLLBACK_RESULT_STREAM_BYTES,
      'rollback result stream exceeds the byte limit'
    )
    chunks.push(bytes)
  }
  return Buffer.concat(chunks, byteLength)
}

async function validateResultStreamCli(args, readable = process.stdin) {
  const options = parseResultStreamValidationArguments(args)
  const stream = await readBoundedResultStream(readable)
  parseRollbackResultStream(stream, options)
}

function assertPlainObject(value, label) {
  assert.ok(
    value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype,
    `${label} must be an object`
  )
}

function assertNonNegativeSafeInteger(value, label) {
  assert.ok(Number.isSafeInteger(value) && value >= 0, `${label} must be a non-negative safe integer`)
}

function assertTrue(value, label) {
  assert.equal(typeof value, 'boolean', `${label} must be a boolean`)
  assert.equal(value, true, `${label} must be true`)
}

function validateEvidenceV3(evidence, expectedVersion, limits = DEFAULT_LIMITS) {
  const maxFiles = BigInt(positiveSafeIntegerLimit(limits, 'maxFiles'))
  const maxArchiveBytes = BigInt(positiveSafeIntegerLimit(limits, 'maxArchiveBytes'))
  assertPlainObject(evidence, 'rollback evidence')
  assert.equal(evidence.schema, EVIDENCE_SCHEMA, 'rollback evidence schema is invalid')
  assert.equal(typeof evidence.status, 'string', 'rollback evidence status must be a string')
  assert.equal(evidence.status, 'passed', 'only completed rollback evidence may be published')
  assert.ok(
    evidence.input_mode === 'standalone' || evidence.input_mode === 'checkpoint-bound',
    'rollback evidence input_mode is invalid'
  )
  assert.equal(typeof evidence.executed_at, 'string', 'rollback evidence executed_at must be a string')
  assert.match(
    evidence.executed_at,
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    'rollback evidence executed_at must be an ISO timestamp'
  )
  const executedAtMilliseconds = Date.parse(evidence.executed_at)
  assert.equal(Number.isFinite(executedAtMilliseconds), true, 'rollback evidence executed_at is invalid')
  assert.equal(
    new Date(executedAtMilliseconds).toISOString(),
    evidence.executed_at,
    'rollback evidence executed_at is not canonical'
  )

  assertPlainObject(evidence.source, 'rollback evidence source')
  assert.match(expectedVersion || '', VERSION_PATTERN, 'expected rollback evidence version is invalid')
  assert.equal(
    evidence.source.version,
    expectedVersion,
    'rollback evidence source.version does not match the prepared version'
  )
  assert.match(evidence.source.commit || '', /^[a-f0-9]{40}$/, 'rollback evidence source.commit is invalid')
  assert.equal(
    typeof evidence.source.working_tree_dirty,
    'boolean',
    'rollback evidence source.working_tree_dirty must be a boolean'
  )
  assert.equal(evidence.source.working_tree_dirty, false, 'rollback evidence source.working_tree_dirty must be false')
  assert.match(
    evidence.source.data_root_sha256 || '',
    /^[a-f0-9]{64}$/,
    'rollback evidence source.data_root_sha256 is invalid'
  )
  assertPlainObject(evidence.source.database, 'rollback evidence source.database')
  assert.ok(
    typeof evidence.source.database.relative_path === 'string' &&
      evidence.source.database.relative_path.length > 0 &&
      !evidence.source.database.relative_path.includes('\0'),
    'rollback evidence source.database.relative_path is invalid'
  )

  assertPlainObject(evidence.focused_tests, 'rollback evidence focused_tests')
  assert.equal(
    evidence.focused_tests.file,
    'backend-node/test/dataBackupService.test.js',
    'rollback evidence focused_tests.file is invalid'
  )
  assertNonNegativeSafeInteger(evidence.focused_tests.passed, 'rollback evidence focused_tests.passed')
  assertNonNegativeSafeInteger(evidence.focused_tests.total, 'rollback evidence focused_tests.total')
  assert.ok(evidence.focused_tests.total > 0, 'rollback evidence focused_tests.total must be positive')
  assert.equal(
    evidence.focused_tests.passed,
    evidence.focused_tests.total,
    'rollback evidence focused tests must all pass'
  )

  assertPlainObject(evidence.backup, 'rollback evidence backup')
  assert.ok(
    SUPPORTED_FORMAT_VERSIONS.includes(evidence.backup.format_version),
    'rollback evidence backup.format_version is not supported'
  )
  for (const field of [
    'archive_bytes',
    'file_count',
    'storage_files',
    'story_source_files',
    'active_story_source_references',
  ]) {
    assertNonNegativeSafeInteger(evidence.backup[field], `rollback evidence backup.${field}`)
  }
  assert.ok(
    evidence.backup.archive_bytes >= MINIMUM_ZIP_ARCHIVE_BYTES,
    `rollback evidence backup.archive_bytes must be at least ${MINIMUM_ZIP_ARCHIVE_BYTES}`
  )
  assert.ok(
    BigInt(evidence.backup.archive_bytes) <= maxArchiveBytes,
    'rollback evidence backup.archive_bytes exceeds the archive size limit'
  )
  for (const field of ['storage_files', 'story_source_files']) {
    assert.ok(
      BigInt(evidence.backup[field]) <= maxFiles,
      `rollback evidence backup.${field} exceeds the directory file limit`
    )
  }
  const directoryFileCount = BigInt(evidence.backup.storage_files) + BigInt(evidence.backup.story_source_files)
  assert.ok(directoryFileCount <= maxFiles, 'rollback evidence backup directory file counts exceed the file limit')
  const totalFileCount = directoryFileCount + 1n
  assert.equal(
    BigInt(evidence.backup.file_count),
    totalFileCount,
    'rollback evidence backup.file_count does not match its entry counts'
  )
  assert.ok(
    totalFileCount <= maxFiles + 1n,
    'rollback evidence backup.file_count exceeds the total file limit'
  )
  assert.match(
    evidence.backup.archive_sha256 || '',
    /^[a-f0-9]{64}$/,
    'rollback evidence backup.archive_sha256 is invalid'
  )
  assert.equal(
    typeof evidence.backup.archive_retained,
    'boolean',
    'rollback evidence backup.archive_retained must be a boolean'
  )
  assert.equal(
    evidence.backup.archive_retained,
    evidence.input_mode === 'checkpoint-bound',
    'rollback evidence backup.archive_retained does not match input_mode'
  )
  assert.equal(evidence.backup.secret_policy, 'excluded', 'rollback evidence backup.secret_policy is invalid')
  if (evidence.input_mode === 'checkpoint-bound') {
    assert.equal(
      evidence.backup.excluded_values,
      null,
      'rollback evidence backup.excluded_values must be null in checkpoint-bound mode'
    )
  } else {
    assertNonNegativeSafeInteger(
      evidence.backup.excluded_values,
      'rollback evidence backup.excluded_values in standalone mode'
    )
  }

  assertPlainObject(evidence.restore, 'rollback evidence restore')
  assertTrue(evidence.restore.isolated, 'rollback evidence restore.isolated')
  assert.equal(evidence.restore.integrity_check, 'ok', 'rollback evidence restore.integrity_check is invalid')
  assertNonNegativeSafeInteger(
    evidence.restore.credential_rows_checked,
    'rollback evidence restore.credential_rows_checked'
  )
  assertTrue(evidence.restore.credentials_excluded, 'rollback evidence restore.credentials_excluded')
  assertPlainObject(evidence.restore.restored_counts, 'rollback evidence restore.restored_counts')
  for (const [table, count] of Object.entries(evidence.restore.restored_counts)) {
    assert.ok(table.length > 0, 'rollback evidence restore.restored_counts key is invalid')
    assertNonNegativeSafeInteger(count, `rollback evidence restore.restored_counts.${table}`)
  }
  assertPlainObject(evidence.restore.rollback_copies, 'rollback evidence restore.rollback_copies')
  for (const field of ['database', 'storage', 'story_sources']) {
    assertTrue(evidence.restore.rollback_copies[field], `rollback evidence restore.rollback_copies.${field}`)
  }

  assertPlainObject(evidence.operations, 'rollback evidence operations')
  for (const field of [
    'source_database_unchanged',
    'source_data_root_unchanged',
    'credential_reconfiguration_required',
    'workspace_cleanup_verified',
  ]) {
    assertTrue(evidence.operations[field], `rollback evidence operations.${field}`)
  }
  return evidence
}

if (require.main === module) {
  validateResultStreamCli(process.argv.slice(2)).catch((error) => {
    const message = error && typeof error.stack === 'string'
      ? error.stack
      : 'rollback result stream validation failed'
    process.stderr.write(`${message}\n`)
    process.exitCode = 1
  })
}

module.exports = {
  EVIDENCE_RELATIVE_PATH,
  EVIDENCE_SCHEMA,
  MAX_ROLLBACK_RESULT_EVIDENCE_BYTES,
  MAX_ROLLBACK_RESULT_MARKER_BYTES,
  MAX_ROLLBACK_RESULT_STREAM_BYTES,
  ROLLBACK_RESULT_MARKER_PREFIX,
  ROLLBACK_RESULT_SCHEMA,
  assertCheckpointInputPaths,
  assertSamePathIdentity,
  capturePathIdentity,
  createRollbackResultMarker,
  evidenceOutputPath,
  fingerprintDataRoot,
  isPathOutsideRoot,
  parseDrillArguments,
  parseRollbackResultStream,
  prepareEvidenceTarget,
  publishEvidence,
  serializeEvidence,
  validateEvidenceV3,
  validateResultStreamCli,
}
