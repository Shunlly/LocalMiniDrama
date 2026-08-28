'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
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

test('character generation rejects an episode owned by another drama before creating a task', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE dramas (id INTEGER PRIMARY KEY, deleted_at TEXT);
    CREATE TABLE episodes (
      id INTEGER PRIMARY KEY,
      drama_id INTEGER NOT NULL,
      deleted_at TEXT
    );
    CREATE TABLE async_tasks (
      id TEXT PRIMARY KEY,
      type TEXT,
      status TEXT,
      progress INTEGER,
      message TEXT,
      resource_id TEXT,
      created_at TEXT,
      updated_at TEXT,
      deleted_at TEXT
    );
    CREATE TABLE prompt_overrides (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT UNIQUE NOT NULL,
      content TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    INSERT INTO dramas (id) VALUES (1), (2);
    INSERT INTO episodes (id, drama_id) VALUES (20, 2);
  `);

  try {
    const router = setupRouter({}, db, { info() {}, warn() {}, error() {} });
    const layer = router.stack.find((item) => item.route?.path === '/generation/characters');
    assert.ok(layer, 'character generation route must exist');
    const handler = layer.route.stack.at(-1).handle;
    const res = responseRecorder();

    handler({ body: { drama_id: 1, episode_id: 20, outline: 'test' } }, res);

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error.code, 'BAD_REQUEST');
    assert.match(res.body.error.message, /episode_id.*drama_id/i);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM async_tasks').get().count, 0);
  } finally {
    db.close();
  }
});
