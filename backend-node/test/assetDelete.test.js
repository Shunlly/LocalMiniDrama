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
    CREATE TABLE dramas (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      created_at TEXT,
      metadata TEXT,
      deleted_at TEXT
    );
  `);
  return db;
}

function insertAsset(db, localPath, dramaId = null) {
  const now = new Date().toISOString();
  return Number(db.prepare(`
    INSERT INTO assets (drama_id, name, type, url, local_path, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(dramaId, 'upload', 'image', `/static/${String(localPath).replace(/\\/g, '/')}`, localPath, now, now).lastInsertRowid);
}

function insertDrama(db, id, metadata, deletedAt = null) {
  db.prepare(`
    INSERT INTO dramas (id, title, created_at, metadata, deleted_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, `Project ${id}`, '2026-07-27T00:00:00.000Z', metadata, deletedAt);
}

function freeCanvasMetadata(nodes) {
  return JSON.stringify({
    free_canvas: {
      version: 1,
      nodes,
      edges: [],
    },
  });
}

function canvasNode(id, overrides = {}) {
  return {
    id,
    type: 'image',
    position: { x: 0, y: 0 },
    ...overrides,
  };
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

test('a current project free canvas asset ID reference prevents deletion and unlinking', () => {
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-canvas-id-'));
  const db = createDb();
  const localPath = 'projects/0001_20260727_Project_1/uploads/id-only.png';
  const absolutePath = createStoredFile(storageRoot, localPath);
  const id = insertAsset(db, localPath, 1);
  insertDrama(db, 1, freeCanvasMetadata([
    canvasNode('asset-by-id', { assetId: String(id) }),
  ]));

  try {
    assert.throws(
      () => assetService.deleteById(db, log, id, { storageRoot }),
      (error) => {
        assert.equal(error.code, 'ASSET_IN_USE');
        assert.equal(error.statusCode, 409);
        assert.equal(error.details.reference_count, 1);
        assert.deepEqual(error.details.storyboard_ids, []);
        assert.equal(JSON.stringify({ message: error.message, details: error.details }).includes(localPath), false);
        return true;
      },
    );
    assert.equal(db.prepare('SELECT deleted_at FROM assets WHERE id = ?').get(id).deleted_at, null);
    assert.equal(fs.existsSync(absolutePath), true);
  } finally {
    db.close();
    fs.rmSync(storageRoot, { recursive: true, force: true });
  }
});

test('a global asset referenced by multiple active free canvas projects stays intact', () => {
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-canvas-global-'));
  const db = createDb();
  const localPath = 'library/uploads/global-shared.png';
  const absolutePath = createStoredFile(storageRoot, localPath);
  const id = insertAsset(db, localPath);
  insertDrama(db, 1, freeCanvasMetadata([
    canvasNode('global-by-asset-id', { assetId: String(id) }),
  ]));
  insertDrama(db, 2, freeCanvasMetadata([
    canvasNode('global-by-asset-ref', { asset_ref: `project:2:asset:${id}` }),
  ]));

  try {
    assert.throws(
      () => assetService.deleteById(db, log, id, { storageRoot }),
      (error) => error.code === 'ASSET_IN_USE'
        && error.statusCode === 409
        && error.details.reference_count === 2
        && error.details.storyboard_ids.length === 0,
    );
    assert.equal(db.prepare('SELECT deleted_at FROM assets WHERE id = ?').get(id).deleted_at, null);
    assert.equal(fs.existsSync(absolutePath), true);
  } finally {
    db.close();
    fs.rmSync(storageRoot, { recursive: true, force: true });
  }
});

test('a normalized free canvas local media path prevents deletion without an asset ID', () => {
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-canvas-path-'));
  const db = createDb();
  const localPath = 'library/uploads/path-only.png';
  const absolutePath = createStoredFile(storageRoot, localPath);
  const id = insertAsset(db, localPath);
  insertDrama(db, 1, freeCanvasMetadata([
    canvasNode('asset-by-path', { content: '/static/library\\uploads\\path-only.png' }),
  ]));

  try {
    assert.throws(
      () => assetService.deleteById(db, log, id, { storageRoot }),
      (error) => error.code === 'ASSET_IN_USE'
        && error.statusCode === 409
        && error.details.reference_count === 1,
    );
    assert.equal(db.prepare('SELECT deleted_at FROM assets WHERE id = ?').get(id).deleted_at, null);
    assert.equal(fs.existsSync(absolutePath), true);
  } finally {
    db.close();
    fs.rmSync(storageRoot, { recursive: true, force: true });
  }
});

test('free canvas references in deleted projects do not prevent deletion', () => {
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-canvas-deleted-project-'));
  const db = createDb();
  const localPath = 'library/uploads/deleted-project.png';
  const absolutePath = createStoredFile(storageRoot, localPath);
  const id = insertAsset(db, localPath);
  insertDrama(db, 1, freeCanvasMetadata([
    canvasNode('deleted-project-reference', { assetId: id, storageKey: localPath }),
  ]), '2026-07-27T01:00:00.000Z');

  try {
    assert.equal(assetService.deleteById(db, log, id, { storageRoot }), true);
    assert.notEqual(db.prepare('SELECT deleted_at FROM assets WHERE id = ?').get(id).deleted_at, null);
    assert.equal(fs.existsSync(absolutePath), false);
  } finally {
    db.close();
    fs.rmSync(storageRoot, { recursive: true, force: true });
  }
});

test('another project free canvas cannot hold a project-owned asset by ID or path', () => {
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-canvas-project-scope-'));
  const db = createDb();
  const localPath = 'projects/0001_20260727_Project_1/uploads/project-only.png';
  const absolutePath = createStoredFile(storageRoot, localPath);
  const id = insertAsset(db, localPath, 1);
  insertDrama(db, 1, freeCanvasMetadata([]));
  insertDrama(db, 2, freeCanvasMetadata([
    canvasNode('cross-project-id', { assetId: id }),
    canvasNode('cross-project-path', { content: localPath }),
  ]));

  try {
    assert.equal(assetService.deleteById(db, log, id, { storageRoot }), true);
    assert.notEqual(db.prepare('SELECT deleted_at FROM assets WHERE id = ?').get(id).deleted_at, null);
    assert.equal(fs.existsSync(absolutePath), false);
  } finally {
    db.close();
    fs.rmSync(storageRoot, { recursive: true, force: true });
  }
});

test('unrelated, remote, pseudo-prefix, and text paths do not prevent deletion', () => {
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-canvas-nonmatches-'));
  const db = createDb();
  const localPath = 'library/uploads/nonmatch-target.png';
  const absolutePath = createStoredFile(storageRoot, localPath);
  const id = insertAsset(db, localPath);
  insertDrama(db, 1, freeCanvasMetadata([
    canvasNode('unrelated-local', { content: 'library/uploads/other.png' }),
    canvasNode('remote-lookalike', { content: `https://example.test/static/${localPath}` }),
    canvasNode('pseudo-prefix', { content: `${localPath}.preview` }),
    canvasNode('unrelated-id', { asset_ref: `asset:${id}0` }),
    canvasNode('text-lookalike', { type: 'text', content: localPath }),
  ]));

  try {
    assert.equal(assetService.deleteById(db, log, id, { storageRoot }), true);
    assert.notEqual(db.prepare('SELECT deleted_at FROM assets WHERE id = ?').get(id).deleted_at, null);
    assert.equal(fs.existsSync(absolutePath), false);
  } finally {
    db.close();
    fs.rmSync(storageRoot, { recursive: true, force: true });
  }
});

test('malformed active project metadata fails closed before deletion or unlinking', () => {
  const cases = [
    ['truncated JSON', '{"free_canvas":'],
    ['empty metadata', ''],
    ['non-object metadata', '[]'],
    ['invalid free canvas nodes', '{"free_canvas":{"version":1,"nodes":{}}}'],
  ];
  for (const [label, metadata] of cases) {
    const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-canvas-malformed-'));
    const db = createDb();
    const localPath = `library/uploads/malformed-${label.replace(/ /g, '-')}.png`;
    const absolutePath = createStoredFile(storageRoot, localPath);
    const id = insertAsset(db, localPath);
    insertDrama(db, 1, metadata);

    try {
      assert.throws(
        () => assetService.deleteById(db, log, id, { storageRoot }),
        (error) => error.code === 'ASSET_IN_USE'
          && error.statusCode === 409
          && !JSON.stringify({ message: error.message, details: error.details }).includes(localPath),
        label,
      );
      assert.equal(db.prepare('SELECT deleted_at FROM assets WHERE id = ?').get(id).deleted_at, null);
      assert.equal(fs.existsSync(absolutePath), true);
    } finally {
      db.close();
      fs.rmSync(storageRoot, { recursive: true, force: true });
    }
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
