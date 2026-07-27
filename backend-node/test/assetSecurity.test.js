'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');
const Database = require('better-sqlite3');

const assetRoutes = require('../src/routes/assets');
const assetService = require('../src/services/assetService');
const { validateFreeCanvas } = require('../src/services/freeCanvasValidation');

const log = { error() {}, info() {}, warn() {} };

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE dramas (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      created_at TEXT,
      metadata TEXT,
      deleted_at TEXT
    );
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
    CREATE TABLE episodes (id INTEGER PRIMARY KEY, drama_id INTEGER NOT NULL, deleted_at TEXT);
    CREATE TABLE storyboards (id INTEGER PRIMARY KEY, episode_id INTEGER NOT NULL, deleted_at TEXT);
    CREATE TABLE scenes (id INTEGER PRIMARY KEY, drama_id INTEGER NOT NULL, deleted_at TEXT);
    CREATE TABLE image_generations (
      id INTEGER PRIMARY KEY,
      drama_id INTEGER,
      image_url TEXT,
      local_path TEXT,
      deleted_at TEXT
    );
    CREATE TABLE video_generations (
      id INTEGER PRIMARY KEY,
      drama_id INTEGER,
      video_url TEXT,
      local_path TEXT,
      deleted_at TEXT
    );
  `);
  const createdAt = '2026-07-27T00:00:00.000Z';
  db.prepare('INSERT INTO dramas (id, title, created_at, deleted_at) VALUES (?, ?, ?, ?)')
    .run(1, 'First Project', createdAt, null);
  db.prepare('INSERT INTO dramas (id, title, created_at, deleted_at) VALUES (?, ?, ?, ?)')
    .run(2, 'Second Project', createdAt, null);
  db.prepare('INSERT INTO dramas (id, title, created_at, deleted_at) VALUES (?, ?, ?, ?)')
    .run(3, 'Deleted Project', createdAt, createdAt);
  return db;
}

function closeServer(server) {
  return new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

function imageNode(overrides = {}) {
  return {
    id: 'free:image:one',
    type: 'image',
    position: { x: 0, y: 0 },
    content: 'projects/0001_20260727_First_Project/uploads/first.png',
    ...overrides,
  };
}

test('POST /assets rejects non-numeric, nonexistent, and deleted drama ids with a stable 400 response', async () => {
  const db = createDb();
  const app = express();
  app.use(express.json());
  app.post('/api/v1/assets', assetRoutes(db, log).create);
  const server = app.listen(0, '127.0.0.1');

  try {
    await new Promise((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const baseUrl = `http://127.0.0.1:${server.address().port}/api/v1/assets`;
    for (const dramaId of ['1', {}, 999, 3]) {
      const response = await fetch(baseUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ drama_id: dramaId, name: 'unsafe' }),
      });
      const body = await response.json();
      assert.equal(response.status, 400);
      assert.equal(body.error.code, 'BAD_REQUEST');
      assert.doesNotMatch(body.error.message, /sqlite|bind|sql/i);
    }

    const internalFailure = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ drama_id: 1, name: {} }),
    });
    const internalBody = await internalFailure.json();
    assert.equal(internalFailure.status, 500);
    assert.equal(internalBody.error.code, 'INTERNAL_ERROR');
    assert.doesNotMatch(internalBody.error.message, /sqlite|bind|sql/i);
  } finally {
    if (server.listening) await closeServer(server);
    db.close();
  }
});

test('asset creation normalizes current project and library media while rejecting traversal, other projects, and localhost URLs', () => {
  const db = createDb();
  try {
    const projectAsset = assetService.create(db, log, {
      drama_id: 1,
      local_path: '/static/projects/0001_20260727_First_Project/uploads/first.png',
      url: 'projects/0001_20260727_First_Project/uploads/first.png',
    });
    assert.equal(projectAsset.local_path, 'projects/0001_20260727_First_Project/uploads/first.png');
    assert.equal(projectAsset.url, '/static/projects/0001_20260727_First_Project/uploads/first.png');

    const libraryAsset = assetService.create(db, log, {
      drama_id: 1,
      local_path: 'library/uploads/global.png',
      url: '/static/library/uploads/global.png',
    });
    assert.equal(libraryAsset.local_path, 'library/uploads/global.png');

    const globalLegacyAsset = assetService.create(db, log, {
      local_path: 'uploads/legacy-global.png',
      url: '/static/uploads/legacy-global.png',
    });
    assert.equal(globalLegacyAsset.local_path, 'uploads/legacy-global.png');

    const legacyAsset = assetService.create(db, log, {
      drama_id: '1',
      local_path: 'dramas/1/assets/legacy.png',
      url: '/static/dramas/1/assets/legacy.png',
    });
    assert.equal(legacyAsset.drama_id, 1);
    assert.equal(legacyAsset.local_path, 'dramas/1/assets/legacy.png');

    for (const request of [
      { drama_id: 1, local_path: '../outside.png' },
      { drama_id: 1, local_path: 'projects/0002_20260727_Second_Project/uploads/second.png' },
      { drama_id: 1, url: '/static/projects/0002_20260727_Second_Project/uploads/second.png' },
      { drama_id: 1, url: 'http://localhost:5679/static/library/uploads/global.png' },
    ]) {
      assert.throws(() => assetService.create(db, log, request), (error) => error.code === 'BAD_REQUEST');
    }
  } finally {
    db.close();
  }
});

test('internal image import cannot bypass project media scope', () => {
  const db = createDb();
  try {
    const otherProjectPath = 'projects/0002_20260727_Second_Project/uploads/private.png';
    db.prepare(`
      INSERT INTO image_generations (id, drama_id, image_url, local_path, deleted_at)
      VALUES (?, ?, ?, ?, NULL)
    `).run(101, 1, `/static/${otherProjectPath}`, otherProjectPath);

    assert.throws(
      () => assetService.importFromImage(db, log, 101),
      (error) => error?.code === 'BAD_REQUEST' && /project|\u9879\u76ee/i.test(error.message),
    );
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM assets').get().count, 0);
  } finally {
    db.close();
  }
});

test('internal imports prefer a scoped local copy over a provider remote URL', () => {
  const db = createDb();
  try {
    const imagePath = 'projects/0001_20260727_First_Project/uploads/generated.png';
    const videoPath = 'projects/0001_20260727_First_Project/uploads/generated.mp4';
    db.prepare(`
      INSERT INTO image_generations (id, drama_id, image_url, local_path, deleted_at)
      VALUES (?, ?, ?, ?, NULL)
    `).run(103, 1, 'https://provider.example/generated.png?signature=secret', imagePath);
    db.prepare(`
      INSERT INTO video_generations (id, drama_id, video_url, local_path, deleted_at)
      VALUES (?, ?, ?, ?, NULL)
    `).run(201, 1, 'http://10.0.0.8/private.mp4', videoPath);

    const image = assetService.importFromImage(db, log, 103);
    const video = assetService.importFromVideo(db, log, 201);
    assert.equal(image.local_path, imagePath);
    assert.equal(image.url, `/static/${imagePath}`);
    assert.equal(video.local_path, videoPath);
    assert.equal(video.url, `/static/${videoPath}`);
    assert.doesNotMatch(JSON.stringify([image, video]), /provider\.example|10\.0\.0\.8|signature/i);
  } finally {
    db.close();
  }
});

test('local asset creation derives one canonical path and rejects conflicting local references', () => {
  const db = createDb();
  try {
    const firstPath = 'projects/0001_20260727_First_Project/uploads/first.png';
    const secondPath = 'projects/0001_20260727_First_Project/uploads/second.png';
    const localOnly = assetService.create(db, log, { drama_id: 1, local_path: firstPath });
    assert.equal(localOnly.local_path, firstPath);
    assert.equal(localOnly.url, `/static/${firstPath}`);

    const urlOnly = assetService.create(db, log, { drama_id: 1, url: `/static/${secondPath}` });
    assert.equal(urlOnly.local_path, secondPath);
    assert.equal(urlOnly.url, `/static/${secondPath}`);

    const uploadedThroughPublicBase = assetService.create(db, log, {
      drama_id: 1,
      local_path: firstPath,
      url: `https://cdn.example.test/static/${firstPath}?signature=temporary`,
    });
    assert.equal(uploadedThroughPublicBase.local_path, firstPath);
    assert.equal(uploadedThroughPublicBase.url, `/static/${firstPath}`);

    assert.throws(
      () => assetService.create(db, log, {
        drama_id: 1,
        local_path: firstPath,
        url: `/static/${secondPath}`,
      }),
      (error) => error?.code === 'BAD_REQUEST',
    );
  } finally {
    db.close();
  }
});

test('partial local media updates atomically keep url and local_path canonical', () => {
  const db = createDb();
  try {
    const firstPath = 'projects/0001_20260727_First_Project/uploads/first.png';
    const secondPath = 'projects/0001_20260727_First_Project/uploads/second.png';
    const thirdPath = 'projects/0001_20260727_First_Project/uploads/third.png';
    const item = assetService.create(db, log, {
      drama_id: 1,
      local_path: firstPath,
      url: `/static/${firstPath}`,
    });

    const localUpdated = assetService.update(db, log, item.id, { local_path: secondPath });
    assert.equal(localUpdated.local_path, secondPath);
    assert.equal(localUpdated.url, `/static/${secondPath}`);

    const urlUpdated = assetService.update(db, log, item.id, { url: `/static/${thirdPath}` });
    assert.equal(urlUpdated.local_path, thirdPath);
    assert.equal(urlUpdated.url, `/static/${thirdPath}`);

    assert.throws(
      () => assetService.update(db, log, item.id, {
        local_path: firstPath,
        url: `/static/${secondPath}`,
      }),
      (error) => error?.code === 'BAD_REQUEST',
    );
    assert.deepEqual(
      db.prepare('SELECT url, local_path FROM assets WHERE id = ?').get(item.id),
      { url: `/static/${thirdPath}`, local_path: thirdPath },
    );
  } finally {
    db.close();
  }
});

test('PUT /assets migrates a legacy zero-scope upload into a global library asset accepted by free canvas', async () => {
  const db = createDb();
  db.prepare('INSERT INTO assets (id, drama_id, name, local_path, url, deleted_at) VALUES (?, 0, ?, ?, ?, NULL)')
    .run(32, 'legacy global', 'uploads/legacy-global.png', '/static/uploads/legacy-global.png');
  const app = express();
  app.use(express.json());
  app.put('/api/v1/assets/:id', assetRoutes(db, log).update);
  const server = app.listen(0, '127.0.0.1');

  try {
    await new Promise((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const libraryPath = 'library/uploads/migrated-global.png';
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/assets/32`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        local_path: libraryPath,
        url: `/static/${libraryPath}`,
      }),
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.data.drama_id, null);
    assert.deepEqual(
      db.prepare('SELECT drama_id, local_path, url FROM assets WHERE id = ?').get(32),
      { drama_id: null, local_path: libraryPath, url: `/static/${libraryPath}` },
    );

    const canvas = validateFreeCanvas(db, 1, {
      version: 1,
      nodes: [imageNode({ assetId: 32, content: undefined })],
      edges: [],
    });
    assert.equal(canvas.nodes[0].content, libraryPath);
  } finally {
    if (server.listening) await closeServer(server);
    db.close();
  }
});

test('internal imports normalize drama_id zero to global while external creation rejects zero', () => {
  const db = createDb();
  try {
    assert.throws(
      () => assetService.create(db, log, { drama_id: 0, local_path: 'library/images/external.png' }),
      (error) => error?.code === 'BAD_REQUEST',
    );
    db.prepare(`
      INSERT INTO image_generations (id, drama_id, image_url, local_path, deleted_at)
      VALUES (?, 0, ?, ?, NULL)
    `).run(102, '/static/library/images/global.png', 'library/images/global.png');
    db.prepare(`
      INSERT INTO video_generations (id, drama_id, video_url, local_path, deleted_at)
      VALUES (?, 0, ?, ?, NULL)
    `).run(202, '/static/library/videos/global.mp4', 'library/videos/global.mp4');

    const image = assetService.importFromImage(db, log, 102);
    const video = assetService.importFromVideo(db, log, 202);
    assert.equal(image.drama_id, null);
    assert.equal(image.url, '/static/library/images/global.png');
    assert.equal(video.drama_id, null);
    assert.equal(video.url, '/static/library/videos/global.mp4');
  } finally {
    db.close();
  }
});

test('synchronous asset persistence rejects every remote URL instead of using syntax-only checks', () => {
  const db = createDb();
  try {
    for (const url of [
      'https://localtest.me/private.png',
      'https://example.com/public.png',
    ]) {
      assert.throws(
        () => assetService.create(db, log, { drama_id: 1, url }),
        (error) => error?.code === 'BAD_REQUEST' && /DNS|remote|\u8fdc\u7a0b/i.test(error.message),
      );
    }
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM assets').get().count, 0);
  } finally {
    db.close();
  }
});

test('free canvas only accepts current project or library media and uses the referenced asset canonical path', () => {
  const db = createDb();
  try {
    db.prepare('INSERT INTO assets (id, drama_id, local_path, deleted_at) VALUES (?, ?, ?, NULL)')
      .run(10, 1, 'projects/0001_20260727_First_Project/uploads/canonical.png');
    db.prepare('INSERT INTO assets (id, drama_id, local_path, deleted_at) VALUES (?, ?, ?, NULL)')
      .run(20, 2, 'projects/0002_20260727_Second_Project/uploads/second.png');

    const current = validateFreeCanvas(db, 1, {
      version: 1,
      nodes: [imageNode({ assetId: 10, content: undefined })],
      edges: [],
    });
    assert.equal(current.nodes[0].content, 'projects/0001_20260727_First_Project/uploads/canonical.png');
    const assetRef = validateFreeCanvas(db, 1, {
      version: 1,
      nodes: [imageNode({ asset_ref: 'asset:10', content: undefined })],
      edges: [],
    });
    assert.equal(assetRef.nodes[0].content, 'projects/0001_20260727_First_Project/uploads/canonical.png');

    const library = validateFreeCanvas(db, 1, {
      version: 1,
      nodes: [imageNode({ content: 'library/uploads/global.png' })],
      edges: [],
    });
    assert.equal(library.nodes[0].content, 'library/uploads/global.png');

    for (const node of [
      imageNode({ content: 'projects/0002_20260727_Second_Project/uploads/second.png' }),
      imageNode({ assetId: 20 }),
      imageNode({ assetId: 10, content: 'library/uploads/global.png' }),
    ]) {
      assert.throws(
        () => validateFreeCanvas(db, 1, { version: 1, nodes: [node], edges: [] }),
        (error) => error.code === 'BAD_REQUEST',
      );
    }
  } finally {
    db.close();
  }
});

test('legacy drama_id zero assets are global only for safe root uploads paths', () => {
  const db = createDb();
  try {
    db.prepare('INSERT INTO assets (id, drama_id, name, local_path, url, deleted_at) VALUES (?, 0, ?, ?, ?, NULL)')
      .run(30, 'legacy global', 'uploads/legacy-global.png', '/static/uploads/legacy-global.png');
    db.prepare('INSERT INTO assets (id, drama_id, name, local_path, url, deleted_at) VALUES (?, 0, ?, ?, ?, NULL)')
      .run(31, 'invalid zero scope', 'projects/0002_20260727_Second_Project/uploads/private.png', '/static/projects/0002_20260727_Second_Project/uploads/private.png');

    const canvas = validateFreeCanvas(db, 1, {
      version: 1,
      nodes: [imageNode({ assetId: 30, content: undefined })],
      edges: [],
    });
    assert.equal(canvas.nodes[0].content, 'uploads/legacy-global.png');

    const updated = assetService.update(db, log, 30, { name: 'legacy renamed' });
    assert.equal(updated.name, 'legacy renamed');
    assert.equal(updated.drama_id, 0);

    assert.throws(
      () => validateFreeCanvas(db, 1, {
        version: 1,
        nodes: [imageNode({ assetId: 31, content: undefined })],
        edges: [],
      }),
      (error) => error?.code === 'BAD_REQUEST',
    );
    assert.throws(
      () => assetService.update(db, log, 31, { name: 'must stay rejected' }),
      (error) => error?.code === 'BAD_REQUEST',
    );
  } finally {
    db.close();
  }
});
