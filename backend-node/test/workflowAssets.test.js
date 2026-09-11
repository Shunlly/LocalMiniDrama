'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const Database = require('better-sqlite3');

const { runMigrationsAndEnsure } = require('../src/db/migrate');
const workflowService = require('../src/services/workflowService');
const assets = require('../src/services/workflowAssets');

const DRAMA_ID = 11;
const OTHER_DRAMA_ID = 22;
const EVENT_ID = 3301;

const log = { info() {}, warn() {}, error() {} };

function createDb() {
  const db = new Database(':memory:');
  runMigrationsAndEnsure(db);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO dramas (id, title, description, style, status, created_at, updated_at)
     VALUES (?, '资产甲', 'fixture', 'anime', 'draft', ?, ?)`
  ).run(DRAMA_ID, now, now);
  assert.notEqual(DRAMA_ID, OTHER_DRAMA_ID);
  return db;
}

test('workflowService 公开 API 仍指向资产模块的同一函数', () => {
  assert.equal(workflowService.ensureAssetBible, assets.ensureAssetBible);
  assert.equal(workflowService.ensureStoryboardDraft, assets.ensureStoryboardDraft);
  assert.equal(workflowService.createCreativeReview, assets.createCreativeReview);
});

test('节拍切分覆盖空文本、中文句号和数量上限', () => {
  assert.deepEqual(assets.splitScriptIntoBeats('', 3), ['故事节拍']);
  const beats = assets.splitScriptIntoBeats('甲。乙。丙。丁。戊。己。庚。辛。壬。', 8);
  assert.equal(beats.length, 8);
  assert.equal(assets.splitScriptIntoBeats('只有一句', 4).length >= 1, true);
});

test('资产圣经按事件角色名建角色，不相等 drama_id 不会被写到', () => {
  const db = createDb();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO dramas (id, title, status, created_at, updated_at) VALUES (?, '资产乙', 'draft', ?, ?)`
  ).run(OTHER_DRAMA_ID, now, now);
  db.prepare(
    `INSERT INTO story_events (id, drama_id, event_no, characters, location, detail, created_at)
     VALUES (?, ?, 1, ?, '码头', '夜雨', ?)`
  ).run(EVENT_ID, DRAMA_ID, JSON.stringify(['阿宁', '老周']), now);
  const result = assets.ensureAssetBible(db, log, DRAMA_ID, 'draft');
  assert.equal(result.character_created, 2);
  assert.equal(result.scene_created, 1);
  const names = db.prepare(
    'SELECT name FROM characters WHERE drama_id = ? AND deleted_at IS NULL ORDER BY name'
  ).all(DRAMA_ID).map((row) => row.name);
  assert.deepEqual(new Set(names), new Set(['阿宁', '老周']));
  assert.equal(
    db.prepare('SELECT COUNT(*) AS n FROM characters WHERE drama_id = ?').get(OTHER_DRAMA_ID).n,
    0
  );
  assert.notEqual(DRAMA_ID, OTHER_DRAMA_ID);
  assert.notEqual(DRAMA_ID, EVENT_ID);
  db.close();
});

test('创意审阅按 run/role/target 幂等，不重复插入', () => {
  const db = createDb();
  const first = assets.createCreativeReview(db, {
    dramaId: DRAMA_ID,
    runId: 'run-a',
    sourceId: 'src-1',
    role: 'editor',
    targetType: 'storyboard',
    targetId: 'sb-1',
    status: 'locked',
    findings: ['ok'],
  });
  const second = assets.createCreativeReview(db, {
    dramaId: DRAMA_ID,
    runId: 'run-a',
    sourceId: 'src-1',
    role: 'editor',
    targetType: 'storyboard',
    targetId: 'sb-1',
    status: 'locked',
    findings: ['again'],
  });
  assert.equal(first, second);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM creative_reviews').get().n, 1);
  db.close();
});
