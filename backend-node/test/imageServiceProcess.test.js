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
const processModule = require('../src/services/imageServiceProcess');
const taskService = require('../src/services/taskService');

const DRAMA_ID = 11;
const EPISODE_ID = 1101;
const SCENE_ID = 8808;
const STORYBOARD_ID = 4404;
const IMAGE_ID = 11111;
const OTHER_IMAGE_ID = 12222;

const log = { info() {}, warn() {}, error() {}, errorw() {} };

function createDb() {
  const db = new Database(':memory:');
  runMigrationsAndEnsure(db);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO dramas (id, title, status, created_at, updated_at) VALUES (?, '可读', 'draft', ?, ?)`
  ).run(DRAMA_ID, now, now);
  db.prepare(
    `INSERT INTO episodes (id, drama_id, episode_number, title, status, created_at, updated_at)
     VALUES (?, ?, 1, '第一集', 'draft', ?, ?)`
  ).run(EPISODE_ID, DRAMA_ID, now, now);
  db.prepare(
    `INSERT INTO scenes (id, drama_id, episode_id, location, time, prompt, image_url, local_path, extra_images, status, created_at, updated_at)
     VALUES (?, ?, ?, '码头', '夜', '雨', '/static/old.png', 'projects/old.png', ?, 'generated', ?, ?)`
  ).run(SCENE_ID, DRAMA_ID, EPISODE_ID, JSON.stringify(['projects/history.png']), now, now);
  db.prepare(
    `INSERT INTO storyboards (id, episode_id, scene_id, title, created_at, updated_at)
     VALUES (?, ?, ?, '主分镜', ?, ?)`
  ).run(STORYBOARD_ID, EPISODE_ID, SCENE_ID, now, now);
  const ids = [DRAMA_ID, EPISODE_ID, SCENE_ID, STORYBOARD_ID, IMAGE_ID, OTHER_IMAGE_ID];
  assert.equal(new Set(ids).size, ids.length);
  return db;
}

function insertGeneration(db, overrides = {}) {
  const now = new Date().toISOString();
  const row = {
    id: IMAGE_ID,
    storyboard_id: null,
    drama_id: DRAMA_ID,
    scene_id: SCENE_ID,
    provider: 'openai',
    prompt: '夜雨',
    status: 'processing',
    created_at: now,
    updated_at: now,
    ...overrides,
  };
  db.prepare(
    `INSERT INTO image_generations
      (id, storyboard_id, drama_id, scene_id, provider, prompt, status, task_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    row.id,
    row.storyboard_id,
    row.drama_id,
    row.scene_id,
    row.provider,
    row.prompt,
    row.status,
    row.task_id || null,
    row.created_at,
    row.updated_at
  );
  return row;
}

function installImageStubs(storageRoot, extras = {}) {
  const originals = {
    getDefaultImageConfig: imageClient.getDefaultImageConfig,
    getStoryboardReferenceLimits: imageClient.getStoryboardReferenceLimits,
    callImageApi: imageClient.callImageApi,
    downloadImageToLocalAbortable: imageClient.downloadImageToLocalAbortable,
    loadConfig: configModule.loadConfig,
  };
  imageClient.getDefaultImageConfig = extras.getDefaultImageConfig || (() => ({ provider: 'test', model: 'test-image' }));
  imageClient.getStoryboardReferenceLimits = extras.getStoryboardReferenceLimits || (() => ({ total: 4, maxCharacters: 3, maxObjects: 4 }));
  imageClient.callImageApi = extras.callImageApi || (async () => ({ image_url: 'https://provider.example.test/generated.png' }));
  imageClient.downloadImageToLocalAbortable = extras.downloadImageToLocalAbortable || (async () => {
    const localPath = 'projects/process/scenes/generated.png';
    const abs = path.join(storageRoot, ...localPath.split('/'));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, 'generated');
    return localPath;
  });
  configModule.loadConfig = extras.loadConfig || (() => ({ storage: { local_path: storageRoot }, style: {} }));
  return () => {
    imageClient.getDefaultImageConfig = originals.getDefaultImageConfig;
    imageClient.getStoryboardReferenceLimits = originals.getStoryboardReferenceLimits;
    imageClient.callImageApi = originals.callImageApi;
    imageClient.downloadImageToLocalAbortable = originals.downloadImageToLocalAbortable;
    configModule.loadConfig = originals.loadConfig;
  };
}

test('imageService 公开 API 仍指向执行模块的同一函数', () => {
  assert.equal(imageService.processImageGeneration, processModule.processImageGeneration);
});

test('跨模块 ID 在测试数据里互不相等，避免碰巧同值假通过', () => {
  const ids = [DRAMA_ID, EPISODE_ID, SCENE_ID, STORYBOARD_ID, IMAGE_ID, OTHER_IMAGE_ID];
  assert.equal(new Set(ids).size, ids.length);
});

test('供应商调用装配只拼装字段，null 参考图才收成 undefined', () => {
  const signal = { aborted: false };
  const options = processModule.assembleImageProviderCallOptions({
    row: {
      model: 'm1',
      quality: 'high',
      drama_id: DRAMA_ID,
      character_id: 55,
      negative_prompt: 'blur',
      idempotency_key: 'k1',
    },
    imageGenId: IMAGE_ID,
    finalPrompt: '夜雨码头',
    imageSize: '1440x2560',
    imageServiceType: 'image',
    referenceImageUrls: null,
    filesBaseUrl: 'http://127.0.0.1:5679',
    storageLocalPath: '/tmp/storage',
    apiSystemPrompt: 'Image 1: scene',
    frameIdentityLock: true,
    signal,
  });
  assert.equal(options.prompt, '夜雨码头');
  assert.equal(options.model, 'm1');
  assert.equal(options.size, '1440x2560');
  assert.equal(options.quality, 'high');
  assert.equal(options.drama_id, DRAMA_ID);
  assert.equal(options.character_id, 55);
  assert.equal(options.image_gen_id, IMAGE_ID);
  assert.notEqual(options.drama_id, options.image_gen_id);
  assert.equal(options.imageServiceType, 'image');
  assert.equal(options.reference_image_urls, undefined);
  assert.equal(options.files_base_url, 'http://127.0.0.1:5679');
  assert.equal(options.storage_local_path, '/tmp/storage');
  assert.equal(options.system_prompt, 'Image 1: scene');
  assert.equal(options.negative_prompt, 'blur');
  assert.equal(options.frame_identity_lock, true);
  assert.equal(options.idempotency_key, 'k1');
  assert.equal(options.signal, signal);

  const emptyRefs = processModule.assembleImageProviderCallOptions({
    row: { drama_id: DRAMA_ID },
    imageGenId: OTHER_IMAGE_ID,
    referenceImageUrls: [],
  });
  assert.deepEqual(emptyRefs.reference_image_urls, []);
  assert.equal(emptyRefs.image_gen_id, OTHER_IMAGE_ID);
  assert.notEqual(emptyRefs.drama_id, emptyRefs.image_gen_id);
});

test('失败持久化会把英文系统错误收成中文，并只改 pending/processing 记录', async () => {
  const db = createDb();
  try {
    insertGeneration(db, { id: IMAGE_ID, status: 'processing', storyboard_id: STORYBOARD_ID });
    insertGeneration(db, { id: OTHER_IMAGE_ID, status: 'completed', scene_id: null, storyboard_id: null });
    assert.notEqual(IMAGE_ID, SCENE_ID);
    assert.notEqual(IMAGE_ID, STORYBOARD_ID);
    assert.notEqual(SCENE_ID, STORYBOARD_ID);

    await processModule.persistImageFailure(db, {
      id: IMAGE_ID,
      scene_id: SCENE_ID,
      storyboard_id: STORYBOARD_ID,
    }, new Error('ENOENT: no such file or directory'));

    const failed = db.prepare('SELECT status, error_msg FROM image_generations WHERE id = ?').get(IMAGE_ID);
    assert.equal(failed.status, 'failed');
    assert.equal(failed.error_msg, '图片生成失败');
    assert.equal(db.prepare('SELECT error_msg FROM scenes WHERE id = ?').get(SCENE_ID).error_msg, '图片生成失败');
    assert.equal(db.prepare('SELECT error_msg FROM storyboards WHERE id = ?').get(STORYBOARD_ID).error_msg, '图片生成失败');

    await processModule.persistImageFailure(db, {
      id: OTHER_IMAGE_ID,
      scene_id: null,
      storyboard_id: null,
    }, '图片下载到本地失败');
    const completed = db.prepare('SELECT status, error_msg FROM image_generations WHERE id = ?').get(OTHER_IMAGE_ID);
    assert.equal(completed.status, 'completed');
    assert.equal(completed.error_msg, null);
  } finally {
    db.close();
  }
});

test('失败持久化带任务编号时会把任务一并标失败，并保留可信中文', async () => {
  const db = createDb();
  try {
    const created = imageService.create(db, log, {
      drama_id: DRAMA_ID,
      scene_id: SCENE_ID,
      prompt: '夜雨',
      __defer_processing: true,
    });
    assert.ok(created.task_id);
    assert.notEqual(created.id, SCENE_ID);
    db.prepare("UPDATE image_generations SET status = 'processing' WHERE id = ?").run(created.id);
    await processModule.persistImageFailure(db, {
      id: created.id,
      task_id: created.task_id,
      scene_id: SCENE_ID,
      storyboard_id: null,
    }, '未配置图片模型');
    const generation = db.prepare('SELECT status, error_msg FROM image_generations WHERE id = ?').get(created.id);
    assert.equal(generation.status, 'failed');
    assert.equal(generation.error_msg, '未配置图片模型');
    const task = taskService.getTask(db, created.task_id);
    assert.equal(task.status, 'failed');
    assert.equal(task.error, '未配置图片模型');
  } finally {
    db.close();
  }
});

test('记录不存在或非 pending 时生成执行直接跳过', async () => {
  const db = createDb();
  const errors = [];
  const infos = [];
  const probeLog = {
    info(message) { infos.push(message); },
    warn() {},
    error(message) { errors.push(message); },
  };
  try {
    insertGeneration(db, { id: IMAGE_ID, status: 'completed' });
    await processModule.processImageGeneration(db, probeLog, 99999);
    await processModule.processImageGeneration(db, probeLog, IMAGE_ID);
    assert.ok(errors.some((message) => String(message).includes('记录不存在')));
    assert.ok(infos.some((message) => String(message).includes('已被处理，跳过')));
    assert.equal(db.prepare('SELECT status FROM image_generations WHERE id = ?').get(IMAGE_ID).status, 'completed');
  } finally {
    db.close();
  }
});

test('未配置图片模型时生成执行会走失败持久化', async () => {
  const db = createDb();
  const restore = installImageStubs(os.tmpdir(), { getDefaultImageConfig: () => null });
  try {
    const created = imageService.create(db, log, {
      drama_id: DRAMA_ID,
      scene_id: SCENE_ID,
      prompt: '夜雨',
      __defer_processing: true,
    });
    await processModule.processImageGeneration(db, log, created.id);
    const generation = db.prepare('SELECT status, error_msg FROM image_generations WHERE id = ?').get(created.id);
    assert.equal(generation.status, 'failed');
    assert.equal(generation.error_msg, '未配置图片模型');
    assert.equal(taskService.getTask(db, created.task_id).status, 'failed');
  } finally {
    restore();
    db.close();
  }
});

test('供应商返回错误时生成执行会把英文错误收成中文', async () => {
  const db = createDb();
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-image-process-api-'));
  const restore = installImageStubs(storageRoot, {
    callImageApi: async () => ({ error: 'ENOENT: no such file or directory' }),
  });
  try {
    const created = imageService.create(db, log, {
      drama_id: DRAMA_ID,
      scene_id: SCENE_ID,
      prompt: '夜雨',
      __defer_processing: true,
    });
    await processModule.processImageGeneration(db, log, created.id);
    const generation = db.prepare('SELECT status, error_msg, local_path FROM image_generations WHERE id = ?').get(created.id);
    assert.equal(generation.status, 'failed');
    assert.equal(generation.error_msg, '图片生成失败');
    assert.equal(generation.local_path, null);
    assert.equal(taskService.getTask(db, created.task_id).status, 'failed');
  } finally {
    restore();
    db.close();
    fs.rmSync(storageRoot, { recursive: true, force: true });
  }
});

test('生成执行成功后会提交本地路径并绑定场景主图', async () => {
  const db = createDb();
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-image-process-ok-'));
  const restore = installImageStubs(storageRoot);
  try {
    const created = imageService.create(db, log, {
      drama_id: DRAMA_ID,
      scene_id: SCENE_ID,
      prompt: '夜雨',
      __defer_processing: true,
    });
    assert.notEqual(created.id, SCENE_ID);
    await processModule.processImageGeneration(db, log, created.id);
    const generation = db.prepare('SELECT status, local_path, image_url FROM image_generations WHERE id = ?').get(created.id);
    assert.equal(generation.status, 'completed');
    assert.equal(generation.local_path, 'projects/process/scenes/generated.png');
    assert.equal(generation.image_url, '/static/projects/process/scenes/generated.png');
    const scene = db.prepare('SELECT image_url, local_path, status FROM scenes WHERE id = ?').get(SCENE_ID);
    assert.equal(scene.image_url, '/static/projects/process/scenes/generated.png');
    assert.equal(scene.local_path, 'projects/process/scenes/generated.png');
    assert.equal(scene.status, 'generated');
    assert.equal(taskService.getTask(db, created.task_id).status, 'completed');
  } finally {
    restore();
    db.close();
    fs.rmSync(storageRoot, { recursive: true, force: true });
  }
});

test('执行模块源码不出现已禁止的幂等键/失败英文漏出形态', () => {
  const processSource = fs.readFileSync(path.join(__dirname, '../src/services/imageServiceProcess.js'), 'utf8');
  const imageSource = fs.readFileSync(path.join(__dirname, '../src/services/imageService.js'), 'utf8');
  for (const phrase of [
    'idempotency_key belongs to another drama or storyboard',
    'idempotency_key 属于其他 drama 或 storyboard',
    'Image generation did not complete',
    'persistImageFailure(db, row, err.message)',
    '图片持久化失败: ${saveErr.message}',
  ]) {
    assert.equal(processSource.includes(phrase), false, `imageServiceProcess 仍包含：${phrase}`);
    assert.equal(imageSource.includes(phrase), false, `imageService 仍包含：${phrase}`);
  }
  assert.match(imageSource, /该幂等键属于其他项目或分镜/);
  assert.match(processSource, /persistImageFailure\(db, row, err\)/);
  assert.match(processSource, /toUserFacingProcessError\(saveErr/);
  assert.match(processSource, /toUserFacingProcessError\(message, '图片生成失败'\)/);
});
