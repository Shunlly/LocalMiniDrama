'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  migrateLegacyUserData,
  planLegacyUserDataMigration,
} = require('../scripts/user-data-migration');

function createRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-user-data-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
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
