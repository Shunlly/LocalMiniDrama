'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const Database = require('better-sqlite3');

const { validateFreeCanvas } = require('../src/services/freeCanvasValidation');

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE episodes (id INTEGER PRIMARY KEY, drama_id INTEGER NOT NULL, deleted_at TEXT);
    CREATE TABLE storyboards (id INTEGER PRIMARY KEY, episode_id INTEGER NOT NULL, deleted_at TEXT);
    CREATE TABLE assets (id INTEGER PRIMARY KEY, drama_id INTEGER, deleted_at TEXT);
    CREATE TABLE scenes (id INTEGER PRIMARY KEY, drama_id INTEGER NOT NULL, deleted_at TEXT);
    INSERT INTO episodes (id, drama_id) VALUES (10, 1), (20, 2);
    INSERT INTO storyboards (id, episode_id) VALUES (100, 10), (200, 20);
    INSERT INTO assets (id, drama_id) VALUES (1000, 1), (2000, 2);
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
    })), /content/i);
    expectBadRequest(() => validateFreeCanvas(db, 1, validCanvas({
      nodes: [{ ...validCanvas().nodes[0], description: { accessToken: 'secret', providerResponse: { body: 'raw' } } }],
    })), /description/i);
    const cyclic = {};
    cyclic.self = cyclic;
    expectBadRequest(() => validateFreeCanvas(db, 1, validCanvas({
      nodes: [{ ...validCanvas().nodes[0], prompt: cyclic }],
    })), /prompt/i);
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
    expectBadRequest(() => validateFreeCanvas(db, 1, validCanvas({ episodeId: 20 })), /episode/i);
    expectBadRequest(() => validateFreeCanvas(db, 1, validCanvas({
      nodes: [{ ...validCanvas().nodes[0], storyboard_ref: 'storyboard:200' }],
    })), /storyboard/i);
    expectBadRequest(() => validateFreeCanvas(db, 1, validCanvas({
      nodes: [{ ...validCanvas().nodes[0], storyboard_ref: 'project:2:storyboard:200' }],
    })), /project|项目/i);
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
      })), /media|content/i);
    }
    expectBadRequest(() => validateFreeCanvas(db, 1, validCanvas({
      nodes: [{ ...validCanvas().nodes[0], content: 'https://example.test/frame.png' }],
    })), /external|外部/i);
    expectBadRequest(() => validateFreeCanvas(db, 1, validCanvas({
      nodes: [{ ...validCanvas().nodes[0], storageKey: '../outside.png' }],
    })), /media|storageKey/i);
  } finally {
    db.close();
  }
});
