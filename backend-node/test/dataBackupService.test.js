const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const Database = require('better-sqlite3');
const AdmZip = require('adm-zip');
const { getGlobalSetting } = require('../src/services/settingsService');
const {
  __testing,
  FORMAT_VERSION,
  acquireServiceMaintenanceLockSync,
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

test('explicit maintenance scopes only migrate stale legacy Docker owner scopes', async (t) => {
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
  assert.deepEqual(
    recoverInterruptedMaintenanceSync({ ...workspace, ownerScope }),
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
