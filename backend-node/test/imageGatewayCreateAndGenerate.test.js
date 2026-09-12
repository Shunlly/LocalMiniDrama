'use strict';

const { describe, it, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const configModule = require('../src/config');
const { runMigrationsAndEnsure } = require('../src/db/migrate');
const imageClient = require('../src/services/imageClient');
const gateway = require('../src/services/imageGateway/createAndGenerateImage');
const taskService = require('../src/services/taskService');

const log = { info() {}, warn() {}, error() {}, errorw() {} };

const PUBLIC_API = [
  'getDefaultImageConfig',
  'callImageApi',
  'createAndGenerateImage',
  'downloadImageToLocalAbortable',
  'removeDownloadedImage',
  'resolveAssetUserNegativeForApi',
  'getStoryboardReferenceLimits',
  'canAddStoryboardCharacterRef',
  'canAddStoryboardObjectRef',
  'refListHasCanonical',
  'fixAgnesImageSize',
  'isAgnesImageConfig',
  'getProxyCache',
  'getProxyCacheValidated',
  'deleteProxyCache',
  'isProxyUrlAlive',
  'setProxyCache',
];

async function waitFor(read, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = read();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('等待图片生成状态超时');
}

function createBaseFixture(title) {
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
  return { db, dramaId, episodeId, now };
}

function createSceneFixture(title) {
  const fixture = createBaseFixture(title);
  const oldUrl = '/static/projects/gateway/scenes/original.png';
  const oldPath = 'projects/gateway/scenes/original.png';
  const oldExtras = JSON.stringify(['projects/gateway/scenes/history.png']);
  const sceneId = Number(fixture.db.prepare(
    `INSERT INTO scenes
       (drama_id, episode_id, location, time, prompt, image_url, local_path, extra_images, status, created_at, updated_at)
     VALUES (?, ?, '巷口', '雨夜', '原场景', ?, ?, ?, 'generated', ?, ?)`
  ).run(fixture.dramaId, fixture.episodeId, oldUrl, oldPath, oldExtras, fixture.now, fixture.now).lastInsertRowid);
  return { ...fixture, sceneId, oldUrl, oldPath, oldExtras };
}

function createCharacterFixture(title) {
  const fixture = createBaseFixture(title);
  const oldUrl = '/static/projects/gateway/characters/original.png';
  const oldPath = 'projects/gateway/characters/original.png';
  const oldExtras = JSON.stringify(['projects/gateway/characters/history.png']);
  const characterId = Number(fixture.db.prepare(
    `INSERT INTO characters
       (drama_id, name, image_url, local_path, extra_images, created_at, updated_at)
     VALUES (?, '林夏', ?, ?, ?, ?, ?)`
  ).run(fixture.dramaId, oldUrl, oldPath, oldExtras, fixture.now, fixture.now).lastInsertRowid);
  return { ...fixture, characterId, oldUrl, oldPath, oldExtras };
}

function installConfigStub(t) {
  const originalLoadConfig = configModule.loadConfig;
  configModule.loadConfig = () => ({ storage: { local_path: path.join(process.cwd(), 'data', 'storage') } });
  t.after(() => { configModule.loadConfig = originalLoadConfig; });
}

describe('imageGateway createAndGenerateImage 拆分接线', () => {
  it('公开导出仍走 imageClient，API 列表不变', () => {
    assert.deepEqual(Object.keys(imageClient).sort(), [...PUBLIC_API].sort());
    assert.equal(typeof imageClient.createAndGenerateImage, 'function');
    assert.equal(typeof gateway.createAndGenerateImage, 'function');
    assert.notEqual(imageClient.createAndGenerateImage, gateway.createAndGenerateImage);
  });

  it('imageClient 包装函数把 module.exports 注入 gateway 编排', () => {
    const clientSrc = fs.readFileSync(path.join(__dirname, '../src/services/imageClient.js'), 'utf8');
    const gatewaySrc = fs.readFileSync(
      path.join(__dirname, '../src/services/imageGateway/createAndGenerateImage.js'),
      'utf8'
    );
    assert.match(clientSrc, /createAndGenerateImageWithApi\(db, log, opts, module\.exports\)/);
    assert.equal(clientSrc.includes('INSERT INTO image_generations'), false);
    assert.equal(gatewaySrc.includes('INSERT INTO image_generations'), true);
    assert.match(gatewaySrc, /api\.callImageApi/);
    assert.match(gatewaySrc, /api\.downloadImageToLocalAbortable/);
  });
});


test('gateway 只使用注入的 api，不会落到 imageClient 原函数', async (t) => {
  const fixture = createSceneFixture('注入 api');
  installConfigStub(t);
  t.after(() => fixture.db.close());
  let imageClientApiCalled = false;
  t.mock.method(imageClient, 'callImageApi', async () => {
    imageClientApiCalled = true;
    throw new Error('不应走到 imageClient 默认导出');
  });
  t.mock.method(imageClient, 'downloadImageToLocalAbortable', async () => {
    imageClientApiCalled = true;
    throw new Error('不应走到 imageClient 默认导出');
  });
  const created = gateway.createAndGenerateImage(fixture.db, log, {
    drama_id: fixture.dramaId,
    scene_id: fixture.sceneId,
    image_type: 'scene',
    prompt: '注入场景',
    provider: 'test-provider',
  }, {
    callImageApi: async () => ({ image_url: 'https://provider.example.test/injected.png' }),
    downloadImageToLocalAbortable: async () => 'projects/gateway/scenes/injected.png',
  });

  const generation = await waitFor(() => {
    const row = fixture.db.prepare(
      'SELECT status, image_url, local_path FROM image_generations WHERE id = ?'
    ).get(created.id);
    return row?.status === 'completed' ? row : null;
  });
  assert.equal(imageClientApiCalled, false);
  assert.equal(generation.image_url, 'https://provider.example.test/injected.png');
  assert.equal(generation.local_path, 'projects/gateway/scenes/injected.png');
});
test('创建后立即返回 pending，并写入 task / image_generations', async (t) => {
  const fixture = createSceneFixture('立即返回 pending');
  installConfigStub(t);
  let resolveHang;
  const hang = new Promise((resolve) => { resolveHang = resolve; });
  t.after(() => {
    resolveHang();
    fixture.db.close();
  });
  t.mock.method(imageClient, 'callImageApi', async () => {
    await hang;
    return { image_url: 'https://provider.example.test/pending.png' };
  });
  t.mock.method(imageClient, 'downloadImageToLocalAbortable', async () => {
    throw new Error('pending 阶段不应下载');
  });

  const created = imageClient.createAndGenerateImage(fixture.db, log, {
    drama_id: fixture.dramaId,
    scene_id: fixture.sceneId,
    image_type: 'scene',
    prompt: '雨夜巷口',
    model: 'test-image',
    provider: 'test-provider',
    size: '1024x1024',
    user_negative_prompt: 'blurry',
  });

  assert.equal(created.status, 'pending');
  assert.ok(created.task_id);
  assert.equal(created.drama_id, fixture.dramaId);
  assert.equal(created.prompt, '雨夜巷口');
  const row = fixture.db.prepare(
    'SELECT status, task_id, negative_prompt, scene_id, provider FROM image_generations WHERE id = ?'
  ).get(created.id);
  assert.equal(row.status, 'pending');
  assert.equal(row.task_id, created.task_id);
  assert.equal(row.negative_prompt, 'blurry');
  assert.equal(row.scene_id, fixture.sceneId);
  assert.equal(row.provider, 'test-provider');
  assert.equal(taskService.getTask(fixture.db, created.task_id).status, 'pending');
  assert.equal(taskService.getTask(fixture.db, created.task_id).resource_id, `scene_${fixture.sceneId}`);
});

test('场景图完成后回写主图、历史图、生成记录和任务', async (t) => {
  const fixture = createSceneFixture('场景成功回写');
  installConfigStub(t);
  t.after(() => fixture.db.close());
  let apiOpts;
  let downloadCategory;
  t.mock.method(imageClient, 'callImageApi', async (_db, _log, options) => {
    apiOpts = options;
    assert.ok(options.signal instanceof AbortSignal);
    return { image_url: 'https://provider.example.test/scene.png' };
  });
  t.mock.method(imageClient, 'downloadImageToLocalAbortable', async (_root, _url, category) => {
    downloadCategory = category;
    return 'projects/gateway/scenes/new.png';
  });

  const created = imageClient.createAndGenerateImage(fixture.db, log, {
    drama_id: fixture.dramaId,
    scene_id: fixture.sceneId,
    image_type: 'scene',
    prompt: '新场景',
    model: 'test-image',
    provider: 'test-provider',
    size: '1024x1024',
  });

  const generation = await waitFor(() => {
    const row = fixture.db.prepare(
      'SELECT status, image_url, local_path FROM image_generations WHERE id = ?'
    ).get(created.id);
    return row?.status === 'completed' ? row : null;
  });

  assert.equal(apiOpts.image_gen_id, created.id);
  assert.equal(apiOpts.preferred_provider, 'test-provider');
  assert.equal(apiOpts.image_type, 'scene');
  assert.equal(downloadCategory, 'scenes');
  assert.equal(generation.image_url, 'https://provider.example.test/scene.png');
  assert.equal(generation.local_path, 'projects/gateway/scenes/new.png');
  assert.equal(taskService.getTask(fixture.db, created.task_id).status, 'completed');
  const scene = fixture.db.prepare(
    'SELECT image_url, local_path, extra_images, error_msg FROM scenes WHERE id = ?'
  ).get(fixture.sceneId);
  assert.equal(scene.image_url, 'https://provider.example.test/scene.png');
  assert.equal(scene.local_path, 'projects/gateway/scenes/new.png');
  assert.equal(scene.error_msg, null);
  assert.deepEqual(JSON.parse(scene.extra_images), [
    'projects/gateway/scenes/history.png',
    fixture.oldPath,
  ]);
});

test('角色图完成后回写主图并把旧路径并入 extra_images', async (t) => {
  const fixture = createCharacterFixture('角色成功回写');
  installConfigStub(t);
  t.after(() => fixture.db.close());
  t.mock.method(imageClient, 'callImageApi', async () => ({
    image_url: 'https://provider.example.test/character.png',
  }));
  t.mock.method(imageClient, 'downloadImageToLocalAbortable', async (_root, _url, category) => {
    assert.equal(category, 'characters');
    return 'projects/gateway/characters/new.png';
  });

  const created = imageClient.createAndGenerateImage(fixture.db, log, {
    drama_id: fixture.dramaId,
    character_id: fixture.characterId,
    image_type: 'character',
    prompt: '角色立绘',
    model: 'test-image',
    provider: 'test-provider',
  });
  assert.equal(taskService.getTask(fixture.db, created.task_id).resource_id, `character_${fixture.characterId}`);

  const generation = await waitFor(() => {
    const row = fixture.db.prepare('SELECT status FROM image_generations WHERE id = ?').get(created.id);
    return row?.status === 'completed' ? row : null;
  });
  assert.equal(generation.status, 'completed');

  const character = fixture.db.prepare(
    'SELECT image_url, local_path, extra_images, error_msg FROM characters WHERE id = ?'
  ).get(fixture.characterId);
  assert.equal(character.image_url, 'https://provider.example.test/character.png');
  assert.equal(character.local_path, 'projects/gateway/characters/new.png');
  assert.equal(character.error_msg, null);
  assert.deepEqual(JSON.parse(character.extra_images), [
    'projects/gateway/characters/history.png',
    fixture.oldPath,
  ]);
});

test('缺少 character_id/scene_id 列时回退插入，并按 drama 资源下载', async (t) => {
  const fixture = createBaseFixture('缺列回退插入');
  installConfigStub(t);
  t.after(() => fixture.db.close());
  const originalPrepare = fixture.db.prepare.bind(fixture.db);
  fixture.db.prepare = (sql) => {
    if (String(sql).includes('character_id, scene_id')) {
      throw new Error('table image_generations has no column named scene_id');
    }
    return originalPrepare(sql);
  };
  t.mock.method(imageClient, 'callImageApi', async () => ({
    image_url: 'https://provider.example.test/drama.png',
  }));
  t.mock.method(imageClient, 'downloadImageToLocalAbortable', async (_root, _url, category) => {
    assert.equal(category, 'images');
    return 'projects/gateway/images/new.png';
  });

  const created = imageClient.createAndGenerateImage(fixture.db, log, {
    drama_id: fixture.dramaId,
    prompt: '项目封面',
    provider: 'test-provider',
  });
  assert.equal(created.status, 'pending');
  assert.equal(taskService.getTask(fixture.db, created.task_id).resource_id, String(fixture.dramaId));

  const generation = await waitFor(() => {
    const row = fixture.db.prepare(
      'SELECT status, image_url, local_path FROM image_generations WHERE id = ?'
    ).get(created.id);
    return row?.status === 'completed' ? row : null;
  });
  assert.equal(generation.image_url, 'https://provider.example.test/drama.png');
  assert.equal(generation.local_path, 'projects/gateway/images/new.png');
});

test('供应商返回错误时任务与生成记录失败，且不覆盖旧场景', async (t) => {
  const fixture = createSceneFixture('供应商失败');
  installConfigStub(t);
  t.after(() => fixture.db.close());
  t.mock.method(imageClient, 'callImageApi', async () => ({ error: '供应商失败' }));
  t.mock.method(imageClient, 'downloadImageToLocalAbortable', async () => {
    throw new Error('失败路径不应下载');
  });

  const created = imageClient.createAndGenerateImage(fixture.db, log, {
    drama_id: fixture.dramaId,
    scene_id: fixture.sceneId,
    image_type: 'scene',
    prompt: '失败场景',
    provider: 'test-provider',
  });

  const generation = await waitFor(() => {
    const row = fixture.db.prepare(
      'SELECT status, image_url, local_path, error_msg FROM image_generations WHERE id = ?'
    ).get(created.id);
    return row?.status === 'failed' ? row : null;
  });
  assert.equal(generation.image_url, null);
  assert.equal(generation.local_path, null);
  assert.ok(generation.error_msg);
  assert.equal(taskService.getTask(fixture.db, created.task_id).status, 'failed');
  assert.deepEqual(
    fixture.db.prepare('SELECT image_url, local_path, extra_images FROM scenes WHERE id = ?').get(fixture.sceneId),
    { image_url: fixture.oldUrl, local_path: fixture.oldPath, extra_images: fixture.oldExtras }
  );
});
