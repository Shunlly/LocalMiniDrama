'use strict'

const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { createRequire } = require('node:module')
const { spawnSync } = require('node:child_process')
const { types: utilTypes } = require('node:util')

const MAX_CLEANUP_ERROR_DETAILS = 8
const MAX_THROWN_DIAGNOSTIC_BYTES = 64 * 1024
const WINDOWS_CLAIM_RETRY_DELAYS_MS = Object.freeze([25, 50, 100, 200, 400, 800])

const root = path.resolve(__dirname, '..')
const backendRoot = path.join(root, 'backend-node')
const backendRequire = createRequire(path.join(backendRoot, 'package.json'))
const Database = backendRequire('better-sqlite3')
const { loadConfig } = backendRequire('./src/config')
const {
  DEFAULT_LIMITS,
  FORMAT_VERSION,
  createDataBackup,
  restoreDataBackup,
} = backendRequire('./src/services/dataBackupService')
const {
  EVIDENCE_SCHEMA,
  assertCheckpointInputPaths,
  assertSamePathIdentity,
  capturePathIdentity,
  createRollbackResultMarker,
  fingerprintDataRoot,
  parseDrillArguments,
  prepareEvidenceTarget,
  publishEvidence,
  serializeEvidence,
} = require('./rollback-drill-evidence.cjs')
const {
  assertPrivateCleanupBoundary,
  decodeExternalMaintenanceLease,
} = require('./run-rollback-drill-launcher.cjs')

let activeWorkspace = null
let activeAbortController = null
let interruptedSignal = null
let interruptedExitCode = null
const workspaceSignalHandlers = new Map()
const windowsOwnedPathDeletionScript = path.join(__dirname, 'remove-rollback-owned-path.ps1')

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || root,
    encoding: options.encoding,
    stdio: options.stdio,
    timeout: options.timeout,
    killSignal: 'SIGKILL',
    windowsHide: true,
  })
  if (result.error) throw result.error
  assert.equal(result.status, 0, `${command} ${args.join(' ')} failed: ${String(result.stderr || '').trim()}`)
  return String(result.stdout || '').trim()
}

function gitOutput(args) {
  return run('git', args, { encoding: 'utf8', timeout: 30000 })
}

function assertCleanSourceTree() {
  assert.equal(
    gitOutput(['status', '--porcelain', '--untracked-files=normal']),
    '',
    'rollback drill evidence requires a clean Git working tree'
  )
}

function normalizeDrillLimits(overrides = {}) {
  assert.ok(overrides && typeof overrides === 'object' && !Array.isArray(overrides), 'rollback limits must be an object')
  const limits = {}
  for (const [key, defaultValue] of Object.entries(DEFAULT_LIMITS)) {
    const value = overrides[key] === undefined ? defaultValue : overrides[key]
    assert.ok(Number.isSafeInteger(value) && value > 0, `rollback limit ${key} must be a positive safe integer`)
    limits[key] = value
  }
  assert.ok(limits.maxManifestBytes <= limits.maxFileBytes, 'manifest size limit must not exceed file size limit')
  return Object.freeze(limits)
}

function copyBoundedOwnArrayDataValues(value, maximum) {
  if (utilTypes.isProxy(value) || !Array.isArray(value)) return []
  const copied = []
  for (let index = 0; index < maximum; index += 1) {
    let descriptor
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    } catch {
      break
    }
    if (descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      copied.push(descriptor.value)
    }
  }
  return copied
}

function attachCleanupErrors(primaryError, cleanupErrors) {
  if (
    (typeof primaryError !== 'object' && typeof primaryError !== 'function') ||
    primaryError === null ||
    utilTypes.isProxy(primaryError)
  ) return

  let existing = []
  try {
    const descriptor = Object.getOwnPropertyDescriptor(primaryError, 'cleanupErrors')
    if (descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      existing = copyBoundedOwnArrayDataValues(descriptor.value, MAX_CLEANUP_ERROR_DETAILS)
    }
  } catch {
    return
  }

  const additions = copyBoundedOwnArrayDataValues(cleanupErrors, MAX_CLEANUP_ERROR_DETAILS)
  const bounded = existing.slice(0, MAX_CLEANUP_ERROR_DETAILS)
  for (const cleanupError of additions) {
    if (bounded.length >= MAX_CLEANUP_ERROR_DETAILS) break
    if (cleanupError !== primaryError) bounded.push(cleanupError)
  }
  if (bounded.length === 0) return
  try {
    Object.defineProperty(primaryError, 'cleanupErrors', {
      value: Object.freeze(bounded),
      configurable: true,
      enumerable: false,
    })
  } catch {}
}

function attachCleanupError(primaryError, cleanupError) {
  if (
    (typeof primaryError !== 'object' && typeof primaryError !== 'function') ||
    primaryError === null ||
    primaryError === cleanupError ||
    utilTypes.isProxy(primaryError)
  ) return primaryError

  try {
    const descriptor = Object.getOwnPropertyDescriptor(primaryError, 'cleanupError')
    if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      Object.defineProperty(primaryError, 'cleanupError', {
        value: cleanupError,
        configurable: true,
        enumerable: false,
      })
    }
  } catch {}

  const details = [cleanupError]
  if (
    (typeof cleanupError === 'object' || typeof cleanupError === 'function') &&
    cleanupError !== null &&
    !utilTypes.isProxy(cleanupError)
  ) {
    try {
      const descriptor = Object.getOwnPropertyDescriptor(cleanupError, 'cleanupErrors')
      if (descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
        details.push(...copyBoundedOwnArrayDataValues(
          descriptor.value,
          MAX_CLEANUP_ERROR_DETAILS - 1
        ))
      }
    } catch {}
  }
  attachCleanupErrors(primaryError, details)
  return primaryError
}

function attachCleanupErrorList(primaryError, cleanupErrors) {
  for (const cleanupError of copyBoundedOwnArrayDataValues(
    cleanupErrors,
    MAX_CLEANUP_ERROR_DETAILS
  )) {
    attachCleanupError(primaryError, cleanupError)
  }
  return primaryError
}

function throwPrimaryOrCleanup(hasPrimaryError, primaryError, cleanupErrors) {
  if (hasPrimaryError) {
    attachCleanupErrorList(primaryError, cleanupErrors)
    throw primaryError
  }
  if (cleanupErrors.length > 0) {
    const cleanupError = cleanupErrors[0]
    const laterCleanupErrors = cleanupErrors.slice(1, MAX_CLEANUP_ERROR_DETAILS + 1)
    attachCleanupErrorList(cleanupError, laterCleanupErrors)
    throw cleanupError
  }
}

function renderPrimaryThrownValue(value) {
  if (value === undefined) return 'undefined'
  if (value === null) return 'null'
  if (typeof value === 'string') return value.length === 0 ? "''" : value
  if (typeof value !== 'object' && typeof value !== 'function') return String(value)
  if (utilTypes.isProxy(value)) return '[unrenderable thrown object]'
  try {
    for (const property of ['stack', 'message']) {
      const descriptor = Object.getOwnPropertyDescriptor(value, property)
      if (
        descriptor &&
        Object.prototype.hasOwnProperty.call(descriptor, 'value') &&
        typeof descriptor.value === 'string' &&
        descriptor.value.length > 0
      ) return descriptor.value
    }
  } catch {}
  return '[unrenderable thrown object]'
}

function renderThrownValue(value) {
  const sections = [renderPrimaryThrownValue(value)]
  if (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    !utilTypes.isProxy(value)
  ) {
    try {
      const descriptor = Object.getOwnPropertyDescriptor(value, 'cleanupErrors')
      if (descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
        const cleanupErrors = copyBoundedOwnArrayDataValues(descriptor.value, MAX_CLEANUP_ERROR_DETAILS)
        cleanupErrors.forEach((cleanupError, index) => {
          const detail = Buffer.from(renderPrimaryThrownValue(cleanupError), 'utf8')
          sections.push(`[cleanup ${index + 1}] ${detail.subarray(0, 4096).toString('utf8')}`)
        })
      }
    } catch {}
  }
  const rendered = sections.join('\n')
  const bytes = Buffer.from(rendered, 'utf8')
  if (bytes.length <= MAX_THROWN_DIAGNOSTIC_BYTES) return rendered
  return `${bytes.subarray(0, MAX_THROWN_DIAGNOSTIC_BYTES - 32).toString('utf8')}\n[diagnostic truncated]`
}

function nonNegativeBigInt(value, label) {
  if (typeof value === 'bigint') {
    assert.ok(value >= 0n, `${label} must be non-negative`)
    return value
  }
  assert.ok(Number.isSafeInteger(value) && value >= 0, `${label} must be a non-negative safe integer`)
  return BigInt(value)
}

async function sha256FileHandle(handle, { expectedBytes, maxBytes, limits, limitKey, label }) {
  assert.ok(limits && typeof limits === 'object' && Object.isFrozen(limits), 'rollback hashing limits must be immutable')
  assert.ok(limitKey === 'maxArchiveBytes' || limitKey === 'maxFileBytes', 'rollback hashing limit key is invalid')
  assert.equal(maxBytes, limits[limitKey], 'rollback hashing maxBytes must match the shared limits object')
  assert.ok(typeof label === 'string' && label.length > 0, 'rollback hashing label is required')
  const expected = nonNegativeBigInt(expectedBytes, `expected ${label} bytes`)
  assert.ok(Number.isSafeInteger(maxBytes) && maxBytes > 0, `maximum ${label} bytes must be a positive safe integer`)
  const maximum = BigInt(maxBytes)
  const before = await handle.stat({ bigint: true })
  assert.equal(before.isFile(), true, `${label} descriptor must be a regular file`)
  assert.equal(before.size, expected, `${label} descriptor length does not match its retained identity`)
  assert.ok(before.size <= maximum, `${label} exceeds the size limit`)

  const hash = crypto.createHash('sha256')
  const buffer = Buffer.allocUnsafe(Math.min(1024 * 1024, maxBytes))
  let position = 0
  while (true) {
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, position)
    if (bytesRead === 0) break
    const nextPosition = BigInt(position) + BigInt(bytesRead)
    assert.ok(nextPosition <= maximum, `${label} exceeds the size limit while hashing`)
    assert.ok(nextPosition <= expected, `${label} grew while it was hashed`)
    hash.update(buffer.subarray(0, bytesRead))
    position = Number(nextPosition)
  }
  assert.equal(BigInt(position), expected, `${label} length changed while it was hashed`)
  const after = await handle.stat({ bigint: true })
  assert.equal(after.isFile(), true, `${label} descriptor must remain a regular file`)
  for (const field of ['dev', 'ino', 'size', 'ctimeNs']) {
    assert.equal(after[field], before[field], `${label} descriptor ${field} identity changed while hashing`)
  }
  return hash.digest('hex')
}

async function captureRetainedFileIdentity(handle, filePath, label) {
  try {
    return await capturePathIdentity({ handle, path: filePath }, 'file')
  } catch (error) {
    throw new Error(`${label} identity validation failed: ${error.message}`, { cause: error })
  }
}

function assertOwnedObjectType(stat, expectedType, label) {
  const matches = expectedType === 'file' ? stat.isFile() : stat.isDirectory()
  assert.equal(matches, true, `${label} retained object must remain a ${expectedType}`)
}

async function captureOwnedLinkIdentity(handle, targetPath, expectedType, label) {
  const descriptor = await handle.stat({ bigint: true })
  const pathStat = await fsp.lstat(targetPath, { bigint: true })
  assertOwnedObjectType(descriptor, expectedType, label)
  assertOwnedObjectType(pathStat, expectedType, `${label} path`)
  for (const field of ['dev', 'ino']) {
    assert.equal(pathStat[field], descriptor[field], `${label} path ${field} does not match the retained object`)
  }
  if (expectedType === 'file') {
    assert.equal(pathStat.size, descriptor.size, `${label} path size does not match the retained object`)
  }
  assert.equal(pathStat.nlink, descriptor.nlink, `${label} path link count does not match the retained object`)
  assert.ok(descriptor.nlink > 0n, `${label} retained object must have a live link`)
  return {
    dev: descriptor.dev,
    ino: descriptor.ino,
    nlink: descriptor.nlink,
    size: descriptor.size,
    type: expectedType,
  }
}

async function assertOwnedPathStillLinked(handle, targetPath, expected, label) {
  const current = await captureOwnedLinkIdentity(handle, targetPath, expected.type, label)
  for (const field of ['dev', 'ino']) {
    assert.equal(current[field], expected[field], `${label} retained ${field} identity changed`)
  }
  if (expected.type === 'file') {
    assert.equal(current.size, expected.size, `${label} retained size changed`)
    assert.equal(current.nlink, expected.nlink, `${label} retained link count changed before cleanup`)
  }
}

async function assertOwnedHandleUnlinked(handle, expected, label) {
  const current = await handle.stat({ bigint: true })
  assertOwnedObjectType(current, expected.type, label)
  for (const field of ['dev', 'ino']) {
    assert.equal(current[field], expected[field], `${label} retained ${field} identity changed`)
  }
  if (expected.type === 'file') assert.equal(current.size, expected.size, `${label} retained size changed`)
  assert.equal(current.nlink, 0n, `${label} original retained object was not unlinked`)
}

function privateCleanupClaimPath(targetPath) {
  const claimName = `.${path.basename(targetPath)}.localminidrama-cleanup-${crypto.randomBytes(16).toString('hex')}`
  return path.join(path.dirname(targetPath), claimName)
}

async function renameOwnedPathWithRetry(sourcePath, claimPath, options = {}) {
  const renamePath = options.renamePath || fsp.rename
  const wait = options.wait || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)))
  const platform = options.platform || process.platform
  for (let attempt = 0; ; attempt += 1) {
    try {
      await renamePath(sourcePath, claimPath)
      return
    } catch (error) {
      const retryable = platform === 'win32'
        && (error?.code === 'EPERM' || error?.code === 'EBUSY')
        && attempt < WINDOWS_CLAIM_RETRY_DELAYS_MS.length
      if (!retryable) throw error
      await wait(WINDOWS_CLAIM_RETRY_DELAYS_MS[attempt])
    }
  }
}

async function assertPathEntryAbsent(targetPath, label) {
  try {
    await fsp.lstat(targetPath)
  } catch (error) {
    if (error?.code === 'ENOENT') return
    throw error
  }
  assert.fail(`${label} path entry still exists after cleanup`)
}

async function restoreUnownedClaimWithoutOverwrite(claimPath, targetPath, expectedType) {
  const claimStat = await fsp.lstat(claimPath, { bigint: true })
  if (expectedType === 'file' && claimStat.isFile()) {
    await fsp.link(claimPath, targetPath)
    return
  }
  if (expectedType === 'directory' && claimStat.isDirectory()) {
    await fsp.symlink(claimPath, targetPath, process.platform === 'win32' ? 'junction' : 'dir')
  }
}

async function assertClaimOwnedOrPreserve(handle, claimPath, targetPath, expected, label) {
  try {
    await assertOwnedPathStillLinked(handle, claimPath, expected, `${label} private claim`)
  } catch (error) {
    const preservationErrors = []
    try {
      await restoreUnownedClaimWithoutOverwrite(claimPath, targetPath, expected.type)
    } catch (preservationError) {
      preservationErrors.push(preservationError)
    }
    attachCleanupErrorList(error, preservationErrors)
    throw error
  }
}

async function claimOwnedPath(handle, targetPath, expected, label) {
  const claimPath = privateCleanupClaimPath(targetPath)
  await renameOwnedPathWithRetry(targetPath, claimPath)
  await assertClaimOwnedOrPreserve(handle, claimPath, targetPath, expected, label)
  return claimPath
}

function windowsOwnedPathIdentity(expected, label) {
  assert.ok(expected && typeof expected === 'object', `${label} retained identity is required`)
  assert.ok(typeof expected.dev === 'bigint' && expected.dev >= 0n && expected.dev <= 0xffffffffn, `${label} retained device identity is invalid`)
  assert.ok(typeof expected.ino === 'bigint' && expected.ino >= 0n && expected.ino <= 0xffffffffffffffffn, `${label} retained inode identity is invalid`)
  assert.ok(expected.type === 'file' || expected.type === 'directory', `${label} retained type is invalid`)
  return `${expected.dev.toString(16).padStart(8, '0')}:${expected.ino.toString(16).padStart(16, '0')}`
}

async function removeOwnedClaimWindows({
  claimPath,
  expected,
  label,
  maximumEntries = (DEFAULT_LIMITS.maxFiles * DEFAULT_LIMITS.maxPathDepth) + 1,
  timeoutMilliseconds = 120000,
}) {
  assert.equal(process.platform, 'win32', `${label} handle-bound cleanup requires Windows`)
  assert.equal(path.isAbsolute(claimPath), true, `${label} claim path must be absolute`)
  assert.ok(Number.isSafeInteger(maximumEntries) && maximumEntries > 0 && maximumEntries <= 1600001, `${label} cleanup entry limit is invalid`)
  assert.ok(Number.isSafeInteger(timeoutMilliseconds) && timeoutMilliseconds > 0 && timeoutMilliseconds <= 300000, `${label} cleanup timeout is invalid`)
  const expectedIdentity = windowsOwnedPathIdentity(expected, label)
  const shell = String(process.env.LMD_PWSH_EXE || '').trim() || 'powershell.exe'
  const result = spawnSync(shell, [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    windowsOwnedPathDeletionScript,
    '-Path',
    claimPath,
    '-ExpectedIdentity',
    expectedIdentity,
    '-ExpectedType',
    expected.type,
    '-MaximumEntries',
    String(maximumEntries),
    '-TimeoutMilliseconds',
    String(timeoutMilliseconds),
  ], {
    cwd: root,
    encoding: 'utf8',
    timeout: timeoutMilliseconds + 10000,
    windowsHide: true,
  })
  if (result.error) {
    throw new Error(`${label} handle-bound cleanup could not execute for preserved claim ${JSON.stringify(claimPath)}: ${result.error.message}`, { cause: result.error })
  }
  if (result.status !== 0) {
    const diagnostic = String(result.stderr || result.stdout || '').trim()
    throw new Error(`${label} handle-bound cleanup failed for preserved claim ${JSON.stringify(claimPath)}${diagnostic ? `: ${diagnostic}` : ` with exit code ${result.status}`}`)
  }
}

function configuredPath(value, fallback) {
  const candidate = value || fallback
  return path.isAbsolute(candidate) ? candidate : path.resolve(backendRoot, candidate)
}

function comparableHostPath(value) {
  const normalized = path.normalize(value)
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function tableExists(database, name) {
  return Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name))
}

function restoredRowCounts(database) {
  const counts = {}
  for (const table of ['dramas', 'episodes', 'storyboards', 'story_sources', 'ai_service_configs']) {
    if (tableExists(database, table)) {
      counts[table] = database.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get().count
    }
  }
  return counts
}

function safeEvidencePath(basePath, candidatePath, fallback = '[external]') {
  const relative = path.relative(basePath, candidatePath).replace(/\\/g, '/')
  if (!relative || relative === '.' || relative.startsWith('../') || path.posix.isAbsolute(relative)) {
    return fallback
  }
  return relative
}

function verifyRestoredDatabase(databasePath) {
  const database = new Database(databasePath, { fileMustExist: true, readonly: true })
  try {
    const integrity = database.pragma('integrity_check')
    assert.deepEqual(integrity, [{ integrity_check: 'ok' }], 'restored SQLite integrity check failed')

    let credentialRows = 0
    let populatedCredentialRows = 0
    if (tableExists(database, 'ai_service_configs')) {
      const columns = new Set(database.pragma('table_info(ai_service_configs)').map((column) => column.name))
      if (columns.has('api_key')) {
        const row = database.prepare(`
          SELECT COUNT(*) AS total,
                 SUM(CASE WHEN COALESCE(TRIM(api_key), '') <> '' THEN 1 ELSE 0 END) AS populated
          FROM ai_service_configs
        `).get()
        credentialRows = row.total
        populatedCredentialRows = row.populated || 0
      }
    }
    assert.equal(populatedCredentialRows, 0, 'restored backup still contains Provider credentials')
    return {
      integrity_check: 'ok',
      credential_rows_checked: credentialRows,
      credentials_excluded: true,
      restored_counts: restoredRowCounts(database),
    }
  } finally {
    database.close()
  }
}

function installWorkspaceSignalCleanup() {
  for (const [signal, exitCode] of [['SIGINT', 130], ['SIGTERM', 143]]) {
    const handler = () => {
      if (!interruptedSignal) {
        interruptedSignal = signal
        interruptedExitCode = exitCode
      }
      activeAbortController?.abort()
    }
    workspaceSignalHandlers.set(signal, handler)
    process.on(signal, handler)
  }
}

function uninstallWorkspaceSignalCleanup() {
  for (const [signal, handler] of workspaceSignalHandlers) {
    process.removeListener(signal, handler)
  }
  workspaceSignalHandlers.clear()
}

async function cleanupWorkspace(workspace) {
  await fsp.rm(workspace, { recursive: true, force: true })
  assert.equal(fs.existsSync(workspace), false, 'rollback drill workspace cleanup could not be verified')
}

async function removeStandaloneArchive(archivePath) {
  await fsp.rm(archivePath, { force: true })
  assert.equal(fs.existsSync(archivePath), false, 'standalone rollback archive cleanup could not be verified')
}

function assertDrillNotAborted(signal) {
  assert.equal(signal.aborted, false, 'rollback drill was interrupted')
}

async function prepareRestoreTargets({ databasePath, storagePath, storySourcesPath }) {
  await fsp.mkdir(path.dirname(databasePath), { recursive: true })
  await fsp.mkdir(storagePath, { recursive: true })
  await fsp.mkdir(storySourcesPath, { recursive: true })
  const markerDatabase = new Database(databasePath)
  try {
    markerDatabase.exec('CREATE TABLE rollback_marker (value TEXT NOT NULL); INSERT INTO rollback_marker VALUES (\'before-restore\')')
  } finally {
    markerDatabase.close()
  }
  await fsp.writeFile(path.join(storagePath, 'before-restore.txt'), 'rollback marker\n')
  await fsp.writeFile(path.join(storySourcesPath, 'before-restore.txt'), 'rollback marker\n')
}

function assertParsedOptions(options) {
  if (options?.inputMode === 'standalone') {
    assert.equal(options.archivePath, null, 'standalone rollback archivePath must be null')
    assert.equal(options.dataRoot, null, 'standalone rollback dataRoot must be null')
    return
  }
  assert.equal(options?.inputMode, 'checkpoint-bound', 'rollback drill input mode is invalid')
  assert.equal(path.isAbsolute(options.archivePath || ''), true, 'checkpoint archive path must be absolute')
  assert.equal(path.isAbsolute(options.dataRoot || ''), true, 'checkpoint data root must be absolute')
}

function assertFormat2Manifest(manifest) {
  assert.ok(manifest && typeof manifest === 'object' && !Array.isArray(manifest), 'rollback drill manifest is required')
  assert.equal(
    manifest.formatVersion,
    FORMAT_VERSION,
    `rollback drill backup format ${FORMAT_VERSION} required`,
  )
  const storySources = manifest.storySources
  assert.ok(
    storySources && typeof storySources === 'object' && !Array.isArray(storySources),
    `rollback drill format ${FORMAT_VERSION} storySources metadata is required`,
  )
  const storySourceFields = ['entryPrefix', 'fileCount', 'referenceCount', 'sha256', 'totalBytes']
  assert.deepEqual(
    Object.keys(storySources).sort(),
    storySourceFields,
    `rollback drill format ${FORMAT_VERSION} storySources metadata must be complete`,
  )
  assert.equal(
    storySources.entryPrefix,
    'story_sources/',
    `rollback drill format ${FORMAT_VERSION} storySources entryPrefix is invalid`,
  )
  for (const field of ['fileCount', 'totalBytes', 'referenceCount']) {
    assert.ok(
      Number.isSafeInteger(storySources[field]) && storySources[field] >= 0,
      `rollback drill format ${FORMAT_VERSION} storySources.${field} is invalid`,
    )
  }
  assert.match(
    storySources.sha256 || '',
    /^[a-f0-9]{64}$/,
    `rollback drill format ${FORMAT_VERSION} storySources.sha256 is invalid`,
  )
  return manifest
}

async function resolveSourceData(options, runtime) {
  assertParsedOptions(options)
  if (options.inputMode === 'checkpoint-bound') {
    await assertCheckpointInputPaths(options)
    const sourcePaths = {
      databasePath: path.join(options.dataRoot, 'drama_generator.db'),
      storagePath: path.join(options.dataRoot, 'storage'),
      storySourcesPath: path.join(options.dataRoot, 'story_sources'),
    }
    await capturePathIdentity(sourcePaths.databasePath, 'file')
    await capturePathIdentity(sourcePaths.storagePath, 'directory')
    await capturePathIdentity(sourcePaths.storySourcesPath, 'directory')
    return { dataRoot: options.dataRoot, sourcePaths }
  }

  const sourcePaths = runtime?.sourcePaths || {}
  const databasePath = path.resolve(sourcePaths.databasePath || '')
  const storagePath = path.resolve(sourcePaths.storagePath || '')
  const storySourcesPath = path.resolve(sourcePaths.storySourcesPath || '')
  assert.equal(path.basename(databasePath), 'drama_generator.db', 'standalone database must be drama_generator.db')
  assert.equal(path.basename(storagePath), 'storage', 'standalone storage path must end in storage')
  assert.equal(path.basename(storySourcesPath), 'story_sources', 'standalone story source path must end in story_sources')
  const dataRoot = path.dirname(databasePath)
  const parentPaths = [dataRoot, path.dirname(storagePath), path.dirname(storySourcesPath)]
  for (const parentPath of parentPaths.slice(1)) {
    assert.equal(
      comparableHostPath(parentPath),
      comparableHostPath(dataRoot),
      'standalone source paths must use the same data root'
    )
  }
  const dataRootIdentity = await capturePathIdentity(dataRoot, 'directory')
  for (const parentPath of parentPaths.slice(1)) {
    const parentIdentity = await capturePathIdentity(parentPath, 'directory')
    assertSamePathIdentity(dataRootIdentity, parentIdentity, 'standalone source data root')
  }
  await capturePathIdentity(databasePath, 'file')
  await capturePathIdentity(storagePath, 'directory')
  await capturePathIdentity(storySourcesPath, 'directory')
  return { dataRoot, sourcePaths: { databasePath, storagePath, storySourcesPath } }
}

async function executeRollbackDrill(options, runtime) {
  assert.ok(runtime && typeof runtime === 'object', 'rollback drill runtime is required')
  const repoRoot = path.resolve(runtime.repoRoot || root)
  assert.match(runtime.version || '', /^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/, 'rollback version is invalid')
  assert.match(runtime.commit || '', /^[a-f0-9]{40}$/, 'rollback commit is invalid')
  assert.ok(Number.isInteger(runtime.focusedTestCount) && runtime.focusedTestCount > 0, 'focused test count is invalid')
  const limits = normalizeDrillLimits(runtime.limits)
  const { dataRoot, sourcePaths } = await resolveSourceData(options, runtime)
  const fingerprint = runtime.fingerprintDataRoot || fingerprintDataRoot
  const hashFileHandle = runtime.sha256FileHandle || sha256FileHandle
  const fingerprintOptions = runtime.externalMaintenanceLease
    ? Object.freeze({
        volatileControlPaths: Object.freeze([`${sourcePaths.databasePath}.maintenance.lock`]),
      })
    : Object.freeze({})
  await runtime.runFocusedTests?.()
  await (runtime.prepareEvidenceTarget || prepareEvidenceTarget)(repoRoot, runtime.version)
  const beforeRootIdentity = await capturePathIdentity(dataRoot, 'directory')
  const beforeDataRootSha256 = await fingerprint(
    dataRoot,
    runtime.fingerprintHooks?.before,
    limits,
    fingerprintOptions
  )
  const signal = runtime.signal || new AbortController().signal
  const createWorkspace = runtime.createWorkspace || (() => fsp.mkdtemp(path.join(os.tmpdir(), 'localminidrama-rollback-drill-')))
  const removeWorkspace = runtime.cleanupWorkspace || cleanupWorkspace
  let workspace = null
  let archivePath
  let archiveHandle
  let archiveIdentity
  let archiveLinkIdentity
  let archiveSha256
  let archiveBytes
  let sourceDatabaseHandle
  let sourceDatabaseIdentity
  let sourceDatabaseSha256
  let backup
  let restored
  let verifiedManifest
  let restoredVerification
  let rollbackCopies
  let evidence
  let evidenceBytes
  let result
  let workspaceDirectoryHandle
  let workspaceDirectoryIdentity
  let workspaceMarkerHandle
  let workspaceMarkerIdentity
  let workspaceMarkerPath
  let workspaceMarkerClaimPath
  let workspaceClaimPath
  let workspaceCleanupBlockedError
  let workspaceRemovalProven = false
  let hasPrimaryError = false
  let primaryError
  let archiveClaimPath
  let archiveCleanupBlockedError
  let standaloneArchiveRemoved = false
  const closeHandle = runtime.closeRetainedHandle || ((handle) => handle.close())
  const removeArchive = runtime.removeStandaloneArchive || removeStandaloneArchive
  const removeOwnedClaim = runtime.removeOwnedClaim || (async ({ claimPath, expected, label, maximumEntries }) => {
    if (process.platform === 'win32') {
      return removeOwnedClaimWindows({ claimPath, expected, label, maximumEntries })
    }
    assertPrivateCleanupBoundary()
    if (expected.type === 'directory') return removeWorkspace(claimPath)
    if (label === 'standalone rollback archive') return removeArchive(claimPath)
    return fsp.unlink(claimPath)
  })

  async function closeConsumedHandle(handle, label) {
    let hasCloseError = false
    let closeError
    try {
      await closeHandle(handle, label)
    } catch (error) {
      hasCloseError = true
      closeError = error
    }
    if (!hasCloseError) return

    const fallbackErrors = []
    try {
      await handle.close()
    } catch (error) {
      fallbackErrors.push(error)
    }
    attachCleanupErrorList(closeError, fallbackErrors)
    throw closeError
  }

  async function closeArchiveHandle() {
    if (!archiveHandle) return
    const handle = archiveHandle
    archiveHandle = null
    await closeConsumedHandle(handle, 'rollback archive')
  }

  async function closeSourceDatabaseHandle() {
    if (!sourceDatabaseHandle) return
    const handle = sourceDatabaseHandle
    sourceDatabaseHandle = null
    await closeConsumedHandle(handle, 'source database')
  }

  async function closeWorkspaceMarkerHandle() {
    if (!workspaceMarkerHandle) return
    const handle = workspaceMarkerHandle
    workspaceMarkerHandle = null
    await handle.close()
  }

  async function closeWorkspaceDirectoryHandle() {
    if (!workspaceDirectoryHandle) return
    const handle = workspaceDirectoryHandle
    workspaceDirectoryHandle = null
    await handle.close()
  }

  async function removeWorkspaceWithProof() {
    if (!workspace || workspaceRemovalProven) return
    if (workspaceCleanupBlockedError) throw workspaceCleanupBlockedError
    assert.ok(workspaceMarkerHandle && workspaceMarkerIdentity && workspaceMarkerPath, 'workspace marker authority is missing')
    assert.ok(workspaceDirectoryHandle && workspaceDirectoryIdentity, 'workspace directory authority is missing')

    try {
      workspaceMarkerClaimPath = workspaceMarkerClaimPath || await claimOwnedPath(
        workspaceMarkerHandle,
        workspaceMarkerPath,
        workspaceMarkerIdentity,
        'rollback workspace marker'
      )
      await assertClaimOwnedOrPreserve(
        workspaceMarkerHandle,
        workspaceMarkerClaimPath,
        workspaceMarkerPath,
        workspaceMarkerIdentity,
        'rollback workspace marker'
      )
    } catch (error) {
      workspaceCleanupBlockedError = error
      throw error
    }
    try {
      await runtime.hooks?.beforeOwnedClaimRemoval?.({
        claimPath: workspaceMarkerClaimPath,
        expected: workspaceMarkerIdentity,
        label: 'rollback workspace marker',
      })
      await removeOwnedClaim({
        claimPath: workspaceMarkerClaimPath,
        expected: workspaceMarkerIdentity,
        label: 'rollback workspace marker',
        maximumEntries: 1,
      })
    } catch (error) {
      workspaceCleanupBlockedError = error
      throw error
    }
    await assertOwnedHandleUnlinked(workspaceMarkerHandle, workspaceMarkerIdentity, 'rollback workspace marker')
    workspaceMarkerClaimPath = null
    await closeWorkspaceMarkerHandle()

    try {
      workspaceClaimPath = workspaceClaimPath || await claimOwnedPath(
        workspaceDirectoryHandle,
        workspace,
        workspaceDirectoryIdentity,
        'rollback workspace'
      )
      await assertClaimOwnedOrPreserve(
        workspaceDirectoryHandle,
        workspaceClaimPath,
        workspace,
        workspaceDirectoryIdentity,
        'rollback workspace'
      )
    } catch (error) {
      workspaceCleanupBlockedError = error
      throw error
    }

    let hasRemovalError = false
    let removalError
    try {
      await runtime.hooks?.beforeOwnedClaimRemoval?.({
        claimPath: workspaceClaimPath,
        expected: workspaceDirectoryIdentity,
        label: 'rollback workspace',
      })
      await removeOwnedClaim({
        claimPath: workspaceClaimPath,
        expected: workspaceDirectoryIdentity,
        label: 'rollback workspace',
        maximumEntries: (limits.maxFiles * limits.maxPathDepth) + 1,
      })
    } catch (error) {
      hasRemovalError = true
      removalError = error
      workspaceCleanupBlockedError = error
    }

    const proofErrors = []
    let removalProofPassed = false
    try {
      await assertOwnedHandleUnlinked(workspaceDirectoryHandle, workspaceDirectoryIdentity, 'rollback workspace')
      workspaceClaimPath = null
      await assertPathEntryAbsent(workspace, 'rollback workspace')
      removalProofPassed = true
      workspaceRemovalProven = true
      if (activeWorkspace === workspace) activeWorkspace = null
    } catch (error) {
      proofErrors.push(error)
    }
    try {
      await closeWorkspaceDirectoryHandle()
    } catch (error) {
      proofErrors.push(error)
    }
    if (!removalProofPassed) workspaceRemovalProven = false
    throwPrimaryOrCleanup(hasRemovalError, removalError, proofErrors)
  }

  async function removeStandaloneArchiveWithProof() {
    if (options.inputMode !== 'standalone' || !archivePath || standaloneArchiveRemoved) return
    if (archiveCleanupBlockedError) throw archiveCleanupBlockedError
    if (!archiveHandle && !archiveLinkIdentity) {
      await assertPathEntryAbsent(archivePath, 'standalone rollback archive')
      standaloneArchiveRemoved = true
      return
    }
    assert.ok(archiveHandle && archiveLinkIdentity, 'standalone rollback archive authority is missing')
    try {
      archiveClaimPath = archiveClaimPath || await claimOwnedPath(
        archiveHandle,
        archivePath,
        archiveLinkIdentity,
        'standalone rollback archive'
      )
      await assertClaimOwnedOrPreserve(
        archiveHandle,
        archiveClaimPath,
        archivePath,
        archiveLinkIdentity,
        'standalone rollback archive'
      )
    } catch (error) {
      archiveCleanupBlockedError = error
      throw error
    }

    let hasRemovalError = false
    let removalError
    try {
      await runtime.hooks?.beforeOwnedClaimRemoval?.({
        claimPath: archiveClaimPath,
        expected: archiveLinkIdentity,
        label: 'standalone rollback archive',
      })
      await removeOwnedClaim({
        claimPath: archiveClaimPath,
        expected: archiveLinkIdentity,
        label: 'standalone rollback archive',
        maximumEntries: 1,
      })
    } catch (error) {
      hasRemovalError = true
      removalError = error
      archiveCleanupBlockedError = error
    }

    const proofErrors = []
    try {
      await assertOwnedHandleUnlinked(archiveHandle, archiveLinkIdentity, 'standalone rollback archive')
      archiveClaimPath = null
      await assertPathEntryAbsent(archivePath, 'standalone rollback archive')
      standaloneArchiveRemoved = true
    } catch (error) {
      proofErrors.push(error)
    }
    throwPrimaryOrCleanup(hasRemovalError, removalError, proofErrors)
  }

  try {
    if (options.inputMode === 'standalone') {
      sourceDatabaseHandle = await fsp.open(sourcePaths.databasePath, 'r')
      sourceDatabaseIdentity = await captureRetainedFileIdentity(
        sourceDatabaseHandle,
        sourcePaths.databasePath,
        'source database'
      )
      sourceDatabaseSha256 = await hashFileHandle(sourceDatabaseHandle, {
        expectedBytes: sourceDatabaseIdentity.size,
        maxBytes: limits.maxFileBytes,
        limits,
        limitKey: 'maxFileBytes',
        label: 'source database',
      })
      const initialDatabaseIdentity = await captureRetainedFileIdentity(
        sourceDatabaseHandle,
        sourcePaths.databasePath,
        'source database'
      )
      assertSamePathIdentity(sourceDatabaseIdentity, initialDatabaseIdentity, 'source database')
    }

    workspace = await createWorkspace()
    activeWorkspace = workspace
    workspaceDirectoryHandle = await fsp.open(workspace, 'r')
    workspaceMarkerPath = path.join(
      workspace,
      `.localminidrama-workspace-${crypto.randomBytes(16).toString('hex')}.marker`
    )
    workspaceMarkerHandle = await fsp.open(workspaceMarkerPath, 'wx+', 0o600)
    await workspaceMarkerHandle.writeFile(crypto.randomBytes(32))
    await workspaceMarkerHandle.sync()
    workspaceMarkerIdentity = await captureOwnedLinkIdentity(
      workspaceMarkerHandle,
      workspaceMarkerPath,
      'file',
      'rollback workspace marker'
    )
    workspaceDirectoryIdentity = await captureOwnedLinkIdentity(
      workspaceDirectoryHandle,
      workspace,
      'directory',
      'rollback workspace'
    )
    const standaloneArchivePath = `${workspace}-current-data.zip`
    archivePath = options.inputMode === 'checkpoint-bound' ? options.archivePath : standaloneArchivePath
    const restoreRoot = path.join(workspace, 'isolated-restore', 'data')
    const restoredPaths = {
      databasePath: path.join(restoreRoot, 'drama_generator.db'),
      storagePath: path.join(restoreRoot, 'storage'),
      storySourcesPath: path.join(restoreRoot, 'story_sources'),
    }

    let hasOperationError = false
    let operationError
    try {
      if (options.inputMode === 'checkpoint-bound') {
        archiveHandle = await fsp.open(archivePath, 'r')
        archiveIdentity = await captureRetainedFileIdentity(archiveHandle, archivePath, 'rollback archive')
        await runtime.hooks?.onArchiveHandleOpened?.({
          handle: archiveHandle,
          path: archivePath,
          identity: archiveIdentity,
          inputMode: options.inputMode,
        })
        archiveSha256 = await hashFileHandle(archiveHandle, {
          expectedBytes: archiveIdentity.size,
          maxBytes: limits.maxArchiveBytes,
          limits,
          limitKey: 'maxArchiveBytes',
          label: 'rollback archive',
        })
        const hashedArchiveIdentity = await captureRetainedFileIdentity(archiveHandle, archivePath, 'rollback archive')
        assertSamePathIdentity(archiveIdentity, hashedArchiveIdentity, 'rollback archive')
        archiveBytes = Number(archiveIdentity.size)
        assert.equal(Number.isSafeInteger(archiveBytes), true, 'rollback archive size is not a safe integer')
      } else {
        try {
          backup = await runtime.createDataBackup({
            databasePath: sourcePaths.databasePath,
            storagePath: sourcePaths.storagePath,
            storySourcesPath: sourcePaths.storySourcesPath,
            outputPath: archivePath,
            serviceHost: runtime.serviceHost,
            servicePort: runtime.servicePort,
            externalMaintenanceLease: runtime.externalMaintenanceLease,
            signal,
            limits,
          })
        } catch (error) {
          const cause = error?.cause
          if (cause) {
            console.error(`Backup cause: ${cause.stack || cause.message || cause}`)
          }
          throw error
        }
        assertDrillNotAborted(signal)
        verifiedManifest = assertFormat2Manifest(backup?.manifest)
        assert.equal(verifiedManifest.security.secretPolicy, 'excluded', 'rollback backup must exclude credentials')
        assert.ok(
          Number.isSafeInteger(backup.archiveBytes) && backup.archiveBytes >= 0,
          'backup archive size is not a non-negative safe integer'
        )

        archiveHandle = await fsp.open(archivePath, 'r')
        archiveIdentity = await captureRetainedFileIdentity(archiveHandle, archivePath, 'rollback archive')
        archiveLinkIdentity = await captureOwnedLinkIdentity(
          archiveHandle,
          archivePath,
          'file',
          'standalone rollback archive'
        )
        assert.equal(
          archiveIdentity.size,
          BigInt(backup.archiveBytes),
          'rollback archive descriptor length does not match backup.archiveBytes'
        )
        await runtime.hooks?.onArchiveHandleOpened?.({
          handle: archiveHandle,
          path: archivePath,
          identity: archiveIdentity,
          inputMode: options.inputMode,
        })
        archiveSha256 = await hashFileHandle(archiveHandle, {
          expectedBytes: BigInt(backup.archiveBytes),
          maxBytes: limits.maxArchiveBytes,
          limits,
          limitKey: 'maxArchiveBytes',
          label: 'rollback archive',
        })
        const hashedArchiveIdentity = await captureRetainedFileIdentity(archiveHandle, archivePath, 'rollback archive')
        assertSamePathIdentity(archiveIdentity, hashedArchiveIdentity, 'rollback archive')
        archiveBytes = backup.archiveBytes

        const postBackupDatabaseSha256 = await hashFileHandle(sourceDatabaseHandle, {
          expectedBytes: sourceDatabaseIdentity.size,
          maxBytes: limits.maxFileBytes,
          limits,
          limitKey: 'maxFileBytes',
          label: 'source database',
        })
        const postBackupDatabaseIdentity = await captureRetainedFileIdentity(
          sourceDatabaseHandle,
          sourcePaths.databasePath,
          'source database'
        )
        assertSamePathIdentity(sourceDatabaseIdentity, postBackupDatabaseIdentity, 'source database')
        assert.equal(postBackupDatabaseSha256, sourceDatabaseSha256, 'backup drill changed the source database')
      }

      await (runtime.prepareRestoreTargets || prepareRestoreTargets)(restoredPaths)
      restored = await runtime.restoreDataBackup({
        archivePath,
        archiveHandle,
        ...restoredPaths,
        confirmed: true,
        skipServiceCheck: true,
        signal,
        limits,
      })
      assertDrillNotAborted(signal)
      const restoredManifest = assertFormat2Manifest(restored?.manifest)
      if (backup) assert.deepEqual(restoredManifest, verifiedManifest, 'restored manifest differs from the backup manifest')
      else verifiedManifest = restoredManifest
      assert.equal(restoredManifest.security.secretPolicy, 'excluded', 'restored rollback backup must exclude credentials')
      rollbackCopies = {
        database: Boolean(restored.rollback.databasePath && fs.existsSync(restored.rollback.databasePath)),
        storage: Boolean(restored.rollback.storagePath && fs.existsSync(restored.rollback.storagePath)),
        story_sources: Boolean(restored.rollback.storySourcesPath && fs.existsSync(restored.rollback.storySourcesPath)),
      }
      assert.ok(Object.values(rollbackCopies).every(Boolean), 'restore did not retain every pre-restore rollback copy')
      restoredVerification = (runtime.verifyRestoredDatabase || verifyRestoredDatabase)(restoredPaths.databasePath)
      await runtime.hooks?.afterRestore?.({ archivePath, dataRoot, workspace })
    } catch (error) {
      hasOperationError = true
      operationError = error
    }

    let hasCleanupError = false
    let cleanupError
    try {
      await removeWorkspaceWithProof()
    } catch (error) {
      hasCleanupError = true
      cleanupError = error
    }
    throwPrimaryOrCleanup(
      hasOperationError,
      operationError,
      hasCleanupError ? [cleanupError] : []
    )
    assertDrillNotAborted(signal)
    assert.equal(workspaceRemovalProven, true, 'rollback workspace deletion was not proven')

    let finalDatabaseSha256
    if (sourceDatabaseHandle) {
      finalDatabaseSha256 = await hashFileHandle(sourceDatabaseHandle, {
        expectedBytes: sourceDatabaseIdentity.size,
        maxBytes: limits.maxFileBytes,
        limits,
        limitKey: 'maxFileBytes',
        label: 'source database',
      })
      assert.equal(finalDatabaseSha256, sourceDatabaseSha256, 'source database bytes changed')
    }

    const finalArchiveSha256 = await hashFileHandle(archiveHandle, {
      expectedBytes: archiveIdentity.size,
      maxBytes: limits.maxArchiveBytes,
      limits,
      limitKey: 'maxArchiveBytes',
      label: 'rollback archive',
    })
    assert.equal(finalArchiveSha256, archiveSha256, 'rollback archive bytes changed')
    await runtime.hooks?.afterFinalArchiveHash?.({ archivePath, dataRoot })

    const afterDataRootSha256 = await fingerprint(
      dataRoot,
      runtime.fingerprintHooks?.after,
      limits,
      fingerprintOptions
    )
    const afterRootIdentity = await capturePathIdentity(dataRoot, 'directory')
    assertSamePathIdentity(beforeRootIdentity, afterRootIdentity, 'source data root')
    assert.equal(afterDataRootSha256, beforeDataRootSha256, 'source data root fingerprint changed')

    if (sourceDatabaseHandle) {
      const finalDatabaseIdentity = await captureRetainedFileIdentity(
        sourceDatabaseHandle,
        sourcePaths.databasePath,
        'source database'
      )
      assertSamePathIdentity(sourceDatabaseIdentity, finalDatabaseIdentity, 'source database')
    }
    const finalArchiveIdentity = await captureRetainedFileIdentity(archiveHandle, archivePath, 'rollback archive')
    assertSamePathIdentity(archiveIdentity, finalArchiveIdentity, 'rollback archive')

    const manifest = verifiedManifest
    evidence = {
      schema: EVIDENCE_SCHEMA,
      status: 'passed',
      input_mode: options.inputMode,
      executed_at: (runtime.now ? runtime.now() : new Date()).toISOString(),
      source: {
        version: runtime.version,
        commit: runtime.commit,
        working_tree_dirty: false,
        data_root_sha256: beforeDataRootSha256,
        database: {
          relative_path: safeEvidencePath(repoRoot, sourcePaths.databasePath, '[external-database]'),
        },
      },
      focused_tests: {
        file: 'backend-node/test/dataBackupService.test.js',
        passed: runtime.focusedTestCount,
        total: runtime.focusedTestCount,
      },
      backup: {
        format_version: manifest.formatVersion,
        archive_bytes: archiveBytes,
        archive_sha256: archiveSha256,
        archive_retained: options.inputMode === 'checkpoint-bound',
        file_count: manifest.fileCount,
        storage_files: manifest.storage.fileCount,
        story_source_files: manifest.storySources.fileCount,
        active_story_source_references: manifest.storySources.referenceCount,
        secret_policy: manifest.security.secretPolicy,
        excluded_values: options.inputMode === 'checkpoint-bound' ? null : backup.security.excludedValues,
      },
      restore: {
        isolated: true,
        ...restoredVerification,
        rollback_copies: rollbackCopies,
      },
      operations: {
        source_database_unchanged: true,
        source_data_root_unchanged: afterDataRootSha256 === beforeDataRootSha256,
        credential_reconfiguration_required: true,
        workspace_cleanup_verified: workspaceRemovalProven,
      },
    }
    evidenceBytes = serializeEvidence(evidence)
    await runtime.hooks?.onEvidenceStaged?.({
      evidenceBytes: Buffer.from(evidenceBytes),
      inputMode: options.inputMode,
    })

    const preResultCleanupErrors = []
    let hasPreResultCleanupError = false
    const preResultCleanups = options.inputMode === 'standalone'
      ? [
          closeSourceDatabaseHandle,
          closeWorkspaceMarkerHandle,
          closeWorkspaceDirectoryHandle,
          removeStandaloneArchiveWithProof,
          closeArchiveHandle,
        ]
      : [
          closeArchiveHandle,
          closeSourceDatabaseHandle,
          closeWorkspaceMarkerHandle,
          closeWorkspaceDirectoryHandle,
        ]
    for (const cleanup of preResultCleanups) {
      try {
        await cleanup()
      } catch (error) {
        hasPreResultCleanupError = true
        preResultCleanupErrors.push(error)
      }
    }
    if (hasPreResultCleanupError) {
      throwPrimaryOrCleanup(false, undefined, preResultCleanupErrors)
    }

    const publication = await (runtime.publishEvidence || publishEvidence)(
      repoRoot,
      runtime.version,
      evidence,
      limits
    )
    assert.deepEqual(
      serializeEvidence(evidence),
      evidenceBytes,
      'rollback authoritative evidence changed during diagnostic publication'
    )
    assert.ok(publication && typeof publication === 'object', 'rollback diagnostic publication result is required')
    assert.match(
      publication.diagnosticRelativePath || '',
      /^artifacts\/rollback-drill\/summary-v3-[a-f0-9]{40}-[a-f0-9]{32}\.json$/,
      'rollback diagnostic publication path is invalid'
    )
    assert.equal(Buffer.isBuffer(publication.evidenceBytes), true, 'rollback diagnostic publication bytes are required')
    assert.deepEqual(publication.evidenceBytes, evidenceBytes, 'rollback diagnostic publication bytes changed')
    result = {
      evidence,
      evidenceBytes,
      diagnosticRelativePath: publication.diagnosticRelativePath,
    }
  } catch (error) {
    hasPrimaryError = true
    primaryError = error
  }

  const finalCleanupErrors = []
  let hasFinalCleanupError = false
  if (workspace && !workspaceRemovalProven) {
    try {
      await removeWorkspaceWithProof()
    } catch (error) {
      hasFinalCleanupError = true
      finalCleanupErrors.push(error)
    }
  }
  if (options.inputMode === 'standalone' && archivePath && !standaloneArchiveRemoved) {
    try {
      await removeStandaloneArchiveWithProof()
    } catch (error) {
      hasFinalCleanupError = true
      finalCleanupErrors.push(error)
    }
  }
  for (const cleanup of [
    closeArchiveHandle,
    closeSourceDatabaseHandle,
    closeWorkspaceMarkerHandle,
    closeWorkspaceDirectoryHandle,
  ]) {
    try {
      await cleanup()
    } catch (error) {
      hasFinalCleanupError = true
      finalCleanupErrors.push(error)
    }
  }
  throwPrimaryOrCleanup(
    hasPrimaryError,
    primaryError,
    hasFinalCleanupError ? finalCleanupErrors : []
  )
  return result
}

async function main(options = {}) {
  assert.ok(options && typeof options === 'object' && !Array.isArray(options), 'rollback main options must be an object')
  const drillOptions = parseDrillArguments(process.argv.slice(2))
  let externalMaintenanceLease = null
  let commit
  if (process.platform === 'linux') {
    assertPrivateCleanupBoundary()
    externalMaintenanceLease = decodeExternalMaintenanceLease(process.env.LMD_ROLLBACK_MAINTENANCE_LEASE)
    commit = String(process.env.LMD_ROLLBACK_SOURCE_COMMIT || '').toLowerCase()
    assert.match(commit, /^[a-f0-9]{40}$/, 'Linux rollback requires a launcher-proven source commit')
  } else {
    assert.ok(
      options.externalMaintenanceLease && typeof options.externalMaintenanceLease === 'object',
      'Windows rollback requires a launcher-retained external maintenance lease',
    )
    externalMaintenanceLease = options.externalMaintenanceLease
    assertCleanSourceTree()
    commit = gitOutput(['rev-parse', 'HEAD']).toLowerCase()
    assert.match(commit, /^[a-f0-9]{40}$/, 'rollback drill requires a full Git commit')
  }
  const packageJson = backendRequire('./package.json')
  const config = loadConfig()
  const focusedTestPath = path.join(backendRoot, 'test', 'dataBackupService.test.js')
  const focusedTestCount = (fs.readFileSync(focusedTestPath, 'utf8').match(/^test\(/gm) || []).length
  assert.ok(focusedTestCount > 0, 'backup and restore test inventory is empty')
  const controller = new AbortController()
  activeAbortController = controller
  interruptedSignal = null
  interruptedExitCode = null
  const runtime = {
    repoRoot: root,
    version: packageJson.version,
    commit,
    sourcePaths: {
      databasePath: configuredPath(config.database?.path, './data/drama_generator.db'),
      storagePath: configuredPath(config.storage?.local_path, './data/storage'),
      storySourcesPath: path.join(backendRoot, 'data', 'story_sources'),
    },
    focusedTestCount,
    externalMaintenanceLease,
    runFocusedTests: () => run(process.execPath, ['--test', '--test-concurrency=1', 'test/dataBackupService.test.js'], {
      cwd: backendRoot,
      stdio: 'inherit',
      timeout: 600000,
    }),
    createDataBackup,
    restoreDataBackup,
    prepareEvidenceTarget,
    publishEvidence,
    fingerprintDataRoot,
    prepareRestoreTargets,
    verifyRestoredDatabase,
    serviceHost: process.env.HOST || config.server?.host || '127.0.0.1',
    servicePort: Number(process.env.PORT) || config.server?.port || 5679,
    signal: controller.signal,
  }
  installWorkspaceSignalCleanup()
  try {
    const result = await executeRollbackDrill(drillOptions, runtime)
    if (interruptedSignal) {
      process.exitCode = interruptedExitCode
      throw new Error(`rollback drill interrupted by ${interruptedSignal}`)
    }
    process.stdout.write(`${createRollbackResultMarker(result, packageJson.version)}\n`)
  } catch (error) {
    if (interruptedSignal) {
      process.exitCode = interruptedExitCode
      throw new Error(`rollback drill interrupted by ${interruptedSignal}`, { cause: error })
    }
    throw error
  } finally {
    uninstallWorkspaceSignalCleanup()
    activeAbortController = null
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${renderThrownValue(error)}\n`)
    if (!process.exitCode) process.exitCode = 1
  })
}

module.exports = {
  attachCleanupError,
  executeRollbackDrill,
  renameOwnedPathWithRetry,
  main,
  removeOwnedClaimWindows,
  renderThrownValue,
  sha256FileHandle,
}
