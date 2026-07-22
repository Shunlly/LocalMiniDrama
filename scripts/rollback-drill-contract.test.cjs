'use strict'

const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')
const { spawn, spawnSync } = require('node:child_process')
const { createRequire } = require('node:module')
const test = require('node:test')

const backendRequire = createRequire(path.join(__dirname, '..', 'backend-node', 'package.json'))
const Database = backendRequire('better-sqlite3')

const {
  DEFAULT_LIMITS,
  acquireServiceMaintenanceLockSync,
  createDataBackup,
  createExternalMaintenanceLease,
} = require('../backend-node/src/services/dataBackupService')

const {
  EVIDENCE_SCHEMA,
  MAX_ROLLBACK_RESULT_EVIDENCE_BYTES,
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
} = require('./rollback-drill-evidence.cjs')
const {
  executeRollbackDrill,
  removeOwnedClaimWindows,
  renderThrownValue,
  sha256FileHandle,
} = require('./run-rollback-drill.cjs')

const HEX_64 = /^[a-f0-9]{64}$/
const VERSION = '1.3.3'
const COMMIT = 'a'.repeat(40)

function tinyLimits(overrides = {}) {
  return {
    ...DEFAULT_LIMITS,
    maxFiles: 2,
    maxTotalBytes: 19,
    maxFileBytes: 8,
    maxArchiveBytes: 22,
    maxPathBytes: Buffer.byteLength('story_sources/source.txt'),
    maxManifestBytes: 8,
    maxPathDepth: 2,
    ...overrides,
  }
}

function temporaryDirectory(t, prefix) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  return directory
}

function seedCheckpointDataRoot(dataRoot) {
  fs.mkdirSync(path.join(dataRoot, 'storage'), { recursive: true })
  fs.mkdirSync(path.join(dataRoot, 'story_sources'), { recursive: true })
  fs.writeFileSync(path.join(dataRoot, 'drama_generator.db'), 'fixture database')
}

async function unusedTcpPort() {
  const server = net.createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const port = server.address().port
  await new Promise((resolve) => server.close(resolve))
  return port
}

function validExternalMaintenanceLease() {
  return {
    schema: 'localminidrama.maintenance-lease.v2',
    contract: 'exclusive-lease-owner-scope-and-heartbeat-required',
    device: '2049',
    inode: '1234567',
    ownerScope: 'linux:host:pid:[4026531836]',
    pid: 1234,
    token: '0123456789abcdef',
    version: 2,
  }
}

function installFakeGit(fakeBin) {
  const fakeGitPath = path.join(fakeBin, 'git')
  fs.writeFileSync(fakeGitPath, [
    '#!/usr/bin/env node',
    "'use strict'",
    "const fs = require('node:fs')",
    "const args = process.argv.slice(2)",
    "if (process.env.LMD_FAKE_GIT_CAPTURE) fs.appendFileSync(process.env.LMD_FAKE_GIT_CAPTURE, JSON.stringify(args) + '\\n')",
    "if (args[0] === 'status') process.stdout.write(process.env.LMD_FAKE_GIT_STATUS || '')",
    "else if (args[0] === 'rev-parse' && args[1] === 'HEAD') process.stdout.write(process.env.LMD_FAKE_GIT_COMMIT || '')",
    "else process.exit(41)",
    '',
  ].join('\n'))
  fs.chmodSync(fakeGitPath, 0o755)
}

function diagnosticRecords(repoRoot) {
  const evidenceRoot = path.dirname(evidenceOutputPath(repoRoot))
  if (!fs.existsSync(evidenceRoot)) return []
  return fs.readdirSync(evidenceRoot).filter((name) => /^summary-v3-[a-f0-9-]+\.json$/.test(name))
}

function validEvidence(inputMode = 'standalone', version = VERSION) {
  const checkpointBound = inputMode === 'checkpoint-bound'
  return {
    schema: 'localminidrama.rollback-drill.v3',
    status: 'passed',
    input_mode: inputMode,
    executed_at: '2026-07-20T00:00:00.000Z',
    source: {
      version,
      commit: COMMIT,
      working_tree_dirty: false,
      data_root_sha256: 'b'.repeat(64),
      database: { relative_path: 'backend-node/data/drama_generator.db' },
    },
    focused_tests: { file: 'backend-node/test/dataBackupService.test.js', passed: 2, total: 2 },
    backup: {
      format_version: 1,
      archive_bytes: 64,
      archive_sha256: 'c'.repeat(64),
      archive_retained: checkpointBound,
      file_count: 3,
      storage_files: 1,
      story_source_files: 1,
      active_story_source_references: 0,
      secret_policy: 'excluded',
      excluded_values: checkpointBound ? null : 2,
    },
    restore: {
      isolated: true,
      integrity_check: 'ok',
      credential_rows_checked: 0,
      credentials_excluded: true,
      restored_counts: {},
      rollback_copies: { database: true, storage: true, story_sources: true },
    },
    operations: {
      source_database_unchanged: true,
      source_data_root_unchanged: true,
      credential_reconfiguration_required: true,
      workspace_cleanup_verified: true,
    },
  }
}

function diagnosticRelativePath() {
  return `artifacts/rollback-drill/summary-v3-${COMMIT}-${'1'.repeat(32)}.json`
}

function validRollbackResult(evidence = validEvidence()) {
  return {
    evidence,
    evidenceBytes: serializeEvidence(evidence),
    diagnosticRelativePath: diagnosticRelativePath(),
  }
}

function publishedDiagnosticPath(repoRoot, publication) {
  return path.join(repoRoot, ...publication.diagnosticRelativePath.split('/'))
}

function encodeResultEnvelope(envelope) {
  return `${ROLLBACK_RESULT_MARKER_PREFIX}${Buffer.from(JSON.stringify(envelope), 'utf8').toString('base64url')}`
}

function resultEnvelopeForEvidence(evidenceBytes, overrides = {}) {
  return {
    schema: ROLLBACK_RESULT_SCHEMA,
    evidence_utf8_base64url: evidenceBytes.toString('base64url'),
    evidence_sha256: crypto.createHash('sha256').update(evidenceBytes).digest('hex'),
    diagnostic_relative_path: diagnosticRelativePath(),
    ...overrides,
  }
}

function setNested(object, fieldPath, value, remove = false) {
  const fields = fieldPath.split('.')
  let cursor = object
  for (const field of fields.slice(0, -1)) cursor = cursor[field]
  if (remove) delete cursor[fields.at(-1)]
  else cursor[fields.at(-1)] = value
}

function createDirectoryLink(t, target, linkPath) {
  try {
    fs.symlinkSync(target, linkPath, process.platform === 'win32' ? 'junction' : 'dir')
    return true
  } catch (error) {
    if (process.platform === 'win32' && ['EPERM', 'EACCES', 'UNKNOWN'].includes(error?.code)) {
      t.diagnostic(`Windows refused the directory reparse-point fixture: ${error.code}`)
      return false
    }
    throw error
  }
}

function createFileLink(t, target, linkPath) {
  try {
    fs.symlinkSync(target, linkPath, 'file')
    return true
  } catch (error) {
    if (process.platform === 'win32' && ['EPERM', 'EACCES', 'UNKNOWN'].includes(error?.code)) {
      t.diagnostic(`Windows refused the file reparse-point fixture: ${error.code}`)
      return false
    }
    throw error
  }
}

function installPublicPathReplacementRace(targetPath, installReplacement, { deleteOriginal = false } = {}) {
  const original = {
    rename: fsp.rename,
    rm: fsp.rm,
    unlink: fsp.unlink,
  }
  const displacedPath = `${targetPath}.race-original-${crypto.randomBytes(8).toString('hex')}`
  let fired = false

  async function replaceBeforeMutation() {
    fired = true
    await original.rename(targetPath, displacedPath)
    if (deleteOriginal) await original.rm(displacedPath, { recursive: true, force: true })
    await installReplacement(targetPath)
  }

  async function intercept(method, target, args) {
    if (!fired && path.resolve(target) === path.resolve(targetPath)) await replaceBeforeMutation()
    return original[method](target, ...args)
  }

  fsp.rename = (source, ...args) => intercept('rename', source, args)
  fsp.rm = (target, ...args) => intercept('rm', target, args)
  fsp.unlink = (target, ...args) => intercept('unlink', target, args)

  return {
    displacedPath,
    get fired() { return fired },
    restore() {
      fsp.rename = original.rename
      fsp.rm = original.rm
      fsp.unlink = original.unlink
    },
  }
}

function writeDataRoot(dataRoot, values = {}) {
  fs.mkdirSync(path.join(dataRoot, 'storage'), { recursive: true })
  fs.mkdirSync(path.join(dataRoot, 'story_sources'), { recursive: true })
  fs.writeFileSync(path.join(dataRoot, 'drama_generator.db'), values.database || 'database')
  fs.writeFileSync(path.join(dataRoot, 'storage', 'asset.txt'), values.storage || 'asset')
  fs.writeFileSync(path.join(dataRoot, 'story_sources', 'source.txt'), values.story || 'source')
}

function backupManifest() {
  return {
    formatVersion: 1,
    fileCount: 3,
    storage: { fileCount: 1 },
    storySources: { fileCount: 1, referenceCount: 0 },
    security: { secretPolicy: 'excluded' },
  }
}

function createExecutorFixture(t, inputMode = 'checkpoint-bound') {
  const fixtureRoot = temporaryDirectory(t, 'lmd-rollback-executor-')
  const dataRoot = path.join(fixtureRoot, 'source-data')
  const archivePath = path.join(fixtureRoot, 'retained-data.zip')
  writeDataRoot(dataRoot)
  fs.writeFileSync(archivePath, 'retained archive bytes')

  const calls = {
    create: [],
    restore: [],
    prepare: 0,
    publish: [],
  }
  const runtime = {
    repoRoot: fixtureRoot,
    version: VERSION,
    commit: COMMIT,
    sourcePaths: {
      databasePath: path.join(dataRoot, 'drama_generator.db'),
      storagePath: path.join(dataRoot, 'storage'),
      storySourcesPath: path.join(dataRoot, 'story_sources'),
    },
    focusedTestCount: 2,
    prepareEvidenceTarget: async () => {
      calls.prepare += 1
      return evidenceOutputPath(fixtureRoot)
    },
    createDataBackup: async (options) => {
      calls.create.push(options)
      await fsp.writeFile(options.outputPath, 'standalone archive bytes')
      return {
        manifest: backupManifest(),
        archiveBytes: Buffer.byteLength('standalone archive bytes'),
        security: { excludedValues: 7 },
      }
    },
    restoreDataBackup: async (options) => {
      calls.restore.push(options)
      const rollbackRoot = path.join(path.dirname(options.databasePath), 'rollback-copies')
      const rollbackDatabasePath = path.join(rollbackRoot, 'database.sqlite')
      const rollbackStoragePath = path.join(rollbackRoot, 'storage')
      const rollbackStorySourcesPath = path.join(rollbackRoot, 'story_sources')
      await fsp.mkdir(rollbackStoragePath, { recursive: true })
      await fsp.mkdir(rollbackStorySourcesPath, { recursive: true })
      await fsp.writeFile(rollbackDatabasePath, 'rollback')
      return {
        manifest: backupManifest(),
        rollback: {
          databasePath: rollbackDatabasePath,
          storagePath: rollbackStoragePath,
          storySourcesPath: rollbackStorySourcesPath,
        },
      }
    },
    prepareRestoreTargets: async ({ databasePath, storagePath, storySourcesPath }) => {
      await fsp.mkdir(path.dirname(databasePath), { recursive: true })
      await fsp.mkdir(storagePath, { recursive: true })
      await fsp.mkdir(storySourcesPath, { recursive: true })
      await fsp.writeFile(databasePath, 'marker database')
      await fsp.writeFile(path.join(storagePath, 'before-restore.txt'), 'marker')
      await fsp.writeFile(path.join(storySourcesPath, 'before-restore.txt'), 'marker')
    },
    verifyRestoredDatabase: () => ({
      integrity_check: 'ok',
      credential_rows_checked: 0,
      credentials_excluded: true,
      restored_counts: {},
    }),
    fingerprintDataRoot,
    removeOwnedClaim: async ({ claimPath, expected, label }) => {
      if (label === 'standalone rollback archive' && runtime.removeStandaloneArchive) {
        return runtime.removeStandaloneArchive(claimPath)
      }
      if (expected.type === 'directory' && runtime.cleanupWorkspace) {
        return runtime.cleanupWorkspace(claimPath)
      }
      if (expected.type === 'directory') return fsp.rm(claimPath, { recursive: true, force: true })
      return fsp.unlink(claimPath)
    },
    publishEvidence: async (repoRoot, version, evidence, limits) => {
      calls.publish.push(evidence)
      return publishEvidence(repoRoot, version, evidence, limits)
    },
    now: () => new Date('2026-07-20T00:00:00.000Z'),
  }
  const options = inputMode === 'checkpoint-bound'
    ? { inputMode, archivePath, dataRoot }
    : { inputMode: 'standalone', archivePath: null, dataRoot: null }
  return { archivePath, calls, dataRoot, fixtureRoot, options, runtime }
}

test('strict rollback CLI accepts only standalone or paired absolute checkpoint inputs', () => {
  const archive = path.resolve('C:/rollback/data.zip')
  const dataRoot = path.resolve('C:/rollback/data')
  assert.deepEqual(parseDrillArguments([]), {
    inputMode: 'standalone',
    archivePath: null,
    dataRoot: null,
  })
  assert.deepEqual(parseDrillArguments(['--archive', archive, '--data-root', dataRoot]), {
    inputMode: 'checkpoint-bound',
    archivePath: archive,
    dataRoot,
  })
  assert.deepEqual(parseDrillArguments(['--data-root', dataRoot, '--archive', archive]), {
    inputMode: 'checkpoint-bound',
    archivePath: archive,
    dataRoot,
  })

  for (const args of [
    ['--unknown', archive, '--data-root', dataRoot],
    ['--archive', archive, '--archive', archive, '--data-root', dataRoot],
    ['--archive', archive, '--data-root', dataRoot, '--data-root', dataRoot],
    ['--archive'],
    ['--data-root'],
    ['--archive', archive],
    ['--data-root', dataRoot],
    ['--archive', 'relative.zip', '--data-root', dataRoot],
    ['--archive', archive, '--data-root', 'relative-data'],
    ['positional'],
  ]) {
    assert.throws(() => parseDrillArguments(args))
  }
})

test('Linux rollback launcher builds a hardened private-cleanup container invocation', () => {
  const launcherPath = path.join(__dirname, 'run-rollback-drill-launcher.cjs')
  let launcher
  try {
    launcher = require(launcherPath)
  } catch (error) {
    assert.fail(`Linux rollback launcher is missing: ${error.message}`)
  }
  const repoRoot = path.resolve('/workspace/localminidrama')
  const dataRoot = path.resolve('/srv/localminidrama-data')
  const archivePath = path.resolve('/srv/checkpoints/data.zip')
  const artifactDirectory = path.join(repoRoot, 'artifacts', 'rollback-drill')
  const invocation = launcher.buildLinuxRollbackContainerInvocation({
    repoRoot,
    dataRoot,
    archivePath,
    artifactDirectory,
    drillArguments: ['--archive', archivePath, '--data-root', dataRoot],
    environment: {
      LOCALMINIDRAMA_DATA_DIR: dataRoot,
      LOCALMINIDRAMA_CONFIG_PATH: path.join(repoRoot, 'backend-node', 'configs', 'config.yaml'),
    },
    externalMaintenanceLease: validExternalMaintenanceLease(),
    cidFile: path.resolve('/run/user/1001/localminidrama-rollback.cid'),
    containerLabel: 'localminidrama.rollback-drill.run=0123456789abcdef0123456789abcdef',
    containerName: 'localminidrama-rollback-0123456789abcdef0123456789abcdef',
    sourceCommit: COMMIT,
    uid: 1001,
    gid: 1001,
  })

  assert.equal(invocation.command, 'docker')
  assert.equal(invocation.args[0], 'run')
  for (const required of [
    '--rm',
    '--cidfile',
    path.resolve('/run/user/1001/localminidrama-rollback.cid'),
    '--label',
    'localminidrama.rollback-drill.run=0123456789abcdef0123456789abcdef',
    '--name',
    'localminidrama-rollback-0123456789abcdef0123456789abcdef',
    '--init',
    '--read-only',
    '--network',
    'none',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '--tmpfs',
    '/tmp:rw,nosuid,nodev,exec,mode=700,size=48g,uid=1001,gid=1001',
    '--user',
    '1001:1001',
    'LMD_ROLLBACK_PRIVATE_CLEANUP=container-v1',
    `LMD_ROLLBACK_SOURCE_COMMIT=${COMMIT}`,
  ]) assert.ok(invocation.args.includes(required), `missing hardened Docker argument ${required}`)
  assert.ok(invocation.args.includes(`${repoRoot}:/workspace:ro`))
  assert.ok(invocation.args.includes(`${artifactDirectory}:/workspace/artifacts/rollback-drill:rw`))
  assert.ok(invocation.args.includes(`${dataRoot}:${dataRoot}:ro`))
  assert.ok(invocation.args.includes(`${path.dirname(archivePath)}:${path.dirname(archivePath)}:ro`))
  assert.ok(invocation.args.includes('node:20-bookworm-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0'))
  assert.deepEqual(invocation.args.slice(-6), [
    'node',
    'scripts/run-rollback-drill.cjs',
    '--archive',
    archivePath,
    '--data-root',
    dataRoot,
  ])
})

test('rollback launcher hard-bounds Docker controls, runs Windows in-process, and renders cleanup diagnostics', () => {
  const launcherPath = path.join(__dirname, 'run-rollback-drill-launcher.cjs')
  const source = fs.readFileSync(launcherPath, 'utf8')
  assert.match(source, /spawnSync\('docker',[\s\S]*killSignal:\s*'SIGKILL'/)
  assert.match(source, /\['container',\s*'ls',\s*'--all',\s*'--no-trunc'/)
  assert.match(source, /\[\s*'create',\s*'--pull',\s*'never'/)
  assert.doesNotMatch(source, /runChildSync\(process\.execPath/)
  assert.match(source, /await\s+runWindowsRollback\(\{\s*parsed\s*\}\)/)
  assert.match(source, /function recordLauncherCleanupFailure/)
  assert.match(source, /finally\s*\{[\s\S]*recordLauncherCleanupFailure/)
  assert.ok(
    source.indexOf('module.exports = {') < source.indexOf('if (require.main === module)'),
    'launcher exports must be published before the CLI path can load the drill through a circular require',
  )
  const drillSource = fs.readFileSync(path.join(__dirname, 'run-rollback-drill.cjs'), 'utf8')
  assert.match(drillSource, /spawnSync\(command, args,[\s\S]*timeout:\s*options\.timeout[\s\S]*killSignal:\s*'SIGKILL'/)
  assert.match(drillSource, /runFocusedTests:[\s\S]{0,500}timeout:\s*600000/)
  assert.match(
    source,
    /cleanupOwnedContainer\(management\)[\s\S]{0,500}createExternalMaintenanceLease\(maintenanceGuard\)/,
    'Linux launcher must revalidate the host lease after daemon cleanup and before release',
  )

  const { renderLauncherError } = require(launcherPath)
  assert.equal(typeof renderLauncherError, 'function')
  const primary = new Error('primary launcher failure')
  Object.defineProperty(primary, 'cleanupErrors', {
    configurable: true,
    value: [new Error('container cleanup failure')],
  })
  const rendered = renderLauncherError(primary)
  assert.match(rendered, /primary launcher failure/)
  assert.match(rendered, /container cleanup failure/)
  assert.ok(rendered.indexOf('primary launcher failure') < rendered.indexOf('container cleanup failure'))
  assert.ok(Buffer.byteLength(rendered, 'utf8') <= 64 * 1024)
})

test('Windows rollback launcher holds one external maintenance lease across drill identity checks', async (t) => {
  const { runWindowsRollback } = require('./run-rollback-drill-launcher.cjs')
  assert.equal(typeof runWindowsRollback, 'function', 'Windows rollback lease runner is missing')

  const fixtureRoot = temporaryDirectory(t, 'lmd-windows-rollback-lease-')
  const dataRoot = path.join(fixtureRoot, 'data')
  seedCheckpointDataRoot(dataRoot)
  const databasePath = path.join(dataRoot, 'drama_generator.db')
  const storagePath = path.join(dataRoot, 'storage')
  const storySourcesPath = path.join(dataRoot, 'story_sources')
  const lockPath = `${databasePath}.maintenance.lock`
  const lockOptions = { databasePath, storagePath, storySourcesPath }

  const transientBefore = fs.statSync(dataRoot, { bigint: true }).ctimeNs
  const transientGuard = acquireServiceMaintenanceLockSync(lockOptions)
  transientGuard.release()
  const transientAfter = fs.statSync(dataRoot, { bigint: true }).ctimeNs
  assert.notEqual(transientAfter, transientBefore, 'transient maintenance lock did not reproduce data-root ctime drift')

  let drillBefore
  let drillAfter
  await runWindowsRollback({
    parsed: {
      inputMode: 'checkpoint-bound',
      archivePath: path.join(fixtureRoot, 'checkpoint.zip'),
      dataRoot,
    },
    config: { server: { host: '127.0.0.1', port: await unusedTcpPort() } },
    environment: {},
    drillMain: async ({ externalMaintenanceLease }) => {
      assert.equal(fs.existsSync(lockPath), true, 'maintenance lease was not present before the drill')
      assert.equal(externalMaintenanceLease.schema, 'localminidrama.maintenance-lease.v2')
      drillBefore = fs.statSync(dataRoot, { bigint: true }).ctimeNs
      await new Promise((resolve) => setImmediate(resolve))
      drillAfter = fs.statSync(dataRoot, { bigint: true }).ctimeNs
    },
  })

  assert.equal(drillAfter, drillBefore, 'data-root identity changed while the retained lease covered the drill')
  assert.equal(fs.existsSync(lockPath), false, 'Windows launcher did not release its maintenance lease')
})

test('Windows rollback launcher retains WAL control paths across a real standalone backup', async (t) => {
  const { runWindowsRollback } = require('./run-rollback-drill-launcher.cjs')
  const fixtureRoot = temporaryDirectory(t, 'lmd-windows-rollback-wal-')
  const dataRoot = path.join(fixtureRoot, 'data')
  const databasePath = path.join(dataRoot, 'drama_generator.db')
  const storagePath = path.join(dataRoot, 'storage')
  const storySourcesPath = path.join(dataRoot, 'story_sources')
  const firstArchivePath = path.join(fixtureRoot, 'without-retained-reader.zip')
  const secondArchivePath = path.join(fixtureRoot, 'with-retained-reader.zip')
  fs.mkdirSync(storagePath, { recursive: true })
  fs.mkdirSync(storySourcesPath, { recursive: true })
  fs.writeFileSync(path.join(storagePath, 'asset.txt'), 'asset')
  const database = new Database(databasePath)
  database.pragma('journal_mode = WAL')
  database.exec('CREATE TABLE records (id INTEGER PRIMARY KEY, value TEXT NOT NULL); INSERT INTO records (value) VALUES (\'fixture\')')
  database.close()
  const sourcePaths = { databasePath, storagePath, storySourcesPath }

  const transientGuard = acquireServiceMaintenanceLockSync(sourcePaths)
  try {
    const before = fs.statSync(dataRoot, { bigint: true }).ctimeNs
    await createDataBackup({
      ...sourcePaths,
      outputPath: firstArchivePath,
      externalMaintenanceLease: createExternalMaintenanceLease(transientGuard),
    })
    const after = fs.statSync(dataRoot, { bigint: true }).ctimeNs
    assert.notEqual(after, before, 'WAL backup did not reproduce transient sidecar ctime drift')
  } finally {
    transientGuard.release()
  }

  let drillBefore
  let drillAfter
  await runWindowsRollback({
    parsed: { inputMode: 'standalone', archivePath: null, dataRoot: null },
    sourcePaths,
    config: { server: { host: '127.0.0.1', port: await unusedTcpPort() } },
    environment: {},
    drillMain: async ({ externalMaintenanceLease }) => {
      assert.equal(fs.existsSync(`${databasePath}-wal`), true, 'retained WAL path is missing before the drill')
      assert.equal(fs.existsSync(`${databasePath}-shm`), true, 'retained SHM path is missing before the drill')
      drillBefore = fs.statSync(dataRoot, { bigint: true }).ctimeNs
      await createDataBackup({
        ...sourcePaths,
        outputPath: secondArchivePath,
        externalMaintenanceLease,
      })
      drillAfter = fs.statSync(dataRoot, { bigint: true }).ctimeNs
    },
  })

  assert.equal(drillAfter, drillBefore, 'WAL control paths changed the data-root identity during the drill')
  assert.equal(fs.existsSync(`${databasePath}-wal`), false, 'retained WAL path was not released')
  assert.equal(fs.existsSync(`${databasePath}-shm`), false, 'retained SHM path was not released')
})

test('rollback launcher fails closed when Docker inspect fails for a CID that still exists', () => {
  const { inspectOwnedContainer } = require('./run-rollback-drill-launcher.cjs')
  assert.equal(typeof inspectOwnedContainer, 'function')
  const id = 'c'.repeat(64)
  const token = 'a'.repeat(32)
  const management = {
    cidFile: path.join(os.tmpdir(), 'unused-rollback.cid'),
    containerLabel: `localminidrama.rollback-drill.run=${token}`,
    containerName: `localminidrama-rollback-${token}`,
  }
  const dockerControl = () => ({ error: null, status: 1, stderr: 'inspect unavailable', stdout: '' })

  assert.throws(
    () => inspectOwnedContainer(id, management, {
      dockerControl,
      listContainerIds: () => [id],
    }),
    /inspect|exists|container/i,
  )
  assert.equal(inspectOwnedContainer(id, management, {
    dockerControl,
    listContainerIds: () => [],
  }), false)
})

test('Linux rollback launcher retains its host lease and control evidence after a signaled late Docker request', {
  skip: process.platform !== 'linux',
  timeout: 15000,
}, async (t) => {
  const fixtureRoot = temporaryDirectory(t, 'lmd-rollback-signal-cleanup-')
  const fakeBin = path.join(fixtureRoot, 'bin')
  const statePath = path.join(fixtureRoot, 'docker-state.json')
  const eventPath = path.join(fixtureRoot, 'docker-events.jsonl')
  const lateDaemonPath = path.join(fixtureRoot, 'late-docker-request.cjs')
  const lateReadyPath = path.join(fixtureRoot, 'late-docker-request.ready')
  const dataRoot = path.join(fixtureRoot, 'data')
  const archivePath = path.join(fixtureRoot, 'checkpoint.zip')
  fs.mkdirSync(fakeBin)
  seedCheckpointDataRoot(dataRoot)
  fs.writeFileSync(archivePath, 'checkpoint')
  installFakeGit(fakeBin)
  fs.writeFileSync(lateDaemonPath, [
    "'use strict'",
    "const fs = require('node:fs')",
    "setTimeout(() => {",
    "  fs.writeFileSync(process.env.LMD_FAKE_DOCKER_STATE, JSON.stringify({ cid: 'e'.repeat(64), label: process.env.LMD_FAKE_LATE_LABEL, running: false, late: true }))",
    "  fs.appendFileSync(process.env.LMD_FAKE_DOCKER_EVENTS, JSON.stringify({ event: 'late-create', args: [], lockPresent: fs.existsSync(process.env.LMD_FAKE_MAINTENANCE_LOCK) }) + '\\n')",
    "}, 2600)",
    '',
  ].join('\n'))

  const fakeDockerPath = path.join(fakeBin, 'docker')
  fs.writeFileSync(fakeDockerPath, [
    '#!/usr/bin/env node',
    "'use strict'",
    "const fs = require('node:fs')",
    "const { spawn } = require('node:child_process')",
    "const args = process.argv.slice(2)",
    "const statePath = process.env.LMD_FAKE_DOCKER_STATE",
    "const eventPath = process.env.LMD_FAKE_DOCKER_EVENTS",
    "const record = (event) => fs.appendFileSync(eventPath, JSON.stringify({ event, args, lockPresent: fs.existsSync(process.env.LMD_FAKE_MAINTENANCE_LOCK) }) + '\\n')",
    "const readState = () => fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : null",
    "if (args[0] === 'run') {",
    "  const cid = 'c'.repeat(64)",
    "  const cidIndex = args.indexOf('--cidfile')",
    "  fs.writeFileSync(args[cidIndex + 1], cid + '\\n')",
    "  const label = args[args.indexOf('--label') + 1].split('=').slice(1).join('=')",
    "  fs.writeFileSync(statePath, JSON.stringify({ cid, label, running: true }))",
    "  record('run')",
    "  const late = spawn(process.execPath, [process.env.LMD_FAKE_LATE_DAEMON], { detached: true, stdio: 'ignore', env: { ...process.env, LMD_FAKE_LATE_LABEL: label } })",
    "  late.unref()",
    "  fs.writeFileSync(process.env.LMD_FAKE_LATE_READY, 'ready')",
    "  process.on('SIGTERM', () => {})",
    "  setInterval(() => {}, 1000)",
    "} else if (args[0] === 'container' && args[1] === 'ls') {",
    "  const state = readState()",
    "  record('list')",
    "  const filter = args[args.indexOf('--filter') + 1] || ''",
    "  if (state && (filter.startsWith('id=') || process.env.LMD_FAKE_CID_ONLY !== '1')) process.stdout.write(state.cid + '\\n')",
    "} else if (args[0] === 'container' && args[1] === 'inspect') {",
    "  const state = readState()",
    "  record('inspect')",
    "  if (!state) process.exit(1)",
    "  process.stdout.write(state.label + '\\n')",
    "} else if (args[0] === 'stop') {",
    "  record('stop')",
    "  process.exit(19)",
    "} else if (args[0] === 'kill') {",
    "  const state = readState()",
    "  record('kill')",
    "  if (state) fs.writeFileSync(statePath, JSON.stringify({ ...state, running: false }))",
    "} else if (args[0] === 'rm') {",
    "  record('rm')",
    "  fs.rmSync(statePath, { force: true })",
    "} else if (args[0] === 'create') {",
    "  record('create')",
    "  if (readState()) process.exit(1)",
    "  const cid = 'd'.repeat(64)",
    "  const label = args[args.indexOf('--label') + 1].split('=').slice(1).join('=')",
    "  fs.writeFileSync(statePath, JSON.stringify({ cid, label, running: false }))",
    "  process.stdout.write(cid + '\\n')",
    "} else {",
    "  record('unexpected')",
    "  process.exit(41)",
    "}",
    '',
  ].join('\n'))
  fs.chmodSync(fakeDockerPath, 0o755)

  const child = spawn(process.execPath, [
    path.join(__dirname, 'run-rollback-drill-launcher.cjs'),
    '--archive',
    archivePath,
    '--data-root',
    dataRoot,
  ], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(await unusedTcpPort()),
      PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ''}`,
      LMD_FAKE_DOCKER_EVENTS: eventPath,
      LMD_FAKE_DOCKER_STATE: statePath,
      LMD_FAKE_LATE_DAEMON: lateDaemonPath,
      LMD_FAKE_LATE_READY: lateReadyPath,
      LMD_FAKE_GIT_COMMIT: COMMIT,
      LMD_FAKE_MAINTENANCE_LOCK: `${path.join(dataRoot, 'drama_generator.db')}.maintenance.lock`,
      LMD_FAKE_CID_ONLY: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const stderr = []
  child.stdout.resume()
  child.stderr.on('data', (chunk) => stderr.push(chunk))

  const deadline = Date.now() + 5000
  while ((!fs.existsSync(statePath) || !fs.existsSync(lateReadyPath)) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  assert.ok(fs.existsSync(statePath) && fs.existsSync(lateReadyPath), `fake Docker did not start: ${Buffer.concat(stderr).toString('utf8')}`)
  child.kill('SIGTERM')
  const result = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => resolve({ code, signal }))
  })

  assert.deepEqual(result, { code: 143, signal: null }, Buffer.concat(stderr).toString('utf8'))
  await new Promise((resolve) => setTimeout(resolve, 1000))
  assert.equal(JSON.parse(fs.readFileSync(statePath, 'utf8')).late, true, 'late Docker request was not reproduced')
  assert.equal(fs.existsSync(`${path.join(dataRoot, 'drama_generator.db')}.maintenance.lock`), true)
  const events = fs.readFileSync(eventPath, 'utf8').trim().split(/\r?\n/).map(JSON.parse)
  assert.ok(events.some(({ event }) => event === 'stop'))
  assert.ok(events.some(({ event }) => event === 'kill'))
  assert.ok(events.some(({ event }) => event === 'rm'))
  assert.ok(events.some(({ event }) => event === 'inspect'))
  assert.ok(events.some(({ event }) => event === 'create'))
  assert.ok(events.some(({ event }) => event === 'late-create'))
  assert.ok(events.filter(({ event }) => ['stop', 'kill', 'rm'].includes(event)).every(({ lockPresent }) => lockPresent))
})

test('Linux rollback launcher retains the host lease when Docker cleanup cannot be proven', {
  skip: process.platform !== 'linux',
}, async (t) => {
  const fixtureRoot = temporaryDirectory(t, 'lmd-rollback-cleanup-failure-')
  const fakeBin = path.join(fixtureRoot, 'bin')
  const controlDirectory = path.join(fixtureRoot, 'control')
  const dataRoot = path.join(fixtureRoot, 'data')
  const archivePath = path.join(fixtureRoot, 'checkpoint.zip')
  fs.mkdirSync(fakeBin)
  fs.mkdirSync(controlDirectory)
  seedCheckpointDataRoot(dataRoot)
  fs.writeFileSync(archivePath, 'checkpoint')
  installFakeGit(fakeBin)
  const fakeDockerPath = path.join(fakeBin, 'docker')
  fs.writeFileSync(fakeDockerPath, [
    '#!/usr/bin/env node',
    "'use strict'",
    "const args = process.argv.slice(2)",
    "if (args[0] === 'run') process.exit(23)",
    "if (args[0] === 'container' && args[1] === 'ls') process.exit(55)",
    "process.exit(41)",
    '',
  ].join('\n'))
  fs.chmodSync(fakeDockerPath, 0o755)
  const token = 'f'.repeat(32)
  const result = spawnSync(process.execPath, [
    path.join(__dirname, 'run-rollback-drill-launcher.cjs'),
    '--archive',
    archivePath,
    '--data-root',
    dataRoot,
  ], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(await unusedTcpPort()),
      PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ''}`,
      LMD_FAKE_GIT_COMMIT: COMMIT,
      LMD_ROLLBACK_CIDFILE: path.join(controlDirectory, 'container.cid'),
      LMD_ROLLBACK_CONTAINER_LABEL: `localminidrama.rollback-drill.run=${token}`,
      LMD_ROLLBACK_CONTAINER_NAME: `localminidrama-rollback-${token}`,
    },
  })

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Docker control|container|cleanup/i)
  const lockPath = `${path.join(dataRoot, 'drama_generator.db')}.maintenance.lock`
  assert.ok(fs.statSync(lockPath).isFile(), 'cleanup failure released the host maintenance lease')
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'))
  assert.equal(lock.operation, 'service')
  assert.equal(lock.contract, 'exclusive-lease-owner-scope-and-heartbeat-required')
})

test('Linux rollback launcher executes Docker and preserves its exit status without forwarding secrets', {
  skip: process.platform !== 'linux',
}, async (t) => {
  const { ROLLBACK_NODE_IMAGE } = require('./run-rollback-drill-launcher.cjs')
  const fixtureRoot = temporaryDirectory(t, 'lmd-rollback-launcher-')
  const fakeBin = path.join(fixtureRoot, 'bin')
  const capturePath = path.join(fixtureRoot, 'docker-arguments.json')
  const gitCapturePath = path.join(fixtureRoot, 'git-arguments.jsonl')
  const dataRoot = path.join(fixtureRoot, 'data')
  const archivePath = path.join(fixtureRoot, 'checkpoint.zip')
  fs.mkdirSync(fakeBin)
  seedCheckpointDataRoot(dataRoot)
  fs.writeFileSync(archivePath, 'checkpoint')
  const servicePort = await unusedTcpPort()
  installFakeGit(fakeBin)

  const fakeDockerPath = path.join(fakeBin, 'docker')
  fs.writeFileSync(fakeDockerPath, [
    '#!/usr/bin/env node',
    "'use strict'",
    "const fs = require('node:fs')",
    "const args = process.argv.slice(2)",
    "const statePath = process.env.LMD_FAKE_DOCKER_CAPTURE + '.state'",
    "if (args[0] === 'run') {",
    "  fs.writeFileSync(process.env.LMD_FAKE_DOCKER_CAPTURE, JSON.stringify(args))",
    "  process.exit(Number(process.env.LMD_FAKE_DOCKER_EXIT))",
    "}",
    "if (args[0] === 'container' && args[1] === 'ls') process.exit(0)",
    "if (args[0] === 'container' && args[1] === 'inspect') {",
    "  if (!fs.existsSync(statePath)) process.exit(1)",
    "  process.stdout.write(fs.readFileSync(statePath, 'utf8') + '\\n')",
    "  process.exit(0)",
    "}",
    "if (args[0] === 'create') {",
    "  fs.writeFileSync(statePath, args[args.indexOf('--label') + 1].split('=').slice(1).join('='))",
    "  process.stdout.write('d'.repeat(64) + '\\n')",
    "  process.exit(0)",
    "}",
    "if (args[0] === 'rm') { fs.rmSync(statePath, { force: true }); process.exit(0) }",
    "process.exit(41)",
    '',
  ].join('\n'))
  fs.chmodSync(fakeDockerPath, 0o755)

  const secret = 'must-not-enter-docker-arguments'
  const result = spawnSync(process.execPath, [
    path.join(__dirname, 'run-rollback-drill-launcher.cjs'),
    '--archive',
    archivePath,
    '--data-root',
    dataRoot,
  ], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(servicePort),
      PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ''}`,
      LMD_FAKE_DOCKER_CAPTURE: capturePath,
      LMD_FAKE_DOCKER_EXIT: '23',
      LMD_FAKE_GIT_CAPTURE: gitCapturePath,
      LMD_FAKE_GIT_COMMIT: COMMIT,
      LMD_SECRET_DO_NOT_FORWARD: secret,
    },
  })

  assert.equal(result.error, undefined)
  assert.equal(result.signal, null)
  assert.equal(result.status, 23, result.stderr)
  const dockerArguments = JSON.parse(fs.readFileSync(capturePath, 'utf8'))
  assert.equal(dockerArguments[0], 'run')
  assert.ok(dockerArguments.includes(ROLLBACK_NODE_IMAGE))
  assert.ok(dockerArguments.includes(`${dataRoot}:${dataRoot}:ro`))
  assert.ok(dockerArguments.includes(`${fixtureRoot}:${fixtureRoot}:ro`))
  const leaseArguments = dockerArguments.filter((argument) => argument.startsWith('LMD_ROLLBACK_MAINTENANCE_LEASE='))
  assert.equal(leaseArguments.length, 1)
  assert.ok(dockerArguments.includes(`LMD_ROLLBACK_SOURCE_COMMIT=${COMMIT}`))
  assert.deepEqual(dockerArguments.slice(-6), [
    'node',
    'scripts/run-rollback-drill.cjs',
    '--archive',
    archivePath,
    '--data-root',
    dataRoot,
  ])
  assert.equal(dockerArguments.some((argument) => argument.includes(secret)), false)
  assert.equal(dockerArguments.some((argument) => argument.startsWith('LMD_SECRET_DO_NOT_FORWARD=')), false)
  assert.equal(fs.existsSync(`${path.join(dataRoot, 'drama_generator.db')}.maintenance.lock`), false)
  const gitArguments = fs.readFileSync(gitCapturePath, 'utf8').trim().split(/\r?\n/).map(JSON.parse)
  assert.deepEqual(gitArguments, [
    ['status', '--porcelain', '--untracked-files=all'],
    ['rev-parse', 'HEAD'],
  ])
})

test('Linux rollback launcher rejects a diagnostic mount reached through symbolic links', {
  skip: process.platform !== 'linux',
}, (t) => {
  const { assertDiagnosticDirectory } = require('./run-rollback-drill-launcher.cjs')
  assert.equal(typeof assertDiagnosticDirectory, 'function', 'diagnostic directory boundary check is missing')

  const fixtureRoot = temporaryDirectory(t, 'lmd-rollback-diagnostic-mount-')
  const outsideRoot = path.join(fixtureRoot, 'outside')
  fs.mkdirSync(outsideRoot)
  fs.mkdirSync(path.join(outsideRoot, 'rollback-drill'))

  const ancestorLinkRepo = path.join(fixtureRoot, 'ancestor-link-repo')
  fs.mkdirSync(ancestorLinkRepo)
  fs.symlinkSync(outsideRoot, path.join(ancestorLinkRepo, 'artifacts'), 'dir')
  assert.throws(
    () => assertDiagnosticDirectory(
      ancestorLinkRepo,
      path.join(ancestorLinkRepo, 'artifacts', 'rollback-drill'),
    ),
    /diagnostic|symbolic|link|outside/i,
  )

  const finalLinkRepo = path.join(fixtureRoot, 'final-link-repo')
  fs.mkdirSync(path.join(finalLinkRepo, 'artifacts'), { recursive: true })
  fs.symlinkSync(path.join(outsideRoot, 'rollback-drill'), path.join(finalLinkRepo, 'artifacts', 'rollback-drill'), 'dir')
  assert.throws(
    () => assertDiagnosticDirectory(
      finalLinkRepo,
      path.join(finalLinkRepo, 'artifacts', 'rollback-drill'),
    ),
    /diagnostic|symbolic|link|outside/i,
  )

  const ordinaryRepo = path.join(fixtureRoot, 'ordinary-repo')
  const ordinaryDirectory = path.join(ordinaryRepo, 'artifacts', 'rollback-drill')
  fs.mkdirSync(ordinaryDirectory, { recursive: true })
  assert.doesNotThrow(() => assertDiagnosticDirectory(ordinaryRepo, ordinaryDirectory))
})

test('Linux rollback launcher creates diagnostic directories without following an ancestor link', {
  skip: process.platform !== 'linux',
}, (t) => {
  const { ensureDiagnosticDirectory } = require('./run-rollback-drill-launcher.cjs')
  assert.equal(typeof ensureDiagnosticDirectory, 'function', 'safe diagnostic directory creation is missing')

  const fixtureRoot = temporaryDirectory(t, 'lmd-rollback-diagnostic-create-')
  const outsideRoot = path.join(fixtureRoot, 'outside')
  const repoRoot = path.join(fixtureRoot, 'repo')
  fs.mkdirSync(outsideRoot)
  fs.mkdirSync(repoRoot)
  fs.symlinkSync(outsideRoot, path.join(repoRoot, 'artifacts'), 'dir')

  assert.throws(
    () => ensureDiagnosticDirectory(repoRoot),
    /diagnostic|symbolic|link|outside/i,
  )
  assert.equal(
    fs.existsSync(path.join(outsideRoot, 'rollback-drill')),
    false,
    'diagnostic creation followed an ancestor link before validating it',
  )
})

test('Linux rollback launcher rejects a listening host service before Docker starts', {
  skip: process.platform !== 'linux',
}, async (t) => {
  const fixtureRoot = temporaryDirectory(t, 'lmd-rollback-host-service-')
  const fakeBin = path.join(fixtureRoot, 'bin')
  const capturePath = path.join(fixtureRoot, 'docker-started')
  const dataRoot = path.join(fixtureRoot, 'data')
  const archivePath = path.join(fixtureRoot, 'checkpoint.zip')
  fs.mkdirSync(fakeBin)
  seedCheckpointDataRoot(dataRoot)
  fs.writeFileSync(archivePath, 'checkpoint')
  installFakeGit(fakeBin)

  const fakeDockerPath = path.join(fakeBin, 'docker')
  fs.writeFileSync(fakeDockerPath, [
    '#!/usr/bin/env node',
    "'use strict'",
    "require('node:fs').writeFileSync(process.env.LMD_FAKE_DOCKER_CAPTURE, 'started')",
    '',
  ].join('\n'))
  fs.chmodSync(fakeDockerPath, 0o755)

  const server = net.createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  t.after(() => new Promise((resolve) => server.close(resolve)))
  const port = server.address().port

  const result = spawnSync(process.execPath, [
    path.join(__dirname, 'run-rollback-drill-launcher.cjs'),
    '--archive',
    archivePath,
    '--data-root',
    dataRoot,
  ], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ''}`,
      LMD_FAKE_DOCKER_CAPTURE: capturePath,
      LMD_FAKE_GIT_COMMIT: COMMIT,
    },
  })

  assert.notEqual(result.status, 0, 'launcher accepted a listening host service')
  assert.match(result.stderr, /service|backend|running|listening/i)
  assert.equal(fs.existsSync(capturePath), false, 'Docker started before the host service check passed')
})

test('POSIX path cleanup requires an actual private container boundary', () => {
  const launcherPath = path.join(__dirname, 'run-rollback-drill-launcher.cjs')
  let assertPrivateCleanupBoundary
  try {
    ({ assertPrivateCleanupBoundary } = require(launcherPath))
  } catch (error) {
    assert.fail(`Linux rollback launcher is missing: ${error.message}`)
  }
  assert.throws(
    () => assertPrivateCleanupBoundary({ platform: 'linux', environment: {}, dockerEnvironmentPresent: false }),
    /private|container|isolated/i,
  )
  assert.throws(
    () => assertPrivateCleanupBoundary({
      platform: 'linux',
      environment: { LMD_ROLLBACK_PRIVATE_CLEANUP: 'container-v1' },
      dockerEnvironmentPresent: false,
    }),
    /private|container|isolated/i,
  )
  assert.doesNotThrow(() => assertPrivateCleanupBoundary({
    platform: 'linux',
    environment: { LMD_ROLLBACK_PRIVATE_CLEANUP: 'container-v1' },
    dockerEnvironmentPresent: true,
  }))
  assert.doesNotThrow(() => assertPrivateCleanupBoundary({ platform: 'win32' }))
})

test('Linux rollback host source proof rejects dirty or changed revisions', () => {
  const { assertHostSourceRevision } = require('./run-rollback-drill-launcher.cjs')
  assert.equal(typeof assertHostSourceRevision, 'function', 'host source revision proof is missing')
  const commit = 'd'.repeat(40)
  assert.equal(assertHostSourceRevision(null, (args) => {
    if (args[0] === 'status') return ''
    if (args[0] === 'rev-parse') return commit
    throw new Error(`unexpected Git arguments: ${args.join(' ')}`)
  }), commit)
  assert.equal(assertHostSourceRevision(commit, (args) => {
    if (args[0] === 'status') return ''
    if (args[0] === 'rev-parse') return commit
    throw new Error(`unexpected Git arguments: ${args.join(' ')}`)
  }), commit)
  assert.throws(
    () => assertHostSourceRevision(null, (args) => args[0] === 'status' ? ' M changed.js' : commit),
    /clean|dirty|working tree/i,
  )
  assert.throws(
    () => assertHostSourceRevision(commit, (args) => args[0] === 'status' ? '' : 'e'.repeat(40)),
    /commit|revision|changed/i,
  )
})

test('path identity captures BigInt physical metadata and compares every bound field', async (t) => {
  const fixtureRoot = temporaryDirectory(t, 'lmd-rollback-identity-')
  const filePath = path.join(fixtureRoot, 'archive.zip')
  fs.writeFileSync(filePath, 'archive')
  const identity = await capturePathIdentity(filePath, 'file')
  assert.equal(identity.type, 'file')
  assert.equal(typeof identity.dev, 'bigint')
  assert.equal(typeof identity.ino, 'bigint')
  assert.equal(typeof identity.size, 'bigint')
  assert.equal(typeof identity.ctimeNs, 'bigint')
  assert.equal(path.isAbsolute(identity.realPath), true)
  assert.doesNotThrow(() => assertSamePathIdentity(identity, { ...identity }, 'archive'))

  const changes = {
    dev: identity.dev + 1n,
    ino: identity.ino + 1n,
    type: 'directory',
    size: identity.size + 1n,
    ctimeNs: identity.ctimeNs + 1n,
    realPath: path.join(fixtureRoot, 'other.zip'),
  }
  for (const [field, value] of Object.entries(changes)) {
    assert.throws(
      () => assertSamePathIdentity(identity, { ...identity, [field]: value }, 'archive'),
      /archive/
    )
  }
})

test('Windows handle-bound cleanup removes matching file and non-empty directory claims', async (t) => {
  if (process.platform !== 'win32') {
    t.skip('Windows handle-bound cleanup requires Windows')
    return
  }
  assert.equal(typeof removeOwnedClaimWindows, 'function', 'Windows handle-bound cleanup is missing')
  const fixtureRoot = temporaryDirectory(t, 'lmd-owned-cleanup-match-')

  for (const [type, create] of [
    ['file', async (target) => fsp.writeFile(target, 'owned file')],
    ['directory', async (target) => {
      await fsp.mkdir(path.join(target, 'nested'), { recursive: true })
      await fsp.writeFile(path.join(target, 'nested', 'owned.txt'), 'owned tree')
    }],
  ]) {
    await t.test(type, async () => {
      const claimPath = path.join(fixtureRoot, `owned-${type}`)
      await create(claimPath)
      const handle = await fsp.open(claimPath, 'r')
      try {
        const expected = await capturePathIdentity({ handle, path: claimPath }, type)
        await removeOwnedClaimWindows({ claimPath, expected, label: `owned ${type}` })
        await assert.rejects(fsp.lstat(claimPath), (error) => error?.code === 'ENOENT')
        assert.equal((await handle.stat({ bigint: true })).nlink, 0n)
      } finally {
        await handle.close()
      }
    })
  }
})

test('Windows handle-bound cleanup preserves replacements installed after caller verification', async (t) => {
  if (process.platform !== 'win32') {
    t.skip('Windows handle-bound cleanup requires Windows')
    return
  }
  assert.equal(typeof removeOwnedClaimWindows, 'function', 'Windows handle-bound cleanup is missing')
  const fixtureRoot = temporaryDirectory(t, 'lmd-owned-cleanup-replacement-')
  const cases = [
    ['file-to-file', 'file', async (target) => fsp.writeFile(target, 'replacement file')],
    ['file-to-directory', 'file', async (target) => {
      await fsp.mkdir(target)
      await fsp.writeFile(path.join(target, 'canary.txt'), 'replacement directory')
    }],
    ['directory-to-file', 'directory', async (target) => fsp.writeFile(target, 'replacement file')],
    ['directory-to-directory', 'directory', async (target) => {
      await fsp.mkdir(target)
      await fsp.writeFile(path.join(target, 'canary.txt'), 'replacement directory')
    }],
  ]

  for (const [name, originalType, installReplacement] of cases) {
    await t.test(name, async () => {
      const claimPath = path.join(fixtureRoot, name)
      if (originalType === 'file') await fsp.writeFile(claimPath, 'owned original')
      else await fsp.mkdir(claimPath)
      const handle = await fsp.open(claimPath, 'r')
      try {
        const expected = await capturePathIdentity({ handle, path: claimPath }, originalType)
        const displacedPath = `${claimPath}.displaced`
        await fsp.rename(claimPath, displacedPath)
        await fsp.rm(displacedPath, { recursive: true, force: true })
        await installReplacement(claimPath)

        await assert.rejects(
          removeOwnedClaimWindows({ claimPath, expected, label: `replacement probe ${name}` }),
          (error) => {
            assert.match(error.message, /identity|type|filesystem object/i)
            assert.ok(error.message.includes(JSON.stringify(claimPath)), 'preserved private claim path was not reported')
            return true
          },
        )
        const replacement = await fsp.lstat(claimPath)
        if (name.endsWith('file')) {
          assert.equal(replacement.isFile(), true)
          assert.equal(await fsp.readFile(claimPath, 'utf8'), 'replacement file')
        } else {
          assert.equal(replacement.isDirectory(), true)
          assert.equal(await fsp.readFile(path.join(claimPath, 'canary.txt'), 'utf8'), 'replacement directory')
        }
      } finally {
        await handle.close()
      }
    })
  }

  const linkPath = path.join(fixtureRoot, 'file-to-dangling-link')
  const missingTarget = path.join(fixtureRoot, 'missing-target')
  await fsp.writeFile(linkPath, 'owned original')
  const linkHandle = await fsp.open(linkPath, 'r')
  try {
    const expected = await capturePathIdentity({ handle: linkHandle, path: linkPath }, 'file')
    const displacedPath = `${linkPath}.displaced`
    await fsp.rename(linkPath, displacedPath)
    await fsp.rm(displacedPath, { force: true })
    if (!createFileLink(t, missingTarget, linkPath)) return
    await assert.rejects(
      removeOwnedClaimWindows({ claimPath: linkPath, expected, label: 'dangling-link replacement probe' }),
      (error) => {
        assert.match(error.message, /identity|type|filesystem object/i)
        assert.ok(error.message.includes(JSON.stringify(linkPath)), 'preserved private claim path was not reported')
        return true
      },
    )
    assert.equal((await fsp.lstat(linkPath)).isSymbolicLink(), true)
    assert.equal(await fsp.readlink(linkPath), missingTarget)
  } finally {
    await linkHandle.close()
  }
})

test('checkpoint input validation rejects wrong types, nesting, and reparse components', async (t) => {
  const fixtureRoot = temporaryDirectory(t, 'lmd-rollback-inputs-')
  const dataRoot = path.join(fixtureRoot, 'data')
  const archivePath = path.join(fixtureRoot, 'data.zip')
  writeDataRoot(dataRoot)
  fs.writeFileSync(archivePath, 'archive')
  await assert.doesNotReject(assertCheckpointInputPaths({
    inputMode: 'checkpoint-bound',
    archivePath,
    dataRoot,
  }))

  const nestedArchive = path.join(dataRoot, 'nested.zip')
  fs.writeFileSync(nestedArchive, 'archive')
  await assert.rejects(assertCheckpointInputPaths({
    inputMode: 'checkpoint-bound',
    archivePath: nestedArchive,
    dataRoot,
  }))
  await assert.rejects(assertCheckpointInputPaths({
    inputMode: 'checkpoint-bound',
    archivePath: dataRoot,
    dataRoot,
  }))
  await assert.rejects(assertCheckpointInputPaths({
    inputMode: 'checkpoint-bound',
    archivePath,
    dataRoot: archivePath,
  }))

  const outsideRoot = path.join(fixtureRoot, 'outside')
  writeDataRoot(outsideRoot)
  const linkedRoot = path.join(fixtureRoot, 'linked-data')
  if (createDirectoryLink(t, outsideRoot, linkedRoot)) {
    await assert.rejects(assertCheckpointInputPaths({
      inputMode: 'checkpoint-bound',
      archivePath,
      dataRoot: linkedRoot,
    }), /symbolic|reparse|real path/i)
    await assert.rejects(capturePathIdentity(path.join(linkedRoot, 'storage'), 'directory'), /symbolic|reparse|real path/i)
  }

  const archiveTarget = path.join(fixtureRoot, 'archive-target.zip')
  const linkedArchive = path.join(fixtureRoot, 'linked-archive.zip')
  fs.writeFileSync(archiveTarget, 'archive')
  if (createFileLink(t, archiveTarget, linkedArchive)) {
    await assert.rejects(assertCheckpointInputPaths({
      inputMode: 'checkpoint-bound',
      archivePath: linkedArchive,
      dataRoot,
    }), /symbolic|reparse|real path/i)
  }

  const archiveParent = path.join(fixtureRoot, 'archive-parent')
  const linkedArchiveParent = path.join(fixtureRoot, 'linked-archive-parent')
  fs.mkdirSync(archiveParent)
  fs.writeFileSync(path.join(archiveParent, 'parented.zip'), 'archive')
  if (createDirectoryLink(t, archiveParent, linkedArchiveParent)) {
    await assert.rejects(assertCheckpointInputPaths({
      inputMode: 'checkpoint-bound',
      archivePath: path.join(linkedArchiveParent, 'parented.zip'),
      dataRoot,
    }), /symbolic|reparse|real path/i)
  }
})

test('Windows checkpoint containment treats another volume as outside', () => {
  const dataRoot = 'C:\\data'
  assert.equal(isPathOutsideRoot(dataRoot, 'D:\\checkpoint\\data.zip', path.win32), true)
  assert.equal(isPathOutsideRoot(dataRoot, 'C:\\checkpoint\\data.zip', path.win32), true)
  assert.equal(isPathOutsideRoot(dataRoot, 'C:\\data', path.win32), false)
  assert.equal(isPathOutsideRoot(dataRoot, 'C:\\data\\nested.zip', path.win32), false)
})

test('data root fingerprint is deterministic, framed, and UTF-8 byte sorted', async (t) => {
  const fixtureRoot = temporaryDirectory(t, 'lmd-rollback-fingerprint-')
  const first = path.join(fixtureRoot, 'first')
  const second = path.join(fixtureRoot, 'second')
  const entries = [
    ['z.txt', 'z'],
    ['a/bc.txt', 'nested'],
    ['\u00e9.txt', 'accent'],
    ['\u4e2d.txt', 'cjk'],
  ]
  for (const [relativePath, contents] of entries) {
    fs.mkdirSync(path.dirname(path.join(first, relativePath)), { recursive: true })
    fs.writeFileSync(path.join(first, relativePath), contents)
  }
  for (const [relativePath, contents] of [...entries].reverse()) {
    fs.mkdirSync(path.dirname(path.join(second, relativePath)), { recursive: true })
    fs.writeFileSync(path.join(second, relativePath), contents)
  }
  const visited = []
  const firstDigest = await fingerprintDataRoot(first, {
    onEntry: ({ relativePath }) => visited.push(relativePath),
  })
  const secondDigest = await fingerprintDataRoot(second)
  assert.match(firstDigest, HEX_64)
  assert.equal(firstDigest, secondDigest)
  assert.deepEqual(visited, [...visited].sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right))))

  const framedA = path.join(fixtureRoot, 'framed-a')
  const framedB = path.join(fixtureRoot, 'framed-b')
  fs.mkdirSync(path.join(framedA, 'a'), { recursive: true })
  fs.mkdirSync(path.join(framedB, 'ab'), { recursive: true })
  fs.writeFileSync(path.join(framedA, 'a', 'bc'), 'same')
  fs.writeFileSync(path.join(framedB, 'ab', 'c'), 'same')
  assert.notEqual(await fingerprintDataRoot(framedA), await fingerprintDataRoot(framedB))
})

test('external maintenance heartbeat is bound separately from the source data fingerprint', async (t) => {
  const dataRoot = temporaryDirectory(t, 'lmd-fingerprint-maintenance-lease-')
  const databasePath = path.join(dataRoot, 'drama_generator.db')
  const storagePath = path.join(dataRoot, 'storage')
  const storySourcesPath = path.join(dataRoot, 'story_sources')
  fs.writeFileSync(databasePath, 'database')
  fs.mkdirSync(storagePath)
  fs.mkdirSync(storySourcesPath)

  const guard = acquireServiceMaintenanceLockSync({
    databasePath,
    storagePath,
    storySourcesPath,
    heartbeatIntervalMs: 100,
  })
  try {
    createExternalMaintenanceLease(guard)
    const fingerprintOptions = {
      volatileControlPaths: [`${databasePath}.maintenance.lock`],
    }
    const before = await fingerprintDataRoot(dataRoot, {}, DEFAULT_LIMITS, fingerprintOptions)
    await new Promise((resolve) => setTimeout(resolve, 250))
    const after = await fingerprintDataRoot(dataRoot, {}, DEFAULT_LIMITS, fingerprintOptions)
    assert.equal(after, before)
  } finally {
    guard.release()
  }
})

test('data root fingerprint preserves a read failure when the retained handle also fails to close', async (t) => {
  const dataRoot = temporaryDirectory(t, 'lmd-fingerprint-primary-close-')
  const filePath = path.join(dataRoot, 'source.txt')
  fs.writeFileSync(filePath, 'source')
  const readFailure = new Error('injected fingerprint read failure')
  const closeFailure = new Error('injected fingerprint close failure')
  const originalOpen = fsp.open
  t.after(() => { fsp.open = originalOpen })
  fsp.open = async (target, ...args) => {
    const handle = await originalOpen(target, ...args)
    if (path.resolve(String(target)) !== path.resolve(filePath)) return handle
    return {
      stat: (...statArgs) => handle.stat(...statArgs),
      read: async () => { throw readFailure },
      close: async () => {
        await handle.close()
        throw closeFailure
      },
    }
  }

  let thrown
  await assert.rejects(
    fingerprintDataRoot(dataRoot),
    (error) => {
      thrown = error
      return true
    },
  )
  assert.equal(thrown, readFailure)
  const descriptor = Object.getOwnPropertyDescriptor(thrown, 'cleanupErrors')
  assert.equal(descriptor?.enumerable, false)
  assert.deepEqual(descriptor?.value, [closeFailure])
})

test('data root fingerprint rechecks earlier files after a later large file read', async (t) => {
  const fixtureRoot = temporaryDirectory(t, 'lmd-rollback-fingerprint-persistent-')
  const dataRoot = path.join(fixtureRoot, 'tree')
  const earlierPath = path.join(dataRoot, 'a-earlier.txt')
  const laterPath = path.join(dataRoot, 'z-later-large.bin')
  fs.mkdirSync(dataRoot)
  fs.writeFileSync(earlierPath, 'original-earlier-bytes')
  fs.writeFileSync(laterPath, Buffer.alloc(2 * 1024 * 1024, 0x7a))

  const originalOpen = fsp.open
  let mutationRan = false
  fsp.open = async (...args) => {
    const handle = await originalOpen(...args)
    if (path.resolve(args[0]) !== path.resolve(laterPath)) return handle
    const originalRead = handle.read.bind(handle)
    handle.read = async (...readArgs) => {
      const result = await originalRead(...readArgs)
      if (!mutationRan && result.bytesRead > 0) {
        mutationRan = true
        await fsp.writeFile(earlierPath, 'mutated-earlier-bytes!')
      }
      return result
    }
    return handle
  }

  try {
    await assert.rejects(
      fingerprintDataRoot(dataRoot),
      /a-earlier\.txt.*(?:identity|changed)|data root entry.*changed/i,
    )
  } finally {
    fsp.open = originalOpen
  }
  assert.equal(mutationRan, true)
})

test('data root fingerprint changes for content, length, path, type, and empty directories', async (t) => {
  const fixtureRoot = temporaryDirectory(t, 'lmd-rollback-fingerprint-change-')
  const root = path.join(fixtureRoot, 'tree')
  fs.mkdirSync(root)
  fs.writeFileSync(path.join(root, 'entry'), 'one')
  const baseline = await fingerprintDataRoot(root)

  fs.writeFileSync(path.join(root, 'entry'), 'two')
  assert.notEqual(await fingerprintDataRoot(root), baseline)
  fs.writeFileSync(path.join(root, 'entry'), 'one-more')
  assert.notEqual(await fingerprintDataRoot(root), baseline)
  fs.writeFileSync(path.join(root, 'entry'), 'one')
  fs.renameSync(path.join(root, 'entry'), path.join(root, 'renamed'))
  assert.notEqual(await fingerprintDataRoot(root), baseline)
  fs.renameSync(path.join(root, 'renamed'), path.join(root, 'entry'))
  fs.rmSync(path.join(root, 'entry'))
  fs.mkdirSync(path.join(root, 'entry'))
  assert.notEqual(await fingerprintDataRoot(root), baseline)
  fs.rmSync(path.join(root, 'entry'), { recursive: true })
  fs.writeFileSync(path.join(root, 'entry'), 'one')
  fs.mkdirSync(path.join(root, 'empty'))
  assert.notEqual(await fingerprintDataRoot(root), baseline)
})

test('data root fingerprint fails on identical-byte entry replacement and directory name-set drift', async (t) => {
  const fixtureRoot = temporaryDirectory(t, 'lmd-rollback-fingerprint-race-')
  const entryRoot = path.join(fixtureRoot, 'entry-tree')
  fs.mkdirSync(entryRoot)
  fs.writeFileSync(path.join(entryRoot, 'entry.txt'), 'same bytes')
  let replaced = false
  await assert.rejects(fingerprintDataRoot(entryRoot, {
    afterEntryRead: async ({ absolutePath, relativePath, type }) => {
      if (replaced || relativePath !== 'entry.txt' || type !== 'file') return
      replaced = true
      const displaced = path.join(entryRoot, 'displaced.txt')
      await fsp.rename(absolutePath, displaced)
      await fsp.writeFile(absolutePath, await fsp.readFile(displaced))
    },
  }), /changed|identity/i)

  const namesRoot = path.join(fixtureRoot, 'names-tree')
  fs.mkdirSync(namesRoot)
  fs.writeFileSync(path.join(namesRoot, 'stable.txt'), 'stable')
  let added = false
  await assert.rejects(fingerprintDataRoot(namesRoot, {
    beforeDirectoryPostCheck: async ({ absolutePath, relativePath }) => {
      if (added || relativePath !== '') return
      added = true
      await fsp.writeFile(path.join(absolutePath, 'added.txt'), 'added')
    },
  }), /entries|changed|name/i)
})

test('data root fingerprint fails on same-path root replacement', async (t) => {
  const fixtureRoot = temporaryDirectory(t, 'lmd-rollback-fingerprint-root-')
  const dataRoot = path.join(fixtureRoot, 'tree')
  writeDataRoot(dataRoot)
  let replaced = false
  await assert.rejects(fingerprintDataRoot(dataRoot, {
    beforeRootPostCheck: async () => {
      if (replaced) return
      replaced = true
      const displaced = path.join(fixtureRoot, 'displaced-tree')
      await fsp.rename(dataRoot, displaced)
      writeDataRoot(dataRoot)
    },
  }), /changed|identity/i)
})

test('data root fingerprint rejects final, parent, and descendant links or junctions', async (t) => {
  const fixtureRoot = temporaryDirectory(t, 'lmd-rollback-fingerprint-link-')
  const realRoot = path.join(fixtureRoot, 'real')
  writeDataRoot(realRoot)

  const finalLink = path.join(fixtureRoot, 'final-link')
  if (!createDirectoryLink(t, realRoot, finalLink)) return
  await assert.rejects(fingerprintDataRoot(finalLink), /symbolic|reparse|real path/i)

  const parentLink = path.join(fixtureRoot, 'parent-link')
  if (!createDirectoryLink(t, fixtureRoot, parentLink)) return
  await assert.rejects(fingerprintDataRoot(path.join(parentLink, 'real')), /symbolic|reparse|real path/i)

  const descendantTarget = path.join(fixtureRoot, 'descendant-target')
  fs.mkdirSync(descendantTarget)
  const descendantLink = path.join(realRoot, 'storage', 'linked')
  if (!createDirectoryLink(t, descendantTarget, descendantLink)) return
  await assert.rejects(fingerprintDataRoot(realRoot), /symbolic|reparse|unsupported/i)
})

test('fingerprint and archive limits accept every exact tiny boundary before publication', async (t) => {
  const fixture = createExecutorFixture(t)
  fixture.runtime.limits = tinyLimits()

  const result = await executeRollbackDrill(fixture.options, fixture.runtime)

  assert.equal(result.evidence.backup.archive_bytes, fixture.runtime.limits.maxArchiveBytes)
  assert.equal(fixture.calls.publish.length, 1)
})

test('fingerprint and archive limits reject every tiny boundary plus one before publication', async (t) => {
  const cases = [
    {
      name: 'regular files',
      limits: tinyLimits({ maxTotalBytes: 100, maxFileBytes: 100, maxPathBytes: 100, maxManifestBytes: 8, maxPathDepth: 3 }),
      mutate: (fixture) => fs.writeFileSync(path.join(fixture.dataRoot, 'extra.txt'), 'x'),
    },
    {
      name: 'aggregate bytes',
      limits: tinyLimits({ maxTotalBytes: 18 }),
    },
    {
      name: 'single file bytes',
      limits: tinyLimits({ maxFileBytes: 7, maxManifestBytes: 7 }),
    },
    {
      name: 'UTF-8 path bytes',
      limits: tinyLimits({ maxPathBytes: Buffer.byteLength('story_sources/source.txt') - 1 }),
    },
    {
      name: 'relative depth',
      limits: tinyLimits({ maxFiles: 5, maxPathDepth: 1 }),
    },
    {
      name: 'discovered entries',
      limits: tinyLimits(),
      mutate: (fixture) => fs.mkdirSync(path.join(fixture.dataRoot, 'empty')),
    },
    {
      name: 'archive bytes',
      limits: tinyLimits({ maxArchiveBytes: 21 }),
    },
  ]

  for (const boundary of cases) {
    await t.test(boundary.name, async (t) => {
      const fixture = createExecutorFixture(t)
      fixture.runtime.limits = boundary.limits
      boundary.mutate?.(fixture)

      await assert.rejects(
        executeRollbackDrill(fixture.options, fixture.runtime),
        /archive|bytes|depth|entries|file|large|limit|path/i
      )
      assert.equal(fixture.calls.publish.length, 0)
    })
  }
})

test('executor passes one immutable limits object through real fingerprint, hashing, backup, restore, and publication', async (t) => {
  const fixture = createExecutorFixture(t, 'standalone')
  const injectedLimits = tinyLimits({ maxArchiveBytes: 64 })
  const externalMaintenanceLease = Object.freeze(validExternalMaintenanceLease())
  const seenLimits = []
  const hashObservations = []
  const hashCounts = new Map()
  let cleanupCompleted = false
  let fingerprintCalls = 0
  const fingerprint = fixture.runtime.fingerprintDataRoot
  const createBackup = fixture.runtime.createDataBackup
  const restoreBackup = fixture.runtime.restoreDataBackup
  const publish = fixture.runtime.publishEvidence
  fixture.runtime.limits = injectedLimits
  fixture.runtime.externalMaintenanceLease = externalMaintenanceLease
  fixture.runtime.fingerprintDataRoot = (root, hooks, limits, options) => {
    fingerprintCalls += 1
    if (fingerprintCalls === 2) assert.equal(cleanupCompleted, true)
    assert.deepEqual(options, {
      volatileControlPaths: [`${fixture.runtime.sourcePaths.databasePath}.maintenance.lock`],
    })
    seenLimits.push(limits)
    return fingerprint(root, hooks, limits)
  }
  fixture.runtime.createDataBackup = (options) => {
    assert.equal(options.externalMaintenanceLease, externalMaintenanceLease)
    seenLimits.push(options.limits)
    return createBackup(options)
  }
  fixture.runtime.restoreDataBackup = (options) => {
    seenLimits.push(options.limits)
    return restoreBackup(options)
  }
  fixture.runtime.sha256FileHandle = (handle, options) => {
    const count = (hashCounts.get(options.label) || 0) + 1
    hashCounts.set(options.label, count)
    if (
      (options.label === 'source database' && count === 3) ||
      (options.label === 'rollback archive' && count === 2)
    ) {
      assert.equal(cleanupCompleted, true)
    }
    seenLimits.push(options.limits)
    hashObservations.push({ handle, label: options.label, limitKey: options.limitKey })
    return sha256FileHandle(handle, options)
  }
  fixture.runtime.cleanupWorkspace = async (workspace) => {
    await fsp.rm(workspace, { recursive: true, force: true })
    assert.equal(fs.existsSync(workspace), false)
    cleanupCompleted = true
  }
  fixture.runtime.publishEvidence = (repoRoot, version, evidence, limits) => {
    assert.equal(cleanupCompleted, true)
    seenLimits.push(limits)
    return publish(repoRoot, version, evidence, limits)
  }

  await executeRollbackDrill(fixture.options, fixture.runtime)

  assert.equal(seenLimits.length, 10)
  assert.equal(new Set(seenLimits).size, 1)
  assert.equal(typeof seenLimits[0], 'object')
  assert.deepEqual(seenLimits[0], injectedLimits)
  assert.equal(Object.isFrozen(seenLimits[0]), true)
  assert.notEqual(seenLimits[0], injectedLimits)
  assert.deepEqual(
    hashObservations.map(({ label, limitKey }) => [label, limitKey]),
    [
      ['source database', 'maxFileBytes'],
      ['rollback archive', 'maxArchiveBytes'],
      ['source database', 'maxFileBytes'],
      ['source database', 'maxFileBytes'],
      ['rollback archive', 'maxArchiveBytes'],
    ]
  )
  assert.equal(hashObservations[0].handle, hashObservations[2].handle)
  assert.equal(hashObservations[0].handle, hashObservations[3].handle)
  assert.equal(hashObservations[1].handle, hashObservations[4].handle)
})

test('oversized retained archive is rejected from descriptor stat before its first read', async () => {
  let reads = 0
  const limits = Object.freeze(tinyLimits({ maxArchiveBytes: 10 }))
  const handle = {
    stat: async () => ({ size: 11n, isFile: () => true }),
    read: async () => {
      reads += 1
      throw new Error('oversized archive must not be read')
    },
  }

  await assert.rejects(
    sha256FileHandle(handle, {
      expectedBytes: 11n,
      maxBytes: limits.maxArchiveBytes,
      limits,
      limitKey: 'maxArchiveBytes',
      label: 'rollback archive',
    }),
    /archive.*(large|limit|bytes)|maxBytes/i
  )
  assert.equal(reads, 0)
})

test('fingerprint hashing rejects a retained file that grows while streaming', async () => {
  let reads = 0
  const limits = Object.freeze(tinyLimits({ maxArchiveBytes: 4 }))
  const chunks = [Buffer.from('abc'), Buffer.from('d'), Buffer.alloc(0)]
  const handle = {
    stat: async () => ({ size: 3n, isFile: () => true, dev: 1n, ino: 2n, ctimeNs: 3n }),
    read: async (buffer) => {
      const chunk = chunks[reads++]
      chunk.copy(buffer)
      return { bytesRead: chunk.length, buffer }
    },
  }

  await assert.rejects(
    sha256FileHandle(handle, {
      expectedBytes: 3n,
      maxBytes: limits.maxArchiveBytes,
      limits,
      limitKey: 'maxArchiveBytes',
      label: 'rollback archive',
    }),
    /grew|length|expected/i
  )
})

test('retained hashing requires the matching immutable limits object before reading', async () => {
  let reads = 0
  const handle = {
    stat: async () => ({ size: 3n, isFile: () => true }),
    read: async () => {
      reads += 1
      return { bytesRead: 0 }
    },
  }
  const mutableLimits = tinyLimits({ maxArchiveBytes: 3 })
  await assert.rejects(sha256FileHandle(handle, {
    expectedBytes: 3n,
    maxBytes: 3,
    limits: mutableLimits,
    limitKey: 'maxArchiveBytes',
    label: 'rollback archive',
  }), /limits.*immutable|frozen/i)

  const mismatchedLimits = Object.freeze(tinyLimits({ maxArchiveBytes: 4 }))
  await assert.rejects(sha256FileHandle(handle, {
    expectedBytes: 3n,
    maxBytes: 3,
    limits: mismatchedLimits,
    limitKey: 'maxArchiveBytes',
    label: 'rollback archive',
  }), /maxBytes|limit.*match/i)
  assert.equal(reads, 0)
})

test('v3 validation and publication reject malformed mode, hashes, booleans, retention, version, or status', async (t) => {
  const fixtureRoot = temporaryDirectory(t, 'lmd-rollback-v3-validation-')
  const invalidCases = [
    ['schema', 'localminidrama.rollback-drill.v2'],
    ['status', 'failed'],
    ['status', 'PASSED'],
    ['status', true],
    ['status', null],
    ['status', 1],
    ['input_mode', 'bound'],
    ['source.version', '9.9.9'],
    ['source.version', null],
    ['source.working_tree_dirty', 'false'],
    ['source.working_tree_dirty', true],
    ['source.data_root_sha256', 'B'.repeat(64)],
    ['source.data_root_sha256', 'b'.repeat(63)],
    ['backup.archive_sha256', 'C'.repeat(64)],
    ['backup.archive_sha256', null],
    ['backup.archive_retained', 'false'],
    ['backup.archive_retained', true],
    ['backup.excluded_values', null],
    ['backup.excluded_values', 1.5],
    ['operations.source_data_root_unchanged', 'true'],
    ['operations.source_data_root_unchanged', false],
  ]

  const standaloneEvidence = validEvidence()
  const boundEvidence = validEvidence('checkpoint-bound')
  assert.equal(validateEvidenceV3(standaloneEvidence, VERSION), standaloneEvidence)
  assert.equal(validateEvidenceV3(boundEvidence, VERSION), boundEvidence)
  for (const [field, value] of invalidCases) {
    const evidence = validEvidence()
    setNested(evidence, field, value)
    assert.throws(() => validateEvidenceV3(evidence, VERSION), field)
    await assert.rejects(publishEvidence(fixtureRoot, VERSION, evidence), field)
  }

  for (const field of [
    'status',
    'input_mode',
    'source.version',
    'source.data_root_sha256',
    'backup.archive_sha256',
    'backup.archive_retained',
    'operations.source_data_root_unchanged',
  ]) {
    const evidence = validEvidence()
    setNested(evidence, field, undefined, true)
    assert.throws(() => validateEvidenceV3(evidence, VERSION), field)
    await assert.rejects(publishEvidence(fixtureRoot, VERSION, evidence), field)
  }

  const boundWithInteger = validEvidence('checkpoint-bound')
  boundWithInteger.backup.excluded_values = 0
  assert.throws(() => validateEvidenceV3(boundWithInteger, VERSION), /backup\.excluded_values/)
  await assert.rejects(publishEvidence(fixtureRoot, VERSION, boundWithInteger), /backup\.excluded_values/)

  const boundWithoutRetention = validEvidence('checkpoint-bound')
  boundWithoutRetention.backup.archive_retained = false
  assert.throws(() => validateEvidenceV3(boundWithoutRetention, VERSION), /backup\.archive_retained/)
  await assert.rejects(publishEvidence(fixtureRoot, VERSION, boundWithoutRetention), /backup\.archive_retained/)
})

test('v3 accepts only backup formats supported by the restore service', async (t) => {
  const fixtureRoot = temporaryDirectory(t, 'lmd-rollback-v3-formats-')

  for (const formatVersion of [1, 2]) {
    await t.test(`accepts backup format ${formatVersion}`, async () => {
      const repoRoot = path.join(fixtureRoot, `supported-${formatVersion}`)
      await fsp.mkdir(repoRoot)
      const evidence = validEvidence()
      evidence.backup.format_version = formatVersion
      assert.equal(validateEvidenceV3(evidence, VERSION), evidence)
      const publication = await publishEvidence(repoRoot, VERSION, evidence)
      assert.deepEqual(publication.evidenceBytes, serializeEvidence(evidence))
      assert.equal(fs.existsSync(publishedDiagnosticPath(repoRoot, publication)), true)
      assert.equal(fs.existsSync(evidenceOutputPath(repoRoot)), false)
    })
  }

  for (const formatVersion of [3, 999]) {
    await t.test(`rejects unsupported backup format ${formatVersion} without publishing`, async () => {
      const repoRoot = path.join(fixtureRoot, `unsupported-${formatVersion}`)
      await fsp.mkdir(repoRoot)
      const evidence = validEvidence()
      evidence.backup.format_version = formatVersion
      await assert.rejects(publishEvidence(repoRoot, VERSION, evidence), /backup\.format_version/)
      assert.equal(fs.existsSync(evidenceOutputPath(repoRoot)), false)
      assert.throws(() => validateEvidenceV3(evidence, VERSION), /backup\.format_version/)
    })
  }
})

test('v3 requires a safe archive size at or above the ZIP minimum', async (t) => {
  const fixtureRoot = temporaryDirectory(t, 'lmd-rollback-v3-archive-size-')
  const minimumRoot = path.join(fixtureRoot, 'minimum')
  await fsp.mkdir(minimumRoot)
  const minimumEvidence = validEvidence()
  minimumEvidence.backup.archive_bytes = 22
  assert.equal(validateEvidenceV3(minimumEvidence, VERSION), minimumEvidence)
  const minimumPublication = await publishEvidence(minimumRoot, VERSION, minimumEvidence)
  assert.deepEqual(minimumPublication.evidenceBytes, serializeEvidence(minimumEvidence))
  assert.equal(fs.existsSync(publishedDiagnosticPath(minimumRoot, minimumPublication)), true)
  assert.equal(fs.existsSync(evidenceOutputPath(minimumRoot)), false)

  for (const archiveBytes of [0, 1, 21, -1, Number.MAX_SAFE_INTEGER + 1]) {
    await t.test(`rejects archive_bytes=${archiveBytes} without publishing`, async () => {
      const repoRoot = path.join(fixtureRoot, `invalid-${archiveBytes}`)
      await fsp.mkdir(repoRoot)
      const evidence = validEvidence()
      evidence.backup.archive_bytes = archiveBytes
      await assert.rejects(publishEvidence(repoRoot, VERSION, evidence), /backup\.archive_bytes/)
      assert.equal(fs.existsSync(evidenceOutputPath(repoRoot)), false)
      assert.throws(() => validateEvidenceV3(evidence, VERSION), /backup\.archive_bytes/)
    })
  }
})

test('v3 archive size limit rejects 36 GiB plus one in validation and before publication', async (t) => {
  const fixtureRoot = temporaryDirectory(t, 'lmd-rollback-v3-archive-limit-')
  const evidence = validEvidence()
  evidence.backup.archive_bytes = DEFAULT_LIMITS.maxArchiveBytes + 1

  assert.throws(() => validateEvidenceV3(evidence, VERSION), /backup\.archive_bytes/)
  await assert.rejects(publishEvidence(fixtureRoot, VERSION, evidence), /backup\.archive_bytes/)
  assert.equal(fs.existsSync(evidenceOutputPath(fixtureRoot)), false)
})

test('v3 file-count limits accept exact tiny boundaries and reject plus one before publication', async (t) => {
  const fixtureRoot = temporaryDirectory(t, 'lmd-rollback-v3-file-limit-')
  const limits = tinyLimits()
  const exactRoot = path.join(fixtureRoot, 'exact')
  await fsp.mkdir(exactRoot)
  const exact = validEvidence()
  exact.backup.format_version = 2
  exact.backup.archive_bytes = limits.maxArchiveBytes
  exact.backup.file_count = limits.maxFiles + 1
  exact.backup.storage_files = limits.maxFiles
  exact.backup.story_source_files = 0
  assert.equal(validateEvidenceV3(exact, VERSION, limits), exact)
  const exactPublication = await publishEvidence(exactRoot, VERSION, exact, limits)
  assert.deepEqual(exactPublication.evidenceBytes, serializeEvidence(exact))
  assert.equal(fs.existsSync(publishedDiagnosticPath(exactRoot, exactPublication)), true)
  assert.equal(fs.existsSync(evidenceOutputPath(exactRoot)), false)

  const cases = [
    { name: 'storage', storage: limits.maxFiles + 1, story: 0 },
    { name: 'story sources', storage: 0, story: limits.maxFiles + 1 },
    { name: 'combined directories', storage: limits.maxFiles, story: 1 },
  ]
  for (const value of cases) {
    await t.test(value.name, async () => {
      const repoRoot = path.join(fixtureRoot, value.name.replaceAll(' ', '-'))
      await fsp.mkdir(repoRoot)
      const evidence = validEvidence()
      evidence.backup.format_version = 2
      evidence.backup.archive_bytes = limits.maxArchiveBytes
      evidence.backup.storage_files = value.storage
      evidence.backup.story_source_files = value.story
      evidence.backup.file_count = 1 + value.storage + value.story
      assert.throws(() => validateEvidenceV3(evidence, VERSION, limits), /backup.*file|file.*limit/i)
      await assert.rejects(publishEvidence(repoRoot, VERSION, evidence, limits), /backup.*file|file.*limit/i)
      assert.equal(fs.existsSync(evidenceOutputPath(repoRoot)), false)
    })
  }
})

test('v3 limits accept maximum valid format-2 file-count and archive arithmetic', () => {
  const evidence = validEvidence()
  evidence.backup.format_version = 2
  evidence.backup.archive_bytes = DEFAULT_LIMITS.maxArchiveBytes
  evidence.backup.file_count = DEFAULT_LIMITS.maxFiles + 1
  evidence.backup.storage_files = DEFAULT_LIMITS.maxFiles
  evidence.backup.story_source_files = 0

  assert.equal(validateEvidenceV3(evidence, VERSION), evidence)
})

test('complete v3 PASS validation rejects missing fields, invalid types, and false proof flags', async (t) => {
  const fixtureRoot = temporaryDirectory(t, 'lmd-rollback-v3-complete-')
  const requiredFields = [
    'executed_at',
    'source',
    'source.commit',
    'source.database',
    'source.database.relative_path',
    'focused_tests',
    'focused_tests.file',
    'focused_tests.passed',
    'focused_tests.total',
    'backup',
    'backup.format_version',
    'backup.archive_bytes',
    'backup.file_count',
    'backup.storage_files',
    'backup.story_source_files',
    'backup.active_story_source_references',
    'backup.secret_policy',
    'backup.excluded_values',
    'restore',
    'restore.isolated',
    'restore.integrity_check',
    'restore.credential_rows_checked',
    'restore.credentials_excluded',
    'restore.restored_counts',
    'restore.rollback_copies',
    'restore.rollback_copies.database',
    'restore.rollback_copies.storage',
    'restore.rollback_copies.story_sources',
    'operations',
    'operations.source_database_unchanged',
    'operations.credential_reconfiguration_required',
    'operations.workspace_cleanup_verified',
  ]
  for (const field of requiredFields) {
    const evidence = validEvidence()
    setNested(evidence, field, undefined, true)
    assert.throws(() => validateEvidenceV3(evidence, VERSION), `${field} must be required`)
    await assert.rejects(publishEvidence(fixtureRoot, VERSION, evidence), `${field} must block publication`)
  }

  const invalidValues = [
    ['executed_at', '2026-07-20'],
    ['executed_at', 1],
    ['source.commit', 'A'.repeat(40)],
    ['source.commit', 'a'.repeat(39)],
    ['source.database.relative_path', ''],
    ['source.database.relative_path', 1],
    ['focused_tests.file', 'other.test.js'],
    ['focused_tests.passed', '2'],
    ['focused_tests.passed', 1],
    ['focused_tests.total', 0],
    ['focused_tests.total', Number.MAX_SAFE_INTEGER + 1],
    ['backup.format_version', 0],
    ['backup.format_version', '1'],
    ['backup.archive_bytes', -1],
    ['backup.file_count', 4],
    ['backup.storage_files', -1],
    ['backup.story_source_files', 1.5],
    ['backup.active_story_source_references', Number.MAX_SAFE_INTEGER + 1],
    ['backup.secret_policy', 'included'],
    ['restore.isolated', 'true'],
    ['restore.integrity_check', 'OK'],
    ['restore.credential_rows_checked', -1],
    ['restore.credentials_excluded', 'true'],
    ['restore.restored_counts', []],
    ['restore.restored_counts.dramas', -1],
    ['restore.rollback_copies.database', 'true'],
    ['operations.source_database_unchanged', 'true'],
    ['operations.credential_reconfiguration_required', 'true'],
    ['operations.workspace_cleanup_verified', 'true'],
  ]
  for (const [field, value] of invalidValues) {
    const evidence = validEvidence()
    setNested(evidence, field, value)
    assert.throws(() => validateEvidenceV3(evidence, VERSION), `${field}=${String(value)} must be rejected`)
    await assert.rejects(publishEvidence(fixtureRoot, VERSION, evidence), `${field} must block publication`)
  }

  for (const field of [
    'restore.isolated',
    'restore.credentials_excluded',
    'restore.rollback_copies.database',
    'restore.rollback_copies.storage',
    'restore.rollback_copies.story_sources',
    'operations.source_database_unchanged',
    'operations.source_data_root_unchanged',
    'operations.credential_reconfiguration_required',
    'operations.workspace_cleanup_verified',
  ]) {
    const evidence = validEvidence()
    setNested(evidence, field, false)
    assert.throws(() => validateEvidenceV3(evidence, VERSION), `${field}=false must be rejected`)
    await assert.rejects(publishEvidence(fixtureRoot, VERSION, evidence), `${field}=false must block publication`)
  }
})

test('prior v1, v2, and different-version v3 evidence remains untouched during preparation', async (t) => {
  const fixtureRoot = temporaryDirectory(t, 'lmd-rollback-prior-')
  const outputPath = evidenceOutputPath(fixtureRoot)
  const records = [
    {
      generation: 'legacy-v1',
      evidence: {
        schema: 'localminidrama.rollback-drill.v1',
        status: 'passed',
        source_version: VERSION,
        backup: { archive_sha256: '1'.repeat(64) },
      },
    },
    {
      generation: 'v2',
      evidence: {
        schema: 'localminidrama.rollback-drill.v2',
        status: 'passed',
        source: { version: VERSION },
      },
    },
    {
      generation: 'v3',
      evidence: validEvidence('standalone', '1.2.9'),
    },
  ]
  for (const record of records) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true })
    const recordBytes = Buffer.from(`${JSON.stringify(record.evidence)}\n`)
    fs.writeFileSync(outputPath, recordBytes)
    await prepareEvidenceTarget(fixtureRoot, VERSION)
    assert.deepEqual(fs.readFileSync(outputPath), recordBytes, record.generation)
    assert.deepEqual(diagnosticRecords(fixtureRoot), [])
  }
})

test('bound execution restores the exact retained archive without creating a backup', async (t) => {
  const fixture = createExecutorFixture(t)
  const result = await executeRollbackDrill(fixture.options, fixture.runtime)
  const { evidence } = result
  assert.equal(fixture.calls.prepare, 1)
  assert.equal(fixture.calls.create.length, 0)
  assert.equal(fixture.calls.restore.length, 1)
  assert.equal(fixture.calls.restore[0].archivePath, fixture.archivePath)
  assert.equal(fs.readFileSync(fixture.archivePath, 'utf8'), 'retained archive bytes')
  assert.equal(evidence.input_mode, 'checkpoint-bound')
  assert.equal(evidence.backup.archive_retained, true)
  assert.equal(evidence.backup.excluded_values, null)
  assert.equal(evidence.backup.archive_sha256, crypto.createHash('sha256').update('retained archive bytes').digest('hex'))
  assert.equal(evidence.operations.source_data_root_unchanged, true)
  assert.deepEqual(result.evidenceBytes, serializeEvidence(evidence))
  assert.equal(fixture.calls.publish.length, 1)
})

test('bound execution stages copied bytes before cleanup and publishes diagnostics only after closure', async (t) => {
  const fixture = createExecutorFixture(t)
  const publish = fixture.runtime.publishEvidence
  const events = []
  let archiveHandle
  let stagedBytes
  fixture.runtime.hooks = {
    onArchiveHandleOpened: ({ handle }) => { archiveHandle = handle },
    onEvidenceStaged: async (staged) => {
      events.push('evidence-staged')
      assert.deepEqual(Object.keys(staged).sort(), ['evidenceBytes', 'inputMode'])
      assert.equal(staged.inputMode, 'checkpoint-bound')
      stagedBytes = staged.evidenceBytes
      stagedBytes.fill(0x78)
      assert.equal(fs.existsSync(evidenceOutputPath(fixture.fixtureRoot)), false)
      assert.equal((await archiveHandle.stat({ bigint: true })).isFile(), true)
    },
  }
  fixture.runtime.closeRetainedHandle = async (handle, label) => {
    assert.equal(label, 'rollback archive')
    assert.equal(handle, archiveHandle)
    assert.deepEqual(events, ['evidence-staged'])
    assert.equal(diagnosticRecords(fixture.fixtureRoot).length, 0)
    assert.equal((await archiveHandle.stat({ bigint: true })).isFile(), true)
    events.push('archive-closed')
    await handle.close()
  }
  fixture.runtime.publishEvidence = async (repoRoot, version, evidence, limits) => {
    assert.deepEqual(events, ['evidence-staged', 'archive-closed'])
    await assert.rejects(archiveHandle.stat({ bigint: true }), /closed|EBADF/i)
    const publication = await publish(repoRoot, version, evidence, limits)
    events.push('diagnostic-published')
    assert.equal(fs.existsSync(publishedDiagnosticPath(repoRoot, publication)), true)
    return publication
  }

  const result = await executeRollbackDrill(fixture.options, fixture.runtime)

  assert.ok(archiveHandle)
  assert.deepEqual(events, ['evidence-staged', 'archive-closed', 'diagnostic-published'])
  assert.notDeepEqual(stagedBytes, result.evidenceBytes)
  assert.deepEqual(result.evidenceBytes, serializeEvidence(result.evidence))
  await assert.rejects(archiveHandle.stat({ bigint: true }), /closed|EBADF/i)
})

test('bound archive handle prevents swap-use-swap-back restore substitution', async (t) => {
  const fixture = createExecutorFixture(t)
  const originalRestore = fixture.runtime.restoreDataBackup
  let retainedHandle
  let pathBytesDuringRestore
  let handleBytesDuringRestore
  fixture.runtime.hooks = {
    onArchiveHandleOpened: ({ handle }) => { retainedHandle = handle },
  }
  fixture.runtime.restoreDataBackup = async (options) => {
    assert.equal(options.archiveHandle, retainedHandle, 'restore must receive the retained archive handle')
    const displaced = `${fixture.archivePath}.during-restore`
    await fsp.rename(fixture.archivePath, displaced)
    await fsp.writeFile(fixture.archivePath, 'temporary archive B')
    try {
      pathBytesDuringRestore = await fsp.readFile(fixture.archivePath, 'utf8')
      const buffer = Buffer.alloc(Buffer.byteLength('retained archive bytes'))
      const { bytesRead } = await options.archiveHandle.read(buffer, 0, buffer.length, 0)
      handleBytesDuringRestore = buffer.subarray(0, bytesRead).toString('utf8')
    } finally {
      await fsp.rm(fixture.archivePath, { force: true })
      await fsp.rename(displaced, fixture.archivePath)
    }
    return originalRestore(options)
  }

  await assert.rejects(
    executeRollbackDrill(fixture.options, fixture.runtime),
    /rollback archive .*identity changed|rollback archive.*changed/i
  )
  assert.equal(pathBytesDuringRestore, 'temporary archive B')
  assert.equal(handleBytesDuringRestore, 'retained archive bytes')
  assert.equal(fixture.calls.publish.length, 0)
})

test('bound execution closes its archive descriptor when publication rejects', async (t) => {
  const fixture = createExecutorFixture(t)
  let archiveHandle
  fixture.runtime.hooks = {
    onArchiveHandleOpened: ({ handle }) => { archiveHandle = handle },
  }
  fixture.runtime.publishEvidence = async () => {
    throw new Error('publication rejected')
  }
  await assert.rejects(executeRollbackDrill(fixture.options, fixture.runtime), /publication rejected/)
  assert.ok(archiveHandle)
  await assert.rejects(archiveHandle.stat({ bigint: true }), /closed|EBADF/i)
})

test('checkpoint close failure after in-memory staging blocks diagnostics and remains exact', async (t) => {
  const fixture = createExecutorFixture(t)
  const closeFailure = new Error('retained archive close failed')
  let archiveHandle
  let staged = false
  fixture.runtime.hooks = {
    onArchiveHandleOpened: ({ handle }) => { archiveHandle = handle },
    onEvidenceStaged: () => {
      staged = true
      assert.equal(fs.existsSync(evidenceOutputPath(fixture.fixtureRoot)), false)
    },
  }
  fixture.runtime.closeRetainedHandle = async (handle, label) => {
    assert.equal(staged, true)
    assert.equal(handle, archiveHandle)
    assert.equal(label, 'rollback archive')
    assert.deepEqual(diagnosticRecords(fixture.fixtureRoot), [])
    await handle.close()
    throw closeFailure
  }

  let thrown
  try {
    await executeRollbackDrill(fixture.options, fixture.runtime)
  } catch (error) {
    thrown = error
  }

  assert.equal(thrown, closeFailure)
  assert.equal(staged, true)
  assert.equal(fs.existsSync(evidenceOutputPath(fixture.fixtureRoot)), false)
  assert.deepEqual(diagnosticRecords(fixture.fixtureRoot), [])
  await assert.rejects(archiveHandle.stat({ bigint: true }), /closed|EBADF/i)
})

test('in-memory staging error remains exact when retained cleanup also fails', async (t) => {
  const fixture = createExecutorFixture(t)
  const publicationFailure = new Error('staged publication rejected')
  const cleanupFailure = new Error('cleanup after publication rejection failed')
  let archiveHandle
  fixture.runtime.hooks = {
    onArchiveHandleOpened: ({ handle }) => { archiveHandle = handle },
    onEvidenceStaged: () => { throw publicationFailure },
  }
  fixture.runtime.closeRetainedHandle = async (handle) => {
    assert.equal(handle, archiveHandle)
    await handle.close()
    throw cleanupFailure
  }

  let thrown
  try {
    await executeRollbackDrill(fixture.options, fixture.runtime)
  } catch (error) {
    thrown = error
  }

  assert.equal(thrown, publicationFailure)
  assert.deepEqual(thrown.cleanupErrors, [cleanupFailure])
  assert.equal(fs.existsSync(evidenceOutputPath(fixture.fixtureRoot)), false)
  assert.deepEqual(diagnosticRecords(fixture.fixtureRoot), [])
  await assert.rejects(archiveHandle.stat({ bigint: true }), /closed|EBADF/i)
})

test('operation error remains exact when workspace and retained cleanup also fail', async (t) => {
  const fixture = createExecutorFixture(t)
  const operationFailure = new Error('restore verification failed')
  const workspaceCleanupFailure = new Error('workspace cleanup failed')
  const retainedCleanupFailure = new Error('retained cleanup failed')
  let archiveHandle
  fixture.runtime.hooks = {
    onArchiveHandleOpened: ({ handle }) => { archiveHandle = handle },
    afterRestore: () => { throw operationFailure },
  }
  fixture.runtime.cleanupWorkspace = async (workspace) => {
    await fsp.rm(workspace, { recursive: true, force: true })
    throw workspaceCleanupFailure
  }
  fixture.runtime.closeRetainedHandle = async (handle) => {
    assert.equal(handle, archiveHandle)
    await handle.close()
    throw retainedCleanupFailure
  }

  let thrown
  try {
    await executeRollbackDrill(fixture.options, fixture.runtime)
  } catch (error) {
    thrown = error
  }

  assert.equal(thrown, operationFailure)
  assert.deepEqual(thrown.cleanupErrors, [workspaceCleanupFailure, retainedCleanupFailure])
  assert.equal(fs.existsSync(evidenceOutputPath(fixture.fixtureRoot)), false)
  await assert.rejects(archiveHandle.stat({ bigint: true }), /closed|EBADF/i)
})

test('bound execution rejects identical archive replacement without publishing PASS', async (t) => {
  const fixture = createExecutorFixture(t)
  fixture.runtime.hooks = {
    afterRestore: async () => {
      const contents = await fsp.readFile(fixture.archivePath)
      const displaced = `${fixture.archivePath}.displaced`
      await fsp.rename(fixture.archivePath, displaced)
      await fsp.writeFile(fixture.archivePath, contents)
    },
  }
  await assert.rejects(executeRollbackDrill(fixture.options, fixture.runtime), /archive.*changed|identity/i)
  assert.equal(fixture.calls.publish.length, 0)
})

test('bound execution rejects source mutation and same-path root replacement without publishing PASS', async (t) => {
  const mutation = createExecutorFixture(t)
  mutation.runtime.hooks = {
    afterRestore: async () => fsp.writeFile(path.join(mutation.dataRoot, 'storage', 'asset.txt'), 'mutated'),
  }
  await assert.rejects(executeRollbackDrill(mutation.options, mutation.runtime), /fingerprint|changed|unchanged/i)
  assert.equal(mutation.calls.publish.length, 0)

  const replacement = createExecutorFixture(t)
  replacement.runtime.hooks = {
    afterRestore: async () => {
      const displaced = path.join(replacement.fixtureRoot, 'displaced-source-data')
      await fsp.rename(replacement.dataRoot, displaced)
      writeDataRoot(replacement.dataRoot)
    },
  }
  await assert.rejects(executeRollbackDrill(replacement.options, replacement.runtime), /data root.*changed|identity/i)
  assert.equal(replacement.calls.publish.length, 0)
})

test('bound execution rejects identical-byte entry replacement during post-drill fingerprint', async (t) => {
  const fixture = createExecutorFixture(t)
  let replaced = false
  fixture.runtime.fingerprintHooks = {
    after: {
      afterEntryRead: async ({ absolutePath, relativePath, type }) => {
        if (replaced || relativePath !== 'storage/asset.txt' || type !== 'file') return
        replaced = true
        const displaced = path.join(fixture.dataRoot, 'storage', 'displaced.txt')
        await fsp.rename(absolutePath, displaced)
        await fsp.writeFile(absolutePath, await fsp.readFile(displaced))
      },
    },
  }
  await assert.rejects(executeRollbackDrill(fixture.options, fixture.runtime), /changed|identity/i)
  assert.equal(fixture.calls.publish.length, 0)
})

test('standalone execution creates and removes only its workspace archive and retains integer exclusions', async (t) => {
  const fixture = createExecutorFixture(t, 'standalone')
  const result = await executeRollbackDrill(fixture.options, fixture.runtime)
  const { evidence } = result
  assert.equal(fixture.calls.create.length, 1)
  assert.equal(fixture.calls.restore.length, 1)
  assert.equal(fixture.calls.create[0].outputPath, fixture.calls.restore[0].archivePath)
  assert.equal(fs.existsSync(fixture.calls.create[0].outputPath), false)
  assert.equal(fs.existsSync(fixture.archivePath), true)
  assert.equal(evidence.input_mode, 'standalone')
  assert.equal(evidence.backup.archive_retained, false)
  assert.equal(Number.isInteger(evidence.backup.excluded_values), true)
  assert.equal(evidence.backup.excluded_values, 7)
  assert.deepEqual(result.evidenceBytes, serializeEvidence(evidence))
})

test('standalone pre-backup failure proves archive absence without adding a cleanup failure', async (t) => {
  const fixture = createExecutorFixture(t, 'standalone')
  const primary = new Error('injected pre-backup service failure')
  let workspace
  fixture.runtime.createWorkspace = async () => {
    workspace = await fsp.mkdtemp(path.join(fixture.fixtureRoot, 'pre-backup-workspace-'))
    return workspace
  }
  fixture.runtime.createDataBackup = async (options) => {
    fixture.calls.create.push(options)
    assert.equal(fs.existsSync(options.outputPath), false)
    throw primary
  }

  let thrown
  try {
    await executeRollbackDrill(fixture.options, fixture.runtime)
  } catch (error) {
    thrown = error
  }

  assert.strictEqual(thrown, primary)
  assert.equal(Object.hasOwn(thrown, 'cleanupErrors'), false)
  assert.ok(workspace)
  assert.equal(fs.existsSync(workspace), false)
  assert.equal(fs.existsSync(`${workspace}-current-data.zip`), false)
  assert.equal(fixture.calls.publish.length, 0)
})

test('workspace cleanup rejects a moved original workspace without authoritative PASS', async (t) => {
  const fixture = createExecutorFixture(t)
  fixture.runtime.createWorkspace = () => fsp.mkdtemp(path.join(fixture.fixtureRoot, 'owned-workspace-'))
  let movedWorkspace
  fixture.runtime.cleanupWorkspace = async (workspace) => {
    movedWorkspace = `${workspace}.moved`
    await fsp.rename(workspace, movedWorkspace)
    await fsp.mkdir(workspace)
  }

  await assert.rejects(
    executeRollbackDrill(fixture.options, fixture.runtime),
    /workspace.*(?:identity|link|removed|changed)|cleanup.*workspace/i,
  )
  assert.ok(movedWorkspace)
  assert.equal(fs.existsSync(movedWorkspace), true)
  assert.equal(fs.existsSync(movedWorkspace.replace(/\.moved$/, '')), true)
  assert.equal(fixture.calls.publish.length, 0)
})

test('marker cleanup preserves a private-claim replacement installed after verification', async (t) => {
  if (process.platform !== 'win32') {
    t.skip('Windows handle-bound cleanup requires Windows')
    return
  }
  const fixture = createExecutorFixture(t)
  let replacementClaimPath
  let replacementCalls = 0
  fixture.runtime.createWorkspace = () => fsp.mkdtemp(path.join(fixture.fixtureRoot, 'owned-workspace-'))
  fixture.runtime.removeOwnedClaim = removeOwnedClaimWindows
  fixture.runtime.hooks = {
    beforeOwnedClaimRemoval: async ({ claimPath, label }) => {
      if (label !== 'rollback workspace marker') return
      replacementCalls += 1
      replacementClaimPath = claimPath
      const displacedPath = `${claimPath}.owned-displaced`
      await fsp.rename(claimPath, displacedPath)
      await fsp.rm(displacedPath, { force: true })
      await fsp.writeFile(claimPath, 'unrelated marker replacement')
    },
  }

  await assert.rejects(executeRollbackDrill(fixture.options, fixture.runtime), /marker.*(?:identity|cleanup)|handle-bound/i)
  assert.equal(replacementCalls, 1)
  assert.equal(await fsp.readFile(replacementClaimPath, 'utf8'), 'unrelated marker replacement')
  assert.equal(fixture.calls.publish.length, 0)
})

test('workspace cleanup preserves a cross-type private-claim replacement installed after verification', async (t) => {
  if (process.platform !== 'win32') {
    t.skip('Windows handle-bound cleanup requires Windows')
    return
  }
  const fixture = createExecutorFixture(t)
  let replacementClaimPath
  let replacementCalls = 0
  fixture.runtime.createWorkspace = () => fsp.mkdtemp(path.join(fixture.fixtureRoot, 'owned-workspace-'))
  fixture.runtime.removeOwnedClaim = removeOwnedClaimWindows
  fixture.runtime.hooks = {
    beforeOwnedClaimRemoval: async ({ claimPath, label }) => {
      if (label !== 'rollback workspace') return
      replacementCalls += 1
      replacementClaimPath = claimPath
      const displacedPath = `${claimPath}.owned-displaced`
      await fsp.rename(claimPath, displacedPath)
      await fsp.rm(displacedPath, { recursive: true, force: true })
      await fsp.writeFile(claimPath, 'unrelated file at directory claim')
    },
  }

  await assert.rejects(executeRollbackDrill(fixture.options, fixture.runtime), /workspace.*(?:identity|type|cleanup)|handle-bound/i)
  assert.equal(replacementCalls, 1)
  assert.equal(await fsp.readFile(replacementClaimPath, 'utf8'), 'unrelated file at directory claim')
  assert.equal(fixture.calls.publish.length, 0)
})

test('standalone archive cleanup preserves a cross-type private-claim replacement installed after verification', async (t) => {
  if (process.platform !== 'win32') {
    t.skip('Windows handle-bound cleanup requires Windows')
    return
  }
  const fixture = createExecutorFixture(t, 'standalone')
  let replacementClaimPath
  let replacementCalls = 0
  fixture.runtime.removeOwnedClaim = removeOwnedClaimWindows
  fixture.runtime.hooks = {
    beforeOwnedClaimRemoval: async ({ claimPath, label }) => {
      if (label !== 'standalone rollback archive') return
      replacementCalls += 1
      replacementClaimPath = claimPath
      const displacedPath = `${claimPath}.owned-displaced`
      await fsp.rename(claimPath, displacedPath)
      await fsp.rm(displacedPath, { force: true })
      await fsp.mkdir(claimPath)
      await fsp.writeFile(path.join(claimPath, 'canary.txt'), 'unrelated directory at file claim')
    },
  }

  await assert.rejects(executeRollbackDrill(fixture.options, fixture.runtime), /archive.*(?:identity|type|cleanup)|handle-bound/i)
  assert.equal(replacementCalls, 1)
  assert.equal(await fsp.readFile(path.join(replacementClaimPath, 'canary.txt'), 'utf8'), 'unrelated directory at file claim')
  assert.equal(fixture.calls.publish.length, 0)
})

test('marker cleanup preserves a replacement installed after its last identity check', async (t) => {
  const fixture = createExecutorFixture(t)
  let race
  let markerPath
  fixture.runtime.createWorkspace = () => fsp.mkdtemp(path.join(fixture.fixtureRoot, 'owned-workspace-'))
  fixture.runtime.hooks = {
    afterRestore: async ({ workspace }) => {
      markerPath = (await fsp.readdir(workspace))
        .map((name) => path.join(workspace, name))
        .find((candidate) => candidate.endsWith('.marker'))
      assert.ok(markerPath)
      race = installPublicPathReplacementRace(
        markerPath,
        (target) => fsp.writeFile(target, 'unrelated replacement marker'),
      )
    },
  }

  try {
    await assert.rejects(executeRollbackDrill(fixture.options, fixture.runtime), /workspace marker|cleanup/i)
  } finally {
    race?.restore()
  }

  assert.equal(race.fired, true)
  assert.equal(await fsp.readFile(markerPath, 'utf8'), 'unrelated replacement marker')
  assert.equal(fs.existsSync(race.displacedPath), true)
  assert.equal(fixture.calls.publish.length, 0)
})

test('workspace cleanup preserves a replacement tree installed after its last identity check', async (t) => {
  const fixture = createExecutorFixture(t)
  let race
  let workspace
  fixture.runtime.createWorkspace = async () => {
    workspace = await fsp.mkdtemp(path.join(fixture.fixtureRoot, 'owned-workspace-'))
    return workspace
  }
  fixture.runtime.hooks = {
    afterRestore: () => {
      race = installPublicPathReplacementRace(workspace, async (target) => {
        await fsp.mkdir(target)
        await fsp.writeFile(path.join(target, 'unrelated.txt'), 'unrelated replacement tree')
      })
    },
  }

  try {
    await assert.rejects(executeRollbackDrill(fixture.options, fixture.runtime), /workspace|cleanup/i)
  } finally {
    race?.restore()
  }

  assert.equal(race.fired, true)
  assert.equal(await fsp.readFile(path.join(workspace, 'unrelated.txt'), 'utf8'), 'unrelated replacement tree')
  assert.equal(fs.existsSync(race.displacedPath), true)
  assert.equal(fixture.calls.publish.length, 0)
})

test('workspace cleanup rejects a dangling public link after owned removal', async (t) => {
  const fixture = createExecutorFixture(t)
  const missingTarget = path.join(fixture.fixtureRoot, 'missing-workspace-target')
  const probePath = path.join(fixture.fixtureRoot, 'workspace-link-probe')
  if (!createDirectoryLink(t, missingTarget, probePath)) {
    t.skip('Directory reparse-point fixtures are unavailable')
    return
  }
  fs.rmSync(probePath, { force: true })

  let workspace
  fixture.runtime.createWorkspace = async () => {
    workspace = await fsp.mkdtemp(path.join(fixture.fixtureRoot, 'owned-workspace-'))
    return workspace
  }
  fixture.runtime.cleanupWorkspace = async (claimPath) => {
    await fsp.rm(claimPath, { recursive: true, force: true })
    assert.equal(createDirectoryLink(t, missingTarget, workspace), true)
  }

  await assert.rejects(executeRollbackDrill(fixture.options, fixture.runtime), /workspace|cleanup|path/i)
  assert.equal((await fsp.lstat(workspace)).isSymbolicLink(), true)
  assert.equal(fixture.calls.publish.length, 0)
})

test('workspace cleanup rejects a replaced marker and preserves the displaced original', async (t) => {
  const fixture = createExecutorFixture(t)
  let workspace
  let markerPath
  let movedMarker
  fixture.runtime.createWorkspace = async () => {
    workspace = await fsp.mkdtemp(path.join(fixture.fixtureRoot, 'owned-workspace-'))
    return workspace
  }
  const restore = fixture.runtime.restoreDataBackup
  fixture.runtime.restoreDataBackup = async (options) => {
    markerPath = (await fsp.readdir(workspace))
      .map((name) => path.join(workspace, name))
      .find((candidate) => candidate.endsWith('.marker'))
    assert.ok(markerPath, 'workspace marker was not created')
    movedMarker = `${markerPath}.moved`
    await fsp.rename(markerPath, movedMarker)
    await fsp.writeFile(markerPath, 'replacement marker')
    return restore(options)
  }

  await assert.rejects(
    executeRollbackDrill(fixture.options, fixture.runtime),
    /workspace marker.*(?:identity|match|changed)|cleanup.*marker/i,
  )
  assert.equal(fs.readFileSync(markerPath, 'utf8'), 'replacement marker')
  assert.equal(fs.existsSync(movedMarker), true)
  assert.equal(fixture.calls.publish.length, 0)
})

test('standalone archive cleanup rejects a moved original while its retained handle is open', async (t) => {
  const fixture = createExecutorFixture(t, 'standalone')
  fixture.runtime.createWorkspace = () => fsp.mkdtemp(path.join(fixture.fixtureRoot, 'owned-workspace-'))
  let movedArchive
  let retainedArchiveHandle
  fixture.runtime.hooks = {
    onArchiveHandleOpened: ({ handle }) => { retainedArchiveHandle = handle },
  }
  fixture.runtime.removeStandaloneArchive = async (archivePath) => {
    assert.ok(retainedArchiveHandle)
    assert.equal((await retainedArchiveHandle.stat({ bigint: true })).isFile(), true)
    movedArchive = `${archivePath}.moved`
    await fsp.rename(archivePath, movedArchive)
    await fsp.writeFile(archivePath, 'replacement archive')
  }

  await assert.rejects(
    executeRollbackDrill(fixture.options, fixture.runtime),
    /archive.*(?:identity|link|removed|changed)|cleanup.*archive/i,
  )
  assert.ok(movedArchive)
  assert.equal(fs.existsSync(movedArchive), true)
  assert.equal(fs.readFileSync(movedArchive.replace(/\.moved$/, ''), 'utf8'), 'replacement archive')
  assert.equal(fixture.calls.publish.length, 0)
  await assert.rejects(retainedArchiveHandle.stat({ bigint: true }), /closed|EBADF/i)
})

test('standalone archive cleanup preserves a replacement installed after its last identity check', async (t) => {
  const fixture = createExecutorFixture(t, 'standalone')
  let race
  fixture.runtime.hooks = {
    onEvidenceStaged: () => {
      const archivePath = fixture.calls.create[0].outputPath
      race = installPublicPathReplacementRace(
        archivePath,
        (target) => fsp.writeFile(target, 'unrelated replacement archive'),
      )
    },
  }

  try {
    await assert.rejects(executeRollbackDrill(fixture.options, fixture.runtime), /archive|cleanup/i)
  } finally {
    race?.restore()
  }

  const archivePath = fixture.calls.create[0].outputPath
  assert.equal(race.fired, true)
  assert.equal(await fsp.readFile(archivePath, 'utf8'), 'unrelated replacement archive')
  assert.equal(fs.existsSync(race.displacedPath), true)
  assert.equal(fixture.calls.publish.length, 0)
})

test('zero original links cannot authorize deleting a standalone archive replacement', async (t) => {
  const fixture = createExecutorFixture(t, 'standalone')
  let race
  fixture.runtime.hooks = {
    onEvidenceStaged: () => {
      const archivePath = fixture.calls.create[0].outputPath
      race = installPublicPathReplacementRace(
        archivePath,
        (target) => fsp.writeFile(target, 'unrelated zero-link replacement'),
        { deleteOriginal: true },
      )
    },
  }

  try {
    await assert.rejects(executeRollbackDrill(fixture.options, fixture.runtime), /archive|cleanup/i)
  } finally {
    race?.restore()
  }

  const archivePath = fixture.calls.create[0].outputPath
  assert.equal(race.fired, true)
  assert.equal(await fsp.readFile(archivePath, 'utf8'), 'unrelated zero-link replacement')
  assert.equal(fs.existsSync(race.displacedPath), false)
  assert.equal(fixture.calls.publish.length, 0)
})

test('standalone archive cleanup rejects a dangling public link after owned removal', async (t) => {
  const fixture = createExecutorFixture(t, 'standalone')
  const missingTarget = path.join(fixture.fixtureRoot, 'missing-archive-target')
  const probePath = path.join(fixture.fixtureRoot, 'archive-link-probe')
  if (!createDirectoryLink(t, missingTarget, probePath)) {
    t.skip('Directory reparse-point fixtures are unavailable')
    return
  }
  fs.rmSync(probePath, { force: true })

  let archivePath
  fixture.runtime.hooks = {
    onArchiveHandleOpened: ({ path: openedPath }) => { archivePath = openedPath },
  }
  fixture.runtime.removeStandaloneArchive = async (claimPath) => {
    await fsp.rm(claimPath, { force: true })
    assert.equal(createDirectoryLink(t, missingTarget, archivePath), true)
  }

  await assert.rejects(executeRollbackDrill(fixture.options, fixture.runtime), /archive|cleanup|path/i)
  assert.equal(fixture.calls.publish.length, 0)
})

test('standalone exact boundary publishes diagnostics only after final fingerprint, closure, and archive deletion', async (t) => {
  const fixture = createExecutorFixture(t, 'standalone')
  assert.equal(fixture.options.inputMode, 'standalone')
  fixture.runtime.limits = tinyLimits({ maxArchiveBytes: Buffer.byteLength('standalone archive bytes') })
  const restore = fixture.runtime.restoreDataBackup
  const publish = fixture.runtime.publishEvidence
  const fingerprint = fixture.runtime.fingerprintDataRoot
  const events = []
  let archiveHandle
  let sourceDatabaseHandle
  fixture.runtime.hooks = {
    onArchiveHandleOpened: ({ handle, inputMode }) => {
      assert.equal(inputMode, 'standalone')
      archiveHandle = handle
    },
    afterFinalArchiveHash: () => {
      events.push('after-final-archive-hash')
    },
    onEvidenceStaged: async () => {
      events.push('evidence-staged')
      assert.equal(fs.existsSync(evidenceOutputPath(fixture.fixtureRoot)), false)
      assert.equal(fs.existsSync(fixture.calls.create[0].outputPath), true)
      assert.equal((await archiveHandle.stat({ bigint: true })).isFile(), true)
      assert.equal((await sourceDatabaseHandle.stat({ bigint: true })).isFile(), true)
    },
  }
  fixture.runtime.restoreDataBackup = (options) => {
    assert.ok(archiveHandle)
    assert.equal(options.archiveHandle, archiveHandle)
    return restore(options)
  }
  fixture.runtime.sha256FileHandle = async (handle, options) => {
    const digest = await sha256FileHandle(handle, options)
    if (options.label === 'source database') sourceDatabaseHandle = handle
    events.push(`hash:${options.label}`)
    return digest
  }
  fixture.runtime.fingerprintDataRoot = async (root, hooks, limits) => {
    const digest = await fingerprint(root, hooks, limits)
    events.push('fingerprint')
    return digest
  }
  fixture.runtime.cleanupWorkspace = async (workspace) => {
    await fsp.rm(workspace, { recursive: true, force: true })
    assert.equal(fs.existsSync(workspace), false)
    events.push('workspace-cleaned')
  }
  fixture.runtime.closeRetainedHandle = async (handle, label) => {
    assert.equal(fs.existsSync(evidenceOutputPath(fixture.fixtureRoot)), false)
    events.push(`close:${label}`)
    await handle.close()
  }
  fixture.runtime.removeStandaloneArchive = async (archivePath) => {
    assert.equal(fs.existsSync(evidenceOutputPath(fixture.fixtureRoot)), false)
    assert.equal((await archiveHandle.stat({ bigint: true })).isFile(), true)
    await assert.rejects(sourceDatabaseHandle.stat({ bigint: true }), /closed|EBADF/i)
    await fsp.rm(archivePath, { force: true })
    assert.equal((await archiveHandle.stat({ bigint: true })).nlink, 0n)
    events.push('archive-deleted')
  }
  fixture.runtime.publishEvidence = async (repoRoot, version, evidence, limits) => {
    const publication = await publish(repoRoot, version, evidence, limits)
    events.push('diagnostic-published')
    assert.equal(fs.existsSync(publishedDiagnosticPath(repoRoot, publication)), true)
    assert.equal(fs.existsSync(fixture.calls.create[0].outputPath), false)
    return publication
  }

  const result = await executeRollbackDrill(fixture.options, fixture.runtime)
  const { evidence } = result

  assert.equal(evidence.backup.archive_bytes, fixture.runtime.limits.maxArchiveBytes)
  assert.equal(fixture.calls.restore.length, 1)
  assert.equal(fixture.calls.publish.length, 1)
  assert.equal(fs.existsSync(fixture.calls.create[0].outputPath), false)
  assert.equal(diagnosticRecords(fixture.fixtureRoot).length, 1)
  assert.deepEqual(events, [
    'fingerprint',
    'hash:source database',
    'hash:rollback archive',
    'hash:source database',
    'workspace-cleaned',
    'hash:source database',
    'hash:rollback archive',
    'after-final-archive-hash',
    'fingerprint',
    'evidence-staged',
    'close:source database',
    'archive-deleted',
    'close:rollback archive',
    'diagnostic-published',
  ])
  await assert.rejects(archiveHandle.stat({ bigint: true }), /closed|EBADF/i)
  await assert.rejects(sourceDatabaseHandle.stat({ bigint: true }), /closed|EBADF/i)
})

test('standalone mutation after final archive hash is rejected by the last fingerprint without PASS', async (t) => {
  const fixture = createExecutorFixture(t, 'standalone')
  assert.equal(fixture.options.inputMode, 'standalone')
  let mutationRan = false
  fixture.runtime.hooks = {
    afterFinalArchiveHash: async () => {
      mutationRan = true
      await fsp.writeFile(path.join(fixture.dataRoot, 'story_sources', 'source.txt'), 'late mutation')
    },
  }

  await assert.rejects(
    executeRollbackDrill(fixture.options, fixture.runtime),
    /fingerprint|data root.*changed/i
  )
  assert.equal(mutationRan, true)
  assert.equal(fixture.calls.publish.length, 0)
  assert.equal(fs.existsSync(evidenceOutputPath(fixture.fixtureRoot)), false)
  assert.deepEqual(diagnosticRecords(fixture.fixtureRoot), [])
})

test('standalone close failure after staging throws the exact error before diagnostics', async (t) => {
  const fixture = createExecutorFixture(t, 'standalone')
  assert.equal(fixture.options.inputMode, 'standalone')
  const closeFailure = new Error('standalone retained archive close failed')
  let archiveHandle
  let generatedArchivePath
  let failedOnce = false
  let staged = false
  t.after(async () => {
    if (generatedArchivePath) await fsp.rm(generatedArchivePath, { force: true })
  })
  const createBackup = fixture.runtime.createDataBackup
  fixture.runtime.createDataBackup = async (options) => {
    generatedArchivePath = options.outputPath
    return createBackup(options)
  }
  fixture.runtime.hooks = {
    onArchiveHandleOpened: ({ handle }) => { archiveHandle = handle },
    onEvidenceStaged: () => {
      staged = true
      assert.equal(fs.existsSync(evidenceOutputPath(fixture.fixtureRoot)), false)
    },
  }
  fixture.runtime.closeRetainedHandle = async (handle, label) => {
    assert.equal(staged, true)
    assert.equal(fs.existsSync(evidenceOutputPath(fixture.fixtureRoot)), false)
    await handle.close()
    if (label === 'rollback archive' && !failedOnce) {
      failedOnce = true
      throw closeFailure
    }
  }

  let thrown
  try {
    await executeRollbackDrill(fixture.options, fixture.runtime)
  } catch (error) {
    thrown = error
  }

  assert.equal(thrown, closeFailure)
  assert.equal(failedOnce, true)
  assert.equal(fs.existsSync(evidenceOutputPath(fixture.fixtureRoot)), false)
  assert.deepEqual(diagnosticRecords(fixture.fixtureRoot), [])
  await assert.rejects(archiveHandle.stat({ bigint: true }), /closed|EBADF/i)
})

test('standalone archive deletion failure after staging blocks diagnostics', async (t) => {
  const fixture = createExecutorFixture(t, 'standalone')
  assert.equal(fixture.options.inputMode, 'standalone')
  const deletionFailure = new Error('standalone archive deletion failed')
  let archiveHandle
  let sourceDatabaseHandle
  let generatedArchivePath
  let staged = false
  t.after(async () => {
    if (generatedArchivePath) await fsp.rm(generatedArchivePath, { force: true })
  })
  fixture.runtime.hooks = {
    onArchiveHandleOpened: ({ handle }) => { archiveHandle = handle },
    onEvidenceStaged: () => {
      staged = true
      assert.equal(fs.existsSync(evidenceOutputPath(fixture.fixtureRoot)), false)
    },
  }
  fixture.runtime.sha256FileHandle = (handle, options) => {
    if (options.label === 'source database') sourceDatabaseHandle = handle
    return sha256FileHandle(handle, options)
  }
  fixture.runtime.closeRetainedHandle = (handle) => handle.close()
  fixture.runtime.removeStandaloneArchive = async (archivePath) => {
    generatedArchivePath = archivePath
    assert.equal(staged, true)
    assert.equal(fs.existsSync(evidenceOutputPath(fixture.fixtureRoot)), false)
    assert.equal((await archiveHandle.stat({ bigint: true })).isFile(), true)
    await assert.rejects(sourceDatabaseHandle.stat({ bigint: true }), /closed|EBADF/i)
    throw deletionFailure
  }

  let thrown
  try {
    await executeRollbackDrill(fixture.options, fixture.runtime)
  } catch (error) {
    thrown = error
  }

  assert.equal(thrown, deletionFailure)
  assert.equal(staged, true)
  assert.equal(fs.existsSync(evidenceOutputPath(fixture.fixtureRoot)), false)
  assert.deepEqual(diagnosticRecords(fixture.fixtureRoot), [])
  assert.equal(fs.existsSync(generatedArchivePath), true)
})

test('standalone archive plus-one growth fails from the retained handle before restore or PASS', async (t) => {
  const fixture = createExecutorFixture(t, 'standalone')
  assert.equal(fixture.options.inputMode, 'standalone')
  fixture.runtime.limits = tinyLimits({ maxArchiveBytes: Buffer.byteLength('standalone archive bytes') })
  let retainedHandle
  fixture.runtime.hooks = {
    onArchiveHandleOpened: async ({ handle, path: openedPath, inputMode }) => {
      assert.equal(inputMode, 'standalone')
      retainedHandle = handle
      await fsp.appendFile(openedPath, 'x')
    },
  }

  await assert.rejects(executeRollbackDrill(fixture.options, fixture.runtime), /archive.*(length|limit|identity|large)/i)
  assert.equal(fixture.calls.restore.length, 0)
  assert.equal(fixture.calls.publish.length, 0)
  assert.ok(retainedHandle)
  await assert.rejects(retainedHandle.stat({ bigint: true }), /closed|EBADF/i)
})

test('standalone archive replacement after real hashing fails before restore or PASS', async (t) => {
  const fixture = createExecutorFixture(t, 'standalone')
  assert.equal(fixture.options.inputMode, 'standalone')
  fixture.runtime.limits = tinyLimits({ maxArchiveBytes: Buffer.byteLength('standalone archive bytes') })
  let archiveHashCalls = 0
  let displacedArchivePath
  let retainedHandle
  t.after(async () => {
    if (displacedArchivePath) await fsp.rm(displacedArchivePath, { force: true })
  })
  fixture.runtime.hooks = {
    onArchiveHandleOpened: ({ handle, inputMode }) => {
      assert.equal(inputMode, 'standalone')
      retainedHandle = handle
    },
  }
  fixture.runtime.sha256FileHandle = async (handle, options) => {
    const digest = await sha256FileHandle(handle, options)
    if (options.label === 'rollback archive' && ++archiveHashCalls === 1) {
      const archivePath = fixture.calls.create[0].outputPath
      displacedArchivePath = `${archivePath}.displaced`
      const contents = await fsp.readFile(archivePath)
      await fsp.rename(archivePath, displacedArchivePath)
      await fsp.writeFile(archivePath, contents)
    }
    return digest
  }

  await assert.rejects(executeRollbackDrill(fixture.options, fixture.runtime), /archive.*(identity|changed)/i)
  assert.equal(archiveHashCalls, 1)
  assert.equal(fixture.calls.restore.length, 0)
  assert.equal(fixture.calls.publish.length, 0)
  assert.ok(retainedHandle)
  await assert.rejects(retainedHandle.stat({ bigint: true }), /closed|EBADF/i)
})

test('standalone database same-byte replacement fails before restore and closes its retained handle', async (t) => {
  const fixture = createExecutorFixture(t, 'standalone')
  assert.equal(fixture.options.inputMode, 'standalone')
  const createBackup = fixture.runtime.createDataBackup
  let databaseHandle
  fixture.runtime.createDataBackup = async (options) => {
    const backup = await createBackup(options)
    const displaced = `${options.databasePath}.displaced`
    const contents = await fsp.readFile(options.databasePath)
    await fsp.rename(options.databasePath, displaced)
    await fsp.writeFile(options.databasePath, contents)
    return backup
  }
  fixture.runtime.sha256FileHandle = (handle, options) => {
    if (options.label === 'source database') databaseHandle = handle
    return sha256FileHandle(handle, options)
  }

  await assert.rejects(executeRollbackDrill(fixture.options, fixture.runtime), /database.*(identity|changed)/i)
  assert.equal(fixture.calls.restore.length, 0)
  assert.equal(fixture.calls.publish.length, 0)
  assert.ok(databaseHandle)
  await assert.rejects(databaseHandle.stat({ bigint: true }), /closed|EBADF/i)
})

test('standalone public database swap-use-swap-back is rejected by retained ctime authority', async (t) => {
  const fixture = createExecutorFixture(t, 'standalone')
  const sourceDatabasePath = fixture.runtime.sourcePaths.databasePath
  const displacedDatabasePath = `${sourceDatabasePath}.displaced`
  const createBackup = fixture.runtime.createDataBackup
  let backupDatabasePath
  let mutationCompleted = false
  fixture.runtime.createDataBackup = async (options) => {
    backupDatabasePath = options.databasePath
    const backup = await createBackup(options)
    await fsp.rename(sourceDatabasePath, displacedDatabasePath)
    await fsp.writeFile(sourceDatabasePath, 'valid replacement database')
    try {
      await fsp.rm(sourceDatabasePath, { force: true })
      await fsp.rename(displacedDatabasePath, sourceDatabasePath)
      mutationCompleted = true
      return backup
    } finally {
      if (fs.existsSync(displacedDatabasePath)) {
        await fsp.rm(sourceDatabasePath, { force: true })
        await fsp.rename(displacedDatabasePath, sourceDatabasePath)
      }
    }
  }

  await assert.rejects(
    executeRollbackDrill(fixture.options, fixture.runtime),
    /source database.*(?:ctime|identity|changed)/i
  )

  assert.equal(path.resolve(backupDatabasePath), path.resolve(sourceDatabasePath))
  assert.equal(mutationCompleted, true)
  assert.equal(fixture.calls.restore.length, 0)
  assert.equal(fixture.calls.publish.length, 0)
  assert.equal(await fsp.readFile(sourceDatabasePath, 'utf8'), 'database')
})

test('standalone database plus-one growth is rejected by stat before a post-backup read', async (t) => {
  const fixture = createExecutorFixture(t, 'standalone')
  assert.equal(fixture.options.inputMode, 'standalone')
  fixture.runtime.limits = tinyLimits({ maxArchiveBytes: 64 })
  const createBackup = fixture.runtime.createDataBackup
  let databaseHandle
  let databaseHashCalls = 0
  let postBackupReads = 0
  fixture.runtime.createDataBackup = async (options) => {
    const backup = await createBackup(options)
    await fsp.appendFile(options.databasePath, 'x')
    return backup
  }
  fixture.runtime.sha256FileHandle = (handle, options) => {
    if (options.label !== 'source database') return sha256FileHandle(handle, options)
    databaseHandle = handle
    databaseHashCalls += 1
    if (databaseHashCalls !== 2) return sha256FileHandle(handle, options)
    const observedHandle = {
      stat: (...args) => handle.stat(...args),
      read: (...args) => {
        postBackupReads += 1
        return handle.read(...args)
      },
    }
    return sha256FileHandle(observedHandle, options)
  }

  await assert.rejects(executeRollbackDrill(fixture.options, fixture.runtime), /database.*(length|limit|identity|large)/i)
  assert.equal(databaseHashCalls, 2)
  assert.equal(postBackupReads, 0)
  assert.equal(fixture.calls.restore.length, 0)
  assert.equal(fixture.calls.publish.length, 0)
  assert.ok(databaseHandle)
  await assert.rejects(databaseHandle.stat({ bigint: true }), /closed|EBADF/i)
})

test('standalone final fingerprint runs after workspace cleanup and blocks cleanup-window mutation', async (t) => {
  const fixture = createExecutorFixture(t, 'standalone')
  assert.equal(fixture.options.inputMode, 'standalone')
  let cleanupCompleted = false
  fixture.runtime.cleanupWorkspace = async (workspace) => {
    await fsp.rm(workspace, { recursive: true, force: true })
    assert.equal(fs.existsSync(workspace), false)
    cleanupCompleted = true
    await fsp.writeFile(path.join(fixture.dataRoot, 'storage', 'asset.txt'), 'cleanup mutation')
  }

  await assert.rejects(executeRollbackDrill(fixture.options, fixture.runtime), /fingerprint|data root.*changed/i)
  assert.equal(cleanupCompleted, true)
  assert.equal(fixture.calls.publish.length, 0)
})

test('standalone execution rejects split source roots before preparing evidence', async (t) => {
  const fixture = createExecutorFixture(t, 'standalone')
  const otherRoot = path.join(fixture.fixtureRoot, 'other-data')
  const otherStorage = path.join(otherRoot, 'storage')
  fs.mkdirSync(otherStorage, { recursive: true })
  fixture.runtime.sourcePaths.storagePath = otherStorage
  await assert.rejects(executeRollbackDrill(fixture.options, fixture.runtime), /same data root|single data root/i)
  assert.equal(fixture.calls.prepare, 0)
  assert.equal(fixture.calls.publish.length, 0)
})

test('standalone execution accepts Windows case variants of one physical data root', {
  skip: process.platform !== 'win32',
}, async (t) => {
  const fixture = createExecutorFixture(t, 'standalone')
  fixture.runtime.sourcePaths = {
    databasePath: path.join(fixture.dataRoot.toUpperCase(), 'drama_generator.db'),
    storagePath: path.join(fixture.dataRoot.toLowerCase(), 'storage'),
    storySourcesPath: path.join(fixture.dataRoot, 'story_sources'),
  }

  const result = await executeRollbackDrill(fixture.options, fixture.runtime)
  assert.equal(result.evidence.status, 'passed')
  assert.equal(fixture.calls.prepare, 1)
  assert.equal(fixture.calls.publish.length, 1)
})

test('executor validates forged bound options before preparing evidence', async (t) => {
  const fixture = createExecutorFixture(t)
  const forged = { ...fixture.options, archivePath: 'relative.zip' }
  await assert.rejects(executeRollbackDrill(forged, fixture.runtime))
  assert.equal(fixture.calls.prepare, 0)
  assert.equal(fixture.calls.publish.length, 0)
})

test('rollback result marker round-trips canonical exact evidence bytes', () => {
  const result = validRollbackResult()
  const marker = createRollbackResultMarker(result, VERSION)
  assert.equal(marker.startsWith(ROLLBACK_RESULT_MARKER_PREFIX), true)
  assert.equal(marker.includes('\n'), false)

  const parsed = parseRollbackResultStream(`diagnostic output\n${marker}\n`, {
    expectedCommit: COMMIT,
    expectedInputMode: 'standalone',
    expectedVersion: VERSION,
  })

  assert.equal(parsed.schema, ROLLBACK_RESULT_SCHEMA)
  assert.equal(parsed.diagnosticRelativePath, result.diagnosticRelativePath)
  assert.deepEqual(parsed.evidenceBytes, result.evidenceBytes)
  assert.deepEqual(parsed.evidence, result.evidence)
  assert.equal(parsed.evidenceSha256, crypto.createHash('sha256').update(result.evidenceBytes).digest('hex'))
})

test('rollback result parser rejects missing, duplicate, oversized, noncanonical, malformed, and mistyped markers', () => {
  const evidenceBytes = serializeEvidence(validEvidence())
  const utf8Bom = Buffer.from([0xef, 0xbb, 0xbf])
  const validEnvelope = resultEnvelopeForEvidence(evidenceBytes)
  const validMarker = encodeResultEnvelope(validEnvelope)
  const options = {
    expectedCommit: COMMIT,
    expectedInputMode: 'standalone',
    expectedVersion: VERSION,
  }
  const rejects = (stream, pattern) => assert.throws(() => parseRollbackResultStream(stream, options), pattern)

  rejects('no marker here\n', /exactly one.*marker/i)
  rejects(`${validMarker}\n${validMarker}\n`, /exactly one.*marker/i)
  rejects(Buffer.concat([
    utf8Bom,
    Buffer.from(`diagnostic output\n${validMarker}\n`, 'utf8'),
  ]), /BOM|canonical/i)
  rejects(Buffer.alloc(MAX_ROLLBACK_RESULT_STREAM_BYTES + 1, 0x61), /stream.*limit|too large/i)
  rejects(`${ROLLBACK_RESULT_MARKER_PREFIX}***\n`, /base64url/i)
  rejects(`${ROLLBACK_RESULT_MARKER_PREFIX}${Buffer.from([0xff]).toString('base64url')}\n`, /UTF-8/i)
  rejects(`${ROLLBACK_RESULT_MARKER_PREFIX}${Buffer.from(` ${JSON.stringify(validEnvelope)}`, 'utf8').toString('base64url')}\n`, /canonical/i)
  rejects(
    `${ROLLBACK_RESULT_MARKER_PREFIX}${Buffer.concat([
      utf8Bom,
      Buffer.from(JSON.stringify(validEnvelope), 'utf8'),
    ]).toString('base64url')}\n`,
    /canonical|BOM/i,
  )

  const envelopeCases = [
    [{ ...validEnvelope, schema: 'localminidrama.rollback-result.v2' }, /schema/i],
    [{ ...validEnvelope, evidence_sha256: 'A'.repeat(64) }, /sha256|digest/i],
    [{ ...validEnvelope, diagnostic_relative_path: '../summary.json' }, /diagnostic/i],
    [{ ...validEnvelope, diagnostic_relative_path: 'artifacts/rollback-drill/summary.json' }, /diagnostic/i],
    [{ ...validEnvelope, evidence_utf8_base64url: 7 }, /evidence.*base64url|type/i],
    [{ ...validEnvelope, extra: true }, /property|canonical|field/i],
  ]
  for (const [envelope, pattern] of envelopeCases) rejects(`${encodeResultEnvelope(envelope)}\n`, pattern)

  const invalidUtf8Evidence = Buffer.from([0xc3, 0x28])
  rejects(`${encodeResultEnvelope(resultEnvelopeForEvidence(invalidUtf8Evidence))}\n`, /evidence.*UTF-8/i)
  const bomEvidence = Buffer.concat([utf8Bom, evidenceBytes])
  rejects(`${encodeResultEnvelope(resultEnvelopeForEvidence(bomEvidence))}\n`, /evidence.*(?:canonical|JSON|BOM)/i)
  const malformedEvidenceEnvelope = resultEnvelopeForEvidence(Buffer.from('{', 'utf8'))
  rejects(`${encodeResultEnvelope(malformedEvidenceEnvelope)}\n`, /evidence.*JSON/i)
  const wrongSchemaEvidence = validEvidence()
  wrongSchemaEvidence.schema = 'localminidrama.rollback-drill.v2'
  rejects(`${encodeResultEnvelope(resultEnvelopeForEvidence(serializeEvidence(wrongSchemaEvidence)))}\n`, /schema/i)
  const mistypedEvidence = validEvidence()
  mistypedEvidence.status = true
  const mistypedBytes = Buffer.from(`${JSON.stringify(mistypedEvidence, null, 2)}\n`, 'utf8')
  rejects(`${encodeResultEnvelope(resultEnvelopeForEvidence(mistypedBytes))}\n`, /status/i)
  const oversizedEvidence = Buffer.alloc(MAX_ROLLBACK_RESULT_EVIDENCE_BYTES + 1, 0x61)
  rejects(`${encodeResultEnvelope(resultEnvelopeForEvidence(oversizedEvidence))}\n`, /evidence.*limit|too large/i)
})

test('rollback result stream CLI validates the live anonymous stream', () => {
  const modulePath = path.join(__dirname, 'rollback-drill-evidence.cjs')
  const marker = createRollbackResultMarker(validRollbackResult(), VERSION)
  const args = [
    modulePath,
    '--validate-result-stream',
    '--expected-version', VERSION,
    '--expected-commit', COMMIT,
    '--expected-mode', 'standalone',
  ]
  const valid = spawnSync(process.execPath, args, {
    cwd: path.dirname(__dirname),
    encoding: 'utf8',
    input: `focused test log\n${marker}\n`,
    windowsHide: true,
  })
  assert.equal(valid.status, 0, valid.stderr || valid.stdout)
  assert.equal(valid.stdout, '')

  for (const stream of ['missing\n', `${marker}\n${marker}\n`, `${ROLLBACK_RESULT_MARKER_PREFIX}bad=\n`]) {
    const invalid = spawnSync(process.execPath, args, {
      cwd: path.dirname(__dirname),
      encoding: 'utf8',
      input: stream,
      windowsHide: true,
    })
    assert.notEqual(invalid.status, 0, `stream validator accepted: ${JSON.stringify(stream)}`)
  }
})

test('diagnostic publication is append-only, leaves prior records untouched, and never calls fsp.link', async (t) => {
  const fixtureRoot = temporaryDirectory(t, 'lmd-rollback-append-only-diagnostic-')
  const evidenceRoot = path.dirname(evidenceOutputPath(fixtureRoot))
  const legacyPath = evidenceOutputPath(fixtureRoot)
  const v1Path = path.join(evidenceRoot, 'legacy-v1.json')
  const fixedPath = path.join(evidenceRoot, 'fixed-record.json')
  const legacyBytes = Buffer.from(`${JSON.stringify(validEvidence())}\n`)
  const v1Bytes = Buffer.from('{"schema":"localminidrama.rollback-drill.v1"}\n')
  const fixedBytes = Buffer.from('fixed record bytes\n')
  await fsp.mkdir(evidenceRoot, { recursive: true })
  await fsp.writeFile(legacyPath, legacyBytes)
  await fsp.writeFile(v1Path, v1Bytes)
  await fsp.writeFile(fixedPath, fixedBytes)

  await prepareEvidenceTarget(fixtureRoot, VERSION)
  assert.deepEqual(await fsp.readFile(legacyPath), legacyBytes)
  assert.deepEqual(await fsp.readFile(v1Path), v1Bytes)
  assert.deepEqual(await fsp.readFile(fixedPath), fixedBytes)

  const originalLink = fsp.link
  let linkCalls = 0
  fsp.link = async (sourcePath, outputPath) => {
    linkCalls += 1
    const displacedPath = `${sourcePath}.old-source`
    await fsp.rename(sourcePath, displacedPath)
    await fsp.writeFile(sourcePath, 'malicious final-boundary replacement')
    return originalLink(sourcePath, outputPath)
  }
  let publication
  try {
    publication = await publishEvidence(fixtureRoot, VERSION, validEvidence())
  } finally {
    fsp.link = originalLink
  }

  assert.equal(linkCalls, 0)
  assert.match(publication.diagnosticRelativePath, /^artifacts\/rollback-drill\/summary-v3-[a-f0-9-]+\.json$/)
  assert.notEqual(publication.diagnosticRelativePath, 'artifacts/rollback-drill/summary.json')
  assert.deepEqual(publication.evidenceBytes, serializeEvidence(validEvidence()))
  assert.deepEqual(
    await fsp.readFile(path.join(fixtureRoot, ...publication.diagnosticRelativePath.split('/'))),
    publication.evidenceBytes
  )
  assert.deepEqual(await fsp.readFile(legacyPath), legacyBytes)
  assert.deepEqual(await fsp.readFile(v1Path), v1Bytes)
  assert.deepEqual(await fsp.readFile(fixedPath), fixedBytes)
})

test('executor closes every retained resource before diagnostic publication and returns authoritative bytes', async (t) => {
  for (const inputMode of ['checkpoint-bound', 'standalone']) {
    await t.test(inputMode, async () => {
      const fixture = createExecutorFixture(t, inputMode)
      let archiveHandle
      let archivePath
      let archiveClosed = false
      let sourceDatabaseClosed = inputMode === 'checkpoint-bound'
      let standaloneArchiveRemoved = inputMode === 'checkpoint-bound'
      fixture.runtime.hooks = {
        onArchiveHandleOpened: ({ handle, path: openedPath }) => {
          archiveHandle = handle
          archivePath = openedPath
        },
      }
      fixture.runtime.closeRetainedHandle = async (handle, label) => {
        await handle.close()
        if (label === 'rollback archive') archiveClosed = true
        if (label === 'source database') sourceDatabaseClosed = true
      }
      fixture.runtime.removeStandaloneArchive = async (targetPath) => {
        await fsp.rm(targetPath, { force: true })
        standaloneArchiveRemoved = true
      }
      fixture.runtime.publishEvidence = async (repoRoot, version, evidence) => {
        assert.equal(archiveClosed, true)
        assert.equal(sourceDatabaseClosed, true)
        assert.equal(standaloneArchiveRemoved, true)
        await assert.rejects(archiveHandle.stat({ bigint: true }), /closed|EBADF/i)
        if (inputMode === 'standalone') assert.equal(fs.existsSync(archivePath), false)
        return {
          diagnosticRelativePath: diagnosticRelativePath(),
          evidenceBytes: serializeEvidence(evidence),
        }
      }

      const result = await executeRollbackDrill(fixture.options, fixture.runtime)

      assert.equal(result.evidence.input_mode, inputMode)
      assert.equal(result.diagnosticRelativePath, diagnosticRelativePath())
      assert.deepEqual(result.evidenceBytes, serializeEvidence(result.evidence))
    })
  }
})

test('executor rejects a diagnostic publisher that mutates authoritative in-memory evidence', async (t) => {
  const fixture = createExecutorFixture(t)
  fixture.runtime.publishEvidence = async (repoRoot, version, evidence) => {
    const evidenceBytes = serializeEvidence(evidence)
    evidence.status = 'failed'
    return {
      diagnosticRelativePath: diagnosticRelativePath(),
      evidenceBytes,
    }
  }

  await assert.rejects(
    executeRollbackDrill(fixture.options, fixture.runtime),
    /authoritative.*evidence.*changed|evidence.*canonical/i,
  )
})

test('same-size mutation at the former afterCommit boundary cannot affect result authority', async (t) => {
  const fixture = createExecutorFixture(t)
  const legacyPath = evidenceOutputPath(fixture.fixtureRoot)
  const originalBytes = Buffer.from('legacy fixed diagnostic A')
  const replacementBytes = Buffer.from('legacy fixed diagnostic B')
  assert.equal(originalBytes.length, replacementBytes.length)
  await fsp.mkdir(path.dirname(legacyPath), { recursive: true })
  await fsp.writeFile(legacyPath, originalBytes)
  fixture.runtime.closeRetainedHandle = async (handle, label) => {
    await handle.close()
    if (label === 'rollback archive') await fsp.writeFile(legacyPath, replacementBytes)
  }

  const result = await executeRollbackDrill(fixture.options, fixture.runtime)

  assert.deepEqual(await fsp.readFile(legacyPath), replacementBytes)
  assert.deepEqual(result.evidenceBytes, serializeEvidence(result.evidence))
  assert.notDeepEqual(result.evidenceBytes, replacementBytes)
})

test('checkpoint close failure occurs before diagnostics and produces no authoritative result', async (t) => {
  const fixture = createExecutorFixture(t)
  const closeFailure = new Error('checkpoint close gate failed')
  let publishCalls = 0
  fixture.runtime.closeRetainedHandle = async (handle) => {
    await handle.close()
    throw closeFailure
  }
  fixture.runtime.publishEvidence = async () => {
    publishCalls += 1
    throw new Error('diagnostic publication must not run')
  }

  let thrown
  try {
    await executeRollbackDrill(fixture.options, fixture.runtime)
  } catch (error) {
    thrown = error
  }
  assert.equal(thrown, closeFailure)
  assert.equal(publishCalls, 0)
})

test('executor preserves every falsey operation, cleanup-only, and publication failure after cleanup', async (t) => {
  const falseyValues = [undefined, null, 0, '']
  for (let index = 0; index < falseyValues.length; index += 1) {
    const value = falseyValues[index]
    await t.test(`operation-${index}`, async () => {
      const fixture = createExecutorFixture(t)
      let workspaceCleaned = false
      let archiveClosed = false
      let published = false
      fixture.runtime.hooks = { afterRestore: () => { throw value } }
      fixture.runtime.cleanupWorkspace = async (workspace) => {
        await fsp.rm(workspace, { recursive: true, force: true })
        workspaceCleaned = true
      }
      fixture.runtime.closeRetainedHandle = async (handle) => {
        await handle.close()
        archiveClosed = true
      }
      fixture.runtime.publishEvidence = async () => {
        published = true
        throw new Error('unexpected diagnostic publication')
      }
      let caught = false
      let thrown = Symbol('not thrown')
      try { await executeRollbackDrill(fixture.options, fixture.runtime) } catch (error) { caught = true; thrown = error }
      assert.equal(caught, true)
      assert.equal(thrown, value)
      assert.equal(workspaceCleaned, true)
      assert.equal(archiveClosed, true)
      assert.equal(published, false)
    })

    await t.test(`cleanup-only-${index}`, async () => {
      const fixture = createExecutorFixture(t)
      let archiveClosed = false
      let published = false
      fixture.runtime.cleanupWorkspace = async (workspace) => {
        await fsp.rm(workspace, { recursive: true, force: true })
        throw value
      }
      fixture.runtime.closeRetainedHandle = async (handle) => {
        await handle.close()
        archiveClosed = true
      }
      fixture.runtime.publishEvidence = async () => { published = true }
      let caught = false
      let thrown = Symbol('not thrown')
      try { await executeRollbackDrill(fixture.options, fixture.runtime) } catch (error) { caught = true; thrown = error }
      assert.equal(caught, true)
      assert.equal(thrown, value)
      assert.equal(archiveClosed, true)
      assert.equal(published, false)
    })

    await t.test(`publication-${index}`, async () => {
      const fixture = createExecutorFixture(t)
      let archiveClosed = false
      fixture.runtime.closeRetainedHandle = async (handle) => {
        await handle.close()
        archiveClosed = true
      }
      fixture.runtime.publishEvidence = async () => {
        assert.equal(archiveClosed, true)
        throw value
      }
      let caught = false
      let thrown = Symbol('not thrown')
      try { await executeRollbackDrill(fixture.options, fixture.runtime) } catch (error) { caught = true; thrown = error }
      assert.equal(caught, true)
      assert.equal(thrown, value)
      assert.equal(archiveClosed, true)
    })
  }
})

test('executor cleanup attachment skips proxies and bounds own data descriptors at eight', async (t) => {
  const cases = []

  const accessorPrimary = new Error('accessor primary')
  let accessorReads = 0
  Object.defineProperty(accessorPrimary, 'cleanupErrors', {
    configurable: true,
    get() { accessorReads += 1; throw new Error('accessor executed') },
  })
  cases.push({ name: 'accessor', primary: accessorPrimary, reads: () => accessorReads, expected: [] })

  let proxyReads = 0
  const proxyPrimary = new Proxy(new Error('proxy primary'), {
    get() { proxyReads += 1; throw new Error('proxy get executed') },
    getOwnPropertyDescriptor() { proxyReads += 1; throw new Error('proxy descriptor executed') },
  })
  cases.push({ name: 'proxy', primary: proxyPrimary, reads: () => proxyReads, expected: null })

  const proxyContainerPrimary = new Error('proxy cleanup container primary')
  let proxyContainerReads = 0
  const proxyContainer = new Proxy([], {
    get() { proxyContainerReads += 1; throw new Error('proxy container get executed') },
    getOwnPropertyDescriptor() { proxyContainerReads += 1; throw new Error('proxy container descriptor executed') },
  })
  Object.defineProperty(proxyContainerPrimary, 'cleanupErrors', { configurable: true, value: proxyContainer })
  cases.push({ name: 'proxy-container', primary: proxyContainerPrimary, reads: () => proxyContainerReads, expected: [] })

  const nonArrayPrimary = new Error('non-array cleanup container primary')
  let nonArrayReads = 0
  const nonArrayContainer = {}
  Object.defineProperty(nonArrayContainer, '0', {
    get() { nonArrayReads += 1; throw new Error('non-array entry executed') },
  })
  Object.defineProperty(nonArrayPrimary, 'cleanupErrors', { configurable: true, value: nonArrayContainer })
  cases.push({ name: 'non-array-container', primary: nonArrayPrimary, reads: () => nonArrayReads, expected: [] })

  const largePrimary = new Error('large cleanup primary')
  const existing = new Array(10_000_000)
  const expected = Array.from({ length: 8 }, (_, index) => new Error(`existing ${index}`))
  for (let index = 0; index < expected.length; index += 1) existing[index] = expected[index]
  let overflowReads = 0
  Object.defineProperty(existing, '8', {
    get() { overflowReads += 1; throw new Error('ninth entry executed') },
  })
  Object.defineProperty(largePrimary, 'cleanupErrors', { configurable: true, value: existing })
  cases.push({ name: 'large', primary: largePrimary, reads: () => overflowReads, expected })

  for (const value of cases) {
    await t.test(value.name, async () => {
      const fixture = createExecutorFixture(t)
      const cleanupFailure = new Error(`${value.name} cleanup failure`)
      fixture.runtime.hooks = { afterRestore: () => { throw value.primary } }
      fixture.runtime.cleanupWorkspace = async (workspace) => {
        await fsp.rm(workspace, { recursive: true, force: true })
        throw cleanupFailure
      }
      let thrown
      try { await executeRollbackDrill(fixture.options, fixture.runtime) } catch (error) { thrown = error }
      assert.equal(thrown, value.primary)
      assert.equal(value.reads(), 0)
      if (value.expected) assert.deepEqual(thrown.cleanupErrors, value.expected.length === 8 ? value.expected : [cleanupFailure])
    })
  }
})

test('stderr rendering is safe and explicit for falsey and proxy thrown values', () => {
  assert.equal(renderThrownValue(undefined), 'undefined')
  assert.equal(renderThrownValue(null), 'null')
  assert.equal(renderThrownValue(0), '0')
  assert.equal(renderThrownValue(''), "''")
  let trapReads = 0
  const proxy = new Proxy({}, { get() { trapReads += 1; throw new Error('render trap') } })
  assert.equal(renderThrownValue(proxy), '[unrenderable thrown object]')
  assert.equal(trapReads, 0)

  const primary = new Error('primary rollback failure')
  Object.defineProperty(primary, 'cleanupErrors', {
    configurable: true,
    value: [new Error('retained cleanup failure')],
  })
  const rendered = renderThrownValue(primary)
  assert.match(rendered, /primary rollback failure/)
  assert.match(rendered, /retained cleanup failure/)
  assert.ok(rendered.indexOf('primary rollback failure') < rendered.indexOf('retained cleanup failure'))
  assert.ok(Buffer.byteLength(rendered, 'utf8') <= 64 * 1024)
})

test('rollback drill module import does not execute the CLI', () => {
  const modulePath = path.join(__dirname, 'run-rollback-drill.cjs')
  const result = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(modulePath)})`], {
    cwd: path.dirname(__dirname),
    encoding: 'utf8',
    windowsHide: true,
  })
  assert.equal(result.status, 0, result.stderr || result.stdout)
  assert.equal(result.stdout, '')
  assert.equal(result.stderr, '')
})
