const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { spawnSync } = require('node:child_process');
const Database = require('better-sqlite3');
const AdmZip = require('adm-zip');
const { getGlobalSetting } = require('../src/services/settingsService');
const {
  __testing,
  FORMAT_VERSION,
  acquireServiceMaintenanceLockSync,
  createExternalMaintenanceLease,
  createDataBackup,
  maintenancePaths,
  recoverInterruptedMaintenanceSync,
  restoreDataBackup,
} = require('../src/services/dataBackupService');

async function makeWorkspace(t) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'localminidrama-data-backup-test-'));
  t.after(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });
  const databasePath = path.join(root, 'live', 'drama.db');
  const storagePath = path.join(root, 'live', 'storage');
  const storySourcesPath = path.join(root, 'live', 'story_sources');
  const archivePath = path.join(root, 'archives', 'backup.zip');
  await fsp.mkdir(path.dirname(databasePath), { recursive: true });
  await fsp.mkdir(storagePath, { recursive: true });
  await fsp.mkdir(storySourcesPath, { recursive: true });
  return { root, databasePath, storagePath, storySourcesPath, archivePath };
}

function createDatabase(databasePath, value) {
  const db = new Database(databasePath);
  db.pragma('journal_mode = WAL');
  db.exec('CREATE TABLE records (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
  db.prepare('INSERT INTO records (value) VALUES (?)').run(value);
  return db;
}

function replaceDatabaseValue(databasePath, value) {
  const db = new Database(databasePath);
  db.prepare('DELETE FROM records').run();
  db.prepare('INSERT INTO records (value) VALUES (?)').run(value);
  db.close();
}

function readDatabaseValues(databasePath) {
  const db = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    return db.prepare('SELECT value FROM records ORDER BY id').all().map((row) => row.value);
  } finally {
    db.close();
  }
}

async function seedStorage(storagePath, label) {
  await fsp.mkdir(path.join(storagePath, 'images', 'nested'), { recursive: true });
  await fsp.writeFile(path.join(storagePath, 'images', 'cover.txt'), `${label}-cover`);
  await fsp.writeFile(path.join(storagePath, 'images', 'nested', 'clip.bin'), Buffer.from([0, 1, 2, 3, label.length]));
}

function createStorySourcesTable(db) {
  db.exec(`CREATE TABLE story_sources (
    id INTEGER PRIMARY KEY,
    raw_text_path TEXT,
    deleted_at TEXT
  )`);
}

function createProjectStorySourcesTables(db) {
  db.exec(`
    CREATE TABLE dramas (
      id INTEGER PRIMARY KEY,
      deleted_at TEXT
    );
    CREATE TABLE story_sources (
      id INTEGER PRIMARY KEY,
      drama_id INTEGER,
      raw_text_path TEXT,
      deleted_at TEXT
    );
  `);
}

async function seedStorySource(workspace, relativePath, content) {
  const absolutePath = path.join(workspace.storySourcesPath, ...relativePath.split('/'));
  await fsp.mkdir(path.dirname(absolutePath), { recursive: true });
  await fsp.writeFile(absolutePath, content);
  return {
    absolutePath,
    rawTextPath: path.relative(workspace.root, absolutePath).replace(/\\/g, '/'),
  };
}

function insertStorySource(db, rawTextPath, deletedAt = null) {
  return db.prepare('INSERT INTO story_sources (raw_text_path, deleted_at) VALUES (?, ?)')
    .run(rawTextPath, deletedAt);
}

async function createFixtureBackup(t) {
  const workspace = await makeWorkspace(t);
  const db = createDatabase(workspace.databasePath, 'backup-state');
  await seedStorage(workspace.storagePath, 'backup');
  const result = await createDataBackup({ ...workspace, outputPath: workspace.archivePath, skipServiceCheck: true });
  db.close();
  return { ...workspace, result };
}

function expectCode(code) {
  return (error) => {
    assert.equal(error?.code, code);
    return true;
  };
}

test('creates a consistent frozen backup and restores database plus media', async (t) => {
  const workspace = await makeWorkspace(t);
  const liveDb = createDatabase(workspace.databasePath, 'snapshot-value');
  await seedStorage(workspace.storagePath, 'snapshot');

  const backup = await createDataBackup({ ...workspace, outputPath: workspace.archivePath, skipServiceCheck: true });
  assert.equal(backup.manifest.formatVersion, FORMAT_VERSION);
  assert.equal(backup.manifest.fileCount, 3);
  assert.equal(backup.manifest.storage.fileCount, 2);
  assert.equal(backup.manifest.storySources.fileCount, 0);
  assert.equal(backup.manifest.storySources.referenceCount, 0);
  assert.match(backup.manifest.storage.sha256, /^[a-f0-9]{64}$/);
  assert.match(backup.manifest.storySources.sha256, /^[a-f0-9]{64}$/);
  assert.match(backup.manifest.database.sha256, /^[a-f0-9]{64}$/);
  assert.ok(backup.archiveBytes > backup.manifest.totalBytes);

  const zip = new AdmZip(workspace.archivePath);
  assert.deepEqual(
    zip.getEntries().map((entry) => entry.entryName).sort(),
    ['database.sqlite', 'manifest.json', 'storage/images/cover.txt', 'storage/images/nested/clip.bin']
  );
  const archivedManifest = JSON.parse(zip.readAsText('manifest.json'));
  assert.deepEqual(archivedManifest, backup.manifest);
  liveDb.close();

  replaceDatabaseValue(workspace.databasePath, 'newer-live-value');
  await fsp.rm(workspace.storagePath, { recursive: true, force: true });
  await fsp.mkdir(workspace.storagePath, { recursive: true });
  await fsp.writeFile(path.join(workspace.storagePath, 'newer.txt'), 'newer-media');

  const restored = await restoreDataBackup({
    ...workspace,
    confirmed: true,
    skipServiceCheck: true,
  });
  assert.deepEqual(readDatabaseValues(workspace.databasePath), ['snapshot-value']);
  assert.equal(await fsp.readFile(path.join(workspace.storagePath, 'images', 'cover.txt'), 'utf8'), 'snapshot-cover');
  assert.deepEqual(
    await fsp.readFile(path.join(workspace.storagePath, 'images', 'nested', 'clip.bin')),
    Buffer.from([0, 1, 2, 3, 'snapshot'.length])
  );
  assert.equal(await fsp.stat(path.join(workspace.storagePath, 'newer.txt')).catch(() => null), null);
  assert.ok(restored.rollback.databasePath);
  assert.ok(restored.rollback.storagePath);
  assert.ok((await fsp.stat(restored.rollback.databasePath)).isFile());
  assert.ok((await fsp.stat(restored.rollback.storagePath)).isDirectory());
  if (process.platform !== 'win32') {
    assert.equal((await fsp.stat(workspace.archivePath)).mode & 0o777, 0o600);
  }
});

test('caller-owned archive handle is the sole restore source and remains open', async (t) => {
  const retained = await createFixtureBackup(t);
  const alternate = await makeWorkspace(t);
  const alternateDb = createDatabase(alternate.databasePath, 'alternate-state');
  await seedStorage(alternate.storagePath, 'alternate');
  const alternateBackup = await createDataBackup({
    ...alternate,
    outputPath: alternate.archivePath,
    skipServiceCheck: true,
  });
  alternateDb.close();

  replaceDatabaseValue(retained.databasePath, 'live-state');
  const archiveHandle = await fsp.open(retained.archivePath, 'r');
  const retainedAtAlternatePath = `${retained.archivePath}.retained`;
  const originalStat = archiveHandle.stat.bind(archiveHandle);
  let handleStatCalls = 0;
  archiveHandle.stat = async (...args) => {
    const stat = await originalStat(...args);
    handleStatCalls += 1;
    if (handleStatCalls === 1) {
      await fsp.rename(retained.archivePath, retainedAtAlternatePath);
      await fsp.copyFile(alternate.archivePath, retained.archivePath);
    }
    return stat;
  };

  try {
    await restoreDataBackup({
      ...retained,
      archiveHandle,
      confirmed: true,
      skipServiceCheck: true,
    });

    assert.ok(handleStatCalls >= 2, 'restore must validate and revalidate the caller-owned archive handle');
    assert.deepEqual(readDatabaseValues(retained.databasePath), ['backup-state']);
    assert.equal((await archiveHandle.stat()).isFile(), true, 'restore must not close a caller-owned archive handle');
    const pathManifest = JSON.parse(new AdmZip(retained.archivePath).readAsText('manifest.json'));
    assert.equal(pathManifest.database.sha256, alternateBackup.manifest.database.sha256);
    assert.notEqual(pathManifest.database.sha256, retained.result.manifest.database.sha256);
  } finally {
    await archiveHandle.close().catch(() => {});
  }
});

test('descriptor publication writes and verifies the caller-owned archive without closing descriptors', async (t) => {
  const workspace = await makeWorkspace(t);
  const liveDb = createDatabase(workspace.databasePath, 'descriptor-publication');
  await seedStorage(workspace.storagePath, 'descriptor-publication');
  liveDb.close();

  const publicationPath = path.join(workspace.root, 'archives', 'data.zip');
  const temporaryPath = path.join(workspace.root, 'archives', '.data.zip.retained.tmp');
  await fsp.mkdir(path.dirname(publicationPath), { recursive: true });
  const writeHandle = await fsp.open(temporaryPath, 'wx+', 0o600);
  const readHandle = await fsp.open(temporaryPath, 'r+');

  const readyMarkers = [];
  let result;
  try {
    result = await createDataBackup({
      ...workspace,
      skipServiceCheck: true,
      descriptorPublication: {
        readFd: readHandle.fd,
        writeFd: writeHandle.fd,
        publicationPath,
        publicationFile: 'data.zip',
        operationId: '0123456789abcdef0123456789abcdef',
        waitForPublication: async (marker) => {
          readyMarkers.push(marker);
          assert.equal(marker.phase, 'ready');
          assert.equal((await readHandle.stat()).isFile(), true);
          assert.equal((await writeHandle.stat()).isFile(), true);
          await fsp.rename(temporaryPath, publicationPath);
        },
      },
    });

    assert.equal((await readHandle.stat()).isFile(), true, 'the read descriptor must remain caller-owned');
    assert.equal((await writeHandle.stat()).isFile(), true, 'the write descriptor must remain caller-owned');
  } finally {
    await readHandle.close().catch(() => {});
    await writeHandle.close().catch(() => {});
  }

  assert.equal(readyMarkers.length, 1);
  assert.deepEqual(result.publication.ready, readyMarkers[0]);
  assert.equal(result.publication.committed.phase, 'committed');
  assert.equal(result.publication.committed.archive_sha256, result.publication.ready.archive_sha256);
  assert.equal(result.publication.committed.archive_bytes, String(result.archiveBytes));
  assert.equal(result.outputPath, publicationPath);
  assert.deepEqual(new AdmZip(publicationPath).getEntries().map((entry) => entry.entryName).sort(), [
    'database.sqlite',
    'manifest.json',
    'storage/images/cover.txt',
    'storage/images/nested/clip.bin',
  ]);
});

test('descriptor publication rejects the same archive bytes at a different filesystem identity', async (t) => {
  const workspace = await makeWorkspace(t);
  const liveDb = createDatabase(workspace.databasePath, 'descriptor-copy');
  await seedStorage(workspace.storagePath, 'descriptor-copy');
  liveDb.close();

  const publicationPath = path.join(workspace.root, 'archives', 'data.zip');
  const temporaryPath = path.join(workspace.root, 'archives', '.data.zip.copy-source.tmp');
  await fsp.mkdir(path.dirname(publicationPath), { recursive: true });
  const writeHandle = await fsp.open(temporaryPath, 'wx+', 0o600);
  const readHandle = await fsp.open(temporaryPath, 'r+');

  try {
    await assert.rejects(
      createDataBackup({
        ...workspace,
        skipServiceCheck: true,
        descriptorPublication: {
          readFd: readHandle.fd,
          writeFd: writeHandle.fd,
          publicationPath,
          publicationFile: 'data.zip',
          operationId: '11111111111111111111111111111111',
          waitForPublication: async () => {
            await fsp.copyFile(temporaryPath, publicationPath);
          },
        },
      }),
      expectCode('PUBLICATION_IDENTITY_MISMATCH')
    );
    assert.equal((await readHandle.stat()).isFile(), true);
    assert.equal((await writeHandle.stat()).isFile(), true);
  } finally {
    await readHandle.close().catch(() => {});
    await writeHandle.close().catch(() => {});
  }
});

test('descriptor publication rejects changed bytes at the retained filesystem identity', async (t) => {
  const workspace = await makeWorkspace(t);
  const liveDb = createDatabase(workspace.databasePath, 'descriptor-mutation');
  await seedStorage(workspace.storagePath, 'descriptor-mutation');
  liveDb.close();

  const publicationPath = path.join(workspace.root, 'archives', 'data.zip');
  const temporaryPath = path.join(workspace.root, 'archives', '.data.zip.mutation.tmp');
  await fsp.mkdir(path.dirname(publicationPath), { recursive: true });
  const writeHandle = await fsp.open(temporaryPath, 'wx+', 0o600);
  const readHandle = await fsp.open(temporaryPath, 'r+');

  try {
    await assert.rejects(
      createDataBackup({
        ...workspace,
        skipServiceCheck: true,
        descriptorPublication: {
          readFd: readHandle.fd,
          writeFd: writeHandle.fd,
          publicationPath,
          publicationFile: 'data.zip',
          operationId: '22222222222222222222222222222222',
          waitForPublication: async () => {
            await fsp.rename(temporaryPath, publicationPath);
            await writeHandle.write(Buffer.from([0x00]), 0, 1, 0);
            await writeHandle.sync();
          },
        },
      }),
      expectCode('PUBLICATION_CONTENT_MISMATCH')
    );
    assert.equal((await readHandle.stat()).isFile(), true);
    assert.equal((await writeHandle.stat()).isFile(), true);
  } finally {
    await readHandle.close().catch(() => {});
    await writeHandle.close().catch(() => {});
  }
});

test('descriptor physical identity uses canonical unsigned Windows-width fields', () => {
  assert.equal(
    __testing.canonicalPhysicalIdentity({ dev: -1n, ino: -1n }),
    'ffffffff:ffffffffffffffff'
  );
  assert.equal(
    __testing.canonicalPhysicalIdentity({ dev: 0x1234n, ino: 0x5678n }),
    '00001234:0000000000005678'
  );
});

test('backs up, hashes, and atomically restores Source Intake raw text', async (t) => {
  const workspace = await makeWorkspace(t);
  const db = createDatabase(workspace.databasePath, 'source-snapshot');
  createStorySourcesTable(db);
  const source = await seedStorySource(workspace, '7/source.txt', 'original source text');
  insertStorySource(db, source.rawTextPath);

  const backup = await createDataBackup({
    ...workspace,
    outputPath: workspace.archivePath,
    skipServiceCheck: true,
  });
  assert.equal(backup.manifest.storySources.fileCount, 1);
  assert.equal(backup.manifest.storySources.referenceCount, 1);
  assert.equal(backup.manifest.storySources.totalBytes, Buffer.byteLength('original source text'));
  assert.match(backup.manifest.storySources.sha256, /^[a-f0-9]{64}$/);
  assert.ok(new AdmZip(workspace.archivePath).getEntry('story_sources/7/source.txt'));
  db.close();

  await fsp.writeFile(source.absolutePath, 'mutated source text');
  await fsp.writeFile(path.join(workspace.storySourcesPath, 'live-only.txt'), 'live only');
  const restored = await restoreDataBackup({
    ...workspace,
    confirmed: true,
    skipServiceCheck: true,
  });

  assert.equal(await fsp.readFile(source.absolutePath, 'utf8'), 'original source text');
  assert.equal(await fsp.stat(path.join(workspace.storySourcesPath, 'live-only.txt')).catch(() => null), null);
  assert.ok(restored.rollback.storySourcesPath);
  assert.equal(
    await fsp.readFile(path.join(restored.rollback.storySourcesPath, 'live-only.txt'), 'utf8'),
    'live only'
  );
});

test('fails closed for missing or escaping active source-text references without changing records', async (t) => {
  const workspace = await makeWorkspace(t);
  const db = createDatabase(workspace.databasePath, 'invalid-source-reference');
  createStorySourcesTable(db);
  for (let index = 1; index <= 4; index += 1) {
    const source = await seedStorySource(workspace, `${index}/source.txt`, `source ${index}`);
    insertStorySource(db, source.rawTextPath);
  }
  const missingPath = 'live/story_sources/8/missing.txt';
  insertStorySource(db, missingPath);

  await assert.rejects(
    createDataBackup({ ...workspace, outputPath: workspace.archivePath, skipServiceCheck: true }),
    expectCode('SOURCE_TEXT_MISSING')
  );
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM story_sources').get().count, 5);
  assert.equal(await fsp.stat(workspace.archivePath).catch(() => null), null);

  db.prepare('UPDATE story_sources SET raw_text_path = ? WHERE id = 1').run('outside/source.txt');
  await assert.rejects(
    createDataBackup({ ...workspace, outputPath: workspace.archivePath, skipServiceCheck: true }),
    expectCode('SOURCE_TEXT_REFERENCE_INVALID')
  );
  assert.equal(db.prepare('SELECT raw_text_path FROM story_sources WHERE id = 1').get().raw_text_path, 'outside/source.txt');
  assert.equal(await fsp.stat(workspace.archivePath).catch(() => null), null);
  db.close();
});

test('ignores missing source references owned by soft-deleted dramas', async (t) => {
  const workspace = await makeWorkspace(t);
  const db = createDatabase(workspace.databasePath, 'trashed-source-reference');
  createProjectStorySourcesTables(db);
  db.prepare('INSERT INTO dramas (id, deleted_at) VALUES (?, ?)').run(1, null);
  db.prepare('INSERT INTO dramas (id, deleted_at) VALUES (?, ?)').run(2, new Date().toISOString());
  const activeSource = await seedStorySource(workspace, '1/source.txt', 'active source text');
  db.prepare('INSERT INTO story_sources (drama_id, raw_text_path, deleted_at) VALUES (?, ?, NULL)')
    .run(1, activeSource.rawTextPath);
  db.prepare('INSERT INTO story_sources (drama_id, raw_text_path, deleted_at) VALUES (?, ?, NULL)')
    .run(2, 'live/story_sources/2/missing.txt');

  const backup = await createDataBackup({
    ...workspace,
    outputPath: workspace.archivePath,
    skipServiceCheck: true,
  });
  assert.equal(backup.manifest.storySources.referenceCount, 1);
  assert.equal(backup.manifest.storySources.fileCount, 1);
  db.close();
});

test('still rejects a missing source reference owned by an active drama', async (t) => {
  const workspace = await makeWorkspace(t);
  const db = createDatabase(workspace.databasePath, 'active-source-reference');
  createProjectStorySourcesTables(db);
  db.prepare('INSERT INTO dramas (id, deleted_at) VALUES (?, NULL)').run(1);
  db.prepare('INSERT INTO story_sources (drama_id, raw_text_path, deleted_at) VALUES (?, ?, NULL)')
    .run(1, 'live/story_sources/1/missing.txt');

  await assert.rejects(
    createDataBackup({ ...workspace, outputPath: workspace.archivePath, skipServiceCheck: true }),
    expectCode('SOURCE_TEXT_MISSING')
  );
  db.close();
});

test('ignores deleted source-text references but still backs up regular orphan files', async (t) => {
  const workspace = await makeWorkspace(t);
  const db = createDatabase(workspace.databasePath, 'deleted-source-reference');
  createStorySourcesTable(db);
  insertStorySource(db, 'live/story_sources/deleted/missing.txt', new Date().toISOString());
  await seedStorySource(workspace, 'orphan.txt', 'retained orphan source');

  const backup = await createDataBackup({
    ...workspace,
    outputPath: workspace.archivePath,
    skipServiceCheck: true,
  });
  assert.equal(backup.manifest.storySources.referenceCount, 0);
  assert.equal(backup.manifest.storySources.fileCount, 1);
  db.close();
});

test('rejects overlapping storage and source-text targets', async (t) => {
  const workspace = await makeWorkspace(t);
  const db = createDatabase(workspace.databasePath, 'overlapping-targets');
  await assert.rejects(
    createDataBackup({
      ...workspace,
      storySourcesPath: path.join(workspace.storagePath, 'story_sources'),
      outputPath: workspace.archivePath,
      skipServiceCheck: true,
    }),
    expectCode('UNSAFE_TARGET')
  );
  db.close();
});

test('backs up and restores a rollback-journal database while holding the freeze lock', async (t) => {
  const workspace = await makeWorkspace(t);
  const db = new Database(workspace.databasePath);
  assert.equal(String(db.pragma('journal_mode', { simple: true })).toLowerCase(), 'delete');
  db.exec('CREATE TABLE records (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
  db.prepare('INSERT INTO records (value) VALUES (?)').run('rollback-journal-value');
  db.close();
  await seedStorage(workspace.storagePath, 'rollback-journal');

  await createDataBackup({ ...workspace, outputPath: workspace.archivePath, skipServiceCheck: true });
  replaceDatabaseValue(workspace.databasePath, 'mutated-value');
  await fsp.writeFile(path.join(workspace.storagePath, 'images', 'cover.txt'), 'mutated-cover');

  await restoreDataBackup({ ...workspace, confirmed: true, skipServiceCheck: true });
  assert.deepEqual(readDatabaseValues(workspace.databasePath), ['rollback-journal-value']);
  assert.equal(
    await fsp.readFile(path.join(workspace.storagePath, 'images', 'cover.txt'), 'utf8'),
    'rollback-journal-cover'
  );
});

test('rejects a database payload whose manifest hash was not updated', async (t) => {
  const workspace = await createFixtureBackup(t);
  const tamperedPath = path.join(workspace.root, 'archives', 'tampered.zip');
  const zip = new AdmZip(workspace.archivePath);
  const tamperedDatabase = Buffer.from(zip.readFile('database.sqlite'));
  tamperedDatabase[Math.floor(tamperedDatabase.length / 2)] ^= 0xff;
  zip.updateFile(zip.getEntry('database.sqlite'), tamperedDatabase);
  zip.writeZip(tamperedPath);

  await assert.rejects(
    restoreDataBackup({
      ...workspace,
      archivePath: tamperedPath,
      confirmed: true,
      skipServiceCheck: true,
    }),
    expectCode('DATABASE_HASH_MISMATCH')
  );
  assert.deepEqual(readDatabaseValues(workspace.databasePath), ['backup-state']);
});

test('preserves current source text when restoring a legacy archive without story_sources', async (t) => {
  const workspace = await makeWorkspace(t);
  const db = createDatabase(workspace.databasePath, 'legacy-backup');
  await seedStorage(workspace.storagePath, 'legacy');
  await createDataBackup({ ...workspace, outputPath: workspace.archivePath, skipServiceCheck: true });
  db.close();

  const legacyPath = path.join(workspace.root, 'archives', 'legacy.zip');
  const zip = new AdmZip(workspace.archivePath);
  const manifest = JSON.parse(zip.readAsText('manifest.json'));
  manifest.formatVersion = 1;
  delete manifest.storage.sha256;
  delete manifest.storySources;
  zip.updateFile(zip.getEntry('manifest.json'), Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`));
  zip.writeZip(legacyPath);

  const currentSource = await seedStorySource(workspace, 'current/source.txt', 'must survive legacy restore');
  await restoreDataBackup({
    ...workspace,
    archivePath: legacyPath,
    confirmed: true,
    skipServiceCheck: true,
  });
  assert.equal(await fsp.readFile(currentSource.absolutePath, 'utf8'), 'must survive legacy restore');
});

test('rejects source-text content tampering even when ZIP CRC metadata is rewritten', async (t) => {
  const workspace = await makeWorkspace(t);
  const db = createDatabase(workspace.databasePath, 'source-tamper');
  createStorySourcesTable(db);
  const source = await seedStorySource(workspace, '9/source.txt', 'trusted source payload');
  insertStorySource(db, source.rawTextPath);
  await createDataBackup({ ...workspace, outputPath: workspace.archivePath, skipServiceCheck: true });
  db.close();

  const tamperedPath = path.join(workspace.root, 'archives', 'source-tampered.zip');
  const zip = new AdmZip(workspace.archivePath);
  zip.updateFile(zip.getEntry('story_sources/9/source.txt'), Buffer.from('forged! source payload'));
  zip.writeZip(tamperedPath);
  await fsp.writeFile(source.absolutePath, 'current source remains');

  await assert.rejects(
    restoreDataBackup({
      ...workspace,
      archivePath: tamperedPath,
      confirmed: true,
      skipServiceCheck: true,
    }),
    expectCode('SOURCE_TEXT_HASH_MISMATCH')
  );
  assert.equal(await fsp.readFile(source.absolutePath, 'utf8'), 'current source remains');
});

test('rejects media content tampering even when size and ZIP CRC are rewritten', async (t) => {
  const workspace = await createFixtureBackup(t);
  const tamperedPath = path.join(workspace.root, 'archives', 'storage-tampered.zip');
  const zip = new AdmZip(workspace.archivePath);
  const entry = zip.getEntry('storage/images/cover.txt');
  const original = zip.readFile(entry);
  zip.updateFile(entry, Buffer.alloc(original.length, 0x58));
  zip.writeZip(tamperedPath);
  const currentPath = path.join(workspace.storagePath, 'images', 'cover.txt');
  await fsp.writeFile(currentPath, 'current-media');

  await assert.rejects(
    restoreDataBackup({
      ...workspace,
      archivePath: tamperedPath,
      confirmed: true,
      skipServiceCheck: true,
    }),
    expectCode('STORAGE_HASH_MISMATCH')
  );
  assert.equal(await fsp.readFile(currentPath, 'utf8'), 'current-media');
});

test('rejects traversing and symbolic-link story_sources ZIP entries', async (t) => {
  const workspace = await makeWorkspace(t);
  const db = createDatabase(workspace.databasePath, 'source-path-safety');
  createStorySourcesTable(db);
  const source = await seedStorySource(workspace, '10/source.txt', 'safe source');
  insertStorySource(db, source.rawTextPath);
  await createDataBackup({ ...workspace, outputPath: workspace.archivePath, skipServiceCheck: true });
  db.close();

  const traversalPath = path.join(workspace.root, 'archives', 'source-traversal.zip');
  const traversalZip = new AdmZip(workspace.archivePath);
  traversalZip.getEntry('story_sources/10/source.txt').entryName = 'story_sources/../../outside-source.txt';
  traversalZip.writeZip(traversalPath);
  await assert.rejects(
    restoreDataBackup({
      ...workspace,
      archivePath: traversalPath,
      confirmed: true,
      skipServiceCheck: true,
    }),
    expectCode('UNSAFE_ARCHIVE_PATH')
  );
  assert.equal(await fsp.stat(path.join(workspace.root, 'outside-source.txt')).catch(() => null), null);

  const symlinkPath = path.join(workspace.root, 'archives', 'source-symlink.zip');
  const symlinkZip = new AdmZip(workspace.archivePath);
  symlinkZip.getEntry('story_sources/10/source.txt').attr = (0o120777 << 16) >>> 0;
  symlinkZip.writeZip(symlinkPath);
  await assert.rejects(
    restoreDataBackup({
      ...workspace,
      archivePath: symlinkPath,
      confirmed: true,
      skipServiceCheck: true,
    }),
    expectCode('SYMLINK_REJECTED')
  );
});

test('applies file-count, single-file, and compression-ratio limits to story_sources', async (t) => {
  const workspace = await makeWorkspace(t);
  const db = createDatabase(workspace.databasePath, 'source-limits');
  await seedStorySource(workspace, 'limits/one.txt', 'one');
  await seedStorySource(workspace, 'limits/two.txt', 'two');
  await assert.rejects(
    createDataBackup({
      ...workspace,
      outputPath: workspace.archivePath,
      skipServiceCheck: true,
      limits: { maxFiles: 1 },
    }),
    expectCode('FILE_LIMIT_EXCEEDED')
  );

  await fsp.rm(path.join(workspace.storySourcesPath, 'limits', 'two.txt'));
  await fsp.writeFile(path.join(workspace.storySourcesPath, 'limits', 'one.txt'), Buffer.alloc(128 * 1024, 0x41));
  await assert.rejects(
    createDataBackup({
      ...workspace,
      outputPath: workspace.archivePath,
      skipServiceCheck: true,
      limits: { maxFileBytes: 64 * 1024 },
    }),
    expectCode('FILE_LIMIT_EXCEEDED')
  );

  await createDataBackup({ ...workspace, outputPath: workspace.archivePath, skipServiceCheck: true });
  db.close();
  const compressedPath = path.join(workspace.root, 'archives', 'compressed-source.zip');
  const sourceZip = new AdmZip(workspace.archivePath);
  const compressedZip = new AdmZip();
  for (const entry of sourceZip.getEntries()) {
    compressedZip.addFile(entry.entryName, sourceZip.readFile(entry));
  }
  compressedZip.writeZip(compressedPath);
  await assert.rejects(
    restoreDataBackup({
      ...workspace,
      archivePath: compressedPath,
      confirmed: true,
      skipServiceCheck: true,
      limits: { maxCompressionRatio: 2 },
    }),
    expectCode('COMPRESSION_LIMIT_EXCEEDED')
  );
});

test('rejects traversal paths and symbolic-link ZIP entries', async (t) => {
  const workspace = await createFixtureBackup(t);
  const sourceZip = new AdmZip(workspace.archivePath);
  const manifest = sourceZip.readFile('manifest.json');
  const database = sourceZip.readFile('database.sqlite');

  const traversalPath = path.join(workspace.root, 'archives', 'traversal.zip');
  const traversalZip = new AdmZip();
  traversalZip.addFile('manifest.json', manifest);
  traversalZip.addFile('database.sqlite', database);
  const traversalEntry = traversalZip.addFile('storage/safe.txt', Buffer.from('escape'));
  traversalEntry.entryName = 'storage/../../outside.txt';
  traversalZip.writeZip(traversalPath);
  await assert.rejects(
    restoreDataBackup({
      ...workspace,
      archivePath: traversalPath,
      confirmed: true,
      skipServiceCheck: true,
    }),
    expectCode('UNSAFE_ARCHIVE_PATH')
  );
  assert.equal(await fsp.stat(path.join(workspace.root, 'outside.txt')).catch(() => null), null);

  const symlinkPath = path.join(workspace.root, 'archives', 'symlink.zip');
  const symlinkZip = new AdmZip();
  symlinkZip.addFile('manifest.json', manifest);
  symlinkZip.addFile('database.sqlite', database);
  const symlinkEntry = symlinkZip.addFile('storage/link.txt', Buffer.from('../outside.txt'));
  symlinkEntry.attr = (0o120777 << 16) >>> 0;
  symlinkZip.writeZip(symlinkPath);
  await assert.rejects(
    restoreDataBackup({
      ...workspace,
      archivePath: symlinkPath,
      confirmed: true,
      skipServiceCheck: true,
    }),
    expectCode('SYMLINK_REJECTED')
  );
});

test('requires confirmation and refuses a running service or locked database', async (t) => {
  const workspace = await createFixtureBackup(t);
  await assert.rejects(
    restoreDataBackup({ ...workspace, skipServiceCheck: true }),
    expectCode('CONFIRMATION_REQUIRED')
  );

  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await assert.rejects(
    restoreDataBackup({
      ...workspace,
      confirmed: true,
      serviceHost: '127.0.0.1',
      servicePort: server.address().port,
    }),
    expectCode('SERVICE_RUNNING')
  );
  await new Promise((resolve) => server.close(resolve));

  const locker = new Database(workspace.databasePath);
  locker.exec('BEGIN EXCLUSIVE');
  try {
    await assert.rejects(
      restoreDataBackup({
        ...workspace,
        confirmed: true,
        skipServiceCheck: true,
      }),
      expectCode('DATABASE_BUSY')
    );
  } finally {
    locker.exec('ROLLBACK');
    locker.close();
  }
});

test('enforces backup file-count and restore total-size limits', async (t) => {
  const workspace = await makeWorkspace(t);
  const db = createDatabase(workspace.databasePath, 'limited-state');
  await seedStorage(workspace.storagePath, 'limited');
  await assert.rejects(
    createDataBackup({
      ...workspace,
      outputPath: workspace.archivePath,
      skipServiceCheck: true,
      limits: { maxFiles: 1 },
    }),
    expectCode('FILE_LIMIT_EXCEEDED')
  );

  const backup = await createDataBackup({ ...workspace, outputPath: workspace.archivePath, skipServiceCheck: true });
  db.close();
  await assert.rejects(
    restoreDataBackup({
      ...workspace,
      confirmed: true,
      skipServiceCheck: true,
      limits: { maxTotalBytes: backup.manifest.totalBytes - 1 },
    }),
    expectCode('SIZE_LIMIT_EXCEEDED')
  );
});

test('rolls back database and storage when replacement fails after both targets move', async (t) => {
  const workspace = await createFixtureBackup(t);
  replaceDatabaseValue(workspace.databasePath, 'pre-restore-live-value');
  await fsp.rm(workspace.storagePath, { recursive: true, force: true });
  await fsp.mkdir(workspace.storagePath, { recursive: true });
  await fsp.writeFile(path.join(workspace.storagePath, 'live-only.txt'), 'pre-restore-media');

  await assert.rejects(
    restoreDataBackup({
      ...workspace,
      confirmed: true,
      skipServiceCheck: true,
      faultInjector(step) {
        if (step === 'after-targets-replaced') throw new Error('injected failure');
      },
    }),
    expectCode('RESTORE_FAILED')
  );

  assert.deepEqual(readDatabaseValues(workspace.databasePath), ['pre-restore-live-value']);
  assert.equal(await fsp.readFile(path.join(workspace.storagePath, 'live-only.txt'), 'utf8'), 'pre-restore-media');
  assert.equal(await fsp.stat(path.join(workspace.storagePath, 'images')).catch(() => null), null);
  const liveDirectoryEntries = await fsp.readdir(path.dirname(workspace.databasePath));
  assert.deepEqual(liveDirectoryEntries.filter((name) => name.includes('restore-incoming')), []);
  assert.deepEqual(liveDirectoryEntries.filter((name) => name.includes('restore-original')), []);
  assert.equal(liveDirectoryEntries.some((name) => name.endsWith('.restore.lock')), false);
});

test('rolls back source text with database and storage after a failed replacement', async (t) => {
  const workspace = await makeWorkspace(t);
  const db = createDatabase(workspace.databasePath, 'source-backup-state');
  createStorySourcesTable(db);
  const source = await seedStorySource(workspace, '11/source.txt', 'backup source state');
  insertStorySource(db, source.rawTextPath);
  await seedStorage(workspace.storagePath, 'source-backup');
  await createDataBackup({ ...workspace, outputPath: workspace.archivePath, skipServiceCheck: true });
  db.close();

  replaceDatabaseValue(workspace.databasePath, 'source-live-state');
  await fsp.writeFile(source.absolutePath, 'live source state');
  await fsp.writeFile(path.join(workspace.storySourcesPath, 'live-only.txt'), 'live source only');
  await assert.rejects(
    restoreDataBackup({
      ...workspace,
      confirmed: true,
      skipServiceCheck: true,
      faultInjector(step) {
        if (step === 'after-targets-replaced') throw new Error('injected source restore failure');
      },
    }),
    expectCode('RESTORE_FAILED')
  );

  assert.deepEqual(readDatabaseValues(workspace.databasePath), ['source-live-state']);
  assert.equal(await fsp.readFile(source.absolutePath, 'utf8'), 'live source state');
  assert.equal(
    await fsp.readFile(path.join(workspace.storySourcesPath, 'live-only.txt'), 'utf8'),
    'live source only'
  );
});

test('excludes provider credentials from backups by default', async (t) => {
  const workspace = await makeWorkspace(t);
  const db = createDatabase(workspace.databasePath, 'secret-policy');
  const syntheticApiMarker = `LMD_SYNTHETIC_BACKUP_API_${'A'.repeat(96)}`;
  const syntheticTokenMarker = `LMD_SYNTHETIC_BACKUP_TOKEN_${'T'.repeat(96)}`;
  const syntheticUrlMarker = `LMD_SYNTHETIC_BACKUP_URL_${'U'.repeat(96)}`;
  const syntheticSigMarker = `LMD_SYNTHETIC_BACKUP_SIG_${'S'.repeat(96)}`;
  const syntheticCredentialMarker = `LMD_SYNTHETIC_BACKUP_CREDENTIAL_${'C'.repeat(96)}`;
  const syntheticBypassMarker = `LMD_SYNTHETIC_BACKUP_BYPASS_${'B'.repeat(96)}`;
  const syntheticHeaderMarker = `LMD_SYNTHETIC_BACKUP_HEADER_${'H'.repeat(96)}`;
  const syntheticTableMarker = `LMD_SYNTHETIC_BACKUP_TABLE_${'R'.repeat(96)}`;
  const syntheticGlobalTopMarker = `LMD_SYNTHETIC_GLOBAL_TOP_${'G'.repeat(96)}`;
  const syntheticGlobalNestedMarker = `LMD_SYNTHETIC_GLOBAL_NESTED_${'N'.repeat(96)}`;
  db.exec(`CREATE TABLE ai_service_configs (
    id INTEGER PRIMARY KEY,
    api_key TEXT,
    base_url TEXT,
    endpoint TEXT,
    query_endpoint TEXT,
    settings TEXT
  )`);
  db.exec(`CREATE TABLE global_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE image_generations (id INTEGER PRIMARY KEY, image_url TEXT);
  CREATE TABLE async_tasks (id INTEGER PRIMARY KEY, result TEXT);
  CREATE TABLE image_proxy_cache (id INTEGER PRIMARY KEY, proxy_url TEXT);
  CREATE TABLE provider_invocations (id INTEGER PRIMARY KEY, output_json TEXT, error_message TEXT)`);
  db.prepare(`INSERT INTO ai_service_configs
    (api_key, base_url, endpoint, query_endpoint, settings)
    VALUES (?, ?, ?, ?, ?)`
  ).run(
    `${syntheticApiMarker}${'x'.repeat(16 * 1024)}`,
    `https://user:${syntheticUrlMarker}@provider.example/v1?sig=${syntheticSigMarker}#fragment`,
    `/chat/completions?sig=${syntheticSigMarker}&api-version=2026-01-01`,
    `/tasks/{taskId}?credential=${syntheticCredentialMarker}&view=summary`,
    JSON.stringify({
      headers: {
        Authorization: 'Bearer hidden',
        'X-Auth': syntheticHeaderMarker,
        Accept: 'application/json',
      },
      header_list: [
        { name: 'Authentication', value: syntheticHeaderMarker },
        { name: 'Content-Type', value: 'application/json' },
      ],
      nested: {
        token: `${syntheticTokenMarker}${'y'.repeat(16 * 1024)}`,
        accessToken: 'hidden-access-token',
        refreshToken: 'hidden-refresh-token',
        maxTokens: 4096,
      },
      sig: syntheticSigMarker,
      credential: syntheticCredentialMarker,
      callback_url: `https://callback.example/result?sig=${syntheticSigMarker}`,
      protocol_relative_url: `//user:pass@callback.example/result?sig=${syntheticSigMarker}`,
      bare_relative_url: `v1/events?sig=${syntheticSigMarker}&view=summary`,
      embedded_url: `callback=v1/events?sig=${syntheticSigMarker}&view=summary`,
      bare_query_url: `events?sig=${syntheticBypassMarker}`,
      assignment_url: `callback=events?unknown=${syntheticBypassMarker}`,
      bracketed_protocol_url: `note:[//user:pass@callback.example/result?sig=${syntheticBypassMarker}]`,
      colon_prefixed_url: `note:v1/events?sig=${syntheticBypassMarker}`,
      quality: 'high',
    })
  );
  const insertGlobalSetting = db.prepare(
    'INSERT INTO global_settings (key, value, updated_at) VALUES (?, ?, ?)'
  );
  insertGlobalSetting.run(
    'provider_access_token',
    JSON.stringify(`${syntheticGlobalTopMarker}${'g'.repeat(16 * 1024)}`),
    '2026-07-16T12:00:00.000Z'
  );
  db.prepare('INSERT INTO image_generations (image_url) VALUES (?)')
    .run(`https://images.example/frame.png?sig=${syntheticTableMarker}`);
  db.prepare('INSERT INTO async_tasks (result) VALUES (?)')
    .run(JSON.stringify({ output_url: `https://tasks.example/result?token=${syntheticTableMarker}` }));
  db.prepare('INSERT INTO image_proxy_cache (proxy_url) VALUES (?)')
    .run(`https://proxy.example/image.png?key=${syntheticTableMarker}`);
  db.prepare('INSERT INTO provider_invocations (output_json, error_message) VALUES (?, ?)').run(
    JSON.stringify({ media_url: `https://provider.example/media?signature=${syntheticTableMarker}` }),
    `Authorization=Bearer ${syntheticTableMarker}`
  );
  insertGlobalSetting.run(
    'render_preferences',
    JSON.stringify({
      provider: {
        client_secret: `${syntheticGlobalNestedMarker}${'n'.repeat(16 * 1024)}`,
        callback_url: `https://global.example/result?sig=${syntheticSigMarker}`,
        embedded_relative_url: `note:v1/events?unknown=${syntheticBypassMarker}`,
      },
      maxTokens: 4096,
      quality: 'high',
    }),
    '2026-07-16T12:00:00.000Z'
  );
  db.pragma('wal_checkpoint(TRUNCATE)');
  const sourceBytes = fs.readFileSync(workspace.databasePath);
  assert.equal(sourceBytes.includes(Buffer.from(syntheticApiMarker)), true);
  assert.equal(sourceBytes.includes(Buffer.from(syntheticTokenMarker)), true);
  assert.equal(sourceBytes.includes(Buffer.from(syntheticUrlMarker)), true);
  assert.equal(sourceBytes.includes(Buffer.from(syntheticSigMarker)), true);
  assert.equal(sourceBytes.includes(Buffer.from(syntheticCredentialMarker)), true);
  assert.equal(sourceBytes.includes(Buffer.from(syntheticGlobalTopMarker)), true);
  assert.equal(sourceBytes.includes(Buffer.from(syntheticGlobalNestedMarker)), true);

  const backup = await createDataBackup({
    ...workspace,
    outputPath: workspace.archivePath,
    skipServiceCheck: true,
  });
  assert.equal(backup.security.policy, 'excluded');
  db.close();

  const zip = new AdmZip(workspace.archivePath);
  const snapshotBytes = zip.readFile('database.sqlite');
  assert.equal(snapshotBytes.includes(Buffer.from(syntheticApiMarker)), false);
  assert.equal(snapshotBytes.includes(Buffer.from(syntheticTokenMarker)), false);
  assert.equal(snapshotBytes.includes(Buffer.from(syntheticUrlMarker)), false);
  assert.equal(snapshotBytes.includes(Buffer.from(syntheticSigMarker)), false);
  assert.equal(snapshotBytes.includes(Buffer.from(syntheticCredentialMarker)), false);
  assert.equal(snapshotBytes.includes(Buffer.from(syntheticBypassMarker)), false);
  assert.equal(snapshotBytes.includes(Buffer.from(syntheticHeaderMarker)), false);
  assert.equal(snapshotBytes.includes(Buffer.from(syntheticTableMarker)), false);
  assert.equal(snapshotBytes.includes(Buffer.from(syntheticGlobalTopMarker)), false);
  assert.equal(snapshotBytes.includes(Buffer.from(syntheticGlobalNestedMarker)), false);
  assert.equal(
    zip.getEntries().some((entry) => /database\.sqlite-(?:journal|wal|shm)$/.test(entry.entryName)),
    false
  );
  const snapshotPath = path.join(workspace.root, 'snapshot-without-secrets.db');
  await fsp.writeFile(snapshotPath, snapshotBytes);
  const snapshot = new Database(snapshotPath, { readonly: true });
  const row = snapshot.prepare(
    'SELECT api_key, base_url, endpoint, query_endpoint, settings FROM ai_service_configs'
  ).get();
  const rawGlobalTop = snapshot.prepare('SELECT value FROM global_settings WHERE key = ?')
    .get('provider_access_token');
  const globalTop = getGlobalSetting(snapshot, 'provider_access_token', 'missing');
  const globalNested = getGlobalSetting(snapshot, 'render_preferences', null);
  const imageGeneration = snapshot.prepare('SELECT image_url FROM image_generations').get();
  const asyncTask = snapshot.prepare('SELECT result FROM async_tasks').get();
  const proxyCache = snapshot.prepare('SELECT proxy_url FROM image_proxy_cache').get();
  const providerInvocation = snapshot.prepare('SELECT output_json, error_message FROM provider_invocations').get();
  assert.equal(snapshot.pragma('freelist_count', { simple: true }), 0);
  snapshot.close();
  assert.equal(row.api_key, '');
  assert.equal(row.base_url, 'https://provider.example/v1');
  assert.equal(row.endpoint, '/chat/completions?api-version=2026-01-01');
  assert.equal(row.query_endpoint, '/tasks/{taskId}?view=summary');
  const settings = JSON.parse(row.settings);
  assert.equal(settings.headers.Authorization, '');
  assert.equal(settings.headers['X-Auth'], '');
  assert.equal(settings.headers.Accept, 'application/json');
  assert.equal(settings.header_list[0].name, 'Authentication');
  assert.equal(settings.header_list[0].value, '');
  assert.equal(settings.header_list[1].value, 'application/json');
  assert.equal(settings.nested.token, '');
  assert.equal(settings.nested.accessToken, '');
  assert.equal(settings.nested.refreshToken, '');
  assert.equal(settings.nested.maxTokens, 4096);
  assert.equal(settings.sig, '');
  assert.equal(settings.credential, '');
  assert.equal(settings.callback_url, 'https://callback.example/result');
  assert.equal(settings.protocol_relative_url, '//callback.example/result');
  assert.equal(settings.bare_relative_url, 'v1/events?view=summary');
  assert.equal(settings.embedded_url, 'callback=v1/events?view=summary');
  assert.equal(settings.bare_query_url, 'events');
  assert.equal(settings.assignment_url, 'callback=events');
  assert.equal(settings.bracketed_protocol_url, 'note:[//callback.example/result]');
  assert.equal(settings.colon_prefixed_url, 'note:v1/events');
  assert.equal(settings.quality, 'high');
  assert.equal(rawGlobalTop.value, JSON.stringify(''));
  assert.equal(globalTop, '');
  assert.equal(globalNested.provider.client_secret, '');
  assert.equal(globalNested.provider.callback_url, 'https://global.example/result');
  assert.equal(globalNested.provider.embedded_relative_url, 'note:v1/events');
  assert.equal(globalNested.maxTokens, 4096);
  assert.equal(globalNested.quality, 'high');
  assert.equal(imageGeneration.image_url, 'https://images.example/frame.png');
  assert.equal(JSON.parse(asyncTask.result).output_url, 'https://tasks.example/result');
  assert.equal(proxyCache.proxy_url, 'https://proxy.example/image.png');
  assert.equal(JSON.parse(providerInvocation.output_json).media_url, 'https://provider.example/media');
  assert.equal(providerInvocation.error_message.includes(syntheticTableMarker), false);
});

test('excludes nested custom-provider secret aliases from backups by default', async (t) => {
  const workspace = await makeWorkspace(t);
  const db = createDatabase(workspace.databasePath, 'nested-secret-alias-policy');
  const secretMarker = `LMD_NESTED_PROVIDER_SECRET_ALIAS_${'Z'.repeat(96)}`;
  db.exec(`CREATE TABLE ai_service_configs (
    id INTEGER PRIMARY KEY,
    settings TEXT
  )`);
  db.prepare('INSERT INTO ai_service_configs (settings) VALUES (?)').run(JSON.stringify({
    provider_name: 'custom-safe-provider',
    key: `${secretMarker}:key`,
    nested: {
      keys: [`${secretMarker}:keys-array`, { value: `${secretMarker}:keys-object` }],
      region: 'cn-north-1',
    },
    transports: [
      { passwd: `${secretMarker}:passwd`, timeout_ms: 1200 },
      {
        tls: { passphrase: `${secretMarker}:passphrase`, verify_peer: true },
        retry_count: 3,
      },
    ],
    models: ['safe-model-a'],
  }));
  db.pragma('wal_checkpoint(TRUNCATE)');
  assert.equal(fs.readFileSync(workspace.databasePath).includes(Buffer.from(secretMarker)), true);

  const backup = await createDataBackup({
    ...workspace,
    outputPath: workspace.archivePath,
    skipServiceCheck: true,
  });
  assert.equal(backup.security.policy, 'excluded');
  db.close();

  const snapshotBytes = new AdmZip(workspace.archivePath).readFile('database.sqlite');
  assert.equal(snapshotBytes.includes(Buffer.from(secretMarker)), false);
  const snapshotPath = path.join(workspace.root, 'snapshot-without-nested-secret-aliases.db');
  await fsp.writeFile(snapshotPath, snapshotBytes);
  const snapshot = new Database(snapshotPath, { readonly: true, fileMustExist: true });
  let settings;
  try {
    settings = JSON.parse(snapshot.prepare('SELECT settings FROM ai_service_configs').get().settings);
  } finally {
    snapshot.close();
  }

  assert.equal(settings.key, '');
  assert.equal(settings.nested.keys, '');
  assert.equal(settings.transports[0].passwd, '');
  assert.equal(settings.transports[1].tls.passphrase, '');
  assert.equal(settings.provider_name, 'custom-safe-provider');
  assert.equal(settings.nested.region, 'cn-north-1');
  assert.equal(settings.transports[0].timeout_ms, 1200);
  assert.equal(settings.transports[1].tls.verify_peer, true);
  assert.equal(settings.transports[1].retry_count, 3);
  assert.deepEqual(settings.models, ['safe-model-a']);
});

test('preserves non-sensitive business key fields in default backups', async (t) => {
  const workspace = await makeWorkspace(t);
  const db = createDatabase(workspace.databasePath, 'business-key-policy');
  const shortcutKeys = JSON.stringify(['Ctrl+K', 'Ctrl+Shift+P']);
  db.exec(`CREATE TABLE workflow_preferences (
    id INTEGER PRIMARY KEY,
    business_key TEXT,
    shortcut_keys TEXT
  );
  CREATE TABLE global_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`);
  db.prepare('INSERT INTO workflow_preferences (business_key, shortcut_keys) VALUES (?, ?)')
    .run('episode-routing-v2', shortcutKeys);
  const insertGlobalSetting = db.prepare('INSERT INTO global_settings (key, value) VALUES (?, ?)');
  insertGlobalSetting.run('business_key', JSON.stringify('tenant-routing-v3'));
  insertGlobalSetting.run('shortcut_keys', JSON.stringify(['Ctrl+B', 'Ctrl+Alt+M']));
  db.pragma('wal_checkpoint(TRUNCATE)');

  const backup = await createDataBackup({
    ...workspace,
    outputPath: workspace.archivePath,
    skipServiceCheck: true,
  });
  assert.equal(backup.security.policy, 'excluded');
  db.close();

  const snapshotBytes = new AdmZip(workspace.archivePath).readFile('database.sqlite');
  const snapshotPath = path.join(workspace.root, 'snapshot-with-business-keys.db');
  await fsp.writeFile(snapshotPath, snapshotBytes);
  const snapshot = new Database(snapshotPath, { readonly: true, fileMustExist: true });
  let preference;
  let globalSettings;
  try {
    preference = snapshot.prepare(
      'SELECT business_key, shortcut_keys FROM workflow_preferences'
    ).get();
    globalSettings = Object.fromEntries(
      snapshot.prepare('SELECT key, value FROM global_settings').all()
        .map((row) => [row.key, JSON.parse(row.value)])
    );
  } finally {
    snapshot.close();
  }

  assert.deepEqual(preference, {
    business_key: 'episode-routing-v2',
    shortcut_keys: shortcutKeys,
  });
  assert.deepEqual(globalSettings, {
    business_key: 'tenant-routing-v3',
    shortcut_keys: ['Ctrl+B', 'Ctrl+Alt+M'],
  });
});

test('preserves provider secret markers when includeSecrets is true', async (t) => {
  const workspace = await makeWorkspace(t);
  const db = createDatabase(workspace.databasePath, 'explicit-secret-policy');
  const secretMarker = `LMD_EXPLICIT_PROVIDER_SECRET_${'I'.repeat(96)}`;
  const originalSettings = {
    key: `${secretMarker}:key`,
    nested: [
      { passwd: `${secretMarker}:passwd` },
      { tls: { passphrase: `${secretMarker}:passphrase` } },
    ],
  };
  db.exec(`CREATE TABLE ai_service_configs (
    id INTEGER PRIMARY KEY,
    api_key TEXT,
    settings TEXT
  )`);
  db.prepare('INSERT INTO ai_service_configs (api_key, settings) VALUES (?, ?)')
    .run(`${secretMarker}:api-key`, JSON.stringify(originalSettings));
  db.pragma('wal_checkpoint(TRUNCATE)');

  const backup = await createDataBackup({
    ...workspace,
    outputPath: workspace.archivePath,
    skipServiceCheck: true,
    includeSecrets: true,
  });
  assert.equal(backup.security.policy, 'included-by-explicit-request');
  db.close();

  const snapshotBytes = new AdmZip(workspace.archivePath).readFile('database.sqlite');
  assert.equal(snapshotBytes.includes(Buffer.from(secretMarker)), true);
  const snapshotPath = path.join(workspace.root, 'snapshot-with-explicit-secrets.db');
  await fsp.writeFile(snapshotPath, snapshotBytes);
  const snapshot = new Database(snapshotPath, { readonly: true, fileMustExist: true });
  let row;
  try {
    row = snapshot.prepare('SELECT api_key, settings FROM ai_service_configs').get();
  } finally {
    snapshot.close();
  }

  assert.equal(row.api_key, `${secretMarker}:api-key`);
  assert.deepEqual(JSON.parse(row.settings), originalSettings);
});

test('redacts header array values while preserving name and key metadata', async (t) => {
  const workspace = await makeWorkspace(t);
  const db = createDatabase(workspace.databasePath, 'header-array-policy');
  const secretMarker = `LMD_HEADER_ARRAY_SECRET_${'H'.repeat(96)}`;
  db.exec(`CREATE TABLE ai_service_configs (
    id INTEGER PRIMARY KEY,
    settings TEXT
  )`);
  db.prepare('INSERT INTO ai_service_configs (settings) VALUES (?)').run(JSON.stringify({
    header_list: [
      { key: 'Authorization', value: `${secretMarker}:key-form`, enabled: true },
      { name: 'X-Auth', value: `${secretMarker}:name-form`, enabled: false },
      { key: 'Content-Type', value: 'application/json' },
    ],
  }));
  db.pragma('wal_checkpoint(TRUNCATE)');

  await createDataBackup({
    ...workspace,
    outputPath: workspace.archivePath,
    skipServiceCheck: true,
  });
  db.close();

  const snapshotBytes = new AdmZip(workspace.archivePath).readFile('database.sqlite');
  assert.equal(snapshotBytes.includes(Buffer.from(secretMarker)), false);
  const snapshotPath = path.join(workspace.root, 'snapshot-with-redacted-header-array.db');
  await fsp.writeFile(snapshotPath, snapshotBytes);
  const snapshot = new Database(snapshotPath, { readonly: true, fileMustExist: true });
  let settings;
  try {
    settings = JSON.parse(snapshot.prepare('SELECT settings FROM ai_service_configs').get().settings);
  } finally {
    snapshot.close();
  }

  assert.deepEqual(settings.header_list, [
    { key: 'Authorization', value: '', enabled: true },
    { name: 'X-Auth', value: '', enabled: false },
    { key: 'Content-Type', value: 'application/json' },
  ]);
});

test('maintenance lock rejects a concurrent backup in the same host contract', async (t) => {
  const workspace = await makeWorkspace(t);
  const db = createDatabase(workspace.databasePath, 'locked-backup');
  await seedStorage(workspace.storagePath, 'locked');
  let releaseFreeze;
  let notifyFreeze;
  const freezeReached = new Promise((resolve) => { notifyFreeze = resolve; });
  const holdFreeze = new Promise((resolve) => { releaseFreeze = resolve; });
  const first = createDataBackup({
    ...workspace,
    outputPath: workspace.archivePath,
    skipServiceCheck: true,
    async faultInjector(step) {
      if (step === 'after-backup-freeze-acquired') {
        notifyFreeze();
        await holdFreeze;
      }
    },
  });
  await freezeReached;
  await assert.rejects(
    createDataBackup({
      ...workspace,
      outputPath: path.join(workspace.root, 'archives', 'second.zip'),
      skipServiceCheck: true,
    }),
    (error) => ['MAINTENANCE_ACTIVE', 'MAINTENANCE_LOCKED'].includes(error?.code)
  );
  releaseFreeze();
  await first;
  db.close();
});

test('service maintenance guard removes its persistent lock on release', async (t) => {
  const workspace = await makeWorkspace(t);
  const guard = acquireServiceMaintenanceLockSync({
    databasePath: workspace.databasePath,
    storagePath: workspace.storagePath,
  });
  const { lockPath } = maintenancePaths(workspace.databasePath);
  assert.ok((await fsp.stat(lockPath)).isFile());
  guard.release();
  guard.release();
  assert.equal(await fsp.stat(lockPath).catch(() => null), null);
});

test('abandoning a service maintenance guard leaves its persistent lock for fail-closed recovery', async (t) => {
  const workspace = await makeWorkspace(t);
  const guard = acquireServiceMaintenanceLockSync({
    databasePath: workspace.databasePath,
    storagePath: workspace.storagePath,
  });
  const { lockPath } = maintenancePaths(workspace.databasePath);
  t.after(() => fsp.rm(lockPath, { force: true }));

  guard.abandon();
  guard.release();

  assert.ok((await fsp.stat(lockPath)).isFile());
  assert.equal(JSON.parse(await fsp.readFile(lockPath, 'utf8')).token, guard.token);
});

test('process exit abandons a service guard after an external lease is issued', async (t) => {
  const workspace = await makeWorkspace(t);
  const modulePath = path.resolve(__dirname, '../src/services/dataBackupService.js');
  const script = `
    const service = require(${JSON.stringify(modulePath)});
    const guard = service.acquireServiceMaintenanceLockSync(${JSON.stringify({
      databasePath: workspace.databasePath,
      storagePath: workspace.storagePath,
      storySourcesPath: workspace.storySourcesPath,
    })});
    service.createExternalMaintenanceLease(guard);
    process.exit(0);
  `;
  const result = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  const { lockPath } = maintenancePaths(workspace.databasePath);
  t.after(() => fsp.rm(lockPath, { force: true }));
  assert.ok((await fsp.stat(lockPath)).isFile());
});

test('process exit cleanup continues after one service guard release fails', async (t) => {
  const first = await makeWorkspace(t);
  const second = await makeWorkspace(t);
  const firstLockPath = maintenancePaths(first.databasePath).lockPath;
  const secondLockPath = maintenancePaths(second.databasePath).lockPath;
  const displacedPath = `${firstLockPath}.exit-displaced`;
  const modulePath = path.resolve(__dirname, '../src/services/dataBackupService.js');
  const script = `
    const fs = require('node:fs');
    const service = require(${JSON.stringify(modulePath)});
    service.acquireServiceMaintenanceLockSync(${JSON.stringify({
      databasePath: first.databasePath,
      storagePath: first.storagePath,
      storySourcesPath: first.storySourcesPath,
    })});
    service.acquireServiceMaintenanceLockSync(${JSON.stringify({
      databasePath: second.databasePath,
      storagePath: second.storagePath,
      storySourcesPath: second.storySourcesPath,
    })});
    fs.renameSync(${JSON.stringify(firstLockPath)}, ${JSON.stringify(displacedPath)});
    process.exit(0);
  `;

  const result = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', windowsHide: true });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /maintenance guard cleanup failed for 1 lock/i);
  assert.ok((await fsp.stat(displacedPath)).isFile());
  assert.equal(await fsp.stat(secondLockPath).catch(() => null), null);
});

test('service guard release preserves an identical replacement installed at its atomic claim boundary', async (t) => {
  const workspace = await makeWorkspace(t);
  const guard = acquireServiceMaintenanceLockSync({
    databasePath: workspace.databasePath,
    storagePath: workspace.storagePath,
  });
  const { lockPath } = maintenancePaths(workspace.databasePath);
  const displacedPath = `${lockPath}.displaced`;
  let injected = false;
  const originalRenameSync = fs.renameSync;
  t.after(async () => {
    fs.renameSync = originalRenameSync;
    await fsp.rm(lockPath, { force: true });
    await fsp.rm(displacedPath, { force: true });
  });
  fs.renameSync = (source, destination) => {
    if (!injected && path.resolve(source) === path.resolve(lockPath)) {
      injected = true;
      originalRenameSync(source, displacedPath);
      fs.writeFileSync(lockPath, `${JSON.stringify(guard.payload)}\n`, { flag: 'wx' });
    }
    return originalRenameSync(source, destination);
  };

  assert.throws(
    () => guard.release(),
    expectCode('MAINTENANCE_LOCK_RELEASE_FAILED')
  );

  assert.equal(injected, true, 'release did not use an atomic pathname claim');
  assert.deepEqual(JSON.parse(await fsp.readFile(lockPath, 'utf8')), guard.payload);
  assert.ok((await fsp.stat(displacedPath)).isFile());
});

test('service guard closes its descriptor before the atomic release claim', async (t) => {
  const workspace = await makeWorkspace(t);
  const guard = acquireServiceMaintenanceLockSync({
    databasePath: workspace.databasePath,
    storagePath: workspace.storagePath,
  });
  const { lockPath } = maintenancePaths(workspace.databasePath);
  const originalRenameSync = fs.renameSync;
  let observedClosedDescriptor = false;
  t.after(async () => {
    fs.renameSync = originalRenameSync;
    guard.abandon();
    await fsp.rm(lockPath, { recursive: true, force: true });
  });
  fs.renameSync = (source, destination) => {
    if (path.resolve(source) === path.resolve(lockPath)) {
      assert.throws(
        () => fs.fstatSync(guard.fd),
        (error) => error?.code === 'EBADF'
      );
      observedClosedDescriptor = true;
    }
    return originalRenameSync(source, destination);
  };

  guard.release();

  assert.equal(observedClosedDescriptor, true);
  assert.equal(await fsp.stat(lockPath).catch(() => null), null);
});

test('service heartbeat and release fail closed when the public lock path is displaced', async (t) => {
  const workspace = await makeWorkspace(t);
  const guard = acquireServiceMaintenanceLockSync({
    databasePath: workspace.databasePath,
    storagePath: workspace.storagePath,
    heartbeatIntervalMs: 100,
  });
  const { lockPath } = maintenancePaths(workspace.databasePath);
  const displacedPath = `${lockPath}.heartbeat-displaced`;
  t.after(async () => {
    guard.abandon();
    await fsp.rm(lockPath, { recursive: true, force: true });
    await fsp.rm(displacedPath, { recursive: true, force: true });
  });

  await fsp.rename(lockPath, displacedPath);
  const deadline = Date.now() + 2000;
  while (!guard.heartbeatError && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  assert.equal(guard.heartbeatError?.code, 'MAINTENANCE_LEASE_INVALID');
  assert.throws(
    () => createExternalMaintenanceLease(guard),
    expectCode('MAINTENANCE_LEASE_INVALID')
  );
  assert.throws(
    () => guard.release(),
    expectCode('MAINTENANCE_LOCK_RELEASE_FAILED')
  );
  assert.ok((await fsp.stat(displacedPath)).isFile());
  assert.equal(await fsp.stat(lockPath).catch(() => null), null);
});

test('service release reports and preserves a directory replacement installed at its claim boundary', async (t) => {
  const workspace = await makeWorkspace(t);
  const guard = acquireServiceMaintenanceLockSync({
    databasePath: workspace.databasePath,
    storagePath: workspace.storagePath,
  });
  const { lockPath } = maintenancePaths(workspace.databasePath);
  const displacedPath = `${lockPath}.directory-displaced`;
  const claimPrefix = `.${path.basename(lockPath)}.claim-`;
  let injected = false;
  const originalRenameSync = fs.renameSync;
  t.after(async () => {
    fs.renameSync = originalRenameSync;
    guard.abandon();
    await fsp.rm(lockPath, { recursive: true, force: true });
    await fsp.rm(displacedPath, { recursive: true, force: true });
    const parentEntries = await fsp.readdir(path.dirname(lockPath)).catch(() => []);
    await Promise.all(parentEntries
      .filter((name) => name.startsWith(claimPrefix))
      .map((name) => fsp.rm(path.join(path.dirname(lockPath), name), { recursive: true, force: true })));
  });
  fs.renameSync = (source, destination) => {
    if (!injected && path.resolve(source) === path.resolve(lockPath)) {
      injected = true;
      originalRenameSync(source, displacedPath);
      fs.mkdirSync(lockPath);
      fs.writeFileSync(path.join(lockPath, 'canary.txt'), 'unrelated directory replacement');
    }
    return originalRenameSync(source, destination);
  };

  assert.throws(
    () => guard.release(),
    expectCode('MAINTENANCE_LOCK_RELEASE_FAILED')
  );

  assert.equal(injected, true);
  assert.ok((await fsp.stat(displacedPath)).isFile());
  const claimDirectories = (await fsp.readdir(path.dirname(lockPath)))
    .filter((name) => name.startsWith(claimPrefix));
  assert.equal(claimDirectories.length, 1);
  assert.deepEqual(JSON.parse(await fsp.readFile(lockPath, 'utf8')), {
    schema: 'localminidrama.maintenance-quarantine.v1',
    claimDirectory: claimDirectories[0],
    claimEntry: 'owned',
    replacementType: 'directory',
    contract: 'manual-inspection-required',
  });
  assert.equal(
    await fsp.readFile(path.join(path.dirname(lockPath), claimDirectories[0], 'owned', 'canary.txt'), 'utf8'),
    'unrelated directory replacement'
  );
});

test('service release surfaces descriptor close failure and restores the public lock path', async (t) => {
  const workspace = await makeWorkspace(t);
  const guard = acquireServiceMaintenanceLockSync({
    databasePath: workspace.databasePath,
    storagePath: workspace.storagePath,
  });
  const { lockPath } = maintenancePaths(workspace.databasePath);
  const originalCloseSync = fs.closeSync;
  const closeFailure = new Error('injected maintenance descriptor close failure');
  let injected = false;
  try {
    fs.closeSync = (fd) => {
      if (!injected && fd === guard.fd) {
        injected = true;
        throw closeFailure;
      }
      return originalCloseSync(fd);
    };

    let releaseFailure;
    assert.throws(
      () => guard.release(),
      (error) => {
        releaseFailure = error;
        return error?.code === 'MAINTENANCE_LOCK_RELEASE_FAILED';
      }
    );

    assert.equal(injected, true);
    assert.equal(releaseFailure.cause, closeFailure);
    assert.ok((await fsp.stat(lockPath)).isFile());
    assert.equal(JSON.parse(await fsp.readFile(lockPath, 'utf8')).token, guard.token);
  } finally {
    fs.closeSync = originalCloseSync;
    try { originalCloseSync(guard.fd); } catch (_) {}
    await fsp.rm(lockPath, { force: true });
  }
});

test('external service lease rejects a path replacement installed after its read descriptor opens', async (t) => {
  const workspace = await makeWorkspace(t);
  const guard = acquireServiceMaintenanceLockSync({
    databasePath: workspace.databasePath,
    storagePath: workspace.storagePath,
  });
  const { lockPath } = maintenancePaths(workspace.databasePath);
  const displacedPath = `${lockPath}.read-displaced`;
  let injected = false;
  const originalOpenSync = fs.openSync;
  t.after(async () => {
    fs.openSync = originalOpenSync;
    guard.abandon();
    await fsp.rm(lockPath, { force: true });
    await fsp.rm(displacedPath, { force: true });
  });
  fs.openSync = (target, flags, ...args) => {
    const fd = originalOpenSync(target, flags, ...args);
    if (!injected && path.resolve(String(target)) === path.resolve(lockPath)) {
      injected = true;
      fs.renameSync(lockPath, displacedPath);
      fs.writeFileSync(lockPath, `${JSON.stringify(guard.payload)}\n`, { flag: 'wx' });
    }
    return fd;
  };

  assert.throws(
    () => createExternalMaintenanceLease(guard),
    expectCode('MAINTENANCE_LEASE_INVALID')
  );
  assert.equal(injected, true, 'lease validation did not open a path-bound read descriptor');
  assert.ok((await fsp.stat(lockPath)).isFile());
  assert.ok((await fsp.stat(displacedPath)).isFile());
  fs.openSync = originalOpenSync;
  guard.abandon();
  await fsp.rm(lockPath, { force: true });
  await fsp.rm(displacedPath, { force: true });
});

test('external service maintenance lease authorizes a backup without taking a second source lock', async (t) => {
  const workspace = await makeWorkspace(t);
  const db = createDatabase(workspace.databasePath, 'externally-locked-backup');
  db.close();
  await seedStorage(workspace.storagePath, 'externally-locked');
  const guard = acquireServiceMaintenanceLockSync({
    databasePath: workspace.databasePath,
    storagePath: workspace.storagePath,
    storySourcesPath: workspace.storySourcesPath,
  });
  t.after(() => guard.release());
  const lease = createExternalMaintenanceLease(guard);
  const { lockPath } = maintenancePaths(workspace.databasePath);
  const lockBefore = await fsp.readFile(lockPath, 'utf8');

  const backup = await createDataBackup({
    ...workspace,
    outputPath: workspace.archivePath,
    externalMaintenanceLease: lease,
  });

  assert.ok(backup.archiveBytes > 0);
  assert.deepEqual(await fsp.readFile(lockPath, 'utf8'), lockBefore);
  assert.deepEqual(JSON.parse(lockBefore), guard.payload);
  guard.release();
  assert.equal(await fsp.stat(lockPath).catch(() => null), null);
});

test('external service maintenance lease rejects mismatches and mutation after output link', async (t) => {
  const workspace = await makeWorkspace(t);
  const db = createDatabase(workspace.databasePath, 'mutated-external-lock');
  db.close();
  await seedStorage(workspace.storagePath, 'mutated-external-lock');
  const guard = acquireServiceMaintenanceLockSync({
    databasePath: workspace.databasePath,
    storagePath: workspace.storagePath,
    storySourcesPath: workspace.storySourcesPath,
  });
  t.after(() => guard.release());
  const lease = createExternalMaintenanceLease(guard);
  const { lockPath } = maintenancePaths(workspace.databasePath);

  await assert.rejects(
    createDataBackup({
      ...workspace,
      outputPath: workspace.archivePath,
      externalMaintenanceLease: { ...lease, token: 'f'.repeat(16) },
    }),
    expectCode('MAINTENANCE_LEASE_INVALID')
  );

  await assert.rejects(
    createDataBackup({
      ...workspace,
      outputPath: workspace.archivePath,
      externalMaintenanceLease: lease,
      async faultInjector(step) {
        if (step !== 'after-backup-output-linked') return;
        await fsp.writeFile(lockPath, `${JSON.stringify({ ...guard.payload, token: 'e'.repeat(16) })}\n`);
      },
    }),
    expectCode('MAINTENANCE_LEASE_INVALID')
  );
  assert.equal(await fsp.stat(workspace.archivePath).catch(() => null), null);

  await fsp.writeFile(lockPath, `${JSON.stringify(guard.payload)}\n`);
  guard.release();
  assert.equal(await fsp.stat(lockPath).catch(() => null), null);
});

test('backup failure compensation preserves an output replacement installed at its atomic claim boundary', async (t) => {
  const workspace = await makeWorkspace(t);
  const db = createDatabase(workspace.databasePath, 'replacement-safe-output-cleanup');
  db.close();
  await seedStorage(workspace.storagePath, 'replacement-safe-output-cleanup');
  const guard = acquireServiceMaintenanceLockSync({
    databasePath: workspace.databasePath,
    storagePath: workspace.storagePath,
    storySourcesPath: workspace.storySourcesPath,
  });
  const lease = createExternalMaintenanceLease(guard);
  const { lockPath } = maintenancePaths(workspace.databasePath);
  const displacedOutputPath = `${workspace.archivePath}.displaced`;
  let injected = false;
  const originalRenameSync = fs.renameSync;
  try {
    fs.renameSync = (source, destination) => {
      if (!injected && path.resolve(source) === path.resolve(workspace.archivePath)) {
        injected = true;
        originalRenameSync(source, displacedOutputPath);
        fs.writeFileSync(workspace.archivePath, 'unrelated-output', { flag: 'wx' });
      }
      return originalRenameSync(source, destination);
    };

    let backupFailure;
    await assert.rejects(
      createDataBackup({
        ...workspace,
        outputPath: workspace.archivePath,
        externalMaintenanceLease: lease,
        async faultInjector(step) {
          if (step === 'after-backup-output-linked') {
            await fsp.writeFile(lockPath, `${JSON.stringify({ ...guard.payload, token: 'e'.repeat(16) })}\n`);
          }
        },
      }),
      (error) => {
        backupFailure = error;
        return expectCode('MAINTENANCE_LEASE_INVALID')(error);
      }
    );

    assert.equal(injected, true, 'backup compensation did not atomically claim the output path');
    assert.equal(await fsp.readFile(workspace.archivePath, 'utf8'), 'unrelated-output');
    assert.ok((await fsp.stat(displacedOutputPath)).isFile());
    assert.equal(Object.hasOwn(backupFailure, 'cleanupError'), false);
    const cleanupDescriptor = Object.getOwnPropertyDescriptor(backupFailure, 'cleanupErrors');
    assert.equal(cleanupDescriptor?.enumerable, false);
    assert.equal(cleanupDescriptor?.value.length, 1);
    assert.equal(cleanupDescriptor.value[0]?.code, 'OUTPUT_CLEANUP_FAILED');
  } finally {
    fs.renameSync = originalRenameSync;
    guard.abandon();
    await fsp.rm(workspace.archivePath, { force: true });
    await fsp.rm(displacedOutputPath, { force: true });
    await fsp.rm(lockPath, { force: true });
  }
});

test('external service maintenance lease binds the original lock identity and requires a fresh heartbeat', async (t) => {
  const workspace = await makeWorkspace(t);
  const db = createDatabase(workspace.databasePath, 'identity-bound-external-lock');
  db.close();
  await seedStorage(workspace.storagePath, 'identity-bound-external-lock');
  const guard = acquireServiceMaintenanceLockSync({
    databasePath: workspace.databasePath,
    storagePath: workspace.storagePath,
    storySourcesPath: workspace.storySourcesPath,
    heartbeatIntervalMs: 60000,
  });
  t.after(() => guard.release());
  const lease = createExternalMaintenanceLease(guard);
  const { lockPath } = maintenancePaths(workspace.databasePath);
  const displacedLockPath = `${lockPath}.displaced`;
  t.after(async () => {
    await fsp.rm(lockPath, { force: true });
    await fsp.rm(displacedLockPath, { force: true });
  });

  assert.equal(lease.schema, 'localminidrama.maintenance-lease.v2');
  assert.match(lease.device, /^(0|[1-9][0-9]*)$/);
  assert.match(lease.inode, /^(0|[1-9][0-9]*)$/);

  const staleHeartbeat = new Date(Date.now() - 120000).toISOString();
  await fsp.writeFile(lockPath, `${JSON.stringify({ ...guard.payload, heartbeatAt: staleHeartbeat })}\n`);
  await assert.rejects(
    createDataBackup({
      ...workspace,
      outputPath: workspace.archivePath,
      externalMaintenanceLease: lease,
    }),
    expectCode('MAINTENANCE_LEASE_INVALID')
  );
  assert.equal(await fsp.stat(workspace.archivePath).catch(() => null), null);

  await fsp.writeFile(lockPath, `${JSON.stringify(guard.payload)}\n`);
  await fsp.rename(lockPath, displacedLockPath);
  await fsp.writeFile(lockPath, `${JSON.stringify(guard.payload)}\n`, { flag: 'wx' });
  await assert.rejects(
    createDataBackup({
      ...workspace,
      outputPath: workspace.archivePath,
      externalMaintenanceLease: lease,
    }),
    expectCode('MAINTENANCE_LEASE_INVALID')
  );

  assert.throws(
    () => guard.release(),
    expectCode('MAINTENANCE_LOCK_RELEASE_FAILED')
  );
  assert.deepEqual(JSON.parse(await fsp.readFile(lockPath, 'utf8')), guard.payload);
  assert.ok((await fsp.stat(displacedLockPath)).isFile());
});

test('stale dead version 1 maintenance locks upgrade to a version 2 service lease', async (t) => {
  const workspace = await makeWorkspace(t);
  const { lockPath } = maintenancePaths(workspace.databasePath);
  const stale = new Date(Date.now() - 120000);
  const legacyLock = {
    version: 1,
    pid: 2147483647,
    operation: 'service',
    token: '1385a1e7b8f9a374',
    createdAt: stale.toISOString(),
    contract: 'advisory-single-host-all-localminidrama-processes-must-honor',
  };
  await fsp.writeFile(lockPath, `${JSON.stringify(legacyLock)}\n`, { flag: 'wx' });
  await fsp.utimes(lockPath, stale, stale);

  const guard = acquireServiceMaintenanceLockSync(workspace);
  const upgraded = JSON.parse(await fsp.readFile(lockPath, 'utf8'));
  assert.equal(upgraded.version, 2);
  assert.equal(upgraded.pid, process.pid);
  if (process.env.LOCALMINIDRAMA_MAINTENANCE_SCOPE) {
    assert.equal(upgraded.ownerScope, process.env.LOCALMINIDRAMA_MAINTENANCE_SCOPE);
  } else {
    assert.match(upgraded.ownerScope, /.+:.+:.+/);
  }
  guard.release();
  assert.equal(await fsp.stat(lockPath).catch(() => null), null);

  delete legacyLock.token;
  await fsp.writeFile(lockPath, `${JSON.stringify(legacyLock)}\n`, { flag: 'wx' });
  await fsp.utimes(lockPath, stale, stale);
  assert.deepEqual(recoverInterruptedMaintenanceSync(workspace), { recovered: false });
  assert.equal(await fsp.stat(lockPath).catch(() => null), null);
});

test('version 1 maintenance locks remain blocked when fresh, live, foreign, or unprovable', async (t) => {
  const workspace = await makeWorkspace(t);
  const { lockPath } = maintenancePaths(workspace.databasePath);
  const contract = 'advisory-single-host-all-localminidrama-processes-must-honor';
  const deadPid = 2147483647;
  const writeLock = async (payload, timestamp) => {
    await fsp.rm(lockPath, { force: true });
    await fsp.writeFile(lockPath, `${JSON.stringify(payload)}\n`, { flag: 'wx' });
    await fsp.utimes(lockPath, timestamp, timestamp);
  };

  const fresh = new Date();
  await writeLock({
    version: 1,
    pid: deadPid,
    operation: 'service',
    createdAt: fresh.toISOString(),
    contract,
  }, fresh);
  assert.throws(() => recoverInterruptedMaintenanceSync(workspace), expectCode('MAINTENANCE_ACTIVE'));

  const stale = new Date(Date.now() - 120000);
  await writeLock({
    version: 1,
    pid: process.pid,
    operation: 'service',
    createdAt: stale.toISOString(),
    contract,
  }, stale);
  assert.throws(() => recoverInterruptedMaintenanceSync(workspace), expectCode('MAINTENANCE_ACTIVE'));

  await writeLock({
    version: 1,
    pid: deadPid,
    operation: 'service',
    createdAt: stale.toISOString(),
    contract: 'unknown-maintenance-contract',
  }, stale);
  assert.throws(() => recoverInterruptedMaintenanceSync(workspace), expectCode('MAINTENANCE_LOCK_FOREIGN'));

  await writeLock({
    version: 1,
    pid: deadPid,
    operation: 'service',
    token: 'not-a-valid-token',
    createdAt: stale.toISOString(),
    contract,
  }, stale);
  assert.throws(() => recoverInterruptedMaintenanceSync(workspace), expectCode('MAINTENANCE_LOCK_FOREIGN'));

  await writeLock({
    version: 1,
    pid: deadPid,
    ownerScope: 'linux:another-host:pid:[999999]',
    operation: 'service',
    createdAt: stale.toISOString(),
    contract,
  }, stale);
  assert.throws(() => recoverInterruptedMaintenanceSync(workspace), expectCode('MAINTENANCE_LOCK_FOREIGN'));
  assert.ok(await fsp.stat(lockPath));
});

test('explicit container scopes reclaim stale version 1 locks despite PID 1 reuse', async (t) => {
  const workspace = await makeWorkspace(t);
  const { lockPath } = maintenancePaths(workspace.databasePath);
  const stale = new Date(Date.now() - 120000);
  const legacyLock = {
    version: 1,
    pid: process.pid,
    operation: 'service',
    token: '1385a1e7b8f9a374',
    createdAt: stale.toISOString(),
    contract: 'advisory-single-host-all-localminidrama-processes-must-honor',
  };
  await fsp.writeFile(lockPath, `${JSON.stringify(legacyLock)}\n`, { flag: 'wx' });
  await fsp.utimes(lockPath, stale, stale);

  assert.deepEqual(
    recoverInterruptedMaintenanceSync({
      ...workspace,
      ownerScope: 'localminidrama-docker-backend',
    }),
    { recovered: false }
  );
  assert.equal(await fsp.stat(lockPath).catch(() => null), null);
});

test('fresh and foreign-namespace maintenance leases are never reclaimed by PID mismatch', async (t) => {
  const workspace = await makeWorkspace(t);
  const { lockPath } = maintenancePaths(workspace.databasePath);
  const now = new Date();
  const payload = {
    version: 2,
    pid: 2147483647,
    ownerScope: 'linux:another-runtime:pid:[999999]',
    operation: 'service',
    token: ['01234567', '89abcdef'].join(''),
    createdAt: now.toISOString(),
    heartbeatAt: now.toISOString(),
    contract: 'exclusive-lease-owner-scope-and-heartbeat-required',
  };
  await fsp.writeFile(lockPath, `${JSON.stringify(payload)}\n`, { flag: 'wx' });

  assert.throws(
    () => recoverInterruptedMaintenanceSync(workspace),
    expectCode('MAINTENANCE_ACTIVE')
  );
  assert.ok(await fsp.stat(lockPath));

  const stale = new Date(Date.now() - 120000);
  payload.heartbeatAt = stale.toISOString();
  await fsp.writeFile(lockPath, `${JSON.stringify(payload)}\n`);
  await fsp.utimes(lockPath, stale, stale);
  assert.throws(
    () => recoverInterruptedMaintenanceSync(workspace),
    expectCode('MAINTENANCE_LOCK_FOREIGN')
  );
  assert.ok(await fsp.stat(lockPath));
});

test('startup recovery still fails closed on a stale foreign Docker lock', async (t) => {
  const workspace = await makeWorkspace(t);
  const { lockPath } = maintenancePaths(workspace.databasePath);
  const stale = new Date(Date.now() - 120000);
  const payload = {
    version: 2,
    pid: 7,
    ownerScope: 'localminidrama-docker-backend',
    operation: 'service',
    token: 'c'.repeat(16),
    createdAt: stale.toISOString(),
    heartbeatAt: stale.toISOString(),
    contract: 'exclusive-lease-owner-scope-and-heartbeat-required',
  };
  await fsp.writeFile(lockPath, `${JSON.stringify(payload)}\n`, { flag: 'wx' });
  await fsp.utimes(lockPath, stale, stale);
  assert.throws(
    () => recoverInterruptedMaintenanceSync(workspace),
    expectCode('MAINTENANCE_LOCK_FOREIGN')
  );
  assert.ok(await fsp.stat(lockPath));
});

test('explicit maintenance scopes persist and reclaim stale same-scope container leases', async (t) => {
  const workspace = await makeWorkspace(t);
  const ownerScope = 'localminidrama-docker-backend';
  const guard = acquireServiceMaintenanceLockSync({ ...workspace, ownerScope });
  const { lockPath } = maintenancePaths(workspace.databasePath);
  const payload = JSON.parse(await fsp.readFile(lockPath, 'utf8'));
  assert.equal(payload.ownerScope, ownerScope);
  guard.release();

  const stale = new Date(Date.now() - 120000);
  await fsp.writeFile(lockPath, `${JSON.stringify({
    ...payload,
    pid: process.pid,
    heartbeatAt: stale.toISOString(),
  })}\n`, { flag: 'wx' });
  await fsp.utimes(lockPath, stale, stale);

  assert.deepEqual(
    recoverInterruptedMaintenanceSync({ ...workspace, ownerScope }),
    { recovered: false }
  );
  assert.equal(await fsp.stat(lockPath).catch(() => null), null);
});

test('explicit maintenance scopes fail closed on stale legacy Docker owner scopes', async (t) => {
  const workspace = await makeWorkspace(t);
  const { lockPath } = maintenancePaths(workspace.databasePath);
  const ownerScope = 'localminidrama-docker-backend';
  const now = new Date();
  const legacyDockerLock = {
    version: 2,
    pid: 2147483647,
    ownerScope: 'linux:0123456789ab:pid:[4026532911]',
    operation: 'service',
    token: ['01234567', '89abcdef'].join(''),
    createdAt: now.toISOString(),
    heartbeatAt: now.toISOString(),
    contract: 'exclusive-lease-owner-scope-and-heartbeat-required',
  };
  await fsp.writeFile(lockPath, `${JSON.stringify(legacyDockerLock)}\n`, { flag: 'wx' });

  assert.throws(
    () => recoverInterruptedMaintenanceSync({ ...workspace, ownerScope }),
    expectCode('MAINTENANCE_ACTIVE')
  );
  assert.ok(await fsp.stat(lockPath));

  const stale = new Date(Date.now() - 120000);
  legacyDockerLock.heartbeatAt = stale.toISOString();
  await fsp.writeFile(lockPath, `${JSON.stringify(legacyDockerLock)}\n`);
  await fsp.utimes(lockPath, stale, stale);
  assert.throws(
    () => recoverInterruptedMaintenanceSync({ ...workspace, ownerScope }),
    expectCode('MAINTENANCE_LOCK_FOREIGN')
  );
  assert.ok(await fsp.stat(lockPath));
  assert.deepEqual(
    recoverInterruptedMaintenanceSync({
      ...workspace,
      ownerScope,
      expectedOwnerScope: legacyDockerLock.ownerScope,
      expectedPid: legacyDockerLock.pid,
    }),
    { recovered: false }
  );
  assert.equal(await fsp.stat(lockPath).catch(() => null), null);

  const foreignLock = {
    ...legacyDockerLock,
    ownerScope: 'linux:another-runtime:pid:[4026532911]',
  };
  await fsp.writeFile(lockPath, `${JSON.stringify(foreignLock)}\n`, { flag: 'wx' });
  await fsp.utimes(lockPath, stale, stale);
  assert.throws(
    () => recoverInterruptedMaintenanceSync({ ...workspace, ownerScope }),
    expectCode('MAINTENANCE_LOCK_FOREIGN')
  );
  assert.ok(await fsp.stat(lockPath));
});

test('invalid explicit maintenance scopes fail closed', async (t) => {
  const workspace = await makeWorkspace(t);
  assert.throws(
    () => acquireServiceMaintenanceLockSync({ ...workspace, ownerScope: 'docker scope with spaces' }),
    expectCode('MAINTENANCE_SCOPE_INVALID')
  );
});

test('maintenance recovery requires an exclusive recovery lease before touching persistent state', async (t) => {
  const workspace = await makeWorkspace(t);
  const { recoveryLockPath, journalPath } = maintenancePaths(workspace.databasePath);
  const now = new Date().toISOString();
  const activeRecovery = {
    version: 2,
    pid: process.pid,
    ownerScope: 'test:active-recovery-owner',
    operation: 'restore',
    token: ['01234567', '89abcdef'].join(''),
    createdAt: now,
    heartbeatAt: now,
    contract: 'exclusive-lease-owner-scope-and-heartbeat-required',
  };
  await fsp.writeFile(recoveryLockPath, `${JSON.stringify(activeRecovery)}\n`, { flag: 'wx' });
  await fsp.writeFile(journalPath, '{ intentionally-not-parseable');

  assert.throws(
    () => recoverInterruptedMaintenanceSync(workspace),
    expectCode('MAINTENANCE_ACTIVE')
  );
  assert.ok(await fsp.stat(recoveryLockPath));
  assert.equal(await fsp.readFile(journalPath, 'utf8'), '{ intentionally-not-parseable');
});

test('recovery lease heartbeat advances while the main thread is synchronously blocked', async (t) => {
  const workspace = await makeWorkspace(t);
  const ownerScope = 'localminidrama-docker-backend';
  const claim = __testing.acquireMaintenanceRecoveryClaimSync(workspace.databasePath, {
    ownerScope,
    heartbeatIntervalMs: 100,
  });
  t.after(() => __testing.releaseMaintenanceRecoveryClaimSync(claim));
  const { recoveryLockPath } = maintenancePaths(workspace.databasePath);
  const first = JSON.parse(await fsp.readFile(recoveryLockPath, 'utf8'));

  const blocker = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));
  Atomics.wait(blocker, 0, 0, 450);
  const second = JSON.parse(await fsp.readFile(recoveryLockPath, 'utf8'));
  assert.ok(Date.parse(second.heartbeatAt) > Date.parse(first.heartbeatAt));
  assert.throws(
    () => recoverInterruptedMaintenanceSync({
      ...workspace,
      ownerScope,
      heartbeatIntervalMs: 100,
      lockStaleMs: 200,
    }),
    expectCode('MAINTENANCE_ACTIVE')
  );

  __testing.releaseMaintenanceRecoveryClaimSync(claim);
  assert.equal(await fsp.stat(recoveryLockPath).catch(() => null), null);
});

test('recovery lease release preserves a fresh replacement installed at its claim boundary', async (t) => {
  const workspace = await makeWorkspace(t);
  const ownerScope = 'localminidrama-docker-backend';
  const claim = __testing.acquireMaintenanceRecoveryClaimSync(workspace.databasePath, { ownerScope });
  const { recoveryLockPath } = maintenancePaths(workspace.databasePath);
  const now = new Date().toISOString();
  const freshPayload = {
    ...claim.payload,
    token: ['01234567', '89abcdef'].join(''),
    createdAt: now,
    heartbeatAt: now,
  };
  const displacedPath = `${recoveryLockPath}.release-displaced`;
  const originalReadFileSync = fs.readFileSync;
  const originalRenameSync = fs.renameSync;
  let injected = false;
  const installReplacement = () => {
    injected = true;
    originalRenameSync(recoveryLockPath, displacedPath);
    fs.writeFileSync(recoveryLockPath, `${JSON.stringify(freshPayload)}\n`, { flag: 'wx' });
  };
  t.after(async () => {
    fs.readFileSync = originalReadFileSync;
    fs.renameSync = originalRenameSync;
    try { fs.closeSync(claim.fd); } catch (_) {}
    await fsp.rm(recoveryLockPath, { recursive: true, force: true });
    await fsp.rm(displacedPath, { recursive: true, force: true });
    const claimPrefix = `.${path.basename(recoveryLockPath)}.claim-`;
    const parentEntries = await fsp.readdir(path.dirname(recoveryLockPath)).catch(() => []);
    await Promise.all(parentEntries
      .filter((name) => name.startsWith(claimPrefix))
      .map((name) => fsp.rm(path.join(path.dirname(recoveryLockPath), name), { recursive: true, force: true })));
  });
  fs.readFileSync = (source, ...args) => {
    const bytes = originalReadFileSync(source, ...args);
    if (!injected && path.resolve(String(source)) === path.resolve(recoveryLockPath)) installReplacement();
    return bytes;
  };
  fs.renameSync = (source, destination) => {
    if (!injected && path.resolve(source) === path.resolve(recoveryLockPath)) installReplacement();
    return originalRenameSync(source, destination);
  };

  assert.throws(
    () => __testing.releaseMaintenanceRecoveryClaimSync(claim),
    expectCode('MAINTENANCE_LOCK_RELEASE_FAILED')
  );

  assert.equal(injected, true);
  assert.deepEqual(JSON.parse(await fsp.readFile(recoveryLockPath, 'utf8')), freshPayload);
  assert.ok((await fsp.stat(displacedPath)).isFile());
});

test('recovery lease closes its descriptor before the atomic release claim', async (t) => {
  const workspace = await makeWorkspace(t);
  const claim = __testing.acquireMaintenanceRecoveryClaimSync(workspace.databasePath, {
    ownerScope: 'localminidrama-docker-backend',
  });
  const { recoveryLockPath } = maintenancePaths(workspace.databasePath);
  const originalRenameSync = fs.renameSync;
  let observedClosedDescriptor = false;
  t.after(async () => {
    fs.renameSync = originalRenameSync;
    try { fs.closeSync(claim.fd); } catch (_) {}
    await fsp.rm(recoveryLockPath, { recursive: true, force: true });
  });
  fs.renameSync = (source, destination) => {
    if (path.resolve(source) === path.resolve(recoveryLockPath)) {
      assert.throws(
        () => fs.fstatSync(claim.fd),
        (error) => error?.code === 'EBADF'
      );
      observedClosedDescriptor = true;
    }
    return originalRenameSync(source, destination);
  };

  __testing.releaseMaintenanceRecoveryClaimSync(claim);

  assert.equal(observedClosedDescriptor, true);
  assert.equal(await fsp.stat(recoveryLockPath).catch(() => null), null);
});

test('stale same-scope recovery leases are atomically reclaimed', async (t) => {
  const workspace = await makeWorkspace(t);
  const guard = acquireServiceMaintenanceLockSync({
    databasePath: workspace.databasePath,
    storagePath: workspace.storagePath,
  });
  const { lockPath, recoveryLockPath } = maintenancePaths(workspace.databasePath);
  const payload = JSON.parse(await fsp.readFile(lockPath, 'utf8'));
  guard.release();

  const stale = new Date(Date.now() - 120000);
  payload.pid = 2147483647;
  payload.operation = 'restore';
  payload.heartbeatAt = stale.toISOString();
  await fsp.writeFile(recoveryLockPath, `${JSON.stringify(payload)}\n`, { flag: 'wx' });
  await fsp.utimes(recoveryLockPath, stale, stale);

  assert.deepEqual(recoverInterruptedMaintenanceSync(workspace), { recovered: false });
  assert.equal(await fsp.stat(recoveryLockPath).catch(() => null), null);
});

test('stale recovery reclaim preserves a fresh lease installed at the atomic claim boundary', async (t) => {
  const workspace = await makeWorkspace(t);
  const ownerScope = 'localminidrama-docker-backend';
  const guard = acquireServiceMaintenanceLockSync({
    databasePath: workspace.databasePath,
    storagePath: workspace.storagePath,
    ownerScope,
  });
  const { lockPath, recoveryLockPath } = maintenancePaths(workspace.databasePath);
  const basePayload = JSON.parse(await fsp.readFile(lockPath, 'utf8'));
  guard.release();

  const staleTime = new Date(Date.now() - 120000);
  const stalePayload = {
    ...basePayload,
    pid: 2147483647,
    operation: 'restore',
    heartbeatAt: staleTime.toISOString(),
  };
  const now = new Date().toISOString();
  const freshPayload = {
    ...basePayload,
    operation: 'restore',
    token: ['fedcba98', '76543210'].join(''),
    createdAt: now,
    heartbeatAt: now,
  };
  await fsp.writeFile(recoveryLockPath, `${JSON.stringify(stalePayload)}\n`, { flag: 'wx' });
  await fsp.utimes(recoveryLockPath, staleTime, staleTime);

  const displacedPath = `${recoveryLockPath}.stale-displaced`;
  const originalRenameSync = fs.renameSync;
  let injected = false;
  t.after(async () => {
    fs.renameSync = originalRenameSync;
    await fsp.rm(recoveryLockPath, { recursive: true, force: true });
    await fsp.rm(displacedPath, { recursive: true, force: true });
    const claimPrefix = `.${path.basename(recoveryLockPath)}.claim-`;
    const parentEntries = await fsp.readdir(path.dirname(recoveryLockPath)).catch(() => []);
    await Promise.all(parentEntries
      .filter((name) => name.startsWith(claimPrefix))
      .map((name) => fsp.rm(path.join(path.dirname(recoveryLockPath), name), { recursive: true, force: true })));
  });
  fs.renameSync = (source, destination) => {
    if (!injected && path.resolve(source) === path.resolve(recoveryLockPath)) {
      injected = true;
      originalRenameSync(source, displacedPath);
      fs.writeFileSync(recoveryLockPath, `${JSON.stringify(freshPayload)}\n`, { flag: 'wx' });
    }
    return originalRenameSync(source, destination);
  };

  assert.throws(
    () => {
      const unexpected = __testing.acquireMaintenanceRecoveryClaimSync(workspace.databasePath, { ownerScope });
      __testing.releaseMaintenanceRecoveryClaimSync(unexpected);
    },
    expectCode('MAINTENANCE_ACTIVE')
  );

  assert.equal(injected, true);
  assert.deepEqual(JSON.parse(await fsp.readFile(recoveryLockPath, 'utf8')), freshPayload);
  assert.ok((await fsp.stat(displacedPath)).isFile());
});

test('service lease heartbeat advances and stale same-scope dead locks recover', async (t) => {
  const workspace = await makeWorkspace(t);
  const guard = acquireServiceMaintenanceLockSync({
    databasePath: workspace.databasePath,
    storagePath: workspace.storagePath,
    heartbeatIntervalMs: 100,
  });
  t.after(() => guard.release());
  const { lockPath } = maintenancePaths(workspace.databasePath);
  const first = JSON.parse(await fsp.readFile(lockPath, 'utf8'));
  await new Promise((resolve) => setTimeout(resolve, 175));
  const second = JSON.parse(await fsp.readFile(lockPath, 'utf8'));
  await new Promise((resolve) => setTimeout(resolve, 250));
  const third = JSON.parse(await fsp.readFile(lockPath, 'utf8'));
  assert.equal(second.ownerScope, first.ownerScope);
  assert.equal(second.token, first.token);
  assert.ok(Date.parse(second.heartbeatAt) > Date.parse(first.heartbeatAt));
  assert.ok(Date.parse(third.heartbeatAt) > Date.parse(second.heartbeatAt));
  assert.equal(guard.heartbeatError, undefined);

  guard.release();
  const stale = new Date(Date.now() - 120000);
  const deadOwner = {
    ...third,
    pid: 2147483647,
    heartbeatAt: stale.toISOString(),
  };
  await fsp.writeFile(lockPath, `${JSON.stringify(deadOwner)}\n`, { flag: 'wx' });
  await fsp.utimes(lockPath, stale, stale);
  assert.deepEqual(recoverInterruptedMaintenanceSync(workspace), { recovered: false });
  assert.equal(await fsp.stat(lockPath).catch(() => null), null);
});

test('backup output commit never overwrites a path created during backup', async (t) => {
  const workspace = await makeWorkspace(t);
  const db = createDatabase(workspace.databasePath, 'output-race');
  await seedStorage(workspace.storagePath, 'output-race');
  const sentinel = 'created-by-another-process';

  await assert.rejects(
    createDataBackup({
      ...workspace,
      outputPath: workspace.archivePath,
      skipServiceCheck: true,
      async faultInjector(step) {
        if (step === 'after-backup-storage-captured') {
          await fsp.writeFile(workspace.archivePath, sentinel, { flag: 'wx' });
        }
      },
    }),
    expectCode('OUTPUT_EXISTS')
  );
  assert.equal(await fsp.readFile(workspace.archivePath, 'utf8'), sentinel);
  db.close();
});

test('aborted backup removes its internal snapshot, output, and maintenance lock', async (t) => {
  const workspace = await makeWorkspace(t);
  const db = createDatabase(workspace.databasePath, 'aborted-backup');
  await seedStorage(workspace.storagePath, 'aborted-backup');
  const before = new Set(
    (await fsp.readdir(os.tmpdir())).filter((name) => name.startsWith('localminidrama-backup-'))
  );
  const controller = new AbortController();

  await assert.rejects(
    createDataBackup({
      ...workspace,
      outputPath: workspace.archivePath,
      skipServiceCheck: true,
      signal: controller.signal,
      faultInjector(step) {
        if (step === 'after-backup-database-snapshot') controller.abort();
      },
    }),
    expectCode('OPERATION_ABORTED')
  );

  const after = (await fsp.readdir(os.tmpdir())).filter(
    (name) => name.startsWith('localminidrama-backup-') && !before.has(name)
  );
  assert.deepEqual(after, []);
  assert.equal(await fsp.stat(workspace.archivePath).catch(() => null), null);
  assert.equal(await fsp.stat(maintenancePaths(workspace.databasePath).lockPath).catch(() => null), null);
  db.close();
});

test('startup recovery rolls back an interrupted database and storage switch', async (t) => {
  const workspace = await makeWorkspace(t);
  const original = createDatabase(workspace.databasePath, 'original-before-crash');
  original.close();
  await fsp.writeFile(path.join(workspace.storagePath, 'original.txt'), 'original-media');
  await fsp.writeFile(path.join(workspace.storySourcesPath, 'current.txt'), 'legacy-journal-source');

  const oldDatabasePath = path.join(
    path.dirname(workspace.databasePath),
    `.${path.basename(workspace.databasePath)}.restore-original.1.deadbeef`
  );
  const storageRollbackPath = path.join(
    path.dirname(workspace.storagePath),
    `.${path.basename(workspace.storagePath)}.restore-rollback.1.deadbeef`
  );
  const databaseStage = path.join(
    path.dirname(workspace.databasePath),
    `.${path.basename(workspace.databasePath)}.restore-incoming.1.deadbeef`
  );
  const storageStage = path.join(
    path.dirname(workspace.storagePath),
    `.${path.basename(workspace.storagePath)}.restore-incoming.1.deadbeef`
  );
  await fsp.rename(workspace.databasePath, oldDatabasePath);
  const replacement = createDatabase(workspace.databasePath, 'replacement-before-crash');
  replacement.close();
  await fsp.rename(workspace.storagePath, storageRollbackPath);
  await fsp.mkdir(workspace.storagePath, { recursive: true });
  await fsp.writeFile(path.join(workspace.storagePath, 'replacement.txt'), 'replacement-media');

  const paths = maintenancePaths(workspace.databasePath);
  await fsp.writeFile(paths.journalPath, `${JSON.stringify({
    version: 1,
    operation: 'restore',
    phase: 'targets_replaced',
    databasePath: workspace.databasePath,
    storagePath: workspace.storagePath,
    databaseStage,
    storageStage,
    oldDatabasePath,
    storageRollbackPath,
    databaseRollbackPath: null,
    originalDatabaseExisted: true,
    originalStorageExisted: true,
    createdAt: new Date().toISOString(),
  })}\n`);

  const recovered = recoverInterruptedMaintenanceSync({
    databasePath: workspace.databasePath,
    storagePath: workspace.storagePath,
  });
  assert.deepEqual(recovered, { recovered: true, action: 'rolled_back' });
  assert.deepEqual(readDatabaseValues(workspace.databasePath), ['original-before-crash']);
  assert.equal(await fsp.readFile(path.join(workspace.storagePath, 'original.txt'), 'utf8'), 'original-media');
  assert.equal(
    await fsp.readFile(path.join(workspace.storySourcesPath, 'current.txt'), 'utf8'),
    'legacy-journal-source'
  );
  assert.equal(await fsp.stat(path.join(workspace.storagePath, 'replacement.txt')).catch(() => null), null);
  assert.equal(await fsp.stat(paths.journalPath).catch(() => null), null);
});

test('startup recovery rolls back an interrupted version 2 source-text switch', async (t) => {
  const workspace = await makeWorkspace(t);
  const original = createDatabase(workspace.databasePath, 'v2-original-before-crash');
  original.close();
  await fsp.writeFile(path.join(workspace.storagePath, 'original.txt'), 'v2-original-media');
  await fsp.writeFile(path.join(workspace.storySourcesPath, 'original.txt'), 'v2-original-source');

  const oldDatabasePath = path.join(
    path.dirname(workspace.databasePath),
    `.${path.basename(workspace.databasePath)}.restore-original.2.deadbeef`
  );
  const storageRollbackPath = path.join(
    path.dirname(workspace.storagePath),
    `.${path.basename(workspace.storagePath)}.restore-rollback.2.deadbeef`
  );
  const storySourcesRollbackPath = path.join(
    path.dirname(workspace.storySourcesPath),
    `.${path.basename(workspace.storySourcesPath)}.restore-rollback.2.deadbeef`
  );
  const databaseStage = path.join(
    path.dirname(workspace.databasePath),
    `.${path.basename(workspace.databasePath)}.restore-incoming.2.deadbeef`
  );
  const storageStage = path.join(
    path.dirname(workspace.storagePath),
    `.${path.basename(workspace.storagePath)}.restore-incoming.2.deadbeef`
  );
  const storySourcesStage = path.join(
    path.dirname(workspace.storySourcesPath),
    `.${path.basename(workspace.storySourcesPath)}.restore-incoming.2.deadbeef`
  );

  await fsp.rename(workspace.databasePath, oldDatabasePath);
  const replacement = createDatabase(workspace.databasePath, 'v2-replacement-before-crash');
  replacement.close();
  await fsp.rename(workspace.storagePath, storageRollbackPath);
  await fsp.mkdir(workspace.storagePath, { recursive: true });
  await fsp.writeFile(path.join(workspace.storagePath, 'replacement.txt'), 'v2-replacement-media');
  await fsp.rename(workspace.storySourcesPath, storySourcesRollbackPath);
  await fsp.mkdir(workspace.storySourcesPath, { recursive: true });
  await fsp.writeFile(path.join(workspace.storySourcesPath, 'replacement.txt'), 'v2-replacement-source');

  const paths = maintenancePaths(workspace.databasePath);
  await fsp.writeFile(paths.journalPath, `${JSON.stringify({
    version: 2,
    operation: 'restore',
    phase: 'targets_replaced',
    databasePath: workspace.databasePath,
    storagePath: workspace.storagePath,
    storySourcesPath: workspace.storySourcesPath,
    databaseStage,
    storageStage,
    storySourcesStage,
    oldDatabasePath,
    storageRollbackPath,
    storySourcesRollbackPath,
    databaseRollbackPath: null,
    originalDatabaseExisted: true,
    originalStorageExisted: true,
    originalStorySourcesExisted: true,
    replaceStorySources: true,
    createdAt: new Date().toISOString(),
  })}\n`);

  assert.deepEqual(recoverInterruptedMaintenanceSync(workspace), { recovered: true, action: 'rolled_back' });
  assert.deepEqual(readDatabaseValues(workspace.databasePath), ['v2-original-before-crash']);
  assert.equal(await fsp.readFile(path.join(workspace.storagePath, 'original.txt'), 'utf8'), 'v2-original-media');
  assert.equal(
    await fsp.readFile(path.join(workspace.storySourcesPath, 'original.txt'), 'utf8'),
    'v2-original-source'
  );
  assert.equal(await fsp.stat(path.join(workspace.storySourcesPath, 'replacement.txt')).catch(() => null), null);
  assert.equal(await fsp.stat(paths.journalPath).catch(() => null), null);
});

test('backup and restore CLIs pass the package-root story_sources directory', () => {
  for (const script of ['backup-data.js', 'restore-data.js']) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', script), 'utf8');
    assert.match(
      source,
      /storySourcesPath:\s*path\.join\(PACKAGE_ROOT, ['"]data['"], ['"]story_sources['"]\)/
    );
  }
});

test('backup and restore CLIs use the selected data root for every persistent target', async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'localminidrama-data-root-cli-'));
  t.after(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  const dataRoot = path.join(root, 'selected-data');
  const decoyRoot = path.join(root, 'decoy-data');
  const archivePath = path.join(root, 'checkpoint.zip');
  await fsp.mkdir(path.join(dataRoot, 'storage'), { recursive: true });
  await fsp.mkdir(path.join(dataRoot, 'story_sources'), { recursive: true });
  await fsp.mkdir(path.join(decoyRoot, 'storage'), { recursive: true });
  await fsp.mkdir(path.join(decoyRoot, 'story_sources'), { recursive: true });

  const selectedDatabase = path.join(dataRoot, 'drama_generator.db');
  const decoyDatabase = path.join(decoyRoot, 'drama_generator.db');
  createDatabase(selectedDatabase, 'selected-backup').close();
  createDatabase(decoyDatabase, 'decoy-original').close();
  await fsp.writeFile(path.join(dataRoot, 'storage', 'selected.txt'), 'selected-storage');
  await fsp.writeFile(path.join(dataRoot, 'story_sources', 'selected.txt'), 'selected-source');
  await fsp.writeFile(path.join(decoyRoot, 'storage', 'decoy.txt'), 'decoy-storage');
  await fsp.writeFile(path.join(decoyRoot, 'story_sources', 'decoy.txt'), 'decoy-source');

  const servicePort = await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
  const cliEnvironment = {
    ...process.env,
    HOST: '127.0.0.1',
    PORT: String(servicePort),
  };

  const scriptRoot = path.join(__dirname, '..', 'scripts');
  const backupResult = spawnSync(process.execPath, [
    path.join(scriptRoot, 'backup-data.js'),
    '--output',
    archivePath,
    '--data-root',
    dataRoot,
  ], { cwd: root, encoding: 'utf8', windowsHide: true, env: cliEnvironment });
  assert.equal(backupResult.status, 0, backupResult.stderr || backupResult.stdout);

  replaceDatabaseValue(selectedDatabase, 'selected-mutated');
  await fsp.rm(path.join(dataRoot, 'storage'), { recursive: true, force: true });
  await fsp.rm(path.join(dataRoot, 'story_sources'), { recursive: true, force: true });
  await fsp.mkdir(path.join(dataRoot, 'storage'), { recursive: true });
  await fsp.mkdir(path.join(dataRoot, 'story_sources'), { recursive: true });
  await fsp.writeFile(path.join(dataRoot, 'storage', 'mutated.txt'), 'mutated-storage');
  await fsp.writeFile(path.join(dataRoot, 'story_sources', 'mutated.txt'), 'mutated-source');

  const restoreResult = spawnSync(process.execPath, [
    path.join(scriptRoot, 'restore-data.js'),
    '--input',
    archivePath,
    '--yes',
    '--data-root',
    dataRoot,
  ], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    env: cliEnvironment,
  });
  assert.equal(restoreResult.status, 0, restoreResult.stderr || restoreResult.stdout);

  assert.deepEqual(readDatabaseValues(selectedDatabase), ['selected-backup']);
  assert.equal(await fsp.readFile(path.join(dataRoot, 'storage', 'selected.txt'), 'utf8'), 'selected-storage');
  assert.equal(await fsp.readFile(path.join(dataRoot, 'story_sources', 'selected.txt'), 'utf8'), 'selected-source');
  assert.equal(await fsp.stat(path.join(dataRoot, 'storage', 'mutated.txt')).catch(() => null), null);
  assert.equal(await fsp.stat(path.join(dataRoot, 'story_sources', 'mutated.txt')).catch(() => null), null);
  assert.deepEqual(readDatabaseValues(decoyDatabase), ['decoy-original']);
  assert.equal(await fsp.readFile(path.join(decoyRoot, 'storage', 'decoy.txt'), 'utf8'), 'decoy-storage');
  assert.equal(await fsp.readFile(path.join(decoyRoot, 'story_sources', 'decoy.txt'), 'utf8'), 'decoy-source');
});
