'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');

const { runMigrationsAndEnsure } = require('../src/db/migrate');
const aiClient = require('../src/services/aiClient');
const framePromptService = require('../src/services/framePromptService');
const imageClient = require('../src/services/imageClient');
const propExtractionService = require('../src/services/propExtractionService');
const propImageGenerationService = require('../src/services/propImageGenerationService');
const taskService = require('../src/services/taskService');
const uploadService = require('../src/services/uploadService');

const log = { debug() {}, info() {}, warn() {}, error() {}, errorw() {} };

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createDb(t) {
  const db = new Database(':memory:');
  runMigrationsAndEnsure(db);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO dramas (id, title, status, metadata, created_at, updated_at)
     VALUES (1, '取消一致性项目', 'draft', '{}', ?, ?)`
  ).run(now, now);
  db.prepare(
    `INSERT INTO episodes (id, drama_id, episode_number, title, script_content, status, created_at, updated_at)
     VALUES (11, 1, 1, '第一集', '桌上放着一枚铜制钥匙。', 'draft', ?, ?)`
  ).run(now, now);
  db.prepare(
    `INSERT INTO storyboards
       (id, episode_id, storyboard_number, title, description, status, created_at, updated_at)
     VALUES (21, 11, 1, '第一镜', '角色拿起钥匙', 'pending', ?, ?)`
  ).run(now, now);
  t.after(() => db.close());
  return db;
}

test('道具提取取消后丢弃延迟 Provider 结果且不新增道具', async (t) => {
  const db = createDb(t);
  const entered = deferred();
  const provider = deferred();
  let providerSignal = null;
  t.mock.method(aiClient, 'generateText', async (_db, _log, _type, _prompt, _system, options) => {
    providerSignal = options.signal;
    entered.resolve();
    return provider.promise;
  });

  const task = taskService.createTask(db, log, 'prop_extraction', '11');
  const worker = propExtractionService.processPropExtraction(db, log, task.id, 11);
  await entered.promise;

  const cancelled = await taskService.cancelTask(db, log, task.id, '用户取消道具提取');
  provider.resolve(JSON.stringify([{
    name: '铜制钥匙',
    type: '随身道具',
    description: '一枚旧钥匙',
    image_prompt: 'an antique brass key',
  }]));
  await worker;

  assert.equal(cancelled.ok, true);
  assert.ok(providerSignal instanceof AbortSignal);
  assert.equal(providerSignal.aborted, true);
  assert.equal(taskService.getTask(db, task.id).status, 'cancelled');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM props WHERE deleted_at IS NULL').get().count, 0);
});

test('道具图片取消后丢弃延迟 Provider 结果且保留原图片', async (t) => {
  const db = createDb(t);
  const now = new Date().toISOString();
  const propId = Number(db.prepare(
    `INSERT INTO props
       (drama_id, episode_id, name, prompt, image_url, local_path, created_at, updated_at)
     VALUES (1, 11, '铜制钥匙', 'an antique brass key', 'https://old.example/key.png', 'props/old.png', ?, ?)`
  ).run(now, now).lastInsertRowid);
  const entered = deferred();
  const provider = deferred();
  let providerSignal = null;
  let downloadCalls = 0;
  t.mock.method(imageClient, 'callImageApi', async (_db, _log, options) => {
    providerSignal = options.signal;
    entered.resolve();
    return provider.promise;
  });
  t.mock.method(uploadService, 'downloadImageToLocal', async () => {
    downloadCalls += 1;
    return 'props/late.png';
  });

  const task = taskService.createTask(db, log, 'prop_image_generation', String(propId));
  const worker = propImageGenerationService.processPropImageGeneration(db, log, task.id, propId, {});
  await entered.promise;

  const cancelled = await taskService.cancelTask(db, log, task.id, '用户取消道具图片');
  provider.resolve({ image_url: 'https://late.example/key.png' });
  await worker;

  const prop = db.prepare('SELECT image_url, local_path, extra_images, error_msg FROM props WHERE id = ?').get(propId);
  assert.equal(cancelled.ok, true);
  assert.ok(providerSignal instanceof AbortSignal);
  assert.equal(providerSignal.aborted, true);
  assert.equal(downloadCalls, 0);
  assert.deepEqual(prop, {
    image_url: 'https://old.example/key.png',
    local_path: 'props/old.png',
    extra_images: null,
    error_msg: null,
  });
  assert.equal(taskService.getTask(db, task.id).status, 'cancelled');
});

test('道具图片下载期间取消会清理未提交文件且不覆盖原图片', async (t) => {
  const db = createDb(t);
  const now = new Date().toISOString();
  const propId = Number(db.prepare(
    `INSERT INTO props
       (drama_id, episode_id, name, prompt, image_url, local_path, created_at, updated_at)
     VALUES (1, 11, '铜制钥匙', 'an antique brass key', 'https://old.example/key.png', 'props/old.png', ?, ?)`
  ).run(now, now).lastInsertRowid);
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-prop-cancel-'));
  const relativePath = 'props/late.png';
  const absolutePath = path.join(storageRoot, 'props', 'late.png');
  const downloadEntered = deferred();
  const releaseDownload = deferred();
  t.after(() => fs.rmSync(storageRoot, { recursive: true, force: true }));
  t.mock.method(require('../src/config'), 'loadConfig', () => ({
    storage: { local_path: storageRoot },
    style: {},
    ai: {},
  }));
  t.mock.method(imageClient, 'callImageApi', async () => ({
    image_url: 'https://late.example/key.png',
  }));
  t.mock.method(uploadService, 'downloadImageToLocal', async () => {
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, 'late image');
    downloadEntered.resolve();
    await releaseDownload.promise;
    return relativePath;
  });

  const task = taskService.createTask(db, log, 'prop_image_generation', String(propId));
  const worker = propImageGenerationService.processPropImageGeneration(db, log, task.id, propId, {});
  await downloadEntered.promise;
  assert.equal(fs.existsSync(absolutePath), true);

  const cancelled = await taskService.cancelTask(db, log, task.id, '用户在图片下载期间取消');
  releaseDownload.resolve();
  await worker;

  const prop = db.prepare('SELECT image_url, local_path, extra_images, error_msg FROM props WHERE id = ?').get(propId);
  assert.equal(cancelled.ok, true);
  assert.equal(fs.existsSync(absolutePath), false);
  assert.deepEqual(prop, {
    image_url: 'https://old.example/key.png',
    local_path: 'props/old.png',
    extra_images: null,
    error_msg: null,
  });
  assert.equal(taskService.getTask(db, task.id).status, 'cancelled');
});

test('帧提示词取消后丢弃延迟 Provider 结果且不保存提示词', async (t) => {
  const db = createDb(t);
  const entered = deferred();
  const provider = deferred();
  let providerSignal = null;
  t.mock.method(aiClient, 'generateText', async (_db, _log, _type, _prompt, _system, options) => {
    providerSignal = options.signal;
    entered.resolve();
    return provider.promise;
  });

  const task = taskService.createTask(db, log, 'frame_prompt_generation', '21');
  const worker = framePromptService.processFramePromptGeneration
    ? framePromptService.processFramePromptGeneration(db, log, task.id, 21, 'first', 0, null)
    : null;
  assert.ok(worker, '帧提示词 worker 必须可定向验证');
  await entered.promise;

  const cancelled = await taskService.cancelTask(db, log, task.id, '用户取消帧提示词');
  provider.resolve(JSON.stringify({ prompt: '迟到的首帧提示词', description: '迟到结果' }));
  await worker;

  assert.equal(cancelled.ok, true);
  assert.ok(providerSignal instanceof AbortSignal);
  assert.equal(providerSignal.aborted, true);
  assert.equal(taskService.getTask(db, task.id).status, 'cancelled');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM frame_prompts').get().count, 0);
});
