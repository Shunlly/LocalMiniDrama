const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const Database = require('better-sqlite3');

const { runMigrationsAndEnsure } = require('../src/db/migrate');
const config = require('../src/config');
const storyboardRoutes = require('../src/routes/storyboards');
const { VALID_PNG_BYTES } = require('./mediaFixture');

const log = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

function createStoryboardDb() {
  const db = new Database(':memory:');
  runMigrationsAndEnsure(db);
  const now = '2026-07-28T12:00:00.000Z';
  db.prepare(
    `INSERT INTO dramas (id, title, status, metadata, created_at, updated_at)
     VALUES (1, 'Upscale security', 'draft', '{}', ?, ?)`
  ).run(now, now);
  db.prepare(
    `INSERT INTO episodes (id, drama_id, episode_number, title, status, created_at, updated_at)
     VALUES (1, 1, 1, 'Episode 1', 'draft', ?, ?)`
  ).run(now, now);
  db.prepare(
    `INSERT INTO storyboards (id, episode_id, storyboard_number, title, status, created_at, updated_at)
     VALUES (1, 1, 1, 'Shot 1', 'pending', ?, ?)`
  ).run(now, now);
  return db;
}

async function startStoryboardApi(t, storageRoot) {
  const db = createStoryboardDb();
  const originalLoadConfig = config.loadConfig;
  config.loadConfig = () => ({ storage: { local_path: storageRoot } });

  const app = express();
  app.use(express.json());
  const handlers = storyboardRoutes(db, log);
  app.put('/api/v1/storyboards/:id', handlers.update);
  app.post('/api/v1/storyboards/:id/upscale', handlers.upscale);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });

  t.after(() => {
    config.loadConfig = originalLoadConfig;
    db.close();
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return {
    db,
    baseUrl: `http://127.0.0.1:${server.address().port}/api/v1`,
  };
}

async function updateStoryboard(baseUrl, localPath) {
  return fetch(`${baseUrl}/storyboards/1`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ local_path: localPath }),
  });
}

async function upscaleStoryboard(baseUrl) {
  return fetch(`${baseUrl}/storyboards/1/upscale`, { method: 'POST' });
}

test('upscale API rejects a storyboard traversal path before it can read or write outside storage', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-upscale-traversal-'));
  const storageRoot = path.join(root, 'storage');
  const outsideInput = path.join(root, 'outside.png');
  const outsideOutput = path.join(root, 'outside_2x.png');
  fs.mkdirSync(storageRoot, { recursive: true });
  fs.writeFileSync(outsideInput, VALID_PNG_BYTES);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const { baseUrl } = await startStoryboardApi(t, storageRoot);
  const update = await updateStoryboard(baseUrl, '../outside.png');
  assert.equal(update.status, 200);

  const upscale = await upscaleStoryboard(baseUrl);
  const body = await upscale.text();
  assert.deepEqual(
    { status: upscale.status, outsideOutputExists: fs.existsSync(outsideOutput) },
    { status: 400, outsideOutputExists: false },
    body
  );
  assert.doesNotMatch(body, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
});

test('upscale API rejects a storage path whose directory link targets outside storage', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-upscale-symlink-'));
  const storageRoot = path.join(root, 'storage');
  const outsideRoot = path.join(root, 'outside');
  const outsideInput = path.join(outsideRoot, 'source.png');
  const outsideOutput = path.join(outsideRoot, 'source_2x.png');
  fs.mkdirSync(storageRoot, { recursive: true });
  fs.mkdirSync(outsideRoot, { recursive: true });
  fs.writeFileSync(outsideInput, VALID_PNG_BYTES);
  fs.symlinkSync(outsideRoot, path.join(storageRoot, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const { baseUrl } = await startStoryboardApi(t, storageRoot);
  const update = await updateStoryboard(baseUrl, 'linked/source.png');
  assert.equal(update.status, 200);

  const upscale = await upscaleStoryboard(baseUrl);
  const body = await upscale.text();
  assert.deepEqual(
    { status: upscale.status, outsideOutputExists: fs.existsSync(outsideOutput) },
    { status: 400, outsideOutputExists: false },
    body
  );
  assert.doesNotMatch(body, new RegExp(outsideRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
});

test('upscale API keeps valid storage media available', async (t) => {
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-upscale-valid-'));
  const sourcePath = 'projects/shot.png';
  const outputPath = 'projects/shot_2x.png';
  fs.mkdirSync(path.join(storageRoot, 'projects'), { recursive: true });
  fs.writeFileSync(path.join(storageRoot, 'projects', 'shot.png'), VALID_PNG_BYTES);
  t.after(() => fs.rmSync(storageRoot, { recursive: true, force: true }));

  const { db, baseUrl } = await startStoryboardApi(t, storageRoot);
  const update = await updateStoryboard(baseUrl, sourcePath);
  assert.equal(update.status, 200);

  const upscale = await upscaleStoryboard(baseUrl);
  const body = await upscale.json();
  assert.equal(upscale.status, 200);
  assert.equal(body.data.local_path, outputPath);
  assert.equal(fs.existsSync(path.join(storageRoot, 'projects', 'shot_2x.png')), true);
  assert.equal(db.prepare('SELECT local_path FROM storyboards WHERE id = 1').get().local_path, outputPath);
});
