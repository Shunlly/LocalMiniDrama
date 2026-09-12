'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const Database = require('better-sqlite3');

const { validateFreeCanvas } = require('../src/services/freeCanvasValidation');

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE dramas (id INTEGER PRIMARY KEY, title TEXT NOT NULL, created_at TEXT, metadata TEXT, deleted_at TEXT);
    CREATE TABLE episodes (id INTEGER PRIMARY KEY, drama_id INTEGER NOT NULL, deleted_at TEXT);
    CREATE TABLE storyboards (id INTEGER PRIMARY KEY, episode_id INTEGER NOT NULL, deleted_at TEXT);
    CREATE TABLE assets (id INTEGER PRIMARY KEY, drama_id INTEGER, local_path TEXT, deleted_at TEXT);
    CREATE TABLE scenes (id INTEGER PRIMARY KEY, drama_id INTEGER NOT NULL, deleted_at TEXT);
    INSERT INTO episodes (id, drama_id) VALUES (10, 1), (20, 2);
    INSERT INTO storyboards (id, episode_id) VALUES (100, 10), (200, 20);
    INSERT INTO dramas (id, title, created_at, deleted_at) VALUES (1, 'project', '2026-07-27', NULL), (2, 'other', '2026-07-27', NULL);
    INSERT INTO assets (id, drama_id, local_path) VALUES
      (1000, 1, 'projects/0001_20260727_project/images/frame.png'),
      (2000, 2, 'projects/0002_20260727_other/images/frame.png');
    INSERT INTO scenes (id, drama_id) VALUES (10000, 1), (20000, 2);
  `);
  return db;
}

function validCanvas(overrides = {}) {
  return {
    version: 1,
    nodes: [{
      id: 'free:image:one',
      type: 'image',
      position: { x: 0, y: 0 },
      content: 'projects/0001_20260727_project/images/frame.png',
      storageKey: 'projects/0001_20260727_project/images/frame.png',
      assetId: 1000,
      storyboardId: 100,
    }],
    edges: [],
    ...overrides,
  };
}

function expectBadRequest(action, message) {
  assert.throws(action, (error) => error?.code === 'BAD_REQUEST' && message.test(error.message));
}

test('free canvas validator rejects nested, sensitive, oversized, and cyclic allowlisted values', () => {
  const db = createDb();
  try {
    expectBadRequest(() => validateFreeCanvas(db, 1, validCanvas({
      nodes: [{ ...validCanvas().nodes[0], content: { payload: 'x'.repeat(50001) } }],
    })), /节点内容/);
    expectBadRequest(() => validateFreeCanvas(db, 1, validCanvas({
      nodes: [{ ...validCanvas().nodes[0], description: { accessToken: 'secret', providerResponse: { body: 'raw' } } }],
    })), /节点描述/);
    const cyclic = {};
    cyclic.self = cyclic;
    expectBadRequest(() => validateFreeCanvas(db, 1, validCanvas({
      nodes: [{ ...validCanvas().nodes[0], prompt: cyclic }],
    })), /节点提示词/);
  } finally {
    db.close();
  }
});

test('free canvas validator rejects cross-project root episodes and opaque storyboard references', () => {
  const db = createDb();
  try {
    const valid = validateFreeCanvas(db, 1, validCanvas({
      nodes: [{
        ...validCanvas().nodes[0],
        asset_ref: 'project:1:asset:1000',
        storyboard_ref: 'storyboard:100',
      }],
    }));
    assert.equal(valid.nodes[0].asset_ref, 'project:1:asset:1000');
    assert.equal(valid.nodes[0].storyboard_ref, 'storyboard:100');
    expectBadRequest(() => validateFreeCanvas(db, 1, validCanvas({ episodeId: 20 })), /剧集/);
    expectBadRequest(() => validateFreeCanvas(db, 1, validCanvas({
      nodes: [{ ...validCanvas().nodes[0], storyboard_ref: 'storyboard:200' }],
    })), /分镜/);
    expectBadRequest(() => validateFreeCanvas(db, 1, validCanvas({
      nodes: [{ ...validCanvas().nodes[0], storyboard_ref: 'project:2:storyboard:200' }],
    })), /project|项目/i);
  } finally {
    db.close();
  }
});

test('free canvas validator rejects mismatched storyboardId and storyboard_ref', () => {
  const db = createDb();
  try {
    db.prepare('INSERT INTO storyboards (id, episode_id) VALUES (?, ?)').run(101, 10);
    expectBadRequest(() => validateFreeCanvas(db, 1, validCanvas({
      nodes: [{
        ...validCanvas().nodes[0],
        storyboardId: 100,
        storyboard_ref: 'storyboard:101',
      }],
    })), /分镜 ID|分镜引用/);
  } finally {
    db.close();
  }
});

test('free canvas validator normalizes local image media and rejects unsafe media references', () => {
  const db = createDb();
  try {
    const valid = validateFreeCanvas(db, 1, validCanvas({
      nodes: [{
        ...validCanvas().nodes[0],
        content: '/static/projects/0001_20260727_project/images/frame.png',
      }],
    }));
    assert.equal(valid.nodes[0].content, 'projects/0001_20260727_project/images/frame.png');
    assert.equal(valid.nodes[0].storageKey, 'projects/0001_20260727_project/images/frame.png');

    for (const value of ['../outside.png', 'C:\\outside.png', 'http://127.0.0.1/frame.png']) {
      expectBadRequest(() => validateFreeCanvas(db, 1, validCanvas({
        nodes: [{ ...validCanvas().nodes[0], content: value }],
      })), /媒体|节点内容|本地/);
    }
    expectBadRequest(() => validateFreeCanvas(db, 1, validCanvas({
      nodes: [{ ...validCanvas().nodes[0], content: 'https://example.test/frame.png' }],
    })), /外部媒体地址/);
    expectBadRequest(() => validateFreeCanvas(db, 1, validCanvas({
      nodes: [{ ...validCanvas().nodes[0], storageKey: '../outside.png' }],
    })), /存储路径|媒体|本地/);
  } finally {
    db.close();
  }
});

test('free canvas permits legacy uploads only through a global asset record', () => {
  const db = createDb();
  try {
    db.prepare('INSERT INTO assets (id, drama_id, local_path) VALUES (?, ?, ?)')
      .run(3000, null, 'uploads/legacy-global.png');
    db.prepare('INSERT INTO assets (id, drama_id, local_path) VALUES (?, ?, ?)')
      .run(3001, 1, 'uploads/project-owned.png');

    const globalAsset = validateFreeCanvas(db, 1, validCanvas({
      nodes: [{
        ...validCanvas().nodes[0],
        assetId: 3000,
        content: 'uploads/legacy-global.png',
        storageKey: 'uploads/legacy-global.png',
      }],
    }));
    assert.equal(globalAsset.nodes[0].content, 'uploads/legacy-global.png');
    assert.equal(globalAsset.nodes[0].storageKey, 'uploads/legacy-global.png');

    expectBadRequest(() => validateFreeCanvas(db, 1, validCanvas({
      nodes: [{
        ...validCanvas().nodes[0],
        assetId: undefined,
        content: 'uploads/unreferenced.png',
        storageKey: 'uploads/unreferenced.png',
      }],
    })), /节点内容|本地|项目/);
    expectBadRequest(() => validateFreeCanvas(db, 1, validCanvas({
      nodes: [{
        ...validCanvas().nodes[0],
        assetId: 3001,
        content: undefined,
        storageKey: undefined,
      }],
    })), /素材|本地|项目/);
  } finally {
    db.close();
  }
});

test('free canvas validator preserves bounded mode, background, and viewport state', () => {
  const db = createDb();
  try {
    const valid = validateFreeCanvas(db, 1, validCanvas({
      mode: 'free',
      background: 'lines',
      viewport: { x: 12, y: -24, zoom: 1.25 },
    }));
    assert.equal(valid.mode, 'free');
    assert.equal(valid.background, 'lines');
    assert.deepEqual(valid.viewport, { x: 12, y: -24, zoom: 1.25 });

    expectBadRequest(() => validateFreeCanvas(db, 1, validCanvas({ mode: 'provider' })), /模式/);
    expectBadRequest(() => validateFreeCanvas(db, 1, validCanvas({ background: 'gradient' })), /背景/);
    expectBadRequest(
      () => validateFreeCanvas(db, 1, validCanvas({ viewport: { x: 0, y: 0, zoom: 3 } })),
      /视口/,
    );
  } finally {
    db.close();
  }
});

test('free canvas validator preserves only bounded config operation state', () => {
  const db = createDb();
  try {
    const valid = validateFreeCanvas(db, 1, validCanvas({
      nodes: [{
        id: 'free:config:one',
        type: 'config',
        position: { x: 0, y: 0 },
        title: '视频生成配置',
        status: 'failed',
        metadata: {
          lastError: '上次生成失败',
          operationId: 'operation-1',
          startedAt: '2026-07-27T08:00:00.000Z',
        },
      }],
    }));
    assert.equal(valid.nodes[0].status, 'failed');
    assert.deepEqual(valid.nodes[0].metadata, {
      lastError: '上次生成失败',
      operationId: 'operation-1',
      startedAt: '2026-07-27T08:00:00.000Z',
    });

    expectBadRequest(() => validateFreeCanvas(db, 1, validCanvas({
      nodes: [{
        id: 'free:config:bad-status',
        type: 'config',
        position: { x: 0, y: 0 },
        status: 'completed',
      }],
    })), /状态/);
    expectBadRequest(() => validateFreeCanvas(db, 1, validCanvas({
      nodes: [{
        id: 'free:config:secret',
        type: 'config',
        position: { x: 0, y: 0 },
        metadata: { apiKey: 'secret' },
      }],
    })), /元数据/);
    expectBadRequest(() => validateFreeCanvas(db, 1, validCanvas({
      nodes: [{
        id: 'free:text:status',
        type: 'text',
        position: { x: 0, y: 0 },
        status: 'running',
      }],
    })), /状态/);
  } finally {
    db.close();
  }
});
