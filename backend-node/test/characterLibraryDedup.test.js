const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');

const characterLibraryService = require('../src/services/characterLibraryService');
const {
  loadCharacterForLibrary,
  buildCharacterLibraryFields,
  findExistingCharacterLibraryItem,
  upsertCharacterLibraryItem,
} = require('../src/services/characterLibraryDedup');

const DRAMA_ACTIVE = 11;
const DRAMA_OTHER = 22;
const DRAMA_DELETED = 33;
const CHARACTER_ACTIVE = 1101;
const CHARACTER_OTHER = 2202;
const CHARACTER_NO_IMAGE = 3303;
const CHARACTER_DELETED_DRAMA = 4404;
const CHARACTER_SOFT_DELETED = 5506;
const LIBRARY_DRAMA = 6606;
const LIBRARY_GLOBAL = 7707;
const LIBRARY_OTHER = 8808;

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
      seedance2_asset TEXT,
      updated_at TEXT,
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
      (${CHARACTER_NO_IMAGE}, ${DRAMA_ACTIVE}, '无图', '草稿', NULL, NULL, NULL),
      (${CHARACTER_DELETED_DRAMA}, ${DRAMA_DELETED}, '孤儿', '旧角色', '/static/projects/orphan.png', 'projects/orphan.png', NULL),
      (${CHARACTER_SOFT_DELETED}, ${DRAMA_ACTIVE}, '已删角色', '旧', '/static/projects/gone.png', 'projects/gone.png', '2026-01-08');
  `);
  return db;
}

test('跨模块 ID 在去重用例里互不相等，避免碰巧同值假通过', () => {
  const ids = [
    DRAMA_ACTIVE, DRAMA_OTHER, DRAMA_DELETED,
    CHARACTER_ACTIVE, CHARACTER_OTHER, CHARACTER_NO_IMAGE, CHARACTER_DELETED_DRAMA, CHARACTER_SOFT_DELETED,
    LIBRARY_DRAMA, LIBRARY_GLOBAL, LIBRARY_OTHER,
  ];
  assert.equal(new Set(ids).size, ids.length);
});

test('服务文件已抽出查询、装配、去重和生成函数', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/services/characterLibraryService.js'), 'utf8');
  for (const name of [
    'function listLibraryItems',
    'function getLibraryItem',
    'function rowToItem',
    'function resolveImageUrl',
    'function loadCharacterForLibrary',
    'function upsertCharacterLibraryItem',
    'function generateCharacterImage',
    'function batchGenerateCharacterImages',
    'function detectGenderFromDescription',
    'function buildFourViewImagePrompt',
    'async function generateCharacterPromptOnly',
    'async function generateCharacterFourViewImage',
    'async function extractAppearanceFromImage',
  ]) {
    assert.equal(src.includes(name), false, name);
  }
  const keys = Object.keys(characterLibraryService).sort();
  assert.deepEqual(keys, [
    'addCharacterToLibrary',
    'addCharacterToMaterialLibrary',
    'applyLibraryItemToCharacter',
    'batchGenerateCharacterImages',
    'createLibraryItem',
    'deleteCharacter',
    'deleteLibraryItem',
    'extractAppearanceFromImage',
    'generateCharacterFourViewImage',
    'generateCharacterImage',
    'generateCharacterPromptOnly',
    'getLibraryItem',
    'listLibraryItems',
    'refreshCharacterJimengMaterialAsset',
    'registerCharacterJimengMaterialAsset',
    'updateCharacter',
    'updateLibraryItem',
    'uploadCharacterImage',
  ]);
});

test('入库前校验区分角色不存在、无图和项目无权限，且不把库项 ID 当成角色 ID', () => {
  const db = createDb();
  try {
    assert.deepEqual(loadCharacterForLibrary(db, 19999), { ok: false, error: '角色不存在' });
    assert.deepEqual(loadCharacterForLibrary(db, LIBRARY_DRAMA), { ok: false, error: '角色不存在' });
    assert.deepEqual(loadCharacterForLibrary(db, DRAMA_ACTIVE), { ok: false, error: '角色不存在' });
    assert.deepEqual(loadCharacterForLibrary(db, CHARACTER_SOFT_DELETED), { ok: false, error: '角色不存在' });
    assert.deepEqual(loadCharacterForLibrary(db, CHARACTER_NO_IMAGE), { ok: false, error: '角色还没有形象图片' });
    assert.deepEqual(
      loadCharacterForLibrary(db, CHARACTER_DELETED_DRAMA, { requireWritableDrama: true }),
      { ok: false, error: '无权限' }
    );
    const orphan = loadCharacterForLibrary(db, CHARACTER_DELETED_DRAMA);
    assert.equal(orphan.ok, true);
    assert.equal(orphan.charRow.id, CHARACTER_DELETED_DRAMA);
    assert.equal(orphan.charRow.drama_id, DRAMA_DELETED);
    const loaded = loadCharacterForLibrary(db, CHARACTER_ACTIVE, { requireWritableDrama: true });
    assert.equal(loaded.ok, true);
    assert.equal(loaded.charRow.id, CHARACTER_ACTIVE);
    assert.notEqual(loaded.charRow.id, loaded.charRow.drama_id);
  } finally {
    db.close();
  }
});

test('装配入库字段时 source_id 用角色 ID，drama_id 用项目范围', () => {
  const db = createDb();
  try {
    const charRow = db.prepare('SELECT * FROM characters WHERE id = ?').get(CHARACTER_ACTIVE);
    const dramaFields = buildCharacterLibraryFields(charRow, {
      dramaId: charRow.drama_id,
      category: '主角',
      now: '2026-01-09T00:00:00.000Z',
      includeCategory: true,
    });
    assert.equal(dramaFields.drama_id, DRAMA_ACTIVE);
    assert.equal(dramaFields.source_id, String(CHARACTER_ACTIVE));
    assert.notEqual(dramaFields.drama_id, Number(dramaFields.source_id));
    assert.equal(dramaFields.category, '主角');
    assert.equal(dramaFields.source_type, 'character');
    const globalFields = buildCharacterLibraryFields(charRow, {
      dramaId: null,
      now: '2026-01-09T00:00:00.000Z',
      includeCategory: false,
    });
    assert.equal(globalFields.drama_id, null);
    assert.equal(Object.prototype.hasOwnProperty.call(globalFields, 'category'), false);
    assert.equal(globalFields.source_id, String(CHARACTER_ACTIVE));
  } finally {
    db.close();
  }
});

test('去重查找按项目范围隔离，角色 ID 不能当成 drama_id', () => {
  const db = createDb();
  try {
    const charRow = db.prepare('SELECT * FROM characters WHERE id = ?').get(CHARACTER_ACTIVE);
    const first = upsertCharacterLibraryItem(db, {
      charRow,
      dramaId: charRow.drama_id,
      category: '主角',
      now: '2026-01-09T00:00:00.000Z',
      includeCategory: true,
    });
    assert.equal(first.duplicated, false);
    assert.notEqual(first.item.id, CHARACTER_ACTIVE);
    assert.notEqual(first.item.id, DRAMA_ACTIVE);
    assert.equal(first.item.drama_id, DRAMA_ACTIVE);
    assert.equal(first.item.source_id, String(CHARACTER_ACTIVE));

    const reused = findExistingCharacterLibraryItem(db, { dramaId: charRow.drama_id, charRow });
    assert.equal(reused.id, first.item.id);
    assert.equal(findExistingCharacterLibraryItem(db, { dramaId: CHARACTER_ACTIVE, charRow }), null);
    assert.equal(findExistingCharacterLibraryItem(db, { dramaId: first.item.id, charRow }), null);
    assert.equal(findExistingCharacterLibraryItem(db, { dramaId: null, charRow }), null);

    const second = upsertCharacterLibraryItem(db, {
      charRow,
      dramaId: charRow.drama_id,
      category: '主角',
      now: '2026-01-10T00:00:00.000Z',
      includeCategory: true,
    });
    assert.equal(second.duplicated, true);
    assert.equal(second.item.id, first.item.id);
  } finally {
    db.close();
  }
});

test('加入本剧库与全局库在 ID 不相等时仍幂等且互不复用', () => {
  const db = createDb();
  try {
    const firstDrama = characterLibraryService.addCharacterToLibrary(db, log, CHARACTER_ACTIVE, '主角');
    db.prepare('UPDATE characters SET name = ?, description = ? WHERE id = ?').run('英雄改名', '新描述', CHARACTER_ACTIVE);
    const secondDrama = characterLibraryService.addCharacterToLibrary(db, log, CHARACTER_ACTIVE, '主角');
    const firstMaterial = characterLibraryService.addCharacterToMaterialLibrary(db, log, CHARACTER_ACTIVE);
    const secondMaterial = characterLibraryService.addCharacterToMaterialLibrary(db, log, CHARACTER_ACTIVE);
    const otherDrama = characterLibraryService.addCharacterToLibrary(db, log, CHARACTER_OTHER, '配角');

    assert.equal(firstDrama.ok, true);
    assert.equal(firstDrama.duplicated, false);
    assert.equal(secondDrama.duplicated, true);
    assert.equal(firstDrama.item.id, secondDrama.item.id);
    assert.equal(firstMaterial.item.id, secondMaterial.item.id);
    assert.notEqual(firstDrama.item.id, firstMaterial.item.id);
    assert.notEqual(firstDrama.item.id, CHARACTER_ACTIVE);
    assert.notEqual(firstDrama.item.id, DRAMA_ACTIVE);
    assert.notEqual(otherDrama.item.id, firstDrama.item.id);
    assert.equal(firstDrama.item.drama_id, DRAMA_ACTIVE);
    assert.equal(firstMaterial.item.drama_id, null);
    assert.equal(otherDrama.item.drama_id, DRAMA_OTHER);
    assert.equal(secondDrama.item.name, '英雄改名');
    assert.equal(secondDrama.item.source_id, String(CHARACTER_ACTIVE));
    assert.equal(otherDrama.item.source_id, String(CHARACTER_OTHER));
    assert.equal(
      db.prepare('SELECT COUNT(*) AS count FROM character_libraries WHERE drama_id = ? AND deleted_at IS NULL').get(DRAMA_ACTIVE).count,
      1
    );
    assert.equal(
      db.prepare('SELECT COUNT(*) AS count FROM character_libraries WHERE drama_id IS NULL AND deleted_at IS NULL').get().count,
      1
    );
    assert.deepEqual(characterLibraryService.addCharacterToLibrary(db, log, LIBRARY_DRAMA), {
      ok: false,
      error: '角色不存在',
    });
    assert.deepEqual(characterLibraryService.addCharacterToLibrary(db, log, DRAMA_ACTIVE), {
      ok: false,
      error: '角色不存在',
    });
    assert.deepEqual(characterLibraryService.addCharacterToMaterialLibrary(db, log, CHARACTER_NO_IMAGE), {
      ok: false,
      error: '角色还没有形象图片',
    });
    assert.deepEqual(characterLibraryService.addCharacterToLibrary(db, log, CHARACTER_DELETED_DRAMA), {
      ok: false,
      error: '无权限',
    });
    const orphanMaterial = characterLibraryService.addCharacterToMaterialLibrary(db, log, CHARACTER_DELETED_DRAMA);
    assert.equal(orphanMaterial.ok, true);
    assert.equal(orphanMaterial.item.drama_id, null);
    assert.equal(orphanMaterial.item.source_id, String(CHARACTER_DELETED_DRAMA));
  } finally {
    db.close();
  }
});

test('应用到角色时 library_id 与 character_id 不得互换', () => {
  const db = createDb();
  try {
    const added = characterLibraryService.addCharacterToLibrary(db, log, CHARACTER_ACTIVE, '主角');
    const libraryId = added.item.id;
    assert.notEqual(libraryId, CHARACTER_ACTIVE);
    assert.notEqual(libraryId, DRAMA_ACTIVE);

    db.prepare('UPDATE characters SET image_url = ?, local_path = ? WHERE id = ?').run(
      '/static/projects/old-hero.png',
      'projects/old-hero.png',
      CHARACTER_ACTIVE
    );
    const applied = characterLibraryService.applyLibraryItemToCharacter(db, log, CHARACTER_ACTIVE, libraryId);
    assert.equal(applied.ok, true);
    const row = db.prepare('SELECT image_url, local_path FROM characters WHERE id = ?').get(CHARACTER_ACTIVE);
    assert.equal(row.image_url, '/static/projects/hero.png');
    assert.equal(row.local_path, 'projects/hero.png');

    assert.deepEqual(
      characterLibraryService.applyLibraryItemToCharacter(db, log, libraryId, CHARACTER_ACTIVE),
      { ok: false, error: '角色库项不存在' }
    );
    assert.deepEqual(
      characterLibraryService.applyLibraryItemToCharacter(db, log, CHARACTER_ACTIVE, CHARACTER_ACTIVE),
      { ok: false, error: '角色库项不存在' }
    );
    assert.deepEqual(
      characterLibraryService.applyLibraryItemToCharacter(db, log, DRAMA_ACTIVE, libraryId),
      { ok: false, error: '角色不存在' }
    );
    assert.deepEqual(
      characterLibraryService.applyLibraryItemToCharacter(db, log, CHARACTER_OTHER, libraryId),
      { ok: true }
    );
  } finally {
    db.close();
  }
});