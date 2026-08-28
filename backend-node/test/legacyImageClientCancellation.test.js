'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');

const configModule = require('../src/config');
const { runMigrationsAndEnsure } = require('../src/db/migrate');
const imageClient = require('../src/services/imageClient');
const taskService = require('../src/services/taskService');

const log = { info() {}, warn() {}, error() {}, errorw() {} };

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function waitFor(read, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = read();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('等待旧图片生成状态超时');
}

function createFixture(title) {
  const db = new Database(':memory:');
  runMigrationsAndEnsure(db);
  const now = new Date().toISOString();
  const dramaId = Number(db.prepare(
    `INSERT INTO dramas (title, status, created_at, updated_at) VALUES (?, 'draft', ?, ?)`
  ).run(title, now, now).lastInsertRowid);
  const episodeId = Number(db.prepare(
    `INSERT INTO episodes (drama_id, episode_number, title, status, created_at, updated_at)
     VALUES (?, 1, '第一集', 'draft', ?, ?)`
  ).run(dramaId, now, now).lastInsertRowid);
  const oldUrl = '/static/projects/legacy/scenes/original.png';
  const oldPath = 'projects/legacy/scenes/original.png';
  const oldExtras = JSON.stringify(['projects/legacy/scenes/history.png']);
  const sceneId = Number(db.prepare(
    `INSERT INTO scenes
       (drama_id, episode_id, location, time, prompt, image_url, local_path, extra_images, status, created_at, updated_at)
     VALUES (?, ?, '站台', '夜晚', '原场景', ?, ?, ?, 'generated', ?, ?)`
  ).run(dramaId, episodeId, oldUrl, oldPath, oldExtras, now, now).lastInsertRowid);
  return { db, dramaId, sceneId, oldUrl, oldPath, oldExtras };
}

function createLegacyGeneration(fixture) {
  return imageClient.createAndGenerateImage(fixture.db, log, {
    drama_id: fixture.dramaId,
    scene_id: fixture.sceneId,
    image_type: 'scene',
    prompt: '生成新的站台场景',
    model: 'test-image',
    provider: 'test-provider',
    size: '1024x1024',
  });
}

function assertOriginalScene(fixture) {
  assert.deepEqual(
    fixture.db.prepare('SELECT image_url, local_path, extra_images FROM scenes WHERE id = ?').get(fixture.sceneId),
    { image_url: fixture.oldUrl, local_path: fixture.oldPath, extra_images: fixture.oldExtras }
  );
}

function installStubs(t, storageRoot) {
  const originalLoadConfig = configModule.loadConfig;
  configModule.loadConfig = () => ({ storage: { local_path: storageRoot } });
  t.after(() => { configModule.loadConfig = originalLoadConfig; });
}

test('旧图片入口在 Provider 迟到时取消，不得下载或覆盖旧场景', async (t) => {
  const fixture = createFixture('旧入口 Provider 取消');
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-legacy-provider-'));
  const started = deferred();
  const release = deferred();
  let providerSignal;
  let downloadCalled = false;
  installStubs(t, storageRoot);
  t.after(() => {
    release.resolve();
    fixture.db.close();
    fs.rmSync(storageRoot, { recursive: true, force: true });
  });
  t.mock.method(imageClient, 'callImageApi', async (_db, _log, options) => {
    providerSignal = options.signal;
    started.resolve();
    await release.promise;
    return { image_url: 'https://provider.example.test/late.png' };
  });
  t.mock.method(imageClient, 'downloadImageToLocalAbortable', async () => {
    downloadCalled = true;
    return 'projects/legacy/scenes/late.png';
  });

  const created = createLegacyGeneration(fixture);
  await started.promise;
  assert.ok(providerSignal instanceof AbortSignal, 'Provider 必须收到任务取消信号');

  const cancelled = await taskService.cancelTask(fixture.db, log, created.task_id, '测试取消');
  assert.equal(cancelled.ok, true);
  assert.equal(providerSignal.aborted, true);
  release.resolve();

  await waitFor(() => fixture.db.prepare(
    `SELECT status FROM image_generations WHERE id = ? AND status = 'cancelled'`
  ).get(created.id));
  assert.equal(taskService.getTask(fixture.db, created.task_id).status, 'cancelled');
  assert.equal(downloadCalled, false, '迟到 Provider 结果必须在下载前被取消边界拦截');
  assertOriginalScene(fixture);
});

test('旧图片入口在下载落盘后取消，必须删除文件并保留旧主图与历史图', async (t) => {
  const fixture = createFixture('旧入口下载取消');
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-legacy-download-'));
  const downloaded = deferred();
  const release = deferred();
  const localPath = 'projects/legacy/scenes/uncommitted.png';
  const absolutePath = path.join(storageRoot, ...localPath.split('/'));
  installStubs(t, storageRoot);
  t.after(() => {
    release.resolve();
    fixture.db.close();
    fs.rmSync(storageRoot, { recursive: true, force: true });
  });
  t.mock.method(imageClient, 'callImageApi', async (_db, _log, options) => {
    assert.ok(options.signal instanceof AbortSignal);
    return { image_url: 'https://provider.example.test/generated.png' };
  });
  t.mock.method(
    imageClient,
    'downloadImageToLocalAbortable',
    async (_root, _url, _category, _log, _prefix, _project, signal) => {
      assert.ok(signal instanceof AbortSignal, '下载必须复用任务取消信号');
      fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
      fs.writeFileSync(absolutePath, 'uncommitted');
      downloaded.resolve();
      await release.promise;
      return localPath;
    }
  );

  const created = createLegacyGeneration(fixture);
  await downloaded.promise;
  assert.equal(fs.existsSync(absolutePath), true);
  const cancelled = await taskService.cancelTask(fixture.db, log, created.task_id, '测试取消');
  assert.equal(cancelled.ok, true);
  release.resolve();

  await waitFor(() => !fs.existsSync(absolutePath));
  assert.equal(taskService.getTask(fixture.db, created.task_id).status, 'cancelled');
  assert.equal(
    fixture.db.prepare('SELECT status FROM image_generations WHERE id = ?').get(created.id).status,
    'cancelled'
  );
  assertOriginalScene(fixture);
});

test('旧图片入口最终绑定失败时，图片、场景与任务完成必须整体回滚', async (t) => {
  const fixture = createFixture('旧入口事务回滚');
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-legacy-rollback-'));
  const localPath = 'projects/legacy/scenes/rollback.png';
  const absolutePath = path.join(storageRoot, ...localPath.split('/'));
  installStubs(t, storageRoot);
  t.after(() => {
    fixture.db.close();
    fs.rmSync(storageRoot, { recursive: true, force: true });
  });
  t.mock.method(imageClient, 'callImageApi', async () => ({
    image_url: 'https://provider.example.test/generated.png',
  }));
  t.mock.method(imageClient, 'downloadImageToLocalAbortable', async () => {
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, 'rollback');
    return localPath;
  });
  fixture.db.exec(
    `CREATE TRIGGER reject_legacy_scene_image BEFORE UPDATE OF image_url ON scenes
     WHEN NEW.id = ${fixture.sceneId}
     BEGIN SELECT RAISE(ABORT, '测试旧入口场景绑定失败'); END;`
  );

  const created = createLegacyGeneration(fixture);
  const failedGeneration = await waitFor(() => {
    const row = fixture.db.prepare(
      'SELECT status, image_url, local_path, error_msg FROM image_generations WHERE id = ?'
    ).get(created.id);
    return row?.status === 'failed' ? row : null;
  });

  assert.equal(failedGeneration.image_url, null);
  assert.equal(failedGeneration.local_path, null);
  assert.match(failedGeneration.error_msg, /SQLITE_CONSTRAINT_TRIGGER/);
  assert.equal(taskService.getTask(fixture.db, created.task_id).status, 'failed');
  assert.equal(fs.existsSync(absolutePath), false, '事务回滚后不得留下无数据库归属的文件');
  assertOriginalScene(fixture);
});

test('旧图片入口下载失败时不得提交完成状态', async (t) => {
  const fixture = createFixture('旧入口下载失败');
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-legacy-download-failed-'));
  installStubs(t, storageRoot);
  t.after(() => {
    fixture.db.close();
    fs.rmSync(storageRoot, { recursive: true, force: true });
  });
  t.mock.method(imageClient, 'callImageApi', async () => ({
    image_url: 'https://provider.example.test/generated.png',
  }));
  t.mock.method(imageClient, 'downloadImageToLocalAbortable', async () => null);

  const created = createLegacyGeneration(fixture);
  const generation = await waitFor(() => {
    const row = fixture.db.prepare(
      'SELECT status, image_url, local_path, error_msg FROM image_generations WHERE id = ?'
    ).get(created.id);
    return row?.status === 'failed' ? row : null;
  });

  assert.equal(generation.image_url, null);
  assert.equal(generation.local_path, null);
  assert.ok(generation.error_msg, '下载失败必须写入经过净化的错误信息');
  assert.equal(taskService.getTask(fixture.db, created.task_id).status, 'failed');
  assertOriginalScene(fixture);
});
