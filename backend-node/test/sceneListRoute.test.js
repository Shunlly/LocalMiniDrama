const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const { runMigrationsAndEnsure } = require('../src/db/migrate');
const sceneRoutes = require('../src/routes/scenes');

const log = { info() {}, warn() {}, error() {} };

function mockResponse() {
  return {
    statusCode: 0,
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

test('scene list endpoint is mounted at the frontend API path', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'index.js'), 'utf8');
  assert.match(source, /r\.get\('\/dramas\/:id\/scenes', scenes\.list\)/);
});

test('scene list route returns only active scenes for the requested drama', () => {
  const db = new Database(':memory:');
  try {
    runMigrationsAndEnsure(db);
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO dramas (id, title, status, created_at, updated_at)
       VALUES (1, 'Target', 'draft', ?, ?), (2, 'Other', 'draft', ?, ?)`,
    ).run(now, now, now, now);
    db.prepare(
      `INSERT INTO scenes (id, drama_id, location, status, created_at, updated_at, deleted_at)
       VALUES (1, 1, 'Active', 'ready', ?, ?, NULL),
              (2, 1, 'Deleted', 'ready', ?, ?, ?),
              (3, 2, 'Other drama', 'ready', ?, ?, NULL)`,
    ).run(now, now, now, now, now, now, now);

    const handlers = sceneRoutes(db, log, {});
    assert.equal(typeof handlers.list, 'function');
    const res = mockResponse();
    handlers.list({ params: { id: '1' } }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.deepEqual(res.body.data.scenes.map((scene) => scene.location), ['Active']);
  } finally {
    db.close();
  }
});
