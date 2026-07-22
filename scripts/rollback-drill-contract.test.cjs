'use strict'

const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const test = require('node:test')

const { DEFAULT_LIMITS } = require('../backend-node/src/services/dataBackupService')

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
const { executeRollbackDrill, sha256FileHandle } = require('./run-rollback-drill.cjs')

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

test('fingerprint and archive limits accept every exact tiny boundary before publication', async (t) => {
  const fixture = createExecutorFixture(t)
  fixture.runtime.limits = tinyLimits()

  const evidence = await executeRollbackDrill(fixture.options, fixture.runtime)

  assert.equal(evidence.backup.archive_bytes, fixture.runtime.limits.maxArchiveBytes)
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
  fixture.runtime.fingerprintDataRoot = (root, hooks, limits) => {
    fingerprintCalls += 1
    if (fingerprintCalls === 2) assert.equal(cleanupCompleted, true)
    seenLimits.push(limits)
    return fingerprint(root, hooks, limits)
  }
  fixture.runtime.createDataBackup = (options) => {
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
      assert.equal(await publishEvidence(repoRoot, VERSION, evidence), evidenceOutputPath(repoRoot))
      assert.equal(fs.existsSync(evidenceOutputPath(repoRoot)), true)
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
  assert.equal(
    await publishEvidence(minimumRoot, VERSION, minimumEvidence),
    evidenceOutputPath(minimumRoot)
  )

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
  assert.equal(await publishEvidence(exactRoot, VERSION, exact, limits), evidenceOutputPath(exactRoot))

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

test('standalone archive exact limit retains one handle through restore and publication then closes it', async (t) => {
  const fixture = createExecutorFixture(t, 'standalone')
  assert.equal(fixture.options.inputMode, 'standalone')
  fixture.runtime.limits = tinyLimits({ maxArchiveBytes: Buffer.byteLength('standalone archive bytes') })
  const restore = fixture.runtime.restoreDataBackup
  const publish = fixture.runtime.publishEvidence
  let retainedHandle
  fixture.runtime.hooks = {
    onArchiveHandleOpened: ({ handle, inputMode }) => {
      assert.equal(inputMode, 'standalone')
      retainedHandle = handle
    },
  }
  fixture.runtime.restoreDataBackup = (options) => {
    assert.ok(retainedHandle)
    assert.equal(options.archiveHandle, retainedHandle)
    return restore(options)
  }
  fixture.runtime.publishEvidence = async (repoRoot, version, evidence, limits) => {
    assert.equal((await retainedHandle.stat({ bigint: true })).isFile(), true)
    assert.equal(fs.existsSync(fixture.calls.create[0].outputPath), true)
    return publish(repoRoot, version, evidence, limits)
  }

  const evidence = await executeRollbackDrill(fixture.options, fixture.runtime)

  assert.equal(evidence.backup.archive_bytes, fixture.runtime.limits.maxArchiveBytes)
  assert.equal(fixture.calls.restore.length, 1)
  assert.equal(fixture.calls.publish.length, 1)
  assert.equal(fs.existsSync(fixture.calls.create[0].outputPath), false)
  await assert.rejects(retainedHandle.stat({ bigint: true }), /closed|EBADF/i)
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
