const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');

const assetService = require('../src/services/assetService');
const query = require('../src/services/assetServiceQuery');
const { rowToItem, encodeNetworkSourceMetadata } = require('../src/services/assetServiceAssembly');

const DRAMA_ACTIVE = 11;
const DRAMA_RECYCLING = 22;
const DRAMA_OTHER = 33;
const DRAMA_DELETED = 44;
const ASSET_ACTIVE = 1101;
const ASSET_RECYCLING = 2202;
const ASSET_OTHER = 3303;
const ASSET_GLOBAL = 4404;
const ASSET_DELETED = 5505;
const ASSET_NETWORK = 6606;
const ASSET_NETWORK_OTHER = 7707;
const ASSET_NETWORK_GLOBAL = 8808;
const LIBRARY_DRAMA = 9909;
const LIBRARY_OTHER = 10101;
const LIBRARY_GLOBAL = 11111;
const OPENVERSE_ID = '123e4567-e89b-12d3-a456-426614174000';

const log = { info() {}, warn() {}, error() {} };

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE dramas (
      id INTEGER PRIMARY KEY, title TEXT, status TEXT, metadata TEXT,
      created_at TEXT, deleted_at TEXT, trash_state TEXT, recycle_phase TEXT
    );
    CREATE TABLE assets (
      id INTEGER PRIMARY KEY,
      drama_id INTEGER,
      name TEXT,
      type TEXT,
      category TEXT,
      url TEXT,
      local_path TEXT,
      file_size INTEGER,
      mime_type TEXT,
      width INTEGER,
      height INTEGER,
      duration REAL,
      image_gen_id INTEGER,
      video_gen_id INTEGER,
      created_at TEXT,
      updated_at TEXT,
      deleted_at TEXT
    );
    INSERT INTO dramas VALUES
      (${DRAMA_ACTIVE}, '夜雨', 'draft', NULL, '2026-01-01', NULL, NULL, NULL),
      (${DRAMA_RECYCLING}, '回收中', 'draft', NULL, '2026-01-01', NULL, 'recycling', 'claimed'),
      (${DRAMA_OTHER}, '另一个可读', 'draft', NULL, '2026-01-01', NULL, NULL, NULL),
      (${DRAMA_DELETED}, '已删除', 'draft', NULL, '2026-01-01', '2026-01-02', NULL, NULL);
    INSERT INTO assets
      (id, drama_id, name, type, category, url, local_path, created_at, updated_at, deleted_at)
    VALUES
      (${ASSET_ACTIVE}, ${DRAMA_ACTIVE}, '码头夜雨', 'image', 'prop', '/static/a.png', 'library/uploads/a.png', '2026-01-03', '2026-01-03', NULL),
      (${ASSET_RECYCLING}, ${DRAMA_RECYCLING}, '回收素材', 'image', 'prop', '/static/r.png', 'library/uploads/r.png', '2026-01-02', '2026-01-02', NULL),
      (${ASSET_OTHER}, ${DRAMA_OTHER}, '山道晨雾', 'video', 'scene', '/static/e.mp4', 'library/uploads/e.mp4', '2026-01-06', '2026-01-06', NULL),
      (${ASSET_GLOBAL}, NULL, '全局上传', 'image', 'upload', '/static/g.png', 'library/uploads/g.png', '2026-01-05', '2026-01-05', NULL),
      (${ASSET_DELETED}, ${DRAMA_ACTIVE}, '已删素材', 'image', 'prop', '/static/x.png', 'library/uploads/x.png', '2026-01-01', '2026-01-01', '2026-01-07');
  `);

  const commons = encodeNetworkSourceMetadata({
    kind: 'wikimedia_commons',
    source_url: 'https://commons.wikimedia.org/wiki/File:Dock.jpg',
    author: '作者甲',
    license: 'CC BY-SA 4.0',
    license_url: 'https://creativecommons.org/licenses/by-sa/4.0/',
    commons_title: 'File:Dock.jpg',
    commons_page_id: 1,
    commons_revision_timestamp: '2026-01-01T00:00:00Z',
    commons_sha1: 'sha1-a',
    resolved_download_url: 'https://commons.wikimedia.org/wiki/Special:FilePath/Dock.jpg',
    content_sha256: 'hash-a',
  });
  const openverse = encodeNetworkSourceMetadata({
    kind: 'openverse',
    source_url: `https://openverse.org/image/${OPENVERSE_ID}`,
    author: '作者乙',
    license: 'by-sa',
    license_url: 'https://creativecommons.org/licenses/by-sa/4.0/',
    landing_page: `https://openverse.org/image/${OPENVERSE_ID}`,
    openverse_id: OPENVERSE_ID,
    source_site: 'flickr',
    indexed_on: '2026-01-01',
    resolved_download_url: 'https://openverse.org/image/download',
    content_sha256: 'hash-b',
  });
  db.prepare(
    `INSERT INTO assets
      (id, drama_id, name, type, category, url, local_path, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, 'image', ?, ?, ?, '2026-01-04', '2026-01-04', NULL)`
  ).run(ASSET_NETWORK, DRAMA_ACTIVE, '网络码头', commons, '/static/n.png', 'library/uploads/n.png');
  db.prepare(
    `INSERT INTO assets
      (id, drama_id, name, type, category, url, local_path, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, 'image', ?, ?, ?, '2026-01-04', '2026-01-04', NULL)`
  ).run(ASSET_NETWORK_OTHER, DRAMA_OTHER, '其他网络码头', commons, '/static/no.png', 'library/uploads/no.png');
  db.prepare(
    `INSERT INTO assets
      (id, drama_id, name, type, category, url, local_path, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, 'image', ?, ?, ?, '2026-01-04', '2026-01-04', NULL)`
  ).run(ASSET_NETWORK_GLOBAL, null, '全局 Openverse', openverse, '/static/ng.png', 'library/uploads/ng.png');
  return db;
}

test('跨模块 ID 在测试数据里互不相等，避免碰巧同值假通过', () => {
  const ids = [
    DRAMA_ACTIVE, DRAMA_RECYCLING, DRAMA_OTHER, DRAMA_DELETED,
    ASSET_ACTIVE, ASSET_RECYCLING, ASSET_OTHER, ASSET_GLOBAL, ASSET_DELETED,
    ASSET_NETWORK, ASSET_NETWORK_OTHER, ASSET_NETWORK_GLOBAL,
    LIBRARY_DRAMA, LIBRARY_OTHER, LIBRARY_GLOBAL,
  ];
  assert.equal(new Set(ids).size, ids.length);
  assert.notEqual(DRAMA_ACTIVE, ASSET_ACTIVE);
  assert.notEqual(DRAMA_ACTIVE, LIBRARY_DRAMA);
  assert.notEqual(ASSET_ACTIVE, LIBRARY_DRAMA);
});

test('服务文件已抽出查询、装配和作用域校验', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/services/assetService.js'), 'utf8');
  for (const name of [
    'function list',
    'function getById',
    'function rowToItem',
    'function parseNetworkSourceMetadata',
    'function encodeNetworkSourceMetadata',
    'function isUnchangedNetworkSource',
    'function resolveDramaScope',
    'function findNetworkAssetBySource',
    'function parseOpenverseSourceMetadata',
  ]) {
    assert.equal(src.includes(name), false, name);
  }
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

test('assetService 公开查询 API 仍指向查询模块的同一函数', () => {
  assert.equal(assetService.list, query.list);
  assert.equal(assetService.getById, query.getById);
});

test('列表按 drama_id 过滤，不会把 asset_id 或 library_id 当成项目范围', () => {
  const db = createDb();
  try {
    const all = query.list(db, {});
    assert.deepEqual(all.items.map((item) => item.id), [
      ASSET_OTHER, ASSET_GLOBAL, ASSET_NETWORK_GLOBAL, ASSET_NETWORK_OTHER, ASSET_NETWORK, ASSET_ACTIVE,
    ]);
    assert.equal(all.total, 6);
    assert.deepEqual(query.list(db, { drama_id: DRAMA_ACTIVE }).items.map((item) => item.id), [
      ASSET_NETWORK, ASSET_ACTIVE,
    ]);
    assert.deepEqual(query.list(db, { drama_id: DRAMA_OTHER }).items.map((item) => item.id), [
      ASSET_OTHER, ASSET_NETWORK_OTHER,
    ]);
    assert.deepEqual(query.list(db, { drama_id: ASSET_ACTIVE }).items, []);
    assert.deepEqual(query.list(db, { drama_id: LIBRARY_DRAMA }).items, []);
    assert.deepEqual(
      query.list(db, { library_id: LIBRARY_DRAMA, asset_id: ASSET_ACTIVE }).items.map((item) => item.id),
      all.items.map((item) => item.id)
    );
    assert.deepEqual(
      query.list(db, {
        drama_id: DRAMA_ACTIVE,
        asset_id: ASSET_OTHER,
        library_id: LIBRARY_OTHER,
      }).items.map((item) => item.id),
      [ASSET_NETWORK, ASSET_ACTIVE]
    );
    assert.equal(query.list(db, { drama_id: DRAMA_RECYCLING }).total, 0);
    assert.deepEqual(query.list(db, { drama_id: DRAMA_RECYCLING }).items, []);
    assert.deepEqual(query.list(db, { type: 'video' }).items.map((item) => item.id), [ASSET_OTHER]);
    const page = query.list(db, { page: 2, page_size: 2 });
    assert.equal(page.page, 2);
    assert.equal(page.pageSize, 2);
    assert.equal(page.total, 6);
    assert.deepEqual(page.items.map((item) => item.id), [ASSET_NETWORK_GLOBAL, ASSET_NETWORK_OTHER]);
    const titled = query.list(db, { drama_id: DRAMA_ACTIVE }).items.find((item) => item.id === ASSET_ACTIVE);
    assert.equal(titled.source_drama_title, '夜雨');
    assert.equal(query.list(db, {}).items.find((item) => item.id === ASSET_GLOBAL).source_drama_title, null);
  } finally {
    db.close();
  }
});

test('详情只按素材 ID 读取，项目 ID 或库项 ID 不能顶替', () => {
  const db = createDb();
  try {
    const item = query.getById(db, ASSET_ACTIVE);
    const row = db.prepare(
      `SELECT a.*, d.title AS source_drama_title
         FROM assets a
         LEFT JOIN dramas d ON d.id = a.drama_id AND d.deleted_at IS NULL
        WHERE a.id = ?`
    ).get(ASSET_ACTIVE);
    assert.deepEqual(item, rowToItem(row));
    assert.equal(item.drama_id, DRAMA_ACTIVE);
    assert.notEqual(item.id, item.drama_id);
    assert.equal(query.getById(db, DRAMA_ACTIVE), null);
    assert.equal(query.getById(db, LIBRARY_DRAMA), null);
    assert.equal(query.getById(db, ASSET_RECYCLING), null);
    assert.equal(query.getById(db, ASSET_DELETED), null);
    assert.equal(query.getById(db, 19999), null);
  } finally {
    db.close();
  }
});

test('项目作用域只接受真实 drama_id，拒绝素材 ID / 库项 ID 互换', () => {
  const db = createDb();
  try {
    const drama = query.resolveDramaScope(db, DRAMA_ACTIVE);
    assert.equal(drama.id, DRAMA_ACTIVE);
    assert.equal(drama.title, '夜雨');
    assert.deepEqual(query.resolveDramaScope(db, String(DRAMA_ACTIVE)), drama);
    assert.equal(query.resolveDramaScope(db, null), null);
    assert.equal(query.resolveDramaScope(db, undefined), null);
    assert.throws(
      () => query.resolveDramaScope(db, String(DRAMA_ACTIVE), { strictDramaId: true }),
      (error) => error.code === 'BAD_REQUEST' && error.message === '项目 ID 必须是正整数'
    );
    assert.throws(
      () => query.resolveDramaScope(db, 0),
      (error) => error.code === 'BAD_REQUEST' && error.message === '项目 ID 必须是正整数'
    );
    assert.throws(
      () => query.resolveDramaScope(db, { nested: DRAMA_ACTIVE }),
      (error) => error.code === 'BAD_REQUEST' && error.message === '项目 ID 必须是正整数'
    );
    assert.throws(
      () => query.resolveDramaScope(db, ASSET_ACTIVE),
      (error) => error.code === 'DRAMA_NOT_FOUND' && error.statusCode === 404
    );
    assert.throws(
      () => query.resolveDramaScope(db, LIBRARY_DRAMA),
      (error) => error.code === 'DRAMA_NOT_FOUND' && error.statusCode === 404
    );
    assert.throws(
      () => query.resolveDramaScope(db, DRAMA_DELETED),
      (error) => error.code === 'DRAMA_NOT_FOUND' && error.statusCode === 404
    );
    assert.throws(
      () => query.resolveDramaScope(db, DRAMA_RECYCLING),
      (error) => error.code === 'DRAMA_RECYCLE_IN_PROGRESS' && error.statusCode === 409
    );
  } finally {
    db.close();
  }
});

test('网络来源查找按 drama_id 隔离，不把 asset_id / library_id 当成项目键', () => {
  const db = createDb();
  try {
    const sourceUrl = 'https://commons.wikimedia.org/wiki/File:Dock.jpg';
    const found = query.findNetworkAssetBySource(db, DRAMA_ACTIVE, { source_url: sourceUrl });
    assert.equal(found.id, ASSET_NETWORK);
    assert.equal(found.drama_id, DRAMA_ACTIVE);
    assert.notEqual(found.id, found.drama_id);
    assert.equal(query.findNetworkAssetBySource(db, DRAMA_OTHER, { source_url: sourceUrl }).id, ASSET_NETWORK_OTHER);
    assert.equal(query.findNetworkAssetBySource(db, ASSET_NETWORK, { source_url: sourceUrl }), null);
    assert.equal(query.findNetworkAssetBySource(db, LIBRARY_DRAMA, { source_url: sourceUrl }), null);
    const global = query.findNetworkAssetBySource(db, null, { openverse_id: OPENVERSE_ID.toUpperCase() });
    assert.equal(global.id, ASSET_NETWORK_GLOBAL);
    assert.equal(global.drama_id, null);
    assert.equal(query.findNetworkAssetBySource(db, DRAMA_ACTIVE, { openverse_id: OPENVERSE_ID }), null);
  } finally {
    db.close();
  }
});

test('新建素材只写入 req.drama_id，忽略同名字段 asset_id / library_id', () => {
  const db = createDb();
  try {
    const item = assetService.create(db, log, {
      drama_id: DRAMA_ACTIVE,
      asset_id: ASSET_OTHER,
      library_id: LIBRARY_OTHER,
      name: '手工入库',
      local_path: 'library/uploads/manual.png',
    });
    assert.equal(item.drama_id, DRAMA_ACTIVE);
    assert.notEqual(item.drama_id, ASSET_OTHER);
    assert.notEqual(item.drama_id, LIBRARY_OTHER);
    assert.notEqual(item.id, ASSET_OTHER);
    assert.notEqual(item.id, LIBRARY_OTHER);
    assert.throws(
      () => assetService.create(db, log, {
        drama_id: ASSET_ACTIVE,
        local_path: 'library/uploads/wrong-asset.png',
      }),
      (error) => error.code === 'DRAMA_NOT_FOUND'
    );
    assert.throws(
      () => assetService.create(db, log, {
        drama_id: LIBRARY_DRAMA,
        local_path: 'library/uploads/wrong-library.png',
      }),
      (error) => error.code === 'DRAMA_NOT_FOUND'
    );
  } finally {
    db.close();
  }
});
