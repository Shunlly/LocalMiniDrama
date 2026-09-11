/**
 * 角色库 Seedance2 / 即梦素材中心注册：公网图链、图床中转、hub / ModelArk 登记与刷新。
 * 路由仍通过 characterLibraryService 调用，本模块不改变公开 API。
 * character_id / drama_id / library_id / hub_asset_id 语义不同，不得互换。
 */

const path = require('path');
const crypto = require('crypto');
const imageClient = require('./imageClient');
const jimengMaterialHubService = require('./jimengMaterialHubService');
const modelArkAssetConfigService = require('./modelArkAssetConfigService');
const uploadService = require('./uploadService');
const seedance2AssetGuards = require('../utils/seedance2AssetGuards');
const { resolveImageUrl } = require('./characterLibraryAssembly');

/**
 * 组成素材库可拉取的 http(s) 图片 URL：优先角色主图已为直链；否则用 storage.base_url + local_path 拼出（与图床/即梦回传直链二选一逻辑一致）
 */
function buildCharacterPublicImageUrlForHub(charRow, cfg) {
  const img = (charRow.image_url || '').toString().trim();
  const lp = (charRow.local_path || '').toString().trim();
  const baseRaw = (cfg?.storage?.base_url || '').toString().trim();
  const publicBase = baseRaw.replace(/\/$/, '');

  if (/^https?:\/\//i.test(img)) {
    return { ok: true, url: img };
  }
  if (!publicBase) {
    return {
      ok: false,
      error:
        '角色主图不是公网图片地址，且未配置静态资源公网地址，无法生成素材库可拉取的图片链接。请将主图设为图床或即梦返回地址，或配置本服务静态资源公网地址。',
    };
  }
  if (lp) {
    const pathPart = lp.replace(/^\/+/, '');
    return { ok: true, url: `${publicBase}/${pathPart}` };
  }
  if (img.startsWith('/')) {
    if (publicBase.endsWith('/static') && img.startsWith('/static/')) {
      return { ok: true, url: publicBase + img.slice('/static'.length) };
    }
    const m = publicBase.match(/^(https?:\/\/[^/]+)/i);
    if (m) return { ok: true, url: m[1] + img };
  }
  const fallback = resolveImageUrl(charRow.image_url, charRow.local_path);
  if (/^https?:\/\//i.test(fallback)) return { ok: true, url: fallback };
  return { ok: false, error: '角色缺少素材库可用的图片（需公网图链或已上传的本地图片）' };
}

function storageRootPath(cfg) {
  const raw = (cfg?.storage?.local_path || './data/storage').toString();
  return path.isAbsolute(raw) ? raw : path.join(process.cwd(), raw);
}

/** 云端素材库无法拉取：非 http(s)、data:、localhost、常见内网等 */
function isNonPublicMaterialHubUrl(url) {
  const s = String(url || '').trim();
  if (!s) return true;
  if (s.startsWith('data:')) return true;
  if (!/^https?:\/\//i.test(s)) return true;
  try {
    const { hostname } = new URL(s);
    const h = String(hostname || '').toLowerCase();
    if (h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0' || h === '[::1]' || h === '::1') return true;
    if (/^192\.168\./.test(h)) return true;
    if (/^10\./.test(h)) return true;
    const m = /^172\.(\d+)\./.exec(h);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n >= 16 && n <= 31) return true;
    }
  } catch (_) {
    return true;
  }
  return false;
}

/** 与 image_proxy_cache 约定一致：有 local_path 用相对路径作 key；否则用 URL 哈希避免冲突 */
function materialHubProxyCacheKey(charRow, imageUrl) {
  const lp = (charRow.local_path || '').toString().trim().replace(/^\/+/, '');
  if (lp) return lp;
  return `sd2char:url:${crypto.createHash('sha256').update(String(imageUrl)).digest('hex').slice(0, 48)}`;
}

function isHubDownloadMediaError(msg) {
  return /DownloadFailed|download media|accessible|拉取|下载|tos: request error|fetch-object/i.test(String(msg || ''));
}

function isHubAuthTokenError(msg) {
  return /无效的\s*token|invalid\s*token|unauthorized|401/i.test(String(msg || ''));
}

function formatSd2HubError(errMsg, hubCtx) {
  let out = String(errMsg || '素材库创建素材失败');
  if (!isHubAuthTokenError(out)) return out;
  const diag = hubCtx?.hubAuthDiag || {};
  const parts = [
    `即梦2素材库拒绝了当前密钥（${out}）。`,
    '请在「AI 配置」→「即梦2角色认证」中重新粘贴与接口测试完全相同的密钥并点击保存（不要带鉴权前缀、不要多空格）。',
    '保存前可用「列出素材」验证；若列出成功而 SD2 仍失败，说明未保存或存在多条配置未设为默认。',
  ];
  if (diag.db_config_id != null) parts.push(`当前读取的配置编号：${diag.db_config_id}${diag.db_config_name ? `「${diag.db_config_name}」` : ''}。`);
  return parts.join('');
}

/**
 * localhost / 内网 / 相对 URL 等：先查 image_proxy_cache，未命中则读本地文件上传图床，供即梦素材库拉取。
 * @param {{ forceLocalProxy?: boolean }} [opts] - 为 true 时跳过直链，强制用 local_path 上传图床（网关拉取火山/TOS 等失败时重试）
 */
async function ensurePublicRegisterImageUrlForMaterialHub(db, log, cfg, charRow, imageUrl, opts = {}) {
  const forceLocalProxy = !!opts.forceLocalProxy;
  if (!forceLocalProxy && !isNonPublicMaterialHubUrl(imageUrl)) {
    return { ok: true, url: imageUrl, via: 'direct' };
  }
  const cacheKey = materialHubProxyCacheKey(charRow, imageUrl);
  const cached = await imageClient.getProxyCacheValidated(db, cacheKey, log, `sd2_char_${charRow.id}`);
  if (cached) {
    log.info('[SD2认证] 使用图床缓存 URL', { character_id: charRow.id, cache_key: cacheKey });
    return { ok: true, url: cached, via: 'cache' };
  }
  const storagePath = storageRootPath(cfg);
  const localRef = (charRow.local_path || '').toString().trim() || imageUrl;
  const proxyUrl = await uploadService.uploadLocalImageToProxy(storagePath, localRef, log, `sd2_char_${charRow.id}`);
  if (!proxyUrl) {
    return {
      ok: false,
      error:
        '角色图为本机或内网地址，上传到中转图床失败。请确认本地存储文件存在，且图床配置可用。',
    };
  }
  imageClient.setProxyCache(db, cacheKey, proxyUrl);
  log.info('[SD2认证] 已上传图床供素材库拉取', { character_id: charRow.id, cache_key: cacheKey });
  return { ok: true, url: proxyUrl, via: 'upload' };
}

function readSeedance2AssetJson(text) {
  if (!text) return null;
  try {
    return typeof text === 'string' ? JSON.parse(text) : text;
  } catch (_) {
    return null;
  }
}

function resolveSd2RegisterProvider(cfg, db, log) {
  const hubCtx = jimengMaterialHubService.buildHubContext(cfg, db, log);
  if (hubCtx.token) return { provider: 'hub', hubCtx };
  const arkCtx = modelArkAssetConfigService.buildModelArkContext(db, log);
  if (arkCtx.ready) return { provider: 'model_ark', arkCtx };
  return { provider: null, hubCtx, arkCtx };
}

function sd2ConfigMissingError(hubCtx, arkCtx) {
  const parts = [
    '未配置 SD2 认证，请在「AI 配置」中任选其一：',
    '① 添加「即梦2角色认证」，并填写网关地址与密钥；',
    '② 或在「SD2 资产管理」点击「保存到 AI 配置」，填写访问密钥、签名密钥与默认资产组编号。',
  ];
  if (arkCtx?.diag?.missing) {
    parts.push(`（ModelArk 配置不完整：缺少 ${arkCtx.diag.missing}）`);
  }
  if (!hubCtx?.token && arkCtx?.diag?.db_model_ark_row_found === false) {
    parts.push('（当前未找到已保存的 ModelArk 资产库配置）');
  }
  return parts.join('');
}

async function prepareCharacterRegisterImage(db, log, cfg, characterId) {
  const charRow = db.prepare('SELECT * FROM characters WHERE id = ? AND deleted_at IS NULL').get(Number(characterId));
  if (!charRow) return { ok: false, error: '角色不存在' };
  if (!charRow.image_url && !charRow.local_path) {
    return { ok: false, error: '角色还没有形象图片' };
  }
  const urlOut = buildCharacterPublicImageUrlForHub(charRow, cfg);
  if (!urlOut.ok) return urlOut;
  const imageUrl = urlOut.url;
  if (String(imageUrl).startsWith('data:')) {
    return { ok: false, error: '不支持内嵌图片注册，请先使用上传或外网图链' };
  }
  const pub = await ensurePublicRegisterImageUrlForMaterialHub(db, log, cfg, charRow, imageUrl);
  if (!pub.ok) return pub;
  return {
    ok: true,
    charRow,
    imageUrl,
    registerImageUrl: pub.url,
    pub,
    assetName: String(charRow.name || 'role').replace(/\s+/g, '').slice(0, 12) || 'role',
  };
}

function buildSeedance2BasePayload(charRow, assetId, created, registerImageUrl, sd2Provider) {
  const now = new Date().toISOString();
  const certifiedLp = seedance2AssetGuards.normalizeStorageRelPath(charRow.local_path || '') || null;
  const certifiedImg = (charRow.image_url || '').toString().trim() || null;
  return {
    hub_asset_id: assetId,
    asset_url: created.asset_url || modelArkAssetConfigService.assetUrlForVideo(created) || null,
    status: created.status || 'processing',
    source_image_url: registerImageUrl,
    certified_local_path: certifiedLp,
    certified_image_url: certifiedImg,
    sd2_provider: sd2Provider,
    character_display: {
      name: charRow.name || '',
      appearance: (charRow.appearance || '').slice(0, 500) || null,
      description: (charRow.description || '').slice(0, 500) || null,
    },
    updated_at: now,
  };
}

async function registerCharacterViaJimengHub(db, log, cfg, characterId, hubCtx, prep) {
  const { charRow, imageUrl, registerImageUrl: initialUrl, pub, assetName } = prep;
  let registerImageUrl = initialUrl;
  const registerUrlLooksPrivate = isNonPublicMaterialHubUrl(imageUrl);
  log.info('[SD2认证][hub] 请求参数摘要', {
    character_id: Number(characterId),
    character_name: charRow.name,
    drama_id: charRow.drama_id,
    register_image_present: Boolean(registerImageUrl),
    hub_gateway: hubCtx.baseUrl,
    hub_auth_diag: hubCtx.hubAuthDiag || null,
    asset_name: assetName,
    register_url_looks_private_host: registerUrlLooksPrivate,
  });

  let createRes = await jimengMaterialHubService.createImageAsset(hubCtx, { url: registerImageUrl, name: assetName }, log);
  if (!createRes.ok && isHubDownloadMediaError(createRes.error) && pub.via === 'direct' && charRow.local_path) {
    const proxyRetry = await ensurePublicRegisterImageUrlForMaterialHub(db, log, cfg, charRow, imageUrl, {
      forceLocalProxy: true,
    });
    if (proxyRetry.ok && proxyRetry.url && proxyRetry.url !== registerImageUrl) {
      registerImageUrl = proxyRetry.url;
      createRes = await jimengMaterialHubService.createImageAsset(hubCtx, { url: registerImageUrl, name: assetName }, log);
    }
  }
  if (!createRes.ok) {
    let errMsg = formatSd2HubError(createRes.error, hubCtx);
    if (isHubDownloadMediaError(createRes.error)) {
      errMsg +=
        ' 【说明】素材库会从云端访问你提交的「图片 URL」。火山引擎/即梦临时链常无法被网关拉取，本服务已尝试用本地图上传中转图床；若仍失败请检查 local_path 文件是否存在、图床是否可用，或换百度图床等公网直链。';
    }
    return { ok: false, error: errMsg };
  }
  const created = createRes.data;
  const assetId = created.id;
  if (!assetId) return { ok: false, error: '素材库返回缺少素材 ID' };

  const basePayload = buildSeedance2BasePayload(charRow, assetId, created, registerImageUrl, 'hub');
  db.prepare('UPDATE characters SET seedance2_asset = ?, updated_at = ? WHERE id = ?').run(
    JSON.stringify(basePayload),
    basePayload.updated_at,
    Number(characterId)
  );

  const poll = await jimengMaterialHubService.pollAssetUntilSettled(hubCtx, assetId, {
    maxMs: hubCtx.poll_max_ms != null ? Number(hubCtx.poll_max_ms) : 120000,
    intervalMs: hubCtx.poll_interval_ms != null ? Number(hubCtx.poll_interval_ms) : 2000,
    log,
  });
  if (!poll.ok) return { ok: false, error: poll.error };
  const settled = poll.asset || created;
  const nextPayload = {
    ...basePayload,
    asset_url: settled.asset_url ?? basePayload.asset_url,
    status: settled.status || basePayload.status,
    hub_url: settled.url || created.url || null,
    poll_timed_out: !!poll.timedOut,
    updated_at: new Date().toISOString(),
  };
  db.prepare('UPDATE characters SET seedance2_asset = ?, updated_at = ? WHERE id = ?').run(
    JSON.stringify(nextPayload),
    nextPayload.updated_at,
    Number(characterId)
  );
  log.info('[SD2认证][hub] 素材已登记', { characterId, hub_asset_id: assetId, status: nextPayload.status });
  return { ok: true, seedance2_asset: nextPayload };
}

async function registerCharacterViaModelArk(db, log, cfg, characterId, arkCtx, prep) {
  const { charRow, imageUrl, registerImageUrl: initialUrl, pub, assetName } = prep;
  let registerImageUrl = initialUrl;
  log.info('[SD2认证][model_ark] 请求参数摘要', {
    character_id: Number(characterId),
    character_name: charRow.name,
    drama_id: charRow.drama_id,
    resolved_register_image_url: String(registerImageUrl).slice(0, 500),
    asset_group_id: arkCtx.assetGroupId,
    auth_mode: arkCtx.diag?.auth_mode,
    asset_name: assetName,
  });

  let createRes = await modelArkAssetConfigService.createImageAsset(
    arkCtx,
    { url: registerImageUrl, name: assetName },
    log
  );
  if (!createRes.ok && isHubDownloadMediaError(createRes.error) && pub.via === 'direct' && charRow.local_path) {
    const proxyRetry = await ensurePublicRegisterImageUrlForMaterialHub(db, log, cfg, charRow, imageUrl, {
      forceLocalProxy: true,
    });
    if (proxyRetry.ok && proxyRetry.url && proxyRetry.url !== registerImageUrl) {
      registerImageUrl = proxyRetry.url;
      createRes = await modelArkAssetConfigService.createImageAsset(
        arkCtx,
        { url: registerImageUrl, name: assetName },
        log
      );
    }
  }
  if (!createRes.ok) {
    return {
      ok: false,
      error: `ModelArk 创建资产失败：${String(createRes.error || '').slice(0, 1500)}`,
    };
  }
  const created = createRes.data;
  const assetId = created.id;
  if (!assetId) return { ok: false, error: '资产库返回缺少资产 ID' };

  const basePayload = buildSeedance2BasePayload(charRow, assetId, created, registerImageUrl, 'model_ark');
  db.prepare('UPDATE characters SET seedance2_asset = ?, updated_at = ? WHERE id = ?').run(
    JSON.stringify(basePayload),
    basePayload.updated_at,
    Number(characterId)
  );

  const poll = await modelArkAssetConfigService.pollAssetUntilSettled(arkCtx, assetId, { log });
  if (!poll.ok) return { ok: false, error: poll.error };
  const settled = poll.asset || created;
  const nextPayload = {
    ...basePayload,
    asset_url: settled.asset_url ?? basePayload.asset_url,
    status: settled.status || basePayload.status,
    poll_timed_out: !!poll.timedOut,
    updated_at: new Date().toISOString(),
  };
  db.prepare('UPDATE characters SET seedance2_asset = ?, updated_at = ? WHERE id = ?').run(
    JSON.stringify(nextPayload),
    nextPayload.updated_at,
    Number(characterId)
  );
  log.info('[SD2认证][model_ark] 素材已登记', { characterId, hub_asset_id: assetId, status: nextPayload.status });
  return { ok: true, seedance2_asset: nextPayload };
}

/**
 * 注册角色主图为 Seedance 2.0 可用 asset 引用。
 * 优先即梦2角色认证（hub）；否则使用已保存的 ModelArk 官方资产库配置。
 */
async function registerCharacterJimengMaterialAsset(db, log, cfg, characterId) {
  const route = resolveSd2RegisterProvider(cfg, db, log);
  if (!route.provider) {
    return { ok: false, error: sd2ConfigMissingError(route.hubCtx, route.arkCtx) };
  }
  const prep = await prepareCharacterRegisterImage(db, log, cfg, characterId);
  if (!prep.ok) return prep;
  if (route.provider === 'hub') {
    return registerCharacterViaJimengHub(db, log, cfg, characterId, route.hubCtx, prep);
  }
  return registerCharacterViaModelArk(db, log, cfg, characterId, route.arkCtx, prep);
}

async function refreshCharacterJimengMaterialAsset(db, log, cfg, characterId) {
  const charRow = db.prepare('SELECT id, seedance2_asset FROM characters WHERE id = ? AND deleted_at IS NULL').get(Number(characterId));
  if (!charRow) return { ok: false, error: '角色不存在' };
  const prev = readSeedance2AssetJson(charRow.seedance2_asset);
  const assetId = prev?.hub_asset_id;
  if (!assetId) {
    return { ok: false, error: '暂未取得素材 ID，请先完成即梦认证' };
  }

  const provider = String(prev?.sd2_provider || '').toLowerCase() === 'model_ark' ? 'model_ark' : 'hub';
  let settled;
  if (provider === 'model_ark') {
    const arkCtx = modelArkAssetConfigService.buildModelArkContext(db, log);
    if (!arkCtx.ready) {
      return { ok: false, error: '未找到有效的资产库配置，无法刷新认证状态' };
    }
    const r = await modelArkAssetConfigService.getAsset(arkCtx, assetId, log);
    if (!r.ok) return { ok: false, error: r.error };
    settled = r.data;
  } else {
    const hubCtx = jimengMaterialHubService.buildHubContext(cfg, db, log);
    if (!hubCtx.token) {
      return { ok: false, error: '未配置即梦2角色认证：请在「AI 配置」中填写密钥' };
    }
    const r = await jimengMaterialHubService.getAsset(hubCtx, assetId, log);
    if (!r.ok) return { ok: false, error: r.error };
    settled = r.data;
  }

  const now = new Date().toISOString();
  const nextPayload = {
    ...(prev && typeof prev === 'object' ? prev : {}),
    hub_asset_id: assetId,
    asset_url: settled.asset_url ?? prev?.asset_url ?? modelArkAssetConfigService.assetUrlForVideo(settled) ?? null,
    status: settled.status || prev?.status || 'processing',
    hub_url: settled.url ?? prev?.hub_url ?? null,
    sd2_provider: provider,
    updated_at: now,
  };
  db.prepare('UPDATE characters SET seedance2_asset = ?, updated_at = ? WHERE id = ?').run(
    JSON.stringify(nextPayload),
    now,
    Number(characterId)
  );
  return { ok: true, seedance2_asset: nextPayload };
}

module.exports = {
  buildCharacterPublicImageUrlForHub,
  storageRootPath,
  isNonPublicMaterialHubUrl,
  materialHubProxyCacheKey,
  isHubDownloadMediaError,
  isHubAuthTokenError,
  formatSd2HubError,
  ensurePublicRegisterImageUrlForMaterialHub,
  readSeedance2AssetJson,
  resolveSd2RegisterProvider,
  sd2ConfigMissingError,
  prepareCharacterRegisterImage,
  buildSeedance2BasePayload,
  registerCharacterViaJimengHub,
  registerCharacterViaModelArk,
  registerCharacterJimengMaterialAsset,
  refreshCharacterJimengMaterialAsset,
};
