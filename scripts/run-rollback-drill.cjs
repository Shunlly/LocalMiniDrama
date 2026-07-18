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
const { createDataBackup, restoreDataBackup } = backendRequire('./src/services/dataBackupService')
const {
  EVIDENCE_SCHEMA,
  assertNoCliArguments,
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

function configuredPath(value, fallback) {
  const candidate = value || fallback
  return path.isAbsolute(candidate) ? candidate : path.resolve(backendRoot, candidate)
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

async function main() {
  assertNoCliArguments(process.argv.slice(2))
  const packageJson = backendRequire('./package.json')
  assertCleanSourceTree()
  const outputPath = await prepareEvidenceTarget(root, packageJson.version)
  const commit = gitOutput(['rev-parse', 'HEAD']).toLowerCase()
  assert.match(commit, /^[a-f0-9]{40}$/, 'rollback drill requires a full Git commit')

  const config = loadConfig()
  const databasePath = configuredPath(config.database?.path, './data/drama_generator.db')
  const storagePath = configuredPath(config.storage?.local_path, './data/storage')
  const storySourcesPath = path.join(backendRoot, 'data', 'story_sources')
  assert.ok(fs.statSync(databasePath, { throwIfNoEntry: false })?.isFile(), 'source SQLite database is missing')
  assert.ok(fs.statSync(storagePath, { throwIfNoEntry: false })?.isDirectory(), 'source storage directory is missing')

  const focusedTestPath = path.join(backendRoot, 'test', 'dataBackupService.test.js')
  const focusedTestCount = (fs.readFileSync(focusedTestPath, 'utf8').match(/^test\(/gm) || []).length
  assert.ok(focusedTestCount > 0, 'backup and restore test inventory is empty')
  run(process.execPath, ['--test', '--test-concurrency=1', 'test/dataBackupService.test.js'], {
    cwd: backendRoot,
    stdio: 'inherit',
  })

  const sourceDatabaseSha256 = sha256(databasePath)
  const workspace = await fsp.mkdtemp(path.join(os.tmpdir(), 'localminidrama-rollback-drill-'))
  activeWorkspace = workspace
  activeAbortController = new AbortController()
  const { signal } = activeAbortController
  installWorkspaceSignalCleanup()
  const archivePath = path.join(workspace, 'current-data.zip')
  const restoreRoot = path.join(workspace, 'isolated-restore')
  const restoredDatabasePath = path.join(restoreRoot, 'data', 'drama_generator.db')
  const restoredStoragePath = path.join(restoreRoot, 'data', 'storage')
  const restoredStorySourcesPath = path.join(restoreRoot, 'data', 'story_sources')

  let evidence
  let operationError
  let cleanupError
  try {
    const backup = await createDataBackup({
      databasePath,
      storagePath,
      storySourcesPath,
      outputPath: archivePath,
      serviceHost: process.env.HOST || config.server?.host || '127.0.0.1',
      servicePort: Number(process.env.PORT) || config.server?.port || 5679,
      signal,
    })
    assertDrillNotAborted(signal)
    assert.equal(backup.manifest.security.secretPolicy, 'excluded', 'rollback backup must exclude credentials')
    assert.equal(sha256(databasePath), sourceDatabaseSha256, 'backup drill changed the source database')

    await fsp.mkdir(path.dirname(restoredDatabasePath), { recursive: true })
    await fsp.mkdir(restoredStoragePath, { recursive: true })
    await fsp.mkdir(restoredStorySourcesPath, { recursive: true })
    const markerDatabase = new Database(restoredDatabasePath)
    markerDatabase.exec('CREATE TABLE rollback_marker (value TEXT NOT NULL); INSERT INTO rollback_marker VALUES (\'before-restore\')')
    markerDatabase.close()
    await fsp.writeFile(path.join(restoredStoragePath, 'before-restore.txt'), 'rollback marker\n')
    await fsp.writeFile(path.join(restoredStorySourcesPath, 'before-restore.txt'), 'rollback marker\n')

    const restored = await restoreDataBackup({
      archivePath,
      databasePath: restoredDatabasePath,
      storagePath: restoredStoragePath,
      storySourcesPath: restoredStorySourcesPath,
      confirmed: true,
      skipServiceCheck: true,
      signal,
    })
    assertDrillNotAborted(signal)
    assert.deepEqual(restored.manifest, backup.manifest, 'restored manifest differs from the backup manifest')
    const rollbackCopies = {
      database: Boolean(restored.rollback.databasePath && fs.existsSync(restored.rollback.databasePath)),
      storage: Boolean(restored.rollback.storagePath && fs.existsSync(restored.rollback.storagePath)),
      story_sources: Boolean(restored.rollback.storySourcesPath && fs.existsSync(restored.rollback.storySourcesPath)),
    }
    assert.ok(Object.values(rollbackCopies).every(Boolean), 'restore did not retain every pre-restore rollback copy')
    const restoredVerification = verifyRestoredDatabase(restoredDatabasePath)

    evidence = {
      schema: EVIDENCE_SCHEMA,
      status: 'passed',
      executed_at: new Date().toISOString(),
      source: {
        version: packageJson.version,
        commit,
        working_tree_dirty: false,
        database: 'backend-node/data/drama_generator.db',
      },
      focused_tests: {
        file: 'backend-node/test/dataBackupService.test.js',
        passed: focusedTestCount,
        total: focusedTestCount,
      },
      backup: {
        format_version: backup.manifest.formatVersion,
        archive_bytes: backup.archiveBytes,
        archive_sha256: sha256(archivePath),
        file_count: backup.manifest.fileCount,
        storage_files: backup.manifest.storage.fileCount,
        story_source_files: backup.manifest.storySources.fileCount,
        active_story_source_references: backup.manifest.storySources.referenceCount,
        secret_policy: backup.manifest.security.secretPolicy,
        excluded_values: backup.security.excludedValues,
      },
      restore: {
        isolated: true,
        ...restoredVerification,
        rollback_copies: rollbackCopies,
      },
      operations: {
        source_database_unchanged: sha256(databasePath) === sourceDatabaseSha256,
        credential_reconfiguration_required: true,
      },
    }
  } catch (error) {
    operationError = error
  } finally {
    try {
      await cleanupWorkspace(workspace)
    } catch (error) {
      cleanupError = error
    } finally {
      uninstallWorkspaceSignalCleanup()
      activeAbortController = null
    }
  }

  if (cleanupError) throw cleanupError
  if (interruptedSignal) {
    process.exitCode = interruptedExitCode
    throw new Error(`rollback drill interrupted by ${interruptedSignal}`)
  }
  if (operationError) throw operationError
  evidence.backup.archive_retained = false
  evidence.operations.workspace_cleanup_verified = true
  const publishedPath = await publishEvidence(root, packageJson.version, evidence)
  const relativeOutput = path.relative(root, publishedPath).replace(/\\/g, '/')
  process.stdout.write(`${JSON.stringify({ output: relativeOutput, ...evidence }, null, 2)}\n`)
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`)
  if (!process.exitCode) process.exitCode = 1
})
