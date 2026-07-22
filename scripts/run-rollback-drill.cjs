'use strict'

const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { createRequire } = require('node:module')
const { spawnSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const backendRoot = path.join(root, 'backend-node')
const backendRequire = createRequire(path.join(backendRoot, 'package.json'))
const Database = backendRequire('better-sqlite3')
const { loadConfig } = backendRequire('./src/config')
const { DEFAULT_LIMITS, createDataBackup, restoreDataBackup } = backendRequire('./src/services/dataBackupService')
const {
  EVIDENCE_RELATIVE_PATH,
  EVIDENCE_SCHEMA,
  assertCheckpointInputPaths,
  assertSamePathIdentity,
  capturePathIdentity,
  fingerprintDataRoot,
  parseDrillArguments,
  prepareEvidenceTarget,
  publishEvidence,
} = require('./rollback-drill-evidence.cjs')

let activeWorkspace = null
let activeAbortController = null
let interruptedSignal = null
let interruptedExitCode = null
const workspaceSignalHandlers = new Map()

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || root,
    encoding: options.encoding,
    stdio: options.stdio,
    windowsHide: true,
  })
  if (result.error) throw result.error
  assert.equal(result.status, 0, `${command} ${args.join(' ')} failed: ${String(result.stderr || '').trim()}`)
  return String(result.stdout || '').trim()
}

function gitOutput(args) {
  return run('git', args, { encoding: 'utf8' })
}

function assertCleanSourceTree() {
  assert.equal(
    gitOutput(['status', '--porcelain', '--untracked-files=normal']),
    '',
    'rollback drill evidence requires a clean Git working tree'
  )
}

function sha256(filePath) {
  const hash = crypto.createHash('sha256')
  const descriptor = fs.openSync(filePath, 'r')
  const buffer = Buffer.allocUnsafe(1024 * 1024)
  try {
    let bytesRead
    do {
      bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null)
      if (bytesRead) hash.update(buffer.subarray(0, bytesRead))
    } while (bytesRead)
  } finally {
    fs.closeSync(descriptor)
  }
  return hash.digest('hex')
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

function nonNegativeBigInt(value, label) {
  if (typeof value === 'bigint') {
    assert.ok(value >= 0n, `${label} must be non-negative`)
    return value
  }
  assert.ok(Number.isSafeInteger(value) && value >= 0, `${label} must be a non-negative safe integer`)
  return BigInt(value)
}

async function sha256FileHandle(handle, { expectedBytes, maxBytes }) {
  const expected = nonNegativeBigInt(expectedBytes, 'expected rollback archive bytes')
  assert.ok(Number.isSafeInteger(maxBytes) && maxBytes > 0, 'maximum rollback archive bytes must be a positive safe integer')
  const maximum = BigInt(maxBytes)
  const before = await handle.stat({ bigint: true })
  assert.equal(before.isFile(), true, 'rollback archive descriptor must be a regular file')
  assert.equal(before.size, expected, 'rollback archive descriptor length does not match its retained identity')
  assert.ok(before.size <= maximum, 'rollback archive exceeds the archive size limit')

  const hash = crypto.createHash('sha256')
  const buffer = Buffer.allocUnsafe(Math.min(1024 * 1024, maxBytes))
  let position = 0
  while (true) {
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, position)
    if (bytesRead === 0) break
    const nextPosition = BigInt(position) + BigInt(bytesRead)
    assert.ok(nextPosition <= maximum, 'rollback archive exceeds the archive size limit while hashing')
    assert.ok(nextPosition <= expected, 'rollback archive grew while it was hashed')
    hash.update(buffer.subarray(0, bytesRead))
    position = Number(nextPosition)
  }
  assert.equal(BigInt(position), expected, 'rollback archive length changed while it was hashed')
  const after = await handle.stat({ bigint: true })
  assert.equal(after.isFile(), true, 'rollback archive descriptor must remain a regular file')
  for (const field of ['dev', 'ino', 'size', 'ctimeNs']) {
    assert.equal(after[field], before[field], `rollback archive descriptor ${field} identity changed while hashing`)
  }
  return hash.digest('hex')
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
  activeWorkspace = null
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
  await runtime.runFocusedTests?.()
  await (runtime.prepareEvidenceTarget || prepareEvidenceTarget)(repoRoot, runtime.version)

  const fingerprint = runtime.fingerprintDataRoot || fingerprintDataRoot
  const beforeRootIdentity = await capturePathIdentity(dataRoot, 'directory')
  const beforeDataRootSha256 = await fingerprint(dataRoot, runtime.fingerprintHooks?.before, limits)
  const sourceDatabaseSha256 = options.inputMode === 'standalone' ? sha256(sourcePaths.databasePath) : null
  const signal = runtime.signal || new AbortController().signal
  const createWorkspace = runtime.createWorkspace || (() => fsp.mkdtemp(path.join(os.tmpdir(), 'localminidrama-rollback-drill-')))
  const removeWorkspace = runtime.cleanupWorkspace || cleanupWorkspace
  const workspace = await createWorkspace()
  activeWorkspace = workspace
  const workspaceArchivePath = path.join(workspace, 'current-data.zip')
  const archivePath = options.inputMode === 'checkpoint-bound' ? options.archivePath : workspaceArchivePath
  const restoreRoot = path.join(workspace, 'isolated-restore', 'data')
  const restoredPaths = {
    databasePath: path.join(restoreRoot, 'drama_generator.db'),
    storagePath: path.join(restoreRoot, 'storage'),
    storySourcesPath: path.join(restoreRoot, 'story_sources'),
  }
  let archiveHandle
  let archiveIdentity
  let archiveSha256
  let archiveBytes
  let backup
  let restored
  let restoredVerification
  let rollbackCopies
  let operationError
  let cleanupError
  try {
    if (options.inputMode === 'checkpoint-bound') {
      archiveHandle = await fsp.open(archivePath, 'r')
      archiveIdentity = await capturePathIdentity({ handle: archiveHandle, path: archivePath }, 'file')
      runtime.hooks?.onArchiveHandleOpened?.({ handle: archiveHandle, path: archivePath, identity: archiveIdentity })
      archiveSha256 = await sha256FileHandle(archiveHandle, {
        expectedBytes: archiveIdentity.size,
        maxBytes: limits.maxArchiveBytes,
      })
      archiveBytes = Number(archiveIdentity.size)
      assert.equal(Number.isSafeInteger(archiveBytes), true, 'rollback archive size is not a safe integer')
    } else {
      backup = await runtime.createDataBackup({
        databasePath: sourcePaths.databasePath,
        storagePath: sourcePaths.storagePath,
        storySourcesPath: sourcePaths.storySourcesPath,
        outputPath: archivePath,
        serviceHost: runtime.serviceHost,
        servicePort: runtime.servicePort,
        signal,
        limits,
      })
      assertDrillNotAborted(signal)
      assert.equal(backup.manifest.security.secretPolicy, 'excluded', 'rollback backup must exclude credentials')
      assert.equal(sha256(sourcePaths.databasePath), sourceDatabaseSha256, 'backup drill changed the source database')
      archiveSha256 = sha256(archivePath)
      archiveBytes = backup.archiveBytes
    }

    await (runtime.prepareRestoreTargets || prepareRestoreTargets)(restoredPaths)
    restored = await runtime.restoreDataBackup({
      archivePath,
      ...(archiveHandle ? { archiveHandle } : {}),
      ...restoredPaths,
      confirmed: true,
      skipServiceCheck: true,
      signal,
      limits,
    })
    assertDrillNotAborted(signal)
    if (backup) assert.deepEqual(restored.manifest, backup.manifest, 'restored manifest differs from the backup manifest')
    assert.equal(restored.manifest.security.secretPolicy, 'excluded', 'restored rollback backup must exclude credentials')
    rollbackCopies = {
      database: Boolean(restored.rollback.databasePath && fs.existsSync(restored.rollback.databasePath)),
      storage: Boolean(restored.rollback.storagePath && fs.existsSync(restored.rollback.storagePath)),
      story_sources: Boolean(restored.rollback.storySourcesPath && fs.existsSync(restored.rollback.storySourcesPath)),
    }
    assert.ok(Object.values(rollbackCopies).every(Boolean), 'restore did not retain every pre-restore rollback copy')
    restoredVerification = (runtime.verifyRestoredDatabase || verifyRestoredDatabase)(restoredPaths.databasePath)
    await runtime.hooks?.afterRestore?.({ archivePath, dataRoot, workspace })
  } catch (error) {
    operationError = error
  } finally {
    try {
      await removeWorkspace(workspace)
    } catch (error) {
      cleanupError = error
    }
  }

  try {
    if (cleanupError) throw cleanupError
    if (operationError) throw operationError
    assertDrillNotAborted(signal)
    const afterDataRootSha256 = await fingerprint(dataRoot, runtime.fingerprintHooks?.after, limits)
    const afterRootIdentity = await capturePathIdentity(dataRoot, 'directory')
    assertSamePathIdentity(beforeRootIdentity, afterRootIdentity, 'source data root')
    assert.equal(afterDataRootSha256, beforeDataRootSha256, 'source data root fingerprint changed')

    if (archiveHandle) {
      const finalArchiveIdentity = await capturePathIdentity({ handle: archiveHandle, path: archivePath }, 'file')
      assertSamePathIdentity(archiveIdentity, finalArchiveIdentity, 'rollback archive')
      const finalArchiveSha256 = await sha256FileHandle(archiveHandle, {
        expectedBytes: archiveIdentity.size,
        maxBytes: limits.maxArchiveBytes,
      })
      assert.equal(finalArchiveSha256, archiveSha256, 'rollback archive bytes changed')
    }

    const manifest = backup?.manifest || restored.manifest
    const evidence = {
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
        source_database_unchanged: options.inputMode === 'checkpoint-bound'
          ? true
          : sha256(sourcePaths.databasePath) === sourceDatabaseSha256,
        source_data_root_unchanged: afterDataRootSha256 === beforeDataRootSha256,
        credential_reconfiguration_required: true,
        workspace_cleanup_verified: true,
      },
    }
    await (runtime.publishEvidence || publishEvidence)(repoRoot, runtime.version, evidence, limits)
    return evidence
  } finally {
    if (archiveHandle) await archiveHandle.close()
  }
}

async function main() {
  const drillOptions = parseDrillArguments(process.argv.slice(2))
  const packageJson = backendRequire('./package.json')
  const config = loadConfig()
  const focusedTestPath = path.join(backendRoot, 'test', 'dataBackupService.test.js')
  const focusedTestCount = (fs.readFileSync(focusedTestPath, 'utf8').match(/^test\(/gm) || []).length
  assert.ok(focusedTestCount > 0, 'backup and restore test inventory is empty')
  assertCleanSourceTree()
  const commit = gitOutput(['rev-parse', 'HEAD']).toLowerCase()
  assert.match(commit, /^[a-f0-9]{40}$/, 'rollback drill requires a full Git commit')
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
    runFocusedTests: () => run(process.execPath, ['--test', '--test-concurrency=1', 'test/dataBackupService.test.js'], {
      cwd: backendRoot,
      stdio: 'inherit',
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
    const evidence = await executeRollbackDrill(drillOptions, runtime)
    if (interruptedSignal) {
      process.exitCode = interruptedExitCode
      throw new Error(`rollback drill interrupted by ${interruptedSignal}`)
    }
    process.stdout.write(`${JSON.stringify({ output: EVIDENCE_RELATIVE_PATH, ...evidence }, null, 2)}\n`)
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
    process.stderr.write(`${error.stack || error}\n`)
    if (!process.exitCode) process.exitCode = 1
  })
}

module.exports = { executeRollbackDrill, main, sha256FileHandle }
