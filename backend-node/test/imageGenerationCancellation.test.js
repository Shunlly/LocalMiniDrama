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
const imageService = require('../src/services/imageService');
const taskService = require('../src/services/taskService');

const log = { info() {}, warn() {}, error() {}, errorw() {} };

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
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
  const oldUrl = '/static/projects/cancel/scenes/original.png';
  const oldPath = 'projects/cancel/scenes/original.png';
  const oldExtras = JSON.stringify(['projects/cancel/scenes/history.png']);
  const sceneId = Number(db.prepare(
    `INSERT INTO scenes
       (drama_id, episode_id, location, time, prompt, image_url, local_path, extra_images, status, created_at, updated_at)
     VALUES (?, ?, '车站', '夜晚', '原场景', ?, ?, ?, 'generated', ?, ?)`
  ).run(dramaId, episodeId, oldUrl, oldPath, oldExtras, now, now).lastInsertRowid);
  return { db, dramaId, sceneId, oldUrl, oldPath, oldExtras };
}

function installImageStubs(storageRoot) {
  const originals = {
    getDefaultImageConfig: imageClient.getDefaultImageConfig,
    getStoryboardReferenceLimits: imageClient.getStoryboardReferenceLimits,
    callImageApi: imageClient.callImageApi,
    downloadImageToLocalAbortable: imageClient.downloadImageToLocalAbortable,
    loadConfig: configModule.loadConfig,
  };
  imageClient.getDefaultImageConfig = () => ({ provider: 'test', model: 'test-image' });
  imageClient.getStoryboardReferenceLimits = () => ({ total: 4, maxCharacters: 3, maxObjects: 4 });
  configModule.loadConfig = () => ({ storage: { local_path: storageRoot }, style: {} });
  return () => {
    imageClient.getDefaultImageConfig = originals.getDefaultImageConfig;
    imageClient.getStoryboardReferenceLimits = originals.getStoryboardReferenceLimits;
    imageClient.callImageApi = originals.callImageApi;
    imageClient.downloadImageToLocalAbortable = originals.downloadImageToLocalAbortable;
    configModule.loadConfig = originals.loadConfig;
  };
}

function createSceneGeneration(db, fixture) {
  return imageService.create(db, log, {
    drama_id: fixture.dramaId,
    scene_id: fixture.sceneId,
    prompt: '新场景图片',
    __defer_processing: true,
  });
}

function assertOriginalScene(db, fixture) {
  assert.deepEqual(
    db.prepare('SELECT image_url, local_path, extra_images FROM scenes WHERE id = ?').get(fixture.sceneId),
    { image_url: fixture.oldUrl, local_path: fixture.oldPath, extra_images: fixture.oldExtras }
  );
}

test('图片 Provider 返回前取消不得覆盖旧场景，且任务与生成记录都进入 cancelled', async () => {
  const fixture = createFixture('Provider 取消');
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-image-provider-cancel-'));
  const restore = installImageStubs(storageRoot);
  const started = deferred();
  const release = deferred();
  let providerSignal;
  let downloadCalled = false;
  imageClient.callImageApi = async (_db, _log, options) => {
    providerSignal = options.signal;
    started.resolve();
    await release.promise;
    return { image_url: 'https://provider.example.test/late.png' };
  };
  imageClient.downloadImageToLocalAbortable = async () => {
    downloadCalled = true;
    const error = new Error('操作已取消');
    error.name = 'AbortError';
    throw error;
  };

  try {
    const created = createSceneGeneration(fixture.db, fixture);
    const processing = imageService.processImageGeneration(fixture.db, log, created.id);
    await started.promise;
    assert.ok(providerSignal instanceof AbortSignal, '必须把任务信号传给图片 Provider');

    const outcome = await taskService.cancelTask(fixture.db, log, created.task_id, '测试取消');
    assert.equal(outcome.ok, true);
    assert.equal(providerSignal.aborted, true);
    release.resolve();
    await processing;

    assert.equal(downloadCalled, true, '迟到 Provider 结果仍应在下载边界被取消信号拦截');
    assert.equal(taskService.getTask(fixture.db, created.task_id).status, 'cancelled');
    assert.equal(fixture.db.prepare('SELECT status FROM image_generations WHERE id = ?').get(created.id).status, 'cancelled');
    assertOriginalScene(fixture.db, fixture);
  } finally {
    release.resolve();
    restore();
    fixture.db.close();
    fs.rmSync(storageRoot, { recursive: true, force: true });
  }
});

test('图片落盘后提交前取消必须删除未提交文件且保留旧场景', async () => {
  const fixture = createFixture('下载取消');
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-image-download-cancel-'));
  const restore = installImageStubs(storageRoot);
  const downloaded = deferred();
  const release = deferred();
  const localPath = 'projects/cancel/scenes/uncommitted.png';
  const absolutePath = path.join(storageRoot, ...localPath.split('/'));
  imageClient.callImageApi = async () => ({ image_url: 'https://provider.example.test/generated.png' });
  imageClient.downloadImageToLocalAbortable = async (_root, _url, _category, _log, _prefix, _project, signal) => {
    assert.ok(signal instanceof AbortSignal);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, 'uncommitted');
    downloaded.resolve();
    await release.promise;
    return localPath;
  };

  try {
    const created = createSceneGeneration(fixture.db, fixture);
    const processing = imageService.processImageGeneration(fixture.db, log, created.id);
    await downloaded.promise;
    assert.equal(fs.existsSync(absolutePath), true);

    const outcome = await taskService.cancelTask(fixture.db, log, created.task_id, '测试取消');
    assert.equal(outcome.ok, true);
    release.resolve();
    await processing;

    assert.equal(fs.existsSync(absolutePath), false, '取消后不得残留未提交图片');
    assert.equal(taskService.getTask(fixture.db, created.task_id).status, 'cancelled');
    assert.equal(fixture.db.prepare('SELECT status FROM image_generations WHERE id = ?').get(created.id).status, 'cancelled');
    assertOriginalScene(fixture.db, fixture);
  } finally {
    release.resolve();
    restore();
    fixture.db.close();
    fs.rmSync(storageRoot, { recursive: true, force: true });
  }
});

test('最终场景绑定失败时图片完成、业务绑定和任务完成必须整体回滚', async () => {
  const fixture = createFixture('提交回滚');
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-image-commit-rollback-'));
  const restore = installImageStubs(storageRoot);
  const localPath = 'projects/cancel/scenes/rollback.png';
  const absolutePath = path.join(storageRoot, ...localPath.split('/'));
  imageClient.callImageApi = async () => ({ image_url: 'https://provider.example.test/generated.png' });
  imageClient.downloadImageToLocalAbortable = async () => {
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, 'rollback');
    return localPath;
  };
  fixture.db.exec(
    `CREATE TRIGGER reject_scene_image_update BEFORE UPDATE OF image_url ON scenes
     WHEN NEW.id = ${fixture.sceneId}
     BEGIN SELECT RAISE(ABORT, '测试场景绑定失败'); END;`
  );

  try {
    const created = createSceneGeneration(fixture.db, fixture);
    await imageService.processImageGeneration(fixture.db, log, created.id);

    const generation = fixture.db.prepare(
      'SELECT status, image_url, local_path FROM image_generations WHERE id = ?'
    ).get(created.id);
    assert.deepEqual(generation, { status: 'failed', image_url: null, local_path: null });
    assert.equal(taskService.getTask(fixture.db, created.task_id).status, 'failed');
    assert.equal(fs.existsSync(absolutePath), false, '回滚后不得保留无数据库归属的文件');
    assertOriginalScene(fixture.db, fixture);
  } finally {
    restore();
    fixture.db.close();
    fs.rmSync(storageRoot, { recursive: true, force: true });
  }
});
