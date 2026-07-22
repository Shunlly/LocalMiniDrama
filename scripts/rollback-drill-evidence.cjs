'use strict'

const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fsp = require('node:fs/promises')
const path = require('node:path')
const { DEFAULT_LIMITS } = require('../backend-node/src/services/dataBackupService')
const {
  MINIMUM_ZIP_ARCHIVE_BYTES,
  SUPPORTED_FORMAT_VERSIONS,
} = require('../backend-node/src/services/dataBackupFormatContract')

const EVIDENCE_SCHEMA = 'localminidrama.rollback-drill.v3'
const V2_EVIDENCE_SCHEMA = 'localminidrama.rollback-drill.v2'
const LEGACY_EVIDENCE_SCHEMA = 'localminidrama.rollback-drill.v1'
const EVIDENCE_RELATIVE_PATH = 'artifacts/rollback-drill/summary.json'
const VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/
const MAX_CLEANUP_ERROR_DETAILS = 8

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

async function lstatBigIntIfExists(targetPath) {
  try {
    return await fsp.lstat(targetPath, { bigint: true })
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

function attachCleanupErrors(primaryError, cleanupErrors) {
  if (!primaryError || (typeof primaryError !== 'object' && typeof primaryError !== 'function')) return
  const existing = Array.isArray(primaryError.cleanupErrors) ? primaryError.cleanupErrors : []
  const additions = cleanupErrors.filter((error) => error && error !== primaryError)
  const bounded = [...existing, ...additions].slice(0, MAX_CLEANUP_ERROR_DETAILS)
  if (bounded.length === 0) return
  try {
    Object.defineProperty(primaryError, 'cleanupErrors', {
      value: Object.freeze(bounded),
      configurable: true,
      enumerable: false,
    })
  } catch {}
}

function throwPrimaryOrCleanup(primaryError, cleanupErrors) {
  if (primaryError) {
    attachCleanupErrors(primaryError, cleanupErrors)
    throw primaryError
  }
  if (cleanupErrors.length > 0) {
    const [cleanupError, ...laterCleanupErrors] = cleanupErrors
    attachCleanupErrors(cleanupError, laterCleanupErrors)
    throw cleanupError
  }
}

async function unlinkOwnedPublication(outputPath, stagedIdentity) {
  const outputIdentity = await lstatBigIntIfExists(outputPath)
  if (!outputIdentity || outputIdentity.isSymbolicLink() || !outputIdentity.isFile()) return
  if (outputIdentity.dev !== stagedIdentity.dev || outputIdentity.ino !== stagedIdentity.ino) return
  await fsp.unlink(outputPath)
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

function recognizedEvidenceVersion(evidence) {
  if (![EVIDENCE_SCHEMA, V2_EVIDENCE_SCHEMA, LEGACY_EVIDENCE_SCHEMA].includes(evidence?.schema)) {
    assert.fail('existing rollback evidence is not recognized')
  }
  assert.equal(typeof evidence?.status, 'string', 'existing rollback evidence status must be a string')
  assert.equal(evidence?.status, 'passed', 'existing rollback evidence is not a completed PASS record')
  if (evidence?.schema === EVIDENCE_SCHEMA) {
    validateEvidenceV3(evidence, evidence?.source?.version)
    return evidence.source.version
  }
  if (evidence?.schema === V2_EVIDENCE_SCHEMA) {
    assert.match(evidence?.source?.version || '', VERSION_PATTERN, 'existing rollback evidence version is invalid')
    return evidence.source.version
  }
  if (evidence?.schema === LEGACY_EVIDENCE_SCHEMA) {
    assert.match(evidence?.source_version || '', VERSION_PATTERN, 'legacy rollback evidence version is invalid')
    assert.match(evidence?.backup?.archive_sha256 || '', /^[a-f0-9]{64}$/i, 'legacy rollback evidence hash is invalid')
    return evidence.source_version
  }
  assert.fail('existing rollback evidence is not recognized')
}

async function archivePriorEvidence(evidenceRoot, outputPath, contents, evidence, version) {
  const archiveRoot = path.join(evidenceRoot, 'archive')
  await ensureRealDirectory(archiveRoot)
  const digest = crypto.createHash('sha256').update(contents).digest('hex')
  const generation = evidence.schema === LEGACY_EVIDENCE_SCHEMA
    ? 'legacy-v1'
    : evidence.schema === V2_EVIDENCE_SCHEMA
      ? 'v2'
      : 'v3'
  const archivePath = path.join(archiveRoot, `${generation}-${version}-${digest.slice(0, 16)}.json`)
  const existingArchive = await lstatIfExists(archivePath)
  if (existingArchive) {
    assert.equal(existingArchive.isSymbolicLink(), false, 'rollback evidence archive must not be a symbolic link')
    assert.equal(existingArchive.isFile(), true, 'rollback evidence archive must be a regular file')
    assert.equal(
      crypto.createHash('sha256').update(await fsp.readFile(archivePath)).digest('hex'),
      digest,
      'rollback evidence archive collision detected'
    )
  } else {
    await fsp.link(outputPath, archivePath)
  }
  await fsp.unlink(outputPath)
}

async function prepareEvidenceTarget(repoRoot, version) {
  assert.match(version || '', VERSION_PATTERN, 'expected rollback evidence version is invalid')
  const evidenceRoot = await ensureEvidenceDirectory(repoRoot)
  const outputPath = evidenceOutputPath(repoRoot)
  const stat = await lstatIfExists(outputPath)
  if (!stat) return outputPath
  assert.equal(stat.isSymbolicLink(), false, 'rollback evidence must not be a symbolic link')
  assert.equal(stat.isFile(), true, 'rollback evidence must be a regular file')
  const contents = await fsp.readFile(outputPath)
  const existing = JSON.parse(contents.toString('utf8'))
  const existingVersion = recognizedEvidenceVersion(existing)
  if (existing.schema === EVIDENCE_SCHEMA && existingVersion === version) {
    await fsp.unlink(outputPath)
  } else {
    await archivePriorEvidence(evidenceRoot, outputPath, contents, existing, existingVersion)
  }
  return outputPath
}

async function publishEvidence(
  repoRoot,
  expectedVersion,
  evidence,
  limits = DEFAULT_LIMITS,
  transactionOptions = {}
) {
  validateEvidenceV3(evidence, expectedVersion, limits)
  assertPlainObject(transactionOptions, 'rollback evidence publication transaction')
  for (const callback of ['onStaged', 'beforeCommit', 'afterCommit']) {
    assert.ok(
      transactionOptions[callback] === undefined || typeof transactionOptions[callback] === 'function',
      `rollback evidence publication ${callback} must be a function`
    )
  }
  const evidenceRoot = await ensureEvidenceDirectory(repoRoot)
  const outputPath = evidenceOutputPath(repoRoot)
  assert.equal(await lstatIfExists(outputPath), null, 'rollback evidence target changed during the drill')

  const temporaryPath = path.join(evidenceRoot, `.summary-${process.pid}-${crypto.randomBytes(8).toString('hex')}.tmp`)
  let handle
  let stagedIdentity
  let linked = false
  let primaryError
  try {
    handle = await fsp.open(temporaryPath, 'wx', 0o600)
    await handle.writeFile(`${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
    await handle.sync()
    await handle.close()
    handle = null
    stagedIdentity = await lstatBigIntIfExists(temporaryPath)
    assert.ok(stagedIdentity?.isFile(), 'staged rollback evidence must be a regular file')
    const transaction = { temporaryPath, outputPath }
    await transactionOptions.onStaged?.(transaction)
    await transactionOptions.beforeCommit?.(transaction)
    assert.equal(await lstatIfExists(outputPath), null, 'rollback evidence target changed before PASS publication')
    await fsp.link(temporaryPath, outputPath)
    linked = true
    await fsp.unlink(temporaryPath)
    await transactionOptions.afterCommit?.(transaction)
  } catch (error) {
    primaryError = error
  }

  const cleanupErrors = []
  if (primaryError && linked && stagedIdentity) {
    try {
      await unlinkOwnedPublication(outputPath, stagedIdentity)
    } catch (error) {
      cleanupErrors.push(error)
    }
  }
  if (handle) {
    try {
      await handle.close()
    } catch (error) {
      cleanupErrors.push(error)
    }
  }
  try {
    await fsp.rm(temporaryPath, { force: true })
  } catch (error) {
    cleanupErrors.push(error)
  }
  throwPrimaryOrCleanup(primaryError, cleanupErrors)
  return outputPath
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

module.exports = {
  EVIDENCE_RELATIVE_PATH,
  EVIDENCE_SCHEMA,
  assertCheckpointInputPaths,
  assertSamePathIdentity,
  capturePathIdentity,
  evidenceOutputPath,
  fingerprintDataRoot,
  isPathOutsideRoot,
  parseDrillArguments,
  prepareEvidenceTarget,
  publishEvidence,
  validateEvidenceV3,
}
