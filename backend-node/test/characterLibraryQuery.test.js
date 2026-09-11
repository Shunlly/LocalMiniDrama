const assert = require('node:assert/strict');
const test = require('node:test');
const Database = require('better-sqlite3');

const characterLibraryService = require('../src/services/characterLibraryService');
const query = require('../src/services/characterLibraryQuery');
const { rowToItem } = require('../src/services/characterLibraryAssembly');

const DRAMA_ACTIVE = 11;
const DRAMA_OTHER = 22;
const DRAMA_DELETED = 33;
const CHARACTER_ACTIVE = 1101;
const CHARACTER_OTHER = 2202;
const CHARACTER_NO_IMAGE = 3303;
const LIBRARY_DRAMA = 6606;
const LIBRARY_GLOBAL = 7707;
const LIBRARY_OTHER = 8808;
const LIBRARY_DELETED = 9909;

const log = { info() {}, warn() {}, error() {} };

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE dramas (
      id INTEGER PRIMARY KEY,
      title TEXT,
      deleted_at TEXT
    );
    CREATE TABLE characters (
      id INTEGER PRIMARY KEY,
      drama_id INTEGER NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      description TEXT,
      appearance TEXT,
      image_url TEXT,
      local_path TEXT,
      deleted_at TEXT
    );
    CREATE TABLE character_libraries (
      id INTEGER PRIMARY KEY,
      drama_id INTEGER,
      name TEXT NOT NULL DEFAULT '',
      category TEXT,
      image_url TEXT,
      local_path TEXT,
      description TEXT,
      tags TEXT,
      source_type TEXT,
      source_id TEXT,
      created_at TEXT,
      updated_at TEXT,
      deleted_at TEXT
    );
    INSERT INTO dramas (id, title, deleted_at) VALUES
      (${DRAMA_ACTIVE}, '可读项目', NULL),
      (${DRAMA_OTHER}, '另一个项目', NULL),
      (${DRAMA_DELETED}, '已删项目', '2026-01-02');
    INSERT INTO characters (id, drama_id, name, description, image_url, local_path, deleted_at) VALUES
      (${CHARACTER_ACTIVE}, ${DRAMA_ACTIVE}, '英雄', '黑发', '/static/projects/hero.png', 'projects/hero.png', NULL),
      (${CHARACTER_OTHER}, ${DRAMA_OTHER}, '配角', '白衣', '/static/projects/side.png', 'projects/side.png', NULL),
      (${CHARACTER_NO_IMAGE}, ${DRAMA_ACTIVE}, '无图', '草稿', NULL, NULL, NULL);
    INSERT INTO character_libraries
      (id, drama_id, name, category, image_url, local_path, description, tags, source_type, source_id, created_at, updated_at, deleted_at)
    VALUES
      (${LIBRARY_DRAMA}, ${DRAMA_ACTIVE}, '英雄', '主角', '/static/projects/hero.png', 'projects/hero.png', '黑发', 'lead', 'character', '${CHARACTER_ACTIVE}', '2026-01-03', '2026-01-03', NULL),
      (${LIBRARY_GLOBAL}, NULL, '全局英雄', NULL, '/static/projects/hero.png', 'projects/hero.png', '黑发', NULL, 'character', '${CHARACTER_ACTIVE}', '2026-01-05', '2026-01-05', NULL),
      (${LIBRARY_OTHER}, ${DRAMA_OTHER}, '配角', '配角', '/static/projects/side.png', 'projects/side.png', '白衣', NULL, 'character', '${CHARACTER_OTHER}', '2026-01-06', '2026-01-06', NULL),
      (${LIBRARY_DELETED}, ${DRAMA_ACTIVE}, '已删', '主角', '/static/projects/old.png', 'projects/old.png', '旧', NULL, 'character', '${CHARACTER_ACTIVE}', '2026-01-01', '2026-01-01', '2026-01-07');
  `);
  return db;
}

test('跨模块 ID 在测试数据里互不相等，避免碰巧同值假通过', () => {
  const ids = [
    DRAMA_ACTIVE, DRAMA_OTHER, DRAMA_DELETED,
    CHARACTER_ACTIVE, CHARACTER_OTHER, CHARACTER_NO_IMAGE,
    LIBRARY_DRAMA, LIBRARY_GLOBAL, LIBRARY_OTHER, LIBRARY_DELETED,
  ];
  assert.equal(new Set(ids).size, ids.length);
});

test('characterLibraryService 公开查询 API 仍指向查询模块的同一函数', () => {
  assert.equal(characterLibraryService.listLibraryItems, query.listLibraryItems);
  assert.equal(characterLibraryService.getLibraryItem, query.getLibraryItem);
});

test('列表按 drama_id / global 过滤，不会把 character_id 或 library_id 当成项目范围', () => {
  const db = createDb();
  try {
    const all = query.listLibraryItems(db, {});
    assert.deepEqual(all.items.map((item) => item.id), [LIBRARY_OTHER, LIBRARY_GLOBAL, LIBRARY_DRAMA]);
    assert.equal(all.total, 3);
    assert.deepEqual(query.listLibraryItems(db, { drama_id: DRAMA_ACTIVE }).items.map((item) => item.id), [LIBRARY_DRAMA]);
    assert.deepEqual(query.listLibraryItems(db, { drama_id: DRAMA_OTHER }).items.map((item) => item.id), [LIBRARY_OTHER]);
    assert.deepEqual(query.listLibraryItems(db, { global: '1' }).items.map((item) => item.id), [LIBRARY_GLOBAL]);
    assert.deepEqual(query.listLibraryItems(db, { drama_id: CHARACTER_ACTIVE }).items, []);
    assert.deepEqual(query.listLibraryItems(db, { drama_id: LIBRARY_DRAMA }).items, []);
    assert.deepEqual(
      query.listLibraryItems(db, {
        drama_id: DRAMA_ACTIVE,
        character_id: CHARACTER_OTHER,
        library_id: LIBRARY_OTHER,
      }).items.map((item) => item.id),
      [LIBRARY_DRAMA]
    );
    const page = query.listLibraryItems(db, { page: 2, page_size: 1 });
    assert.equal(page.page, 2);
    assert.equal(page.pageSize, 1);
    assert.equal(page.total, 3);
    assert.deepEqual(page.items.map((item) => item.id), [LIBRARY_GLOBAL]);
  } finally {
    db.close();
  }
});

test('来源过滤认 source_id 而不是 drama_id，关键字和分类保持原语义', () => {
  const db = createDb();
  try {
    assert.deepEqual(
      query.listLibraryItems(db, { source_id: String(CHARACTER_ACTIVE) }).items.map((item) => item.id),
      [LIBRARY_GLOBAL, LIBRARY_DRAMA]
    );
    assert.deepEqual(query.listLibraryItems(db, { source_id: String(DRAMA_ACTIVE) }).items, []);
    assert.deepEqual(query.listLibraryItems(db, { source_id: String(LIBRARY_DRAMA) }).items, []);
    assert.deepEqual(
      query.listLibraryItems(db, { source_type: 'character', category: '主角' }).items.map((item) => item.id),
      [LIBRARY_DRAMA]
    );
    assert.deepEqual(
      query.listLibraryItems(db, { keyword: '英雄' }).items.map((item) => item.id),
      [LIBRARY_GLOBAL, LIBRARY_DRAMA]
    );
  } finally {
    db.close();
  }
});

test('详情只按库项 ID 读取，角色 ID 或项目 ID 不能顶替', () => {
  const db = createDb();
  try {
    const item = query.getLibraryItem(db, LIBRARY_DRAMA);
    assert.deepEqual(item, rowToItem(db.prepare('SELECT * FROM character_libraries WHERE id = ?').get(LIBRARY_DRAMA)));
    assert.equal(item.drama_id, DRAMA_ACTIVE);
    assert.equal(item.source_id, String(CHARACTER_ACTIVE));
    assert.notEqual(item.id, item.drama_id);
    assert.notEqual(item.id, Number(item.source_id));
    assert.equal(query.getLibraryItem(db, CHARACTER_ACTIVE), null);
    assert.equal(query.getLibraryItem(db, DRAMA_ACTIVE), null);
    assert.equal(query.getLibraryItem(db, LIBRARY_DELETED), null);
    assert.equal(query.getLibraryItem(db, 19999), null);
  } finally {
    db.close();
  }
});

test('新建库项只写入 req.drama_id，忽略同名字段 character_id / library_id', () => {
  const db = createDb();
  try {
    const item = characterLibraryService.createLibraryItem(db, log, {
      drama_id: DRAMA_ACTIVE,
      character_id: CHARACTER_OTHER,
      library_id: LIBRARY_OTHER,
      name: '手工入库',
      source_type: 'upload',
      source_id: String(CHARACTER_ACTIVE),
    });
    assert.equal(item.drama_id, DRAMA_ACTIVE);
    assert.notEqual(item.drama_id, CHARACTER_OTHER);
    assert.notEqual(item.id, LIBRARY_OTHER);
    assert.equal(item.source_id, String(CHARACTER_ACTIVE));
    assert.equal(characterLibraryService.updateLibraryItem(db, log, CHARACTER_ACTIVE, { name: '误用角色ID' }), null);
  } finally {
    db.close();
  }
});