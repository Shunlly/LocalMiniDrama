const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');

const assetService = require('../src/services/assetService');
const references = require('../src/services/assetServiceReferences');

const DRAMA_ACTIVE = 11;
const DRAMA_OTHER = 22;
const ASSET_ACTIVE = 1101;
const ASSET_OTHER = 2202;
const STORYBOARD_ACTIVE = 3301;
const LIBRARY_DRAMA = 9909;

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE dramas (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      created_at TEXT,
      metadata TEXT,
      deleted_at TEXT
    );
    CREATE TABLE assets (
      id INTEGER PRIMARY KEY,
      drama_id INTEGER,
      name TEXT,
      type TEXT,
      url TEXT,
      local_path TEXT,
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

test('跨模块 ID 在引用用例里互不相等，避免碰巧同值假通过', () => {
  const ids = [DRAMA_ACTIVE, DRAMA_OTHER, ASSET_ACTIVE, ASSET_OTHER, STORYBOARD_ACTIVE, LIBRARY_DRAMA];
  assert.equal(new Set(ids).size, ids.length);
  assert.notEqual(DRAMA_ACTIVE, ASSET_ACTIVE);
  assert.notEqual(DRAMA_ACTIVE, LIBRARY_DRAMA);
});

test('服务文件已抽出引用检查，公开 API 仍指向引用模块的同一函数', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/services/assetService.js'), 'utf8');
  for (const name of [
    'function storyboardReferencesForAsset',
    'function freeCanvasReferencesForAsset',
    'function nodeAssetIdMatches',
    'function sameControlledFile',
    'function assetInUseError',
  ]) {
    assert.equal(src.includes(name), false, name);
  }
  assert.equal(src.includes('function create'), true);
  assert.equal(src.includes('function deleteById'), true);
  assert.equal(src.includes('function importFromImage'), true);
  assert.equal(src.includes('function importFromVideo'), true);
  assert.equal(src.includes('function importFromNetwork'), true);
  assert.equal(assetService.storyboardReferencesForAsset, references.storyboardReferencesForAsset);
  assert.equal(typeof assetService.freeCanvasReferencesForAsset, 'undefined');
  assert.equal(typeof assetService.assetInUseError, 'undefined');
  assert.deepEqual(Object.keys(assetService).sort(), [
    'cleanupNetworkImportOrphans',
    'create',
    'deleteById',
    'getById',
    'importFromImage',
    'importFromNetwork',
    'importFromVideo',
    'list',
    'proxyNetworkThumbnail',
    'searchNetwork',
    'startNetworkImportOrphanCleanup',
    'storyboardReferencesForAsset',
    'update',
  ]);
});

test('分镜引用按 asset_id 或规范化路径命中，不会把 library_id 当成素材 ID', () => {
  const db = createDb();
  try {
    const asset = { id: ASSET_ACTIVE, local_path: 'library/uploads/a.png' };
    db.prepare('INSERT INTO storyboards (id, reference_images, deleted_at) VALUES (?, ?, NULL)').run(
      STORYBOARD_ACTIVE,
      JSON.stringify([{ asset_id: ASSET_ACTIVE, local_path: 'library/uploads/other.png' }]),
    );
    db.prepare('INSERT INTO storyboards (id, reference_images, deleted_at) VALUES (?, ?, NULL)').run(
      STORYBOARD_ACTIVE + 1,
      JSON.stringify(['/static/library/uploads/a.png']),
    );
    db.prepare('INSERT INTO storyboards (id, reference_images, deleted_at) VALUES (?, ?, NULL)').run(
      STORYBOARD_ACTIVE + 2,
      JSON.stringify([{ asset_id: LIBRARY_DRAMA, local_path: 'library/uploads/unrelated.png' }]),
    );
    assert.deepEqual(
      references.storyboardReferencesForAsset(db, asset),
      [STORYBOARD_ACTIVE, STORYBOARD_ACTIVE + 1],
    );
  } finally {
    db.close();
  }
});

test('自由画布引用只扫描当前项目，除非素材是全局上传', () => {
  const db = createDb();
  try {
    db.prepare('INSERT INTO dramas (id, title, created_at, metadata, deleted_at) VALUES (?, ?, ?, ?, NULL)').run(
      DRAMA_ACTIVE,
      '夜雨',
      '2026-07-27T00:00:00.000Z',
      JSON.stringify({
        free_canvas: {
          version: 1,
          nodes: [{ id: 'n1', type: 'image', assetId: String(ASSET_ACTIVE) }],
          edges: [],
        },
      }),
    );
    db.prepare('INSERT INTO dramas (id, title, created_at, metadata, deleted_at) VALUES (?, ?, ?, ?, NULL)').run(
      DRAMA_OTHER,
      '另一部',
      '2026-07-27T00:00:00.000Z',
      JSON.stringify({
        free_canvas: {
          version: 1,
          nodes: [{ id: 'n2', type: 'image', assetId: String(ASSET_ACTIVE) }],
          edges: [],
        },
      }),
    );
    assert.deepEqual(
      references.freeCanvasReferencesForAsset(db, {
        id: ASSET_ACTIVE,
        drama_id: DRAMA_ACTIVE,
        local_path: 'library/uploads/a.png',
      }),
      [DRAMA_ACTIVE],
    );
    assert.deepEqual(
      references.freeCanvasReferencesForAsset(db, {
        id: ASSET_ACTIVE,
        drama_id: null,
        local_path: 'library/uploads/a.png',
      }),
      [DRAMA_ACTIVE, DRAMA_OTHER],
    );
  } finally {
    db.close();
  }
});

test('占用错误按分镜和画布引用组合生成中文冲突信息', () => {
  const storyboardOnly = references.assetInUseError([STORYBOARD_ACTIVE]);
  assert.equal(storyboardOnly.code, 'ASSET_IN_USE');
  assert.equal(storyboardOnly.statusCode, 409);
  assert.equal(storyboardOnly.message, '素材正在被 1 个分镜引用，请先从分镜中移除后再删除');
  assert.deepEqual(storyboardOnly.details, {
    reference_count: 1,
    storyboard_ids: [STORYBOARD_ACTIVE],
  });

  const combined = references.assetInUseError([STORYBOARD_ACTIVE], [DRAMA_ACTIVE]);
  assert.equal(combined.message, '素材正在被 2 处引用，请先移除引用后再删除');
  assert.deepEqual(combined.details, {
    reference_count: 2,
    storyboard_ids: [STORYBOARD_ACTIVE],
    free_canvas_drama_ids: [DRAMA_ACTIVE],
  });
});

test('受控文件同一性同时比较规范化路径、真实路径和 inode 身份', () => {
  assert.equal(references.sameControlledFile(null, { identity: '1:1' }), false);
  assert.equal(references.sameControlledFile({
    normalizedPath: 'library/uploads/a.png',
    realPath: path.resolve('/tmp/a.png'),
    identity: '1:2',
  }, {
    normalizedPath: 'library/uploads/a.png',
    realPath: path.resolve('/tmp/a.png'),
    identity: '1:2',
  }), true);
  assert.equal(references.sameControlledFile({
    normalizedPath: 'library/uploads/a.png',
    realPath: path.resolve('/tmp/a.png'),
    identity: '1:2',
  }, {
    normalizedPath: 'library/uploads/a.png',
    realPath: path.resolve('/tmp/a.png'),
    identity: '1:3',
  }), false);
});
