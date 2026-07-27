'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const Database = require('better-sqlite3');

const dramaRoutes = require('../src/routes/drama');
const dramaService = require('../src/services/dramaService');

const log = {
  info() {},
  error() {},
  errorw() {},
};

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE dramas (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      description TEXT,
      genre TEXT,
      style TEXT,
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
      episode_number INTEGER DEFAULT 1,
      title TEXT,
      script_content TEXT,
      description TEXT,
      duration INTEGER DEFAULT 0,
      status TEXT DEFAULT 'draft',
      video_url TEXT,
      thumbnail TEXT,
      created_at TEXT,
      updated_at TEXT,
      deleted_at TEXT
    );
    CREATE TABLE storyboards (
      id INTEGER PRIMARY KEY,
      episode_id INTEGER NOT NULL,
      storyboard_number INTEGER DEFAULT 1,
      title TEXT,
      description TEXT,
      duration INTEGER DEFAULT 0,
      created_at TEXT,
      updated_at TEXT,
      deleted_at TEXT
    );
    CREATE TABLE characters (
      id INTEGER PRIMARY KEY,
      drama_id INTEGER NOT NULL,
      name TEXT,
      sort_order INTEGER DEFAULT 0,
      image_url TEXT,
      local_path TEXT,
      deleted_at TEXT
    );
    CREATE TABLE scenes (
      id INTEGER PRIMARY KEY,
      drama_id INTEGER NOT NULL,
      image_url TEXT,
      local_path TEXT,
      deleted_at TEXT
    );
    CREATE TABLE props (
      id INTEGER PRIMARY KEY,
      drama_id INTEGER NOT NULL,
      image_url TEXT,
      local_path TEXT,
      deleted_at TEXT
    );
    CREATE TABLE assets (id INTEGER PRIMARY KEY, drama_id INTEGER, deleted_at TEXT);
  `);
  return db;
}

function seedDb(db) {
  const now = '2026-07-27T00:00:00.000Z';
  db.prepare(`
    INSERT INTO dramas (id, title, metadata, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(1, 'First project', JSON.stringify({
    canvas_layout: { nodes: { existing: { x: 10, y: 20 } } },
    unknown_metadata_key: { keep: true },
  }), now, now);
  db.prepare(`
    INSERT INTO dramas (id, title, metadata, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(2, 'Second project', JSON.stringify({ protected: 'second-project' }), now, now);
  db.prepare('INSERT INTO episodes (id, drama_id) VALUES (?, ?)').run(10, 1);
  db.prepare('INSERT INTO episodes (id, drama_id) VALUES (?, ?)').run(20, 2);
  db.prepare('INSERT INTO storyboards (id, episode_id) VALUES (?, ?)').run(100, 10);
  db.prepare('INSERT INTO storyboards (id, episode_id) VALUES (?, ?)').run(200, 20);
  db.prepare('INSERT INTO assets (id, drama_id) VALUES (?, ?)').run(1000, 1);
  db.prepare('INSERT INTO assets (id, drama_id) VALUES (?, ?)').run(2000, 2);
}

function validFreeCanvas(overrides = {}) {
  return {
    version: 1,
    mode: 'free',
    projectId: 1,
    nodes: [
      {
        id: 'free:text:one',
        type: 'text',
        position: { x: 12, y: -8 },
        width: 280,
        height: 180,
        content: 'A saved idea',
        assetId: 1000,
        storyboardId: 100,
      },
    ],
    edges: [],
    ...overrides,
  };
}

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

function expectBadRequest(action, message) {
  assert.throws(action, (error) => error?.code === 'BAD_REQUEST' && message.test(error.message));
}

test('free canvas partial update preserves canvas layout and unknown project metadata after reload', () => {
  const db = createDb();
  try {
    seedDb(db);
    const saved = dramaService.saveCanvasLayout(db, log, 1, {
      free_canvas: validFreeCanvas({
        nodes: [{
          ...validFreeCanvas().nodes[0],
          url: 'blob:runtime-only',
          dataUrl: 'data:image/png;base64,abc',
          apiKey: 'secret-key',
          requestHeaders: { authorization: 'Bearer secret' },
        }],
      }),
    });

    assert.deepEqual(saved.metadata.canvas_layout, { nodes: { existing: { x: 10, y: 20 } } });
    assert.deepEqual(saved.metadata.unknown_metadata_key, { keep: true });
    assert.equal(saved.metadata.free_canvas.nodes[0].assetId, 1000);
    assert.equal(saved.metadata.free_canvas.nodes[0].storyboardId, 100);
    const serialized = JSON.stringify(saved.metadata.free_canvas);
    assert.equal(serialized.includes('blob:'), false);
    assert.equal(serialized.includes('data:image'), false);
    assert.equal(serialized.includes('secret'), false);

    const reloaded = dramaService.getDramaById(db, 1);
    assert.deepEqual(reloaded.metadata.free_canvas, saved.metadata.free_canvas);
  } finally {
    db.close();
  }
});

for (const probe of [
  {
    name: 'an unsupported node type',
    canvas: validFreeCanvas({ nodes: [{ ...validFreeCanvas().nodes[0], type: 'provider' }] }),
    message: /node type/i,
  },
  {
    name: 'a non-finite coordinate',
    canvas: validFreeCanvas({ nodes: [{ ...validFreeCanvas().nodes[0], position: { x: Infinity, y: 0 } }] }),
    message: /position/i,
  },
  {
    name: 'a non-positive bounded dimension',
    canvas: validFreeCanvas({ nodes: [{ ...validFreeCanvas().nodes[0], width: 0 }] }),
    message: /width/i,
  },
  {
    name: 'an edge with an unknown endpoint',
    canvas: validFreeCanvas({ edges: [{ id: 'free:edge:one', source: 'free:text:one', target: 'missing' }] }),
    message: /edge/i,
  },
  {
    name: 'more than 500 free nodes',
    canvas: validFreeCanvas({
      nodes: Array.from({ length: 501 }, (_, index) => ({
        id: `free:text:${index}`,
        type: 'text',
        position: { x: index, y: 0 },
      })),
    }),
    message: /node|节点/i,
  },
]) {
  test(`free canvas rejects ${probe.name}`, () => {
    const db = createDb();
    try {
      seedDb(db);
      expectBadRequest(() => dramaService.saveCanvasLayout(db, log, 1, { free_canvas: probe.canvas }), probe.message);
      assert.equal(dramaService.getDramaById(db, 1).metadata.free_canvas, undefined);
    } finally {
      db.close();
    }
  });
}

test('free canvas rejects project and media references belonging to another project without updating either project', () => {
  const db = createDb();
  try {
    seedDb(db);
    expectBadRequest(
      () => dramaService.saveCanvasLayout(db, log, 1, { free_canvas: validFreeCanvas({ projectId: 2 }) }),
      /projectId/i,
    );
    expectBadRequest(
      () => dramaService.saveCanvasLayout(db, log, 1, {
        free_canvas: validFreeCanvas({ nodes: [{ ...validFreeCanvas().nodes[0], assetId: 2000 }] }),
      }),
      /asset/i,
    );
    expectBadRequest(
      () => dramaService.saveCanvasLayout(db, log, 1, {
        free_canvas: validFreeCanvas({ nodes: [{ ...validFreeCanvas().nodes[0], storyboardId: 200 }] }),
      }),
      /storyboard/i,
    );

    assert.equal(dramaService.getDramaById(db, 1).metadata.free_canvas, undefined);
    assert.equal(dramaService.getDramaById(db, 2).metadata.free_canvas, undefined);
    assert.equal(dramaService.getDramaById(db, 2).metadata.protected, 'second-project');
  } finally {
    db.close();
  }
});

test('canvas layout route exposes invalid free canvas as the existing HTTP 400 response shape', () => {
  const db = createDb();
  try {
    seedDb(db);
    const res = responseRecorder();
    dramaRoutes(db, {}, log).saveCanvasLayout({
      params: { id: '1' },
      body: { free_canvas: validFreeCanvas({ nodes: [{ ...validFreeCanvas().nodes[0], type: 'invalid' }] }) },
    }, res);

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error.code, 'BAD_REQUEST');
    assert.match(res.body.error.message, /node type/i);
  } finally {
    db.close();
  }
});
