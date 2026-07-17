const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

const assetService = require('../src/services/assetService');

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      drama_id INTEGER,
      name TEXT,
      description TEXT,
      type TEXT,
      category TEXT,
      url TEXT,
      local_path TEXT,
      thumbnail_url TEXT,
      file_size INTEGER,
      mime_type TEXT,
      width INTEGER,
      height INTEGER,
      duration REAL,
      image_gen_id INTEGER,
      video_gen_id INTEGER,
      is_favorite INTEGER DEFAULT 0,
      created_at TEXT,
      updated_at TEXT,
      deleted_at TEXT
    );
    CREATE TABLE storyboards (
      id INTEGER PRIMARY KEY,
      reference_images TEXT,
      deleted_at TEXT
    );
  `);
  return db;
}

function insertAsset(db, localPath) {
  const now = new Date().toISOString();
  return Number(db.prepare(`
    INSERT INTO assets (name, type, url, local_path, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run('upload', 'image', `/static/${String(localPath).replace(/\\/g, '/')}`, localPath, now, now).lastInsertRowid);
}

function createStoredFile(storageRoot, localPath) {
  const absolutePath = path.join(storageRoot, ...localPath.split('/'));
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, 'media');
  return absolutePath;
}

const log = { info() {}, warn() {}, error() {} };

test('deleting an unshared uploaded asset removes its controlled file', () => {
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-delete-'));
  const db = createDb();
  const localPath = 'library/uploads/only.png';
  const absolutePath = createStoredFile(storageRoot, localPath);
  const id = insertAsset(db, localPath);

  try {
    assert.equal(assetService.deleteById(db, log, id, { storageRoot }), true);
    assert.equal(fs.existsSync(absolutePath), false);
    assert.notEqual(db.prepare('SELECT deleted_at FROM assets WHERE id = ?').get(id).deleted_at, null);
  } finally {
    db.close();
    fs.rmSync(storageRoot, { recursive: true, force: true });
  }
});

test('shared upload remains until the final active asset reference is deleted', () => {
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-shared-'));
  const db = createDb();
  const localPath = 'projects/project-a/uploads/shared.mp4';
  const absolutePath = createStoredFile(storageRoot, localPath);
  const firstId = insertAsset(db, localPath);
  const secondId = insertAsset(db, localPath.replace(/\//g, '\\'));

  try {
    assert.equal(assetService.deleteById(db, log, firstId, { storageRoot }), true);
    assert.equal(fs.existsSync(absolutePath), true);
    assert.equal(assetService.deleteById(db, log, secondId, { storageRoot }), true);
    assert.equal(fs.existsSync(absolutePath), false);
  } finally {
    db.close();
    fs.rmSync(storageRoot, { recursive: true, force: true });
  }
});

test('referenced cross-project assets cannot be deleted or unlinked', () => {
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-referenced-'));
  const db = createDb();
  const localPath = 'projects/source/uploads/referenced.png';
  const absolutePath = createStoredFile(storageRoot, localPath);
  const id = insertAsset(db, localPath);
  db.prepare('INSERT INTO storyboards (id, reference_images) VALUES (?, ?)').run(101, JSON.stringify([{
    name: 'Cross-project reference',
    local_path: localPath,
    asset_id: id,
    source_drama_id: 7,
  }]));

  try {
    assert.throws(
      () => assetService.deleteById(db, log, id, { storageRoot }),
      (error) => error.code === 'ASSET_IN_USE'
        && error.statusCode === 409
        && error.details.reference_count === 1
        && error.details.storyboard_ids[0] === 101
    );
    assert.equal(db.prepare('SELECT deleted_at FROM assets WHERE id = ?').get(id).deleted_at, null);
    assert.equal(fs.existsSync(absolutePath), true);

    db.prepare("UPDATE storyboards SET reference_images = '[]' WHERE id = 101").run();
    assert.equal(assetService.deleteById(db, log, id, { storageRoot }), true);
    assert.equal(fs.existsSync(absolutePath), false);
  } finally {
    db.close();
    fs.rmSync(storageRoot, { recursive: true, force: true });
  }
});

test('soft deletion never unlinks files outside the controlled uploads directory', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-outside-'));
  const storageRoot = path.join(parent, 'storage');
  const outsidePath = path.join(parent, 'outside', 'uploads', 'keep.png');
  fs.mkdirSync(storageRoot, { recursive: true });
  fs.mkdirSync(path.dirname(outsidePath), { recursive: true });
  fs.writeFileSync(outsidePath, 'keep');
  const db = createDb();
  const id = insertAsset(db, '../outside/uploads/keep.png');

  try {
    assert.equal(assetService.deleteById(db, log, id, { storageRoot }), true);
    assert.equal(fs.existsSync(outsidePath), true);
  } finally {
    db.close();
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('a commit failure rolls back the asset row without deleting its file', () => {
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-commit-failure-'));
  const db = createDb();
  const localPath = 'library/uploads/commit-safe.png';
  const absolutePath = createStoredFile(storageRoot, localPath);
  const id = insertAsset(db, localPath);

  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE asset_delete_commit_guard (
      id INTEGER PRIMARY KEY,
      asset_id INTEGER,
      FOREIGN KEY (asset_id) REFERENCES assets(id) DEFERRABLE INITIALLY DEFERRED
    );
    CREATE TRIGGER force_asset_delete_commit_failure
    AFTER UPDATE OF deleted_at ON assets
    WHEN NEW.deleted_at IS NOT NULL
    BEGIN
      INSERT INTO asset_delete_commit_guard (asset_id) VALUES (999999);
    END;
  `);

  try {
    assert.throws(
      () => assetService.deleteById(db, log, id, { storageRoot }),
      /FOREIGN KEY constraint failed/
    );
    assert.equal(db.prepare('SELECT deleted_at FROM assets WHERE id = ?').get(id).deleted_at, null);
    assert.equal(fs.existsSync(absolutePath), true);
  } finally {
    db.close();
    fs.rmSync(storageRoot, { recursive: true, force: true });
  }
});
