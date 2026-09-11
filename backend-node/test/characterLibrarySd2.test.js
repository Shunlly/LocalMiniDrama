const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');

const characterLibraryService = require('../src/services/characterLibraryService');
const sd2 = require('../src/services/characterLibrarySd2');
const jimengMaterialHubService = require('../src/services/jimengMaterialHubService');
const modelArkAssetConfigService = require('../src/services/modelArkAssetConfigService');
const imageClient = require('../src/services/imageClient');
const uploadService = require('../src/services/uploadService');

const DRAMA_ACTIVE = 11;
const DRAMA_OTHER = 22;
const CHARACTER_ACTIVE = 1101;
const CHARACTER_OTHER = 2202;
const CHARACTER_NO_IMAGE = 3303;
const CHARACTER_LOCAL = 4404;
const LIBRARY_DRAMA = 6606;
const HUB_ASSET_ID = 'asset-hub-7707';
const ARK_ASSET_ID = 'asset-ark-8808';
const CONFIG_ID = 91;

const log = { info() {}, warn() {}, error() {} };

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE dramas (
      id INTEGER PRIMARY KEY,
      title TEXT,
      deleted_at TEXT
    );
    CREATE TABLE characters (
      id INTEGER PRIMARY KEY,
      drama_id INTEGER NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      appearance TEXT,
      description TEXT,
      image_url TEXT,
      local_path TEXT,
      seedance2_asset TEXT,
      updated_at TEXT,
      deleted_at TEXT
    );
    INSERT INTO dramas (id, title, deleted_at) VALUES
      (${DRAMA_ACTIVE}, '可读项目', NULL),
      (${DRAMA_OTHER}, '另一个项目', NULL);
    INSERT INTO characters (id, drama_id, name, appearance, description, image_url, local_path, deleted_at) VALUES
      (${CHARACTER_ACTIVE}, ${DRAMA_ACTIVE}, '英雄', '黑发长衫', '主角', 'https://cdn.example/hero.png', 'projects/hero.png', NULL),
      (${CHARACTER_OTHER}, ${DRAMA_OTHER}, '配角', '白衣', '配角', 'https://cdn.example/side.png', 'projects/side.png', NULL),
      (${CHARACTER_NO_IMAGE}, ${DRAMA_ACTIVE}, '无图', '草稿', '草稿', NULL, NULL, NULL),
      (${CHARACTER_LOCAL}, ${DRAMA_ACTIVE}, '本机', '短发', '本机角色', 'http://127.0.0.1:5679/static/projects/local.png', 'projects/local.png', NULL);
  `);
  return db;
}

function mockHubReady(t, extras = {}) {
  t.mock.method(jimengMaterialHubService, 'buildHubContext', () => ({
    token: 'tok',
    baseUrl: 'https://hub.example',
    hubAuthDiag: { db_config_id: CONFIG_ID, db_config_name: '即梦默认' },
    ...extras,
  }));
}

function mockHubMissing(t) {
  t.mock.method(jimengMaterialHubService, 'buildHubContext', () => ({
    token: '',
    baseUrl: '',
    hubAuthDiag: { db_config_id: null },
  }));
}

function mockArkReady(t) {
  t.mock.method(modelArkAssetConfigService, 'buildModelArkContext', () => ({
    ready: true,
    assetGroupId: 'group-99',
    diag: { auth_mode: 'aksk', db_model_ark_row_found: true },
  }));
}

function mockArkMissing(t, extraDiag = {}) {
  t.mock.method(modelArkAssetConfigService, 'buildModelArkContext', () => ({
    ready: false,
    diag: { db_model_ark_row_found: false, missing: 'access_key', ...extraDiag },
  }));
}

test('跨模块 ID 在 SD2 用例里互不相等，避免碰巧同值假通过', () => {
  const ids = [
    DRAMA_ACTIVE, DRAMA_OTHER,
    CHARACTER_ACTIVE, CHARACTER_OTHER, CHARACTER_NO_IMAGE, CHARACTER_LOCAL,
    LIBRARY_DRAMA, CONFIG_ID,
  ];
  assert.equal(new Set(ids).size, ids.length);
  assert.notEqual(HUB_ASSET_ID, ARK_ASSET_ID);
  assert.notEqual(HUB_ASSET_ID, String(CHARACTER_ACTIVE));
  assert.notEqual(HUB_ASSET_ID, String(DRAMA_ACTIVE));
});

test('characterLibraryService 公开 SD2 API 仍指向 Sd2 模块的同一函数', () => {
  assert.equal(characterLibraryService.registerCharacterJimengMaterialAsset, sd2.registerCharacterJimengMaterialAsset);
  assert.equal(characterLibraryService.refreshCharacterJimengMaterialAsset, sd2.refreshCharacterJimengMaterialAsset);
});

test('characterLibraryService 不把 SD2 内部辅助函数暴露为公开 API', () => {
  assert.equal(typeof characterLibraryService.buildCharacterPublicImageUrlForHub, 'undefined');
  assert.equal(typeof characterLibraryService.isNonPublicMaterialHubUrl, 'undefined');
  assert.equal(typeof characterLibraryService.resolveSd2RegisterProvider, 'undefined');
  assert.equal(typeof characterLibraryService.formatSd2HubError, 'undefined');
  assert.equal(typeof characterLibraryService.prepareCharacterRegisterImage, 'undefined');
});

test('服务文件已抽出 SD2 / 即梦素材中心注册函数，CRUD 仍留在原文件', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/services/characterLibraryService.js'), 'utf8');
  for (const name of [
    'function buildCharacterPublicImageUrlForHub',
    'function isNonPublicMaterialHubUrl',
    'function resolveSd2RegisterProvider',
    'async function registerCharacterViaJimengHub',
    'async function registerCharacterJimengMaterialAsset',
    'async function refreshCharacterJimengMaterialAsset',
  ]) {
    assert.equal(src.includes(name), false, name);
  }
  assert.match(src, /require\('\.\/characterLibrarySd2'\)/);
  assert.match(src, /function createLibraryItem/);
  assert.match(src, /require\('\.\/characterLibraryGeneration'\)/);
  assert.match(src, /function updateCharacter/);
  assert.equal(src.includes('function batchGenerateCharacterImages'), false);
  assert.equal(src.includes('function generateCharacterImage'), false);
  assert.equal(src.includes('function listLibraryItems'), false);
  assert.equal(src.includes('function upsertCharacterLibraryItem'), false);
});

test('公网图链优先用角色主图直链，不会把 drama_id 拼进 URL', () => {
  const charRow = {
    id: CHARACTER_ACTIVE,
    drama_id: DRAMA_ACTIVE,
    image_url: 'https://cdn.example/hero.png',
    local_path: 'projects/hero.png',
  };
  const direct = sd2.buildCharacterPublicImageUrlForHub(charRow, { storage: { base_url: 'https://static.example/static' } });
  assert.equal(direct.ok, true);
  assert.equal(direct.url, 'https://cdn.example/hero.png');
  assert.equal(direct.url.includes(String(DRAMA_ACTIVE)), false);

  const fromLocal = sd2.buildCharacterPublicImageUrlForHub({
    ...charRow,
    image_url: '/static/projects/hero.png',
  }, { storage: { base_url: 'https://static.example' } });
  assert.equal(fromLocal.ok, true);
  assert.equal(fromLocal.url, 'https://static.example/projects/hero.png');

  const fromStaticBase = sd2.buildCharacterPublicImageUrlForHub({
    id: CHARACTER_ACTIVE,
    drama_id: DRAMA_ACTIVE,
    image_url: '/static/projects/hero.png',
    local_path: '',
  }, { storage: { base_url: 'https://static.example/static' } });
  assert.equal(fromStaticBase.ok, true);
  assert.equal(fromStaticBase.url, 'https://static.example/static/projects/hero.png');

  const missingBase = sd2.buildCharacterPublicImageUrlForHub({
    id: CHARACTER_ACTIVE,
    image_url: '/static/projects/hero.png',
    local_path: '',
  }, {});
  assert.equal(missingBase.ok, false);
  assert.match(missingBase.error, /不是公网图片地址/);
  assert.match(missingBase.error, /即梦/);

  const missingImage = sd2.buildCharacterPublicImageUrlForHub({
    id: CHARACTER_ACTIVE,
    image_url: '',
    local_path: '',
  }, { storage: { base_url: 'https://static.example' } });
  assert.equal(missingImage.ok, false);
  assert.equal(missingImage.error, '角色缺少素材库可用的图片（需公网图链或已上传的本地图片）');
});

test('素材库无法拉取的 URL 覆盖本机、内网和 data URL', () => {
  assert.equal(sd2.isNonPublicMaterialHubUrl(''), true);
  assert.equal(sd2.isNonPublicMaterialHubUrl('data:image/png;base64,abc'), true);
  assert.equal(sd2.isNonPublicMaterialHubUrl('/static/projects/hero.png'), true);
  assert.equal(sd2.isNonPublicMaterialHubUrl('http://localhost:5679/static/a.png'), true);
  assert.equal(sd2.isNonPublicMaterialHubUrl('http://127.0.0.1/a.png'), true);
  assert.equal(sd2.isNonPublicMaterialHubUrl('http://192.168.1.8/a.png'), true);
  assert.equal(sd2.isNonPublicMaterialHubUrl('http://10.0.0.8/a.png'), true);
  assert.equal(sd2.isNonPublicMaterialHubUrl('http://172.16.0.8/a.png'), true);
  assert.equal(sd2.isNonPublicMaterialHubUrl('http://172.31.0.8/a.png'), true);
  assert.equal(sd2.isNonPublicMaterialHubUrl('http://172.32.0.8/a.png'), false);
  assert.equal(sd2.isNonPublicMaterialHubUrl('https://cdn.example/hero.png'), false);
});

test('图床缓存 key 认 local_path，不会用 drama_id 或 character_id 顶替', () => {
  const withPath = sd2.materialHubProxyCacheKey({
    id: CHARACTER_ACTIVE,
    drama_id: DRAMA_ACTIVE,
    local_path: '/projects/hero.png',
  }, 'https://cdn.example/hero.png');
  assert.equal(withPath, 'projects/hero.png');
  assert.notEqual(withPath, String(DRAMA_ACTIVE));
  assert.notEqual(withPath, String(CHARACTER_ACTIVE));

  const hashed = sd2.materialHubProxyCacheKey({
    id: CHARACTER_ACTIVE,
    drama_id: DRAMA_ACTIVE,
    local_path: '',
  }, 'https://cdn.example/hero.png');
  assert.match(hashed, /^sd2char:url:[0-9a-f]{48}$/);
  const other = sd2.materialHubProxyCacheKey({
    id: CHARACTER_OTHER,
    drama_id: DRAMA_OTHER,
    local_path: '',
  }, 'https://cdn.example/side.png');
  assert.notEqual(hashed, other);
});

test('密钥错误保持中文指引，并带上配置编号而不是角色 ID', () => {
  const raw = sd2.formatSd2HubError('DownloadFailed', {});
  assert.equal(raw, 'DownloadFailed');
  const formatted = sd2.formatSd2HubError('invalid token', {
    hubAuthDiag: { db_config_id: CONFIG_ID, db_config_name: '即梦默认' },
  });
  assert.match(formatted, /即梦2素材库拒绝了当前密钥/);
  assert.match(formatted, /当前读取的配置编号：91「即梦默认」/);
  assert.equal(formatted.includes(String(CHARACTER_ACTIVE)), false);
  assert.equal(sd2.isHubDownloadMediaError('tos: request error'), true);
  assert.equal(sd2.isHubAuthTokenError('无效的 token'), true);
});

test('未配置 SD2 时错误保持中文，并区分 hub 与 ModelArk', () => {
  const msg = sd2.sd2ConfigMissingError(
    { token: '' },
    { diag: { missing: 'access_key', db_model_ark_row_found: false } }
  );
  assert.match(msg, /未配置 SD2 认证/);
  assert.match(msg, /即梦2角色认证/);
  assert.match(msg, /SD2 资产管理/);
  assert.match(msg, /缺少 access_key/);
  assert.match(msg, /未找到已保存的 ModelArk 资产库配置/);
});

test('注册通道优先即梦 hub，没有密钥才走 ModelArk', (t) => {
  mockHubReady(t);
  mockArkReady(t);
  const hub = sd2.resolveSd2RegisterProvider({}, {}, log);
  assert.equal(hub.provider, 'hub');

  mockHubMissing(t);
  mockArkReady(t);
  const ark = sd2.resolveSd2RegisterProvider({}, {}, log);
  assert.equal(ark.provider, 'model_ark');

  mockHubMissing(t);
  mockArkMissing(t);
  const none = sd2.resolveSd2RegisterProvider({}, {}, log);
  assert.equal(none.provider, null);
});

test('准备注册图时按角色 ID 读取，项目 ID 或库项 ID 不能顶替', async () => {
  const db = createDb();
  try {
    const missing = await sd2.prepareCharacterRegisterImage(db, log, {}, DRAMA_ACTIVE);
    assert.deepEqual(missing, { ok: false, error: '角色不存在' });
    assert.deepEqual(await sd2.prepareCharacterRegisterImage(db, log, {}, LIBRARY_DRAMA), {
      ok: false,
      error: '角色不存在',
    });
    assert.deepEqual(await sd2.prepareCharacterRegisterImage(db, log, {}, CHARACTER_NO_IMAGE), {
      ok: false,
      error: '角色还没有形象图片',
    });
    const prep = await sd2.prepareCharacterRegisterImage(db, log, {}, CHARACTER_ACTIVE);
    assert.equal(prep.ok, true);
    assert.equal(prep.charRow.id, CHARACTER_ACTIVE);
    assert.equal(prep.charRow.drama_id, DRAMA_ACTIVE);
    assert.notEqual(prep.charRow.id, prep.charRow.drama_id);
    assert.equal(prep.registerImageUrl, 'https://cdn.example/hero.png');
    assert.equal(prep.pub.via, 'direct');
    assert.equal(prep.assetName, '英雄');
  } finally {
    db.close();
  }
});

test('登记 payload 写入素材 ID，不把角色 ID 或项目 ID 当成 hub_asset_id', () => {
  const payload = sd2.buildSeedance2BasePayload(
    {
      id: CHARACTER_ACTIVE,
      drama_id: DRAMA_ACTIVE,
      name: '英雄',
      appearance: '黑发长衫',
      description: '主角',
      image_url: 'https://cdn.example/hero.png',
      local_path: 'projects/hero.png',
    },
    HUB_ASSET_ID,
    { id: HUB_ASSET_ID, status: 'processing', asset_url: `asset://${HUB_ASSET_ID}` },
    'https://cdn.example/hero.png',
    'hub'
  );
  assert.equal(payload.hub_asset_id, HUB_ASSET_ID);
  assert.notEqual(payload.hub_asset_id, CHARACTER_ACTIVE);
  assert.notEqual(payload.hub_asset_id, DRAMA_ACTIVE);
  assert.equal(payload.sd2_provider, 'hub');
  assert.equal(payload.certified_image_url, 'https://cdn.example/hero.png');
  assert.equal(payload.certified_local_path, 'projects/hero.png');
  assert.equal(payload.character_display.name, '英雄');
});

test('未配置时注册直接返回中文错误，不读取角色行', async (t) => {
  mockHubMissing(t);
  mockArkMissing(t);
  const db = createDb();
  try {
    const out = await characterLibraryService.registerCharacterJimengMaterialAsset(db, log, {}, CHARACTER_ACTIVE);
    assert.equal(out.ok, false);
    assert.match(out.error, /未配置 SD2 认证/);
  } finally {
    db.close();
  }
});

test('hub 注册按 character_id 落库，不会写到 drama_id 对应行', async (t) => {
  mockHubReady(t);
  mockArkMissing(t);
  t.mock.method(jimengMaterialHubService, 'createImageAsset', async (_ctx, params) => {
    assert.equal(params.url, 'https://cdn.example/hero.png');
    assert.equal(params.name, '英雄');
    return {
      ok: true,
      data: { id: HUB_ASSET_ID, status: 'processing', asset_url: `asset://${HUB_ASSET_ID}`, url: 'https://hub.example/a' },
    };
  });
  t.mock.method(jimengMaterialHubService, 'pollAssetUntilSettled', async (_ctx, assetId) => {
    assert.equal(assetId, HUB_ASSET_ID);
    return {
      ok: true,
      timedOut: false,
      asset: { id: HUB_ASSET_ID, status: 'active', asset_url: `asset://${HUB_ASSET_ID}`, url: 'https://hub.example/a' },
    };
  });

  const db = createDb();
  try {
    const wrongId = await characterLibraryService.registerCharacterJimengMaterialAsset(db, log, {}, DRAMA_ACTIVE);
    assert.deepEqual(wrongId, { ok: false, error: '角色不存在' });
    const out = await characterLibraryService.registerCharacterJimengMaterialAsset(db, log, {}, CHARACTER_ACTIVE);
    assert.equal(out.ok, true);
    assert.equal(out.seedance2_asset.hub_asset_id, HUB_ASSET_ID);
    assert.equal(out.seedance2_asset.sd2_provider, 'hub');
    assert.equal(out.seedance2_asset.status, 'active');
    const saved = db.prepare('SELECT seedance2_asset FROM characters WHERE id = ?').get(CHARACTER_ACTIVE);
    const parsed = JSON.parse(saved.seedance2_asset);
    assert.equal(parsed.hub_asset_id, HUB_ASSET_ID);
    const other = db.prepare('SELECT seedance2_asset FROM characters WHERE id = ?').get(CHARACTER_OTHER);
    assert.equal(other.seedance2_asset, null);
    assert.equal(db.prepare('SELECT seedance2_asset FROM characters WHERE id = ?').get(DRAMA_ACTIVE), undefined);
  } finally {
    db.close();
  }
});

test('没有即梦密钥时走 ModelArk，资产 ID 仍写回角色而不是项目', async (t) => {
  mockHubMissing(t);
  mockArkReady(t);
  t.mock.method(modelArkAssetConfigService, 'createImageAsset', async () => ({
    ok: true,
    data: { id: ARK_ASSET_ID, status: 'processing', asset_url: `asset://${ARK_ASSET_ID}` },
  }));
  t.mock.method(modelArkAssetConfigService, 'pollAssetUntilSettled', async () => ({
    ok: true,
    timedOut: true,
    asset: { id: ARK_ASSET_ID, status: 'active', asset_url: `asset://${ARK_ASSET_ID}` },
  }));

  const db = createDb();
  try {
    const out = await characterLibraryService.registerCharacterJimengMaterialAsset(db, log, {}, CHARACTER_ACTIVE);
    assert.equal(out.ok, true);
    assert.equal(out.seedance2_asset.hub_asset_id, ARK_ASSET_ID);
    assert.equal(out.seedance2_asset.sd2_provider, 'model_ark');
    assert.equal(out.seedance2_asset.poll_timed_out, true);
    const saved = JSON.parse(db.prepare('SELECT seedance2_asset FROM characters WHERE id = ?').get(CHARACTER_ACTIVE).seedance2_asset);
    assert.equal(saved.hub_asset_id, ARK_ASSET_ID);
    assert.notEqual(saved.hub_asset_id, DRAMA_ACTIVE);
  } finally {
    db.close();
  }
});

test('hub 拉取失败且存在本地文件时会改走图床重试', async (t) => {
  mockHubReady(t);
  mockArkMissing(t);
  const urls = [];
  t.mock.method(jimengMaterialHubService, 'createImageAsset', async (_ctx, params) => {
    urls.push(params.url);
    if (urls.length === 1) return { ok: false, error: 'DownloadFailed: tos: request error' };
    return {
      ok: true,
      data: { id: HUB_ASSET_ID, status: 'processing', asset_url: `asset://${HUB_ASSET_ID}`, url: 'https://hub.example/a' },
    };
  });
  t.mock.method(jimengMaterialHubService, 'pollAssetUntilSettled', async () => ({
    ok: true,
    timedOut: false,
    asset: { id: HUB_ASSET_ID, status: 'active', asset_url: `asset://${HUB_ASSET_ID}`, url: 'https://hub.example/a' },
  }));
  t.mock.method(imageClient, 'getProxyCacheValidated', async () => null);
  t.mock.method(imageClient, 'setProxyCache', () => {});
  t.mock.method(uploadService, 'uploadLocalImageToProxy', async () => 'https://imgbed.example/hero.png');

  const db = createDb();
  try {
    const out = await characterLibraryService.registerCharacterJimengMaterialAsset(db, log, {}, CHARACTER_ACTIVE);
    assert.equal(out.ok, true);
    assert.deepEqual(urls, ['https://cdn.example/hero.png', 'https://imgbed.example/hero.png']);
    assert.equal(out.seedance2_asset.source_image_url, 'https://imgbed.example/hero.png');
  } finally {
    db.close();
  }
});

test('刷新认证按角色已保存的素材 ID 查询，不把角色 ID 当成素材 ID', async (t) => {
  mockHubReady(t);
  t.mock.method(jimengMaterialHubService, 'getAsset', async (_ctx, assetId) => {
    assert.equal(assetId, HUB_ASSET_ID);
    assert.notEqual(assetId, CHARACTER_ACTIVE);
    assert.notEqual(assetId, DRAMA_ACTIVE);
    return { ok: true, data: { id: HUB_ASSET_ID, status: 'active', asset_url: `asset://${HUB_ASSET_ID}`, url: 'https://hub.example/b' } };
  });
  t.mock.method(modelArkAssetConfigService, 'getAsset', async () => {
    throw new Error('不应走 ModelArk');
  });

  const db = createDb();
  try {
    db.prepare('UPDATE characters SET seedance2_asset = ? WHERE id = ?').run(JSON.stringify({
      hub_asset_id: HUB_ASSET_ID,
      status: 'processing',
      sd2_provider: 'hub',
    }), CHARACTER_ACTIVE);
    assert.deepEqual(await characterLibraryService.refreshCharacterJimengMaterialAsset(db, log, {}, DRAMA_ACTIVE), {
      ok: false,
      error: '角色不存在',
    });
    assert.deepEqual(await characterLibraryService.refreshCharacterJimengMaterialAsset(db, log, {}, LIBRARY_DRAMA), {
      ok: false,
      error: '角色不存在',
    });
    assert.deepEqual(await characterLibraryService.refreshCharacterJimengMaterialAsset(db, log, {}, CHARACTER_OTHER), {
      ok: false,
      error: '暂未取得素材 ID，请先完成即梦认证',
    });
    const out = await characterLibraryService.refreshCharacterJimengMaterialAsset(db, log, {}, CHARACTER_ACTIVE);
    assert.equal(out.ok, true);
    assert.equal(out.seedance2_asset.hub_asset_id, HUB_ASSET_ID);
    assert.equal(out.seedance2_asset.status, 'active');
    assert.equal(out.seedance2_asset.hub_url, 'https://hub.example/b');
    assert.equal(out.seedance2_asset.sd2_provider, 'hub');
  } finally {
    db.close();
  }
});

test('ModelArk 刷新走资产库而不是即梦 hub', async (t) => {
  mockHubReady(t);
  mockArkReady(t);
  t.mock.method(jimengMaterialHubService, 'getAsset', async () => {
    throw new Error('不应走即梦 hub');
  });
  t.mock.method(modelArkAssetConfigService, 'getAsset', async (_ctx, assetId) => {
    assert.equal(assetId, ARK_ASSET_ID);
    return { ok: true, data: { id: ARK_ASSET_ID, status: 'active', asset_url: `asset://${ARK_ASSET_ID}` } };
  });

  const db = createDb();
  try {
    db.prepare('UPDATE characters SET seedance2_asset = ? WHERE id = ?').run(JSON.stringify({
      hub_asset_id: ARK_ASSET_ID,
      status: 'processing',
      sd2_provider: 'model_ark',
    }), CHARACTER_ACTIVE);
    const out = await characterLibraryService.refreshCharacterJimengMaterialAsset(db, log, {}, CHARACTER_ACTIVE);
    assert.equal(out.ok, true);
    assert.equal(out.seedance2_asset.sd2_provider, 'model_ark');
    assert.equal(out.seedance2_asset.hub_asset_id, ARK_ASSET_ID);
    assert.equal(out.seedance2_asset.status, 'active');
  } finally {
    db.close();
  }
});

test('本机 URL 会先走图床；图床失败时保持中文错误', async (t) => {
  t.mock.method(imageClient, 'getProxyCacheValidated', async () => null);
  t.mock.method(uploadService, 'uploadLocalImageToProxy', async () => null);
  const db = createDb();
  try {
    const out = await sd2.prepareCharacterRegisterImage(db, log, {
      storage: { local_path: './data/storage' },
    }, CHARACTER_LOCAL);
    assert.equal(out.ok, false);
    assert.match(out.error, /上传到中转图床失败/);
  } finally {
    db.close();
  }
});
