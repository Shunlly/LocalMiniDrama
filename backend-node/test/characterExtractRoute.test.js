'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const { setupRouter } = require('../src/routes');

function responseRecorder() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

function openDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE dramas (id INTEGER PRIMARY KEY, deleted_at TEXT);
    CREATE TABLE episodes (
      id INTEGER PRIMARY KEY,
      drama_id INTEGER NOT NULL,
      script_content TEXT,
      deleted_at TEXT
    );
    INSERT INTO dramas (id) VALUES (1);
    INSERT INTO episodes (id, drama_id, script_content) VALUES (12, 1, '');
  `);
  return db;
}

function handlerFor(db) {
  const router = setupRouter({}, db, { info() {}, warn() {}, error() {} });
  const layer = router.stack.find((item) => item.route?.path === '/episodes/:episode_id/characters/extract');
  assert.ok(layer, 'character extract route must exist');
  return layer.route.stack.at(-1).handle;
}

test('提取角色路由走真实生成服务，不再挂空角色桩', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/routes/index.js'), 'utf8');
  assert.match(source, /characterGenerationService\.generateCharacters/);
  assert.match(source, /\/episodes\/:episode_id\/characters\/extract/);
  assert.doesNotMatch(source, /stub\.episodeCharactersExtract/);
});

test('空剧本提取角色失败关闭', () => {
  const db = openDb();
  try {
    const handler = handlerFor(db);
    const res = responseRecorder();
    handler({ params: { episode_id: '12' } }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error.message, '请先填写剧本内容');
  } finally {
    db.close();
  }
});

test('缺失剧集提取角色返回中文 404', () => {
  const db = openDb();
  try {
    const handler = handlerFor(db);
    const res = responseRecorder();
    handler({ params: { episode_id: '99' } }, res);
    assert.equal(res.statusCode, 404);
    assert.equal(res.body.error.message, '剧集不存在');
  } finally {
    db.close();
  }
});
