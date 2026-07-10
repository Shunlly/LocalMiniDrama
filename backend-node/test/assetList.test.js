const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const Database = require('better-sqlite3');

const assetRoutes = require('../src/routes/assets');
const assetService = require('../src/services/assetService');

const log = {
  error() {},
};

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  `);
  return db;
}

function insertAsset(db, { dramaId = 1, name, type = 'image', createdAt, deletedAt = null }) {
  db.prepare(
    `INSERT INTO assets (drama_id, name, type, url, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(dramaId, name, type, `/static/${name}.png`, createdAt, createdAt, deletedAt);
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

test('asset service trims keyword and applies it to items and pagination total', () => {
  const db = createDb();
  try {
    insertAsset(db, { name: 'Moonlit Sword', createdAt: '2026-01-04T00:00:00.000Z' });
    insertAsset(db, { name: 'Sword Practice', type: 'video', createdAt: '2026-01-03T00:00:00.000Z' });
    insertAsset(db, { name: 'Ancient sword rack', createdAt: '2026-01-02T00:00:00.000Z' });
    insertAsset(db, { name: 'Village Gate', createdAt: '2026-01-01T00:00:00.000Z' });
    insertAsset(db, { dramaId: 2, name: 'Outsider Sword', createdAt: '2026-01-05T00:00:00.000Z' });
    insertAsset(db, {
      name: 'Deleted Sword',
      createdAt: '2026-01-06T00:00:00.000Z',
      deletedAt: '2026-01-07T00:00:00.000Z',
    });

    const result = assetService.list(db, {
      drama_id: '1',
      keyword: '  sword  ',
      page: '2',
      page_size: '2',
    });

    assert.equal(result.total, 3);
    assert.equal(result.page, 2);
    assert.equal(result.pageSize, 2);
    assert.deepEqual(result.items.map((item) => item.name), ['Ancient sword rack']);

    const injection = assetService.list(db, { keyword: "' OR 1=1 --" });
    assert.equal(injection.total, 0);
    assert.deepEqual(injection.items, []);
  } finally {
    db.close();
  }
});

test('GET /api/v1/assets filters by the trimmed keyword', async () => {
  const db = createDb();
  const app = express();
  app.get('/api/v1/assets', assetRoutes(db, log).list);
  const server = app.listen(0, '127.0.0.1');

  try {
    insertAsset(db, { name: 'Forest Gate', createdAt: '2026-01-02T00:00:00.000Z' });
    insertAsset(db, { name: 'City Market', createdAt: '2026-01-01T00:00:00.000Z' });

    await new Promise((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const { port } = server.address();
    const response = await fetch(
      `http://127.0.0.1:${port}/api/v1/assets?keyword=${encodeURIComponent('  forest  ')}&page=1&page_size=1`
    );
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.success, true);
    assert.deepEqual(body.data.items.map((item) => item.name), ['Forest Gate']);
    assert.deepEqual(body.data.pagination, {
      page: 1,
      page_size: 1,
      total: 1,
      total_pages: 1,
    });
  } finally {
    if (server.listening) await closeServer(server);
    db.close();
  }
});
