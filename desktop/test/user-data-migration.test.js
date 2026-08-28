'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { removeFixtureTree } = require('./fixture-fs');

const {
  migrateLegacyDevelopmentData,
  migrateLegacyUserData,
  planLegacyUserDataMigration,
  resolveDesktopUserDataDir,
} = require('../scripts/user-data-migration');

function createRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-user-data-'));
  t.after(() => removeFixtureTree(root));
  return root;
}

test('migration planning is deterministic and has no filesystem dependency', () => {
  const options = {
    appDataDir: path.join('C:', 'fixture', 'AppData', 'Roaming'),
    userDataDir: path.join('C:', 'fixture', 'AppData', 'Roaming', 'localminidrama-desktop'),
    legacyExists: true,
    destinationExists: false,
  };

  const first = planLegacyUserDataMigration(options);
  const second = planLegacyUserDataMigration(options);

  assert.deepEqual(first, second);
  assert.equal(first.shouldMigrate, true);
  assert.equal(first.reason, 'ready');
});

test('desktop userData defaults isolate development from packaged installs and honor overrides', () => {
  const appDataDir = path.join('C:', 'fixture', 'AppData', 'Roaming');

  assert.equal(
    resolveDesktopUserDataDir({ appDataDir, isPackaged: false, environment: {} }),
    path.resolve(appDataDir, 'localminidrama-desktop-dev')
  );
  assert.equal(
    resolveDesktopUserDataDir({ appDataDir, isPackaged: true, environment: {} }),
    path.resolve(appDataDir, 'localminidrama-desktop')
  );
  assert.equal(
    resolveDesktopUserDataDir({
      appDataDir,
      isPackaged: false,
      environment: { LOCALMINIDRAMA_USER_DATA_DIR: path.join(appDataDir, 'explicit') },
    }),
    path.resolve(appDataDir, 'explicit')
  );
});

test('legacy development data is copied to isolated userData without deleting its source', (t) => {
  const root = createRoot(t);
  const legacyBackendRoot = path.join(root, 'desktop', 'backend-app');
  const userDataDir = path.join(root, 'app-data', 'localminidrama-desktop-dev');
  const fixtures = new Map([
    ['data/drama_generator.db', 'legacy database'],
    ['data/drama_generator.db-journal', 'legacy journal'],
    ['data/drama_generator.db-wal', 'legacy wal'],
    ['data/storage/uploads/frame.png', 'legacy image'],
    ['data/story_sources/7/original.txt', 'legacy story'],
    ['data/backups/legacy.zip', 'legacy backup'],
  ]);
  for (const [relativePath, contents] of fixtures) {
    const source = path.join(legacyBackendRoot, relativePath);
    fs.mkdirSync(path.dirname(source), { recursive: true });
    fs.writeFileSync(source, contents);
  }

  const first = migrateLegacyDevelopmentData({ legacyBackendRoot, userDataDir });
  const second = migrateLegacyDevelopmentData({ legacyBackendRoot, userDataDir });

  assert.equal(first.migrated, true);
  assert.equal(first.reason, 'migrated');
  assert.equal(second.migrated, false);
  assert.equal(second.reason, 'already-migrated');
  assert.deepEqual(first.files, [...fixtures.keys()].sort());
  for (const [relativePath, contents] of fixtures) {
    assert.equal(fs.readFileSync(path.join(legacyBackendRoot, relativePath), 'utf8'), contents);
    assert.equal(
      fs.readFileSync(path.join(userDataDir, 'backend', relativePath), 'utf8'),
      contents
    );
  }
});

test('legacy development migration fails closed on conflicting destination data', (t) => {
  const root = createRoot(t);
  const legacyBackendRoot = path.join(root, 'desktop', 'backend-app');
  const userDataDir = path.join(root, 'app-data', 'localminidrama-desktop-dev');
  const sourceDatabase = path.join(legacyBackendRoot, 'data', 'drama_generator.db');
  const destinationDatabase = path.join(userDataDir, 'backend', 'data', 'drama_generator.db');
  fs.mkdirSync(path.dirname(sourceDatabase), { recursive: true });
  fs.mkdirSync(path.dirname(destinationDatabase), { recursive: true });
  fs.writeFileSync(sourceDatabase, 'legacy database');
  fs.writeFileSync(destinationDatabase, 'current database');

  assert.throws(
    () => migrateLegacyDevelopmentData({ legacyBackendRoot, userDataDir }),
    /conflict/i
  );
  assert.equal(fs.readFileSync(sourceDatabase, 'utf8'), 'legacy database');
  assert.equal(fs.readFileSync(destinationDatabase, 'utf8'), 'current database');
});

test('legacy development migration rejects extra destination data instead of merging datasets', (t) => {
  const root = createRoot(t);
  const legacyBackendRoot = path.join(root, 'desktop', 'backend-app');
  const userDataDir = path.join(root, 'app-data', 'localminidrama-desktop-dev');
  const sourceDatabase = path.join(legacyBackendRoot, 'data', 'drama_generator.db');
  const destinationDatabase = path.join(userDataDir, 'backend', 'data', 'drama_generator.db');
  const destinationOnlyMedia = path.join(
    userDataDir,
    'backend',
    'data',
    'storage',
    'uploads',
    'current-frame.png'
  );
  fs.mkdirSync(path.dirname(sourceDatabase), { recursive: true });
  fs.mkdirSync(path.dirname(destinationDatabase), { recursive: true });
  fs.mkdirSync(path.dirname(destinationOnlyMedia), { recursive: true });
  fs.writeFileSync(sourceDatabase, 'same database');
  fs.writeFileSync(destinationDatabase, 'same database');
  fs.writeFileSync(destinationOnlyMedia, 'current-only image');

  assert.throws(
    () => migrateLegacyDevelopmentData({ legacyBackendRoot, userDataDir }),
    /conflict/i
  );
  assert.equal(fs.readFileSync(sourceDatabase, 'utf8'), 'same database');
  assert.equal(fs.readFileSync(destinationOnlyMedia, 'utf8'), 'current-only image');
});

test('legacy development migration rejects unrecognized mutable data', (t) => {
  const root = createRoot(t);
  const legacyBackendRoot = path.join(root, 'desktop', 'backend-app');
  const userDataDir = path.join(root, 'app-data', 'localminidrama-desktop-dev');
  const unknownData = path.join(legacyBackendRoot, 'data', 'unclassified-cache');
  fs.mkdirSync(unknownData, { recursive: true });
  fs.writeFileSync(path.join(unknownData, 'payload.bin'), 'unknown');

  assert.throws(
    () => migrateLegacyDevelopmentData({ legacyBackendRoot, userDataDir }),
    /unrecognized legacy development data/i
  );
  assert.equal(fs.readFileSync(path.join(unknownData, 'payload.bin'), 'utf8'), 'unknown');
  assert.equal(fs.existsSync(userDataDir), false);
});

test('legacy development migration rejects overlapping source and destination trees', (t) => {
  const root = createRoot(t);
  const legacyBackendRoot = path.join(root, 'desktop', 'backend-app');
  const sourceDatabase = path.join(legacyBackendRoot, 'data', 'drama_generator.db');
  fs.mkdirSync(path.dirname(sourceDatabase), { recursive: true });
  fs.writeFileSync(sourceDatabase, 'legacy database');

  assert.throws(
    () => migrateLegacyDevelopmentData({
      legacyBackendRoot,
      userDataDir: path.join(legacyBackendRoot, 'nested-user-data'),
    }),
    /separate trees/i
  );
  assert.equal(fs.readFileSync(sourceDatabase, 'utf8'), 'legacy database');
});

test('legacy development migration rejects a linked backend root', (t) => {
  const root = createRoot(t);
  const realBackendRoot = path.join(root, 'real-backend-app');
  const linkedBackendRoot = path.join(root, 'linked-backend-app');
  const sourceDatabase = path.join(realBackendRoot, 'data', 'drama_generator.db');
  const userDataDir = path.join(root, 'app-data', 'localminidrama-desktop-dev');
  fs.mkdirSync(path.dirname(sourceDatabase), { recursive: true });
  fs.writeFileSync(sourceDatabase, 'legacy database');
  try {
    fs.symlinkSync(realBackendRoot, linkedBackendRoot, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (error.code === 'EPERM' || error.code === 'EACCES') {
      t.skip('directory links are unavailable in this environment');
      return;
    }
    throw error;
  }

  assert.throws(
    () => migrateLegacyDevelopmentData({ legacyBackendRoot: linkedBackendRoot, userDataDir }),
    /symbolic link|real directory/i
  );
  assert.equal(fs.readFileSync(sourceDatabase, 'utf8'), 'legacy database');
  assert.equal(fs.existsSync(userDataDir), false);
});

test('legacy database and generated media remain visible after migration', (t) => {
  const appDataDir = createRoot(t);
  const legacyRoot = path.join(appDataDir, 'LocalMiniDrama');
  const destinationRoot = path.join(appDataDir, 'localminidrama-desktop');
  const database = path.join(legacyRoot, 'backend', 'data', 'drama_generator.db');
  const image = path.join(legacyRoot, 'backend', 'data', 'storage', 'images', 'legacy-frame.png');
  fs.mkdirSync(path.dirname(database), { recursive: true });
  fs.mkdirSync(path.dirname(image), { recursive: true });
  fs.writeFileSync(database, 'legacy database fixture');
  fs.writeFileSync(image, 'legacy image fixture');

  const result = migrateLegacyUserData({ appDataDir, userDataDir: destinationRoot });

  assert.equal(result.migrated, true);
  assert.equal(result.reason, 'migrated');
  assert.equal(fs.existsSync(legacyRoot), false);
  assert.equal(
    fs.readFileSync(path.join(destinationRoot, 'backend', 'data', 'drama_generator.db'), 'utf8'),
    'legacy database fixture'
  );
  assert.equal(
    fs.readFileSync(
      path.join(destinationRoot, 'backend', 'data', 'storage', 'images', 'legacy-frame.png'),
      'utf8'
    ),
    'legacy image fixture'
  );
});

test('an existing destination is never merged with or overwritten by legacy data', (t) => {
  const appDataDir = createRoot(t);
  const legacyRoot = path.join(appDataDir, 'LocalMiniDrama');
  const destinationRoot = path.join(appDataDir, 'localminidrama-desktop');
  fs.mkdirSync(legacyRoot, { recursive: true });
  fs.mkdirSync(destinationRoot, { recursive: true });
  fs.writeFileSync(path.join(legacyRoot, 'legacy.txt'), 'legacy');
  fs.writeFileSync(path.join(destinationRoot, 'current.txt'), 'current');

  const result = migrateLegacyUserData({ appDataDir, userDataDir: destinationRoot });

  assert.equal(result.migrated, false);
  assert.equal(result.reason, 'destination-exists');
  assert.equal(fs.readFileSync(path.join(legacyRoot, 'legacy.txt'), 'utf8'), 'legacy');
  assert.equal(fs.readFileSync(path.join(destinationRoot, 'current.txt'), 'utf8'), 'current');
});
