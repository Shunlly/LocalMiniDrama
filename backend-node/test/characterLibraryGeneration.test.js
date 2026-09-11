const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');

const characterLibraryService = require('../src/services/characterLibraryService');
const generation = require('../src/services/characterLibraryGeneration');

const DRAMA_ACTIVE = 11;
const DRAMA_DELETED = 33;
const CHARACTER_ACTIVE = 1101;
const CHARACTER_NO_IMAGE = 3303;
const CHARACTER_DELETED_DRAMA = 4404;
const LIBRARY_DRAMA = 6606;

const log = { info() {}, warn() {}, error() {} };

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE dramas (
      id INTEGER PRIMARY KEY,
      title TEXT,
      style TEXT,
      metadata TEXT,
      deleted_at TEXT
    );
    CREATE TABLE characters (
      id INTEGER PRIMARY KEY,
      drama_id INTEGER NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      appearance TEXT,
      description TEXT,
      polished_prompt TEXT,
      negative_prompt TEXT,
      image_url TEXT,
      local_path TEXT,
      extra_images TEXT,
      ref_image TEXT,
      deleted_at TEXT
    );
    INSERT INTO dramas (id, title, style, metadata, deleted_at) VALUES
      (${DRAMA_ACTIVE}, '可读项目', NULL, NULL, NULL),
      (${DRAMA_DELETED}, '已删项目', NULL, NULL, '2026-01-02');
    INSERT INTO characters (id, drama_id, name, appearance, description, image_url, local_path, deleted_at) VALUES
      (${CHARACTER_ACTIVE}, ${DRAMA_ACTIVE}, '英雄', '黑发长衫', '主角', '/static/projects/hero.png', 'projects/hero.png', NULL),
      (${CHARACTER_NO_IMAGE}, ${DRAMA_ACTIVE}, '无图', NULL, '草稿', NULL, NULL, NULL),
      (${CHARACTER_DELETED_DRAMA}, ${DRAMA_DELETED}, '孤儿', '旧角色', '旧', '/static/projects/orphan.png', 'projects/orphan.png', NULL);
  `);
  return db;
}

test('跨模块 ID 在生成用例里互不相等，避免碰巧同值假通过', () => {
  const ids = [DRAMA_ACTIVE, DRAMA_DELETED, CHARACTER_ACTIVE, CHARACTER_NO_IMAGE, CHARACTER_DELETED_DRAMA, LIBRARY_DRAMA];
  assert.equal(new Set(ids).size, ids.length);
});

test('characterLibraryService 公开生成 API 仍指向生成模块的同一函数', () => {
  assert.equal(characterLibraryService.generateCharacterImage, generation.generateCharacterImage);
  assert.equal(characterLibraryService.batchGenerateCharacterImages, generation.batchGenerateCharacterImages);
  assert.equal(characterLibraryService.generateCharacterFourViewImage, generation.generateCharacterFourViewImage);
  assert.equal(characterLibraryService.generateCharacterPromptOnly, generation.generateCharacterPromptOnly);
  assert.equal(characterLibraryService.extractAppearanceFromImage, generation.extractAppearanceFromImage);
});

test('characterLibraryService 不把生成内部辅助函数暴露为公开 API', () => {
  assert.equal(typeof characterLibraryService.detectGenderFromDescription, 'undefined');
  assert.equal(typeof characterLibraryService.buildFourViewImagePrompt, 'undefined');
  assert.equal(typeof characterLibraryService.applyStyleOverrideToCfg, 'undefined');
  assert.equal(typeof characterLibraryService.appendPrompt, 'undefined');
});

test('服务文件已抽出生成/提示词函数，CRUD 仍留在原文件', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/services/characterLibraryService.js'), 'utf8');
  for (const name of [
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
  assert.match(src, /require\('\.\/characterLibraryGeneration'\)/);
  assert.match(src, /function createLibraryItem/);
  assert.match(src, /function updateCharacter/);
  assert.match(src, /function addCharacterToLibrary/);
  assert.equal(src.includes('function listLibraryItems'), false);
  assert.equal(src.includes('function upsertCharacterLibraryItem'), false);
});

test('生成入口只认 character_id，drama_id / library_id 不能顶替', async () => {
  const db = createDb();
  try {
    assert.deepEqual(generation.generateCharacterImage(db, log, {}, 19999), { ok: false, error: '角色不存在' });
    assert.deepEqual(generation.generateCharacterImage(db, log, {}, DRAMA_ACTIVE), { ok: false, error: '角色不存在' });
    assert.deepEqual(generation.generateCharacterImage(db, log, {}, LIBRARY_DRAMA), { ok: false, error: '角色不存在' });
    assert.deepEqual(generation.generateCharacterImage(db, log, {}, CHARACTER_DELETED_DRAMA), { ok: false, error: '无权限' });
    assert.deepEqual(await generation.generateCharacterFourViewImage(db, log, {}, DRAMA_ACTIVE), { ok: false, error: '角色不存在' });
    assert.deepEqual(await generation.generateCharacterFourViewImage(db, log, {}, CHARACTER_DELETED_DRAMA), { ok: false, error: '无权限' });
    assert.deepEqual(await generation.generateCharacterPromptOnly(db, log, {}, LIBRARY_DRAMA), { ok: false, error: '角色不存在' });
    assert.deepEqual(await generation.extractAppearanceFromImage(db, log, {}, DRAMA_ACTIVE), { ok: false, error: '角色不存在' });
    assert.deepEqual(await generation.extractAppearanceFromImage(db, log, {}, CHARACTER_NO_IMAGE), { ok: false, error: '该角色暂无参考图片，请先上传图片' });
    assert.deepEqual(generation.batchGenerateCharacterImages(db, log, {}, []), { ok: false, error: '角色 ID 列表不能为空' });
    assert.deepEqual(
      generation.batchGenerateCharacterImages(db, log, {}, new Array(11).fill(CHARACTER_ACTIVE)),
      { ok: false, error: '单次最多生成10个角色' }
    );
  } finally {
    db.close();
  }
});

test('性别识别按描述文本工作，不依赖 drama_id / character_id', () => {
  assert.equal(generation.detectGenderFromDescription('男性角色，黑发长衫'), 'MALE');
  assert.equal(generation.detectGenderFromDescription('女主，白衣长裙'), 'FEMALE');
  assert.equal(generation.detectGenderFromDescription(''), null);
  assert.equal(generation.detectGenderFromDescription(null), null);
});
