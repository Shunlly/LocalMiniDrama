'use strict';

const { secureHttpFetch } = require('./secureHttpFetch');
const { requireCompleteProviderNetworkPolicy } = require('./providerNetworkPolicy');
const {
  buildProviderErrorMessage,
  summarizeProviderResponse,
  toSafeProviderErrorMessage,
} = require('./providerErrorSanitizer');

const HUB_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const HUB_REQUEST_TIMEOUT_MS = 30000;

/**
 * 即梦2角色认证 — 业务侧「素材管理」HTTP API（与官方路径一致，如 /api/business/v1/assets）。
 * 网关 URL 与 Token 从 AI 配置（service_type = jimeng2_character_auth）读取；可选兼容旧版 config 中的 jimeng_material_hub / silvamux_hub。
 * 参考：https://83zi.com/sd2realperson.html
 */

function loadAiJimeng2AuthRow(db) {
  if (!db) return null;
  try {
    return db
      .prepare(
        `SELECT id, name, base_url, api_key, provider, service_type, settings FROM ai_service_configs
         WHERE deleted_at IS NULL AND service_type = ? AND is_active = 1
         ORDER BY is_default DESC, priority DESC, id ASC LIMIT 1`
      )
      .get('jimeng2_character_auth');
  } catch (_) {
    return null;
  }
}

function legacyYamlHubSection(cfg) {
  return cfg?.jimeng_material_hub || cfg?.silvamux_hub || {};
}

/** 与 routes/aiConfig.js listJimeng2MaterialAssets 一致：存库/环境变量里若含「Bearer 」前缀，hubJson 会再拼 Bearer，需先去重 */
function normalizeMaterialHubToken(raw) {
  let s = String(raw || '').trim();
  if (/^bearer\s+/i.test(s)) s = s.replace(/^bearer\s+/i, '').trim();
  // 兼容误填为 "token" / 'token' 的场景
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  // 去除不可见空白，避免网关把 header 判定为无效
  s = s.replace(/[\r\n\t\u200b-\u200d\ufeff]/g, '').trim();
  // 全角空格等
  s = s.replace(/\u00a0/g, ' ').trim();
  return s;
}

function sameOrigin(left, right) {
  try {
    return new URL(left).origin === new URL(right).origin;
  } catch (_) {
    return false;
  }
}

function safeOrigin(value) {
  try {
    return new URL(value).origin;
  } catch (_) {
    return '[invalid-provider-origin]';
  }
}

/**
 * 解析即梦2角色认证调用上下文（供素材注册 API 使用）
 * @param {object} cfg - 应用 config.yaml
 * @param {object|null} db - better-sqlite3（可选，用于读 AI 配置表）
 * @param {object|null} [log] - 可选 logger；传入时打一条不含密钥原文的鉴权诊断
 * @returns {{ baseUrl: string, token: string, poll_max_ms?: number, poll_interval_ms?: number, hubAuthDiag?: object }}
 */
function buildHubContext(cfg, db, log) {
  const row = loadAiJimeng2AuthRow(db);
  const legacy = legacyYamlHubSection(cfg);
  let base_url = (row?.base_url || '').toString().trim();
  let token = (row?.api_key || '').toString().trim();
  let poll_max_ms;
  let poll_interval_ms;

  if (!base_url || !token) {
    const y = legacy;
    if (!base_url) base_url = (y.base_url || '').toString().trim();
    if (!token) token = (y.token || '').toString().trim();
    if (poll_max_ms == null && y.poll_max_ms != null) poll_max_ms = Number(y.poll_max_ms);
    if (poll_interval_ms == null && y.poll_interval_ms != null) poll_interval_ms = Number(y.poll_interval_ms);
  }

  const baseUrl = (
    process.env.JIMENG2_CHARACTER_AUTH_URL ||
    base_url ||
    process.env.JIMENG_MATERIAL_HUB_BASE_URL ||
    process.env.SILVAMUX_HUB_BASE_URL ||
    'https://silvamux.tingyutech.com'
  )
    .toString()
    .trim()
    .replace(/\/$/, '');

  const rawTokJoined = (
    process.env.JIMENG2_CHARACTER_AUTH_TOKEN ||
    token ||
    process.env.JIMENG_MATERIAL_HUB_TOKEN ||
    process.env.SILVAMUX_HUB_TOKEN ||
    process.env.HUB_TOKEN ||
    ''
  )
    .toString()
    .trim();

  const hadLeadingBearer = /^bearer\s+/i.test(rawTokJoined);
  const tok = normalizeMaterialHubToken(rawTokJoined);

  let networkPolicy = null;
  let networkPolicyError = '';
  try {
    const aiConfigService = require('./aiConfigService');
    networkPolicy = aiConfigService.getProviderNetworkOptions({
      base_url: baseUrl,
      provider: row?.provider || legacy.provider || 'jimeng2_character_auth',
      service_type: row?.service_type || 'jimeng2_character_auth',
      settings: row?.settings || legacy.settings || JSON.stringify({
        allow_local_http: legacy.allow_local_http === true,
      }),
    });
  } catch (error) {
    networkPolicyError = error?.code || 'INVALID_PROVIDER_URL';
  }
  const safeToken = networkPolicy ? tok : '';

  const env2 = !!String(process.env.JIMENG2_CHARACTER_AUTH_TOKEN || '').trim();
  const envMat = !!String(process.env.JIMENG_MATERIAL_HUB_TOKEN || '').trim();
  const envSilva = !!String(process.env.SILVAMUX_HUB_TOKEN || '').trim();
  const envHub = !!String(process.env.HUB_TOKEN || '').trim();
  const dbKeyLen = String(row?.api_key || '').trim().length;

  let winningTokenSource = 'none';
  if (env2) winningTokenSource = 'env:JIMENG2_CHARACTER_AUTH_TOKEN';
  else if (String(token || '').trim()) {
    winningTokenSource = dbKeyLen ? 'db:ai_service_configs(jimeng2_character_auth.api_key)' : 'yaml:jimeng_material_hub|silvamux_hub.token';
  } else if (envMat) winningTokenSource = 'env:JIMENG_MATERIAL_HUB_TOKEN';
  else if (envSilva) winningTokenSource = 'env:SILVAMUX_HUB_TOKEN';
  else if (envHub) winningTokenSource = 'env:HUB_TOKEN';

  const hubAuthDiag = {
    winning_token_source: winningTokenSource,
    raw_token_chars_before_normalize: rawTokJoined.length,
    token_chars_in_bearer_payload: safeToken.length,
    raw_had_leading_bearer_prefix: hadLeadingBearer,
    leading_bearer_prefix_stripped: hadLeadingBearer,
    env_token_flags: {
      JIMENG2_CHARACTER_AUTH_TOKEN: env2,
      JIMENG_MATERIAL_HUB_TOKEN: envMat,
      SILVAMUX_HUB_TOKEN: envSilva,
      HUB_TOKEN: envHub,
    },
    db_jimeng2_active_row_found: !!row,
    db_config_id: row?.id ?? null,
    db_config_name: row?.name ?? null,
    db_api_key_field_chars: dbKeyLen,
    request_header_shape: 'Authorization: Bearer <token>',
    note:
      '若 raw_had_leading_bearer_prefix 为 true，旧版会发出 Bearer Bearer…；现已规范化。环境变量 JIMENG2_CHARACTER_AUTH_TOKEN 优先于数据库 api_key。请求头仅发送 Authorization（勿重复 authorization，部分 model_ark 网关会判为无效 Token）。',
  };

  if (log && typeof log.info === 'function') {
    log.info('[JimengMaterialHub] buildHubContext 鉴权诊断（不含密钥原文）', {
      hub_origin: safeOrigin(baseUrl),
      token_present: !!safeToken,
      ...hubAuthDiag,
    });
  }

  return {
    baseUrl,
    token: safeToken,
    poll_max_ms,
    poll_interval_ms,
    hubAuthDiag,
    networkPolicy,
    networkPolicyError,
    trustedOrigins: networkPolicy?.trustedOrigins || [],
    allowPrivateOrigins: networkPolicy?.allowPrivateOrigins || [],
    networkLookup: networkPolicy?.lookup,
  };
}

/** model_ark 等网关在拉取图片失败时仍返回 HTTP 200 + { error: "..." }，无 id */
function rawHubBusinessError(json) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const err = json.error ?? json.Error;
  if (typeof err === 'string' && err.trim()) return err.trim();
  if (json.success === false) {
    return String(json.message || json.msg || json.detail || '网关业务失败').slice(0, 2000);
  }
  return null;
}

function hubErrorReason(value, status) {
  const text = String(value || '');
  if (status === 401 || status === 403 || /invalid\s*token|unauthorized|forbidden/i.test(text)) {
    return 'HUB_AUTH';
  }
  if (/DownloadFailed|download media|accessible|fetch-object|tos: request error/i.test(text)) {
    return 'HUB_MEDIA_DOWNLOAD';
  }
  return 'HUB_UPSTREAM';
}

function hubBusinessErrorMessage(json) {
  if (!rawHubBusinessError(json)) return null;
  return buildProviderErrorMessage({
    provider: 'Jimeng material hub',
    operation: 'request',
    status: 502,
    responseBody: json,
  });
}

function hubFailure(status, responseBody, rawHint) {
  return {
    ok: false,
    status,
    reason: hubErrorReason(rawHint, status),
    error: buildProviderErrorMessage({
      provider: 'Jimeng material hub',
      operation: 'request',
      status,
      responseBody,
    }),
  };
}

function pickAssetId(obj) {
  if (!obj || typeof obj !== 'object') return '';
  const id = obj.id ?? obj.asset_id ?? obj.assetId;
  return id != null ? String(id).trim() : '';
}

function looksLikeAssetView(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  const id = pickAssetId(obj);
  if (!id) return false;
  return (
    obj.status != null ||
    obj.asset_url != null ||
    obj.asset_type != null ||
    obj.url != null ||
    obj.name != null
  );
}

/** 兼容顶层 AssetView、{ data: {...} }、{ items: [one] } 等包裹格式 */
function unwrapMaterialHubAssetView(payload, depth = 0) {
  if (depth > 5 || payload == null || typeof payload !== 'object') return null;
  if (looksLikeAssetView(payload)) {
    const id = pickAssetId(payload);
    return {
      ...payload,
      id,
      asset_url: payload.asset_url ?? payload.assetUrl ?? null,
      status: payload.status ?? null,
    };
  }
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const found = unwrapMaterialHubAssetView(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  for (const key of ['data', 'result', 'asset', 'item', 'record', 'body', 'payload']) {
    if (payload[key] != null) {
      const found = unwrapMaterialHubAssetView(payload[key], depth + 1);
      if (found) return found;
    }
  }
  if (Array.isArray(payload.items) && payload.items.length === 1) {
    return unwrapMaterialHubAssetView(payload.items[0], depth + 1);
  }
  return null;
}

async function hubJson(path, ctx, { method, body, log } = {}) {
  const base = ctx.baseUrl;
  const token = ctx.token;
  if (!token) {
    return {
      ok: false,
      error:
        '未配置即梦2角色认证：请在「AI 配置」中添加类型为「即梦2角色认证」的一条配置，填写网关 URL 与 Token（或设置环境变量 JIMENG2_CHARACTER_AUTH_*；兼容旧 config / SILVAMUX_*）',
    };
  }
  let networkOptions;
  try {
    networkOptions = requireCompleteProviderNetworkPolicy(ctx.networkPolicy, base);
  } catch (error) {
    return {
      ok: false,
      error: toSafeProviderErrorMessage(error, {
        provider: 'Jimeng material hub',
        operation: 'request',
      }),
    };
  }
  const url = `${base}/api/business/v1${path}`;
  const init = {
    method: method || 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  };
  if (body != null) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  if (log && typeof log.info === 'function' && method === 'POST' && path === '/assets' && body?.url) {
    log.info('[JimengMaterialHub] POST /api/business/v1/assets', {
      hub_origin: safeOrigin(base),
      register_image_present: true,
      asset_name: body.name,
      asset_type: body.asset_type,
      bearer_token_payload_chars: token.length,
    });
  }
  if (log && typeof log.info === 'function' && method === 'GET' && String(path || '').startsWith('/assets')) {
    log.info('[JimengMaterialHub] GET /api/business/v1/assets', {
      hub_origin: safeOrigin(base),
      bearer_token_payload_chars: token.length,
    });
  }

  let res;
  try {
    res = await secureHttpFetch(url, { ...init, redirect: 'error' }, {
      trustedOrigins: networkOptions.trustedOrigins,
      allowPrivateOrigins: networkOptions.allowPrivateOrigins,
      lookup: networkOptions.lookup,
      requireHttpsForPublic: networkOptions.requireHttpsForPublic,
      timeoutMs: HUB_REQUEST_TIMEOUT_MS,
      maxBytes: HUB_MAX_RESPONSE_BYTES,
      maxRedirects: 0,
    });
  } catch (error) {
    const safeMessage = toSafeProviderErrorMessage(error, {
      provider: 'Jimeng material hub',
      operation: 'request',
    });
    log?.warn?.('[JimengMaterialHub] request failed', {
      path: String(path || '').split('?', 1)[0],
      method: method || 'GET',
      hub_origin: safeOrigin(base),
      error: safeMessage,
    });
    return { ok: false, error: safeMessage };
  }
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : {};
  } catch (_) {
    const error = buildProviderErrorMessage({
      provider: 'Jimeng material hub',
      operation: 'response',
      status: res.status,
      responseBody: text,
    });
    log?.warn?.('[JimengMaterialHub] invalid JSON response', {
      path: String(path || '').split('?', 1)[0],
      method: method || 'GET',
      http_status: res.status,
      hub_origin: safeOrigin(base),
      ...summarizeProviderResponse(text),
    });
    return { ok: false, status: res.status, error };
  }
  if (!res.ok) {
    const detail = json?.detail || json?.title || json?.message || text || res.statusText;
    const detailStr = typeof detail === 'string' ? detail : JSON.stringify(detail);
    const safeMessage = buildProviderErrorMessage({
      provider: 'Jimeng material hub',
      operation: 'request',
      status: res.status,
      responseBody: json,
      code: hubErrorReason(detailStr, res.status),
    });
    if (log && typeof log.warn === 'function') {
      log.warn('[JimengMaterialHub] HTTP error', {
        path: String(path || '').split('?', 1)[0],
        method: method || 'GET',
        http_status: res.status,
        hub_origin: safeOrigin(base),
        ...summarizeProviderResponse(json),
      });
    }
    return { ok: false, status: res.status, error: safeMessage };
  }
  const bizErr = hubBusinessErrorMessage(json);
  if (bizErr) {
    if (log && typeof log.warn === 'function') {
      log.warn('[JimengMaterialHub] HTTP 200 但业务失败（常见于图片 URL 无法被网关拉取）', {
        path,
        method: method || 'GET',
        httpStatus: res.status,
        hub_origin: safeOrigin(base),
        ...summarizeProviderResponse(json),
      });
    }
    return { ok: false, status: res.status, error: bizErr };
  }
  return { ok: true, data: json, status: res.status };
}

async function createImageAsset(ctx, params, log) {
  const name = String(params.name || 'c').replace(/\s+/g, '').slice(0, 12) || 'c';
  const r = await hubJson('/assets', ctx, {
    method: 'POST',
    body: { url: params.url, asset_type: 'Image', name },
    log,
  });
  if (!r.ok) return r;
  const asset = unwrapMaterialHubAssetView(r.data);
  if (asset?.id) return { ok: true, data: asset, status: r.status };
  const keys =
    r.data && typeof r.data === 'object' && !Array.isArray(r.data) ? Object.keys(r.data).join(', ') : typeof r.data;
  if (log && typeof log.warn === 'function') {
    log.warn('[JimengMaterialHub] POST 成功但无法解析素材 id', {
      response_keys: keys,
      response_preview: JSON.stringify(r.data).slice(0, 800),
    });
  }
  return {
    ok: false,
    status: r.status,
    error: `素材库未返回素材 id（响应字段：${keys || '空'}）`,
  };
}

/**
 * 列出组织下素材（分页）
 * @see https://83zi.com/sd2realperson.html
 */
async function listAssets(ctx, opts = {}, log) {
  const limitRaw = opts.limit != null ? Number(opts.limit) : 20;
  const limit = Math.min(100, Math.max(1, Number.isFinite(limitRaw) ? limitRaw : 20));
  const q = new URLSearchParams();
  q.set('limit', String(limit));
  if (opts.cursor) q.set('cursor', String(opts.cursor));
  const path = `/assets?${q.toString()}`;
  return hubJson(path, ctx, { method: 'GET', log });
}

async function getAsset(ctx, assetId, log) {
  const id = encodeURIComponent(String(assetId || '').trim());
  if (!id) return { ok: false, error: '缺少 asset id' };
  const r = await hubJson(`/assets/${id}`, ctx, { method: 'GET', log });
  if (!r.ok) return r;
  const asset = unwrapMaterialHubAssetView(r.data);
  if (asset?.id) return { ok: true, data: asset, status: r.status };
  return { ok: true, data: r.data, status: r.status };
}

async function pollAssetUntilSettled(ctx, assetId, options = {}) {
  const maxMs = options.maxMs ?? 120000;
  const intervalMs = options.intervalMs ?? 2000;
  const log = options.log;
  const deadline = Date.now() + maxMs;
  let last;
  while (Date.now() < deadline) {
    const r = await getAsset(ctx, assetId, log);
    if (!r.ok) return { ok: false, error: r.error };
    last = r.data;
    const st = (last && last.status) || '';
    if (st === 'active' || st === 'failed') {
      return { ok: true, asset: last };
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return { ok: true, asset: last, timedOut: true };
}

function hubToken(cfg, db) {
  return buildHubContext(cfg, db).token;
}

module.exports = {
  buildHubContext,
  hubToken,
  normalizeMaterialHubToken,
  hubBusinessErrorMessage,
  unwrapMaterialHubAssetView,
  createImageAsset,
  listAssets,
  getAsset,
  pollAssetUntilSettled,
};
