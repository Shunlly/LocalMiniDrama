const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const createTailFrameRoutes = require('../src/services/tailFrameLinkService');

function responseRecorder() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = String(value); },
    getHeader(name) { return this.headers[String(name).toLowerCase()]; },
  };
}

function createFixture() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE episodes (id INTEGER PRIMARY KEY, drama_id INTEGER, deleted_at TEXT);
    CREATE TABLE storyboards (
      id INTEGER PRIMARY KEY,
      episode_id INTEGER,
      storyboard_number INTEGER,
      deleted_at TEXT
    );
    CREATE TABLE video_generations (
      id INTEGER PRIMARY KEY,
      storyboard_id INTEGER,
      status TEXT,
      local_path TEXT,
      video_url TEXT,
      deleted_at TEXT,
      created_at TEXT
    );
  `);
  db.prepare('INSERT INTO episodes (id, drama_id) VALUES (10, 7)').run();
  db.prepare('INSERT INTO storyboards (id, episode_id, storyboard_number) VALUES (1, 10, 1), (2, 10, 2)').run();
  return db;
}

test('tail-frame linking rejects cross-project access before touching media', async () => {
  const db = createFixture();
  test.after(() => db.close());
  const routes = createTailFrameRoutes(db, { storage: { local_path: process.cwd() } }, { info() {}, error() {} });
  const res = responseRecorder();

  await routes.linkTailFrame({ params: { id: '1' }, body: { drama_id: 8 } }, res);

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.success, false);
  assert.equal(res.body.error.code, 'FORBIDDEN');
});

test('tail-frame linking rejects absolute database media paths without exposing them', async () => {
  const db = createFixture();
  test.after(() => db.close());
  const outside = 'C:\\private\\outside-video.mp4';
  db.prepare(
    `INSERT INTO video_generations
       (storyboard_id, status, local_path, created_at)
     VALUES (1, 'completed', ?, '2026-01-01T00:00:00.000Z')`
  ).run(outside);
  const routes = createTailFrameRoutes(db, { storage: { local_path: process.cwd() } }, { info() {}, error() {} });
  const res = responseRecorder();

  await routes.linkTailFrame({ params: { id: '1' }, body: { drama_id: 7 } }, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.success, false);
  assert.equal(res.body.error.code, 'BAD_REQUEST');
  assert.doesNotMatch(JSON.stringify(res.body), /private|outside-video/);
});
