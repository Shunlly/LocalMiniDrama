'use strict'

const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const test = require('node:test')

const {
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
} = require('./rollback-drill-evidence.cjs')
const { executeRollbackDrill } = require('./run-rollback-drill.cjs')

const HEX_64 = /^[a-f0-9]{64}$/
const VERSION = '1.3.3'
const COMMIT = 'a'.repeat(40)

function temporaryDirectory(t, prefix) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  return directory
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
    publishEvidence: async (_repoRoot, _version, evidence) => {
      calls.publish.push(evidence)
      return evidenceOutputPath(fixtureRoot)
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

test('prior v1, v2, and different-version v3 evidence is archived by explicit generation', async (t) => {
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
    fs.writeFileSync(outputPath, `${JSON.stringify(record.evidence)}\n`)
    await prepareEvidenceTarget(fixtureRoot, VERSION)
    assert.equal(fs.existsSync(outputPath), false)
    const archives = fs.readdirSync(path.join(fixtureRoot, 'artifacts', 'rollback-drill', 'archive'))
    assert.equal(archives.some((name) => name.startsWith(`${record.generation}-`)), true)
  }
})

test('bound execution restores the exact retained archive without creating a backup', async (t) => {
  const fixture = createExecutorFixture(t)
  const evidence = await executeRollbackDrill(fixture.options, fixture.runtime)
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
  assert.equal(fixture.calls.publish.length, 1)
})

test('bound execution keeps one archive descriptor open through publication and closes it afterward', async (t) => {
  const fixture = createExecutorFixture(t)
  let archiveHandle
  let releasePublication
  let publicationStartedResolve
  const publicationStarted = new Promise((resolve) => { publicationStartedResolve = resolve })
  const publicationGate = new Promise((resolve) => { releasePublication = resolve })
  fixture.runtime.hooks = {
    onArchiveHandleOpened: ({ handle }) => { archiveHandle = handle },
  }
  fixture.runtime.publishEvidence = async (_repoRoot, _version, evidence) => {
    publicationStartedResolve()
    await publicationGate
    fixture.calls.publish.push(evidence)
    return evidenceOutputPath(fixture.fixtureRoot)
  }

  const execution = executeRollbackDrill(fixture.options, fixture.runtime)
  await publicationStarted
  assert.ok(archiveHandle)
  assert.equal((await archiveHandle.stat({ bigint: true })).isFile(), true)
  releasePublication()
  await execution
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
  const evidence = await executeRollbackDrill(fixture.options, fixture.runtime)
  assert.equal(fixture.calls.create.length, 1)
  assert.equal(fixture.calls.restore.length, 1)
  assert.equal(fixture.calls.create[0].outputPath, fixture.calls.restore[0].archivePath)
  assert.equal(fs.existsSync(fixture.calls.create[0].outputPath), false)
  assert.equal(fs.existsSync(fixture.archivePath), true)
  assert.equal(evidence.input_mode, 'standalone')
  assert.equal(evidence.backup.archive_retained, false)
  assert.equal(Number.isInteger(evidence.backup.excluded_values), true)
  assert.equal(evidence.backup.excluded_values, 7)
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

  const evidence = await executeRollbackDrill(fixture.options, fixture.runtime)
  assert.equal(evidence.status, 'passed')
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
