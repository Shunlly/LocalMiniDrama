const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const Database = require('better-sqlite3');

const dramaService = require('../src/services/dramaService');
const dramaRoutes = require('../src/routes/drama');

const log = {
  info() {},
  error() {},
  errorw() {},
};

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE dramas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL DEFAULT '',
      description TEXT,
      genre TEXT,
      style TEXT DEFAULT 'realistic',
      tags TEXT,
      thumbnail TEXT,
      total_episodes INTEGER DEFAULT 1,
      total_duration INTEGER DEFAULT 0,
      status TEXT DEFAULT 'draft',
      metadata TEXT,
      created_at TEXT,
      updated_at TEXT,
      deleted_at TEXT
    );
    CREATE TABLE episodes (
      id INTEGER PRIMARY KEY,
      drama_id INTEGER NOT NULL,
      video_url TEXT,
      deleted_at TEXT
    );
    CREATE TABLE storyboards (
      id INTEGER PRIMARY KEY,
      episode_id INTEGER NOT NULL,
      local_path TEXT,
      video_local_path TEXT,
      deleted_at TEXT
    );
    CREATE TABLE assets (
      id INTEGER PRIMARY KEY,
      drama_id INTEGER NOT NULL,
      local_path TEXT,
      deleted_at TEXT
    );
  `);
  return db;
}

function seedDb(db) {
  const insertDrama = db.prepare(`
    INSERT INTO dramas
      (id, title, description, genre, style, status, metadata, created_at, updated_at, deleted_at)
    VALUES
      (?, ?, ?, 'drama', 'realistic', 'draft', ?, ?, ?, ?)
  `);
  insertDrama.run(
    1,
    'Active production',
    'Project with retained media',
    JSON.stringify({ aspect_ratio: '16:9' }),
    '2026-07-01T00:00:00.000Z',
    '2026-07-02T00:00:00.000Z',
    null
  );
  insertDrama.run(
    2,
    'Archived memory',
    'Already in trash',
    null,
    '2026-06-01T00:00:00.000Z',
    '2026-06-02T00:00:00.000Z',
    '2026-06-03T00:00:00.000Z'
  );
  insertDrama.run(
    3,
    'Archived second project',
    'Pagination fixture',
    null,
    '2026-05-01T00:00:00.000Z',
    '2026-05-02T00:00:00.000Z',
    '2026-05-03T00:00:00.000Z'
  );

  db.prepare('INSERT INTO episodes (id, drama_id, video_url, deleted_at) VALUES (?, ?, ?, NULL)')
    .run(10, 1, '/static/dramas/1/episodes/10/final.mp4');
  db.prepare(`
    INSERT INTO storyboards (id, episode_id, local_path, video_local_path, deleted_at)
    VALUES (?, ?, ?, ?, NULL)
  `).run(20, 10, 'dramas/1/storyboards/20/frame.png', 'dramas/1/storyboards/20/clip.mp4');
  db.prepare('INSERT INTO assets (id, drama_id, local_path, deleted_at) VALUES (?, ?, ?, NULL)')
    .run(30, 1, 'dramas/1/assets/reference.png');
}

function retainedRows(db) {
  return {
    episode: db.prepare('SELECT * FROM episodes WHERE id = 10').get(),
    storyboard: db.prepare('SELECT * FROM storyboards WHERE id = 20').get(),
    asset: db.prepare('SELECT * FROM assets WHERE id = 30').get(),
  };
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

test('moving a project to trash and restoring it preserves every associated row', () => {
  const db = createDb();
  try {
    seedDb(db);
    const before = retainedRows(db);

    const removed = dramaService.moveDramaToTrash(db, log, 1);
    assert.equal(removed.id, 1);
    assert.equal(removed.is_removed, true);
    assert.ok(removed.removed_at);
    assert.equal(dramaService.getDramaById(db, 1), null);
    assert.deepEqual(retainedRows(db), before);

    const trash = dramaService.listTrashedDramas(db, { page: 1, page_size: 10 });
    assert.equal(trash.total, 3);
    assert.equal(trash.dramas[0].id, 1);
    assert.deepEqual(trash.dramas[0].removal_policy, {
      recoverable: true,
      associated_data: 'preserved',
      hard_delete_supported: false,
    });

    const restored = dramaService.restoreDrama(db, log, 1);
    assert.equal(restored.id, 1);
    assert.equal(restored.is_removed, false);
    assert.equal(restored.removed_at, null);
    assert.deepEqual(retainedRows(db), before);
    assert.equal(dramaService.restoreDrama(db, log, 1), null);
  } finally {
    db.close();
  }
});

test('trash listing is isolated, searchable, ordered and paginated', () => {
  const db = createDb();
  try {
    seedDb(db);

    const pageOne = dramaService.listTrashedDramas(db, { page: '1', page_size: '1' });
    assert.equal(pageOne.total, 2);
    assert.equal(pageOne.page, 1);
    assert.equal(pageOne.pageSize, 1);
    assert.deepEqual(pageOne.dramas.map((drama) => drama.id), [2]);

    const searched = dramaService.listTrashedDramas(db, {
      keyword: '  second  ',
      page: 1,
      page_size: 10,
    });
    assert.equal(searched.total, 1);
    assert.deepEqual(searched.dramas.map((drama) => drama.id), [3]);
    assert.equal(searched.dramas[0].is_removed, true);
  } finally {
    db.close();
  }
});

test('trash API lists, moves and restores projects with an explicit retention contract', async () => {
  const db = createDb();
  seedDb(db);
  const handlers = dramaRoutes(db, {}, log);
  const app = express();
  app.get('/api/v1/dramas/trash', handlers.listTrashedDramas);
  app.delete('/api/v1/dramas/:id', handlers.moveDramaToTrash);
  app.post('/api/v1/dramas/:id/restore', handlers.restoreDrama);
  const server = app.listen(0, '127.0.0.1');

  try {
    await new Promise((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;

    const moveResponse = await fetch(`${baseUrl}/dramas/1`, { method: 'DELETE' });
    const moveBody = await moveResponse.json();
    assert.equal(moveResponse.status, 200);
    assert.equal(moveBody.data.message, '项目已移入回收站');
    assert.equal(moveBody.data.project.is_removed, true);
    assert.deepEqual(moveBody.data.retention, dramaService.getTrashRetentionPolicy());

    const listResponse = await fetch(`${baseUrl}/dramas/trash?page=1&page_size=2`);
    const listBody = await listResponse.json();
    assert.equal(listResponse.status, 200);
    assert.equal(listBody.data.pagination.total, 3);
    assert.deepEqual(listBody.data.items.map((drama) => drama.id), [1, 2]);

    const restoreResponse = await fetch(`${baseUrl}/dramas/1/restore`, { method: 'POST' });
    const restoreBody = await restoreResponse.json();
    assert.equal(restoreResponse.status, 200);
    assert.equal(restoreBody.data.message, '项目已恢复');
    assert.equal(restoreBody.data.project.is_removed, false);
    assert.equal(retainedRows(db).asset.local_path, 'dramas/1/assets/reference.png');

    const repeatedResponse = await fetch(`${baseUrl}/dramas/1/restore`, { method: 'POST' });
    const repeatedBody = await repeatedResponse.json();
    assert.equal(repeatedResponse.status, 404);
    assert.equal(repeatedBody.error.message, '项目不存在或不在回收站中');
  } finally {
    if (server.listening) await closeServer(server);
    db.close();
  }
});
