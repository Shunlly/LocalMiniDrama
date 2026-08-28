'use strict';

const {
  signKlingOfficialJwt,
  normalizeKlingCredential,
  unsafeDecodeKlingJwtPayload,
  jwtPartLengths,
} = require('../klingJwt');
const { summarizeProviderResponse } = require('../providerErrorSanitizer');
const {
  fetchVideoWithTimeout,
  videoProviderFailure,
  pickProxyVideoUrl,
  logVideoPostRequest,
  normalizeAspectRatioForApi,
  KLING_OMNI_ASPECT_RATIOS,
} = require('./helpers');
const { resolveImageInputForOmniAsync, loadStorageImage } = require('./mediaRefs');

/** 可灵 Omni / 多图生视频（飞儿 ffir.cn 等中转）：可用环境变量临时覆盖配置 */
function applyKlingOmniEnvOverrides(config) {
  const c = { ...config };
  if (process.env.KLING_FFIR_BASE_URL) {
    c.base_url = String(process.env.KLING_FFIR_BASE_URL).replace(/\/$/, '');
  }
  if (process.env.KLING_FFIR_API_KEY) {
    c.api_key = process.env.KLING_FFIR_API_KEY;
  }
  if (process.env.KLING_FFIR_CREATE_PATH) {
    c.endpoint = process.env.KLING_FFIR_CREATE_PATH.startsWith('/')
      ? process.env.KLING_FFIR_CREATE_PATH
      : '/' + process.env.KLING_FFIR_CREATE_PATH;
  }
  if (process.env.KLING_FFIR_QUERY_PATH) {
    c.query_endpoint = process.env.KLING_FFIR_QUERY_PATH;
  }
  if (process.env.KLING_OFFICIAL_ACCESS_KEY) {
    c._kling_official_access_key = process.env.KLING_OFFICIAL_ACCESS_KEY;
  }
  if (process.env.KLING_OFFICIAL_SECRET_KEY) {
    c._kling_official_secret_key = process.env.KLING_OFFICIAL_SECRET_KEY;
  }
  if (process.env.KLING_OFFICIAL_BASE_URL) {
    c.base_url = String(process.env.KLING_OFFICIAL_BASE_URL).replace(/\/$/, '');
  }
  return c;
}

function parseConfigSettingsJson(config) {
  if (!config) return {};
  const raw = config.settings;
  if (raw == null || raw === '') return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) return { ...raw };
  try {
    return JSON.parse(raw);
  } catch (_) {
    return {};
  }
}

/** SecretKey 是否按 Base64 解码后再参与 HS256（部分控制台给出的 Secret 为 Base64 串） */
function resolveKlingSecretKeyBase64Flag(cfg) {
  const s = parseConfigSettingsJson(cfg);
  if (s.kling_secret_key_base64 === true || s.kling_secret_key_base64 === 1) return true;
  if (String(s.kling_secret_key_base64 || '').toLowerCase() === 'true') return true;
  const env = String(process.env.KLING_SECRET_KEY_BASE64 || '').toLowerCase();
  if (env === '1' || env === 'true' || env === 'yes') return true;
  return false;
}

/**
 * 官方 AccessKey+SecretKey → JWT；否则 api_key 视为 Bearer Token（中转站）
 */
function resolveKlingOmniBearerToken(cfg, log) {
  const s = parseConfigSettingsJson(cfg);
  const ak = normalizeKlingCredential(
    s.kling_access_key || s.access_key || cfg._kling_official_access_key || ''
  );
  const sk = normalizeKlingCredential(
    s.kling_secret_key || s.secret_key || cfg._kling_official_secret_key || ''
  );
  if (ak && sk) {
    try {
      const useB64 = resolveKlingSecretKeyBase64Flag(cfg);
      const token = signKlingOfficialJwt(ak, sk, {
        secretEncoding: useB64 ? 'base64' : 'utf8',
      });
      log.info('[KlingOmni] 鉴权：官方 AK/SK → JWT（HS256，payload: iss+exp+nbf）', {
        secret_key_hmac_input: useB64 ? 'base64_decoded_bytes' : 'utf8_string',
      });
      return token;
    } catch (e) {
      log.warn('[KlingOmni] JWT 生成失败', { message: e.message });
      return null;
    }
  }
  let bearer = normalizeKlingCredential(cfg.api_key || '');
  if (/^bearer\s+/i.test(bearer)) bearer = bearer.replace(/^bearer\s+/i, '');
  if (bearer) log.info('[KlingOmni] 鉴权：Bearer Token（api_key，预签 JWT 或中转 Key）');
  return bearer || null;
}

/** 便于排查 401：不打印 Secret、不打印完整 JWT */
function logKlingOmniAuthDebug(cfg, bearerToken, log) {
  if (!bearerToken || !log?.info) return;
  const s = parseConfigSettingsJson(cfg);
  const ak = normalizeKlingCredential(
    s.kling_access_key || s.access_key || cfg._kling_official_access_key || ''
  );
  const sk = normalizeKlingCredential(
    s.kling_secret_key || s.secret_key || cfg._kling_official_secret_key || ''
  );
  const now = Math.floor(Date.now() / 1000);
  if (ak && sk) {
    const payload = unsafeDecodeKlingJwtPayload(bearerToken);
    const lens = jwtPartLengths(bearerToken);
    log.info('[KlingOmni] 鉴权调试（无密钥/无完整 token）', {
      mode: 'official_jwt',
      secret_key_hmac_input: resolveKlingSecretKeyBase64Flag(cfg) ? 'base64_decoded_bytes' : 'utf8_string',
      access_key_len: ak.length,
      secret_key_len: sk.length,
      jwt_parts_b64url_len: lens,
      jwt_payload_decoded: payload
        ? { iss: payload.iss, exp: payload.exp, nbf: payload.nbf, iat: payload.iat }
        : null,
      server_time_unix: now,
      nbf_ok: payload && typeof payload.nbf === 'number' ? now >= payload.nbf : null,
      exp_ok: payload && typeof payload.exp === 'number' ? now < payload.exp : null,
    });
    return;
  }
  log.info('[KlingOmni] 鉴权调试（无密钥/无完整 token）', {
    mode: 'bearer_api_key',
    token_len: bearerToken.length,
    looks_like_jwt: /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(bearerToken),
  });
}

/** 未填 base_url：官方凭据 → api-beijing.klingai.com；否则 ffir 中转默认 */
function resolveKlingOmniBaseUrl(cfg) {
  const b = (cfg.base_url || '').toString().replace(/\/$/, '').trim();
  if (b) return b;
  const s = parseConfigSettingsJson(cfg);
  const hasOfficial =
    ((s.kling_access_key || s.access_key) && (s.kling_secret_key || s.secret_key)) ||
    (cfg._kling_official_access_key && cfg._kling_official_secret_key);
  return hasOfficial ? 'https://api-beijing.klingai.com' : 'https://ffir.cn';
}

const KLING_OMNI_PROXY_CREATE = '/kling/v1/videos/omni-video';
const KLING_OMNI_PROXY_QUERY = '/kling/v1/images/omni-image/{taskId}';
const KLING_OMNI_OFFICIAL_CREATE = '/v1/videos/omni-video';
const KLING_OMNI_OFFICIAL_QUERY = '/v1/videos/omni-video/{taskId}';

function resolveKlingOmniAspectRatio(aspect_ratio, log, video_gen_id) {
  const normalized = normalizeAspectRatioForApi(aspect_ratio);
  if (normalized) return normalized;
  const raw = aspect_ratio != null ? String(aspect_ratio).trim() : '';
  if (raw) {
    log.warn('[KlingOmni] aspect_ratio 不在可灵支持列表，回退 16:9', {
      raw: aspect_ratio,
      video_gen_id,
      supported: [...KLING_OMNI_ASPECT_RATIOS].join(', '),
    });
  }
  return '16:9';
}

/** 可灵官方 OpenAPI 域名（与 ffir 等 /kling/v1/... 中转路径不同） */
function isKlingOfficialOmniHost(baseUrl) {
  const raw = (baseUrl || '').toString().trim();
  if (!raw) return false;
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : 'https://' + raw);
    const h = u.hostname.toLowerCase();
    return (
      h === 'api.klingai.com' ||
      h === 'api-beijing.klingai.com' ||
      h === 'api-singapore.klingai.com'
    );
  } catch (_) {
    return /api(-beijing|-singapore)?\.klingai\.com/i.test(raw);
  }
}

function resolveKlingOmniCreatePath(cfg, base) {
  const official = isKlingOfficialOmniHost(base);
  const ep = (cfg.endpoint || '').toString().trim();
  if (ep) {
    const norm = ep.startsWith('/') ? ep : '/' + ep;
    if (official && norm === KLING_OMNI_PROXY_CREATE) return KLING_OMNI_OFFICIAL_CREATE;
    return norm;
  }
  return official ? KLING_OMNI_OFFICIAL_CREATE : KLING_OMNI_PROXY_CREATE;
}

function resolveKlingOmniQueryPathTemplate(cfg, base) {
  const official = isKlingOfficialOmniHost(base);
  const q = (cfg.query_endpoint || '').toString().trim();
  if (q) {
    if (official && q === KLING_OMNI_PROXY_QUERY) return KLING_OMNI_OFFICIAL_QUERY;
    return q;
  }
  return official ? KLING_OMNI_OFFICIAL_QUERY : KLING_OMNI_PROXY_QUERY;
}

function omniDurationString(modelName, durationNum) {
  const m = (modelName || '').toLowerCase();
  const d = Number(durationNum);
  const safe = Number.isFinite(d) && d > 0 ? d : 5;
  if (m.includes('v3-omni') || m.includes('kling-v3')) {
    const allowed = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
    let best = 5;
    let bestDiff = 999;
    for (const a of allowed) {
      const diff = Math.abs(a - safe);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = a;
      }
    }
    return String(best);
  }
  return safe <= 7 ? '5' : '10';
}

/**
 * 本地/内网图 → base64（图床上传失败时的兜底，与可灵 I2V 一致）
 */

/**
 * 可灵 Omni-Video
 * - 官方（api.klingai.com / api-beijing.klingai.com）：POST {base}/v1/videos/omni-video，轮询 GET {base}/v1/videos/omni-video/{taskId}
 * - ffir 等中转：POST {base}/kling/v1/videos/omni-video，查询 GET {base}/kling/v1/images/omni-image/{taskId}
 * model_name：kling-video-o1 / kling-v3-omni
 */
async function callKlingOmniVideoApi(config, log, opts) {
  const cfg = applyKlingOmniEnvOverrides(config);
  const {
    prompt,
    model,
    duration,
    aspect_ratio,
    image_url,
    reference_urls,
    files_base_url,
    storage_local_path,
    video_gen_id,
  } = opts;

  const base = resolveKlingOmniBaseUrl(cfg);
  const bearerToken = resolveKlingOmniBearerToken(cfg, log);
  if (!bearerToken) {
    return {
      error:
        '可灵 Omni 未配置鉴权：请填写「API Key」（中转 Bearer），或在高级设置中填写官方 AccessKey + SecretKey（存 settings，自动生成 JWT）',
    };
  }
  logKlingOmniAuthDebug(cfg, bearerToken, log);
  const createEp = resolveKlingOmniCreatePath(cfg, base);
  const createUrl = base + createEp;
  log.info('[KlingOmni] 请求路由', {
    video_gen_id,
    base_url: base,
    create_path: createEp,
    official_host: isKlingOfficialOmniHost(base),
  });

  const modelName = model || 'kling-video-o1';
  const durStr = omniDurationString(modelName, duration);
  const ratio = resolveKlingOmniAspectRatio(aspect_ratio, log, video_gen_id);

  const refList = Array.isArray(reference_urls) ? reference_urls.filter(Boolean) : [];
  const primary = (image_url || '').trim();
  const orderedUrls = [...(primary ? [primary] : []), ...refList.filter((u) => u !== primary)];

  const image_list = [];
  for (let i = 0; i < orderedUrls.length; i++) {
    const resolved = await resolveImageInputForOmniAsync(
      orderedUrls[i],
      files_base_url,
      storage_local_path,
      log,
      video_gen_id,
      i
    );
    if (!resolved) continue;
    const item = { image_url: resolved };
    if (orderedUrls.length === 1) {
      item.type = 'first_frame';
    } else if (i === 0) {
      item.type = 'first_frame';
    }
    image_list.push(item);
  }

  const textPrompt = (prompt || '').trim().slice(0, 2500);
  if (!textPrompt) {
    return { error: '可灵 Omni：multi_shot=false 时 prompt 不能为空' };
  }

  const body = {
    model_name: modelName,
    mode: 'std',
    duration: durStr,
    multi_shot: false,
    prompt: textPrompt,
    sound: 'off',
    aspect_ratio: ratio,
  };

  if (image_list.length) {
    body.image_list = image_list;
  }

  const headers = {
    'Content-Type': 'application/json',
    Authorization: bearerToken.startsWith('Bearer ') ? bearerToken : `Bearer ${bearerToken}`,
  };

  log.info('[KlingOmni] 创建任务', {
    url: createUrl,
    model_name: modelName,
    duration: durStr,
    aspect_ratio: ratio,
    image_count: image_list.length,
    video_gen_id,
  });
  logVideoPostRequest(log, 'KlingOmni', createUrl, body, video_gen_id, {
    model_name: modelName,
    duration: durStr,
    aspect_ratio: ratio,
    image_count: image_list.length,
  });

  const res = await fetchVideoWithTimeout(createUrl, { method: 'POST', headers, body: JSON.stringify(body) });
  const raw = await res.text();
  log.info('[KlingOmni] 创建响应', {
    video_gen_id,
    status: res.status,
    ...summarizeProviderResponse(raw),
  });

  if (!res.ok) {
    let errJson;
    try {
      errJson = JSON.parse(raw);
    } catch (_) {}
    if (res.status === 401) {
      log.warn('[KlingOmni] 401 排查', {
        video_gen_id,
        request_id: errJson?.request_id,
        code: errJson?.code,
        secret_key_hmac_input: resolveKlingSecretKeyBase64Flag(cfg) ? 'base64_decoded_bytes' : 'utf8_string',
        mode_note:
          '若用官方 AK/SK：确认未与 Secret 对调；在 AI 配置中尝试勾选「SecretKey 为 Base64」；Base URL 区域（北京/新加坡）须与密钥一致',
      });
    }
    return videoProviderFailure('KlingOmni', 'video request', res.status, raw, errJson?.code);
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    return videoProviderFailure('KlingOmni', 'video response', res.status, raw);
  }

  if (data.code !== undefined && Number(data.code) !== 0) {
    return videoProviderFailure('KlingOmni', 'video request', res.status, data, data.code);
  }

  const directUrl = pickProxyVideoUrl(data);
  if (directUrl) return { video_url: directUrl };

  const taskId =
    data?.data?.task_id ||
    data?.data?.id ||
    data?.task_id ||
    data?.id ||
    data?.data?.task?.id ||
    data?.result?.task_id;
  if (!taskId) {
    return videoProviderFailure('KlingOmni', 'video response', res.status, data);
  }

  const encoded = 'omni:' + String(taskId);
  log.info('[KlingOmni] 已提交', { video_gen_id, task_id: taskId, encoded });
  return { task_id: encoded, status: 'submitted' };
}

function parseKlingOmniPollVideoUrl(data) {
  let u = pickProxyVideoUrl(data);
  if (u) return u;
  const tryPaths = [
    data?.data?.task_result?.videos?.[0]?.url,
    data?.data?.videos?.[0]?.url,
    data?.data?.video_url,
    data?.task_result?.videos?.[0]?.url,
    data?.result?.videos?.[0]?.url,
    data?.output?.video_url,
  ];
  for (const p of tryPaths) {
    if (p && typeof p === 'string') return p;
  }
  return null;
}

/**
 * 调用可灵（Kling AI）视频生成 API（异步任务，返回 task_id）
 * 支持模型：kling-video / kling-omni-video / kling-motion-control
 * 接口：
 *   T2V  → POST /v1/videos/text2video      （无参考图）
 *   I2V  → POST /v1/videos/image2video     （有参考图/首帧）
 *   MC   → POST /v1/videos/motion-control  （kling-motion-control 模型，需首帧图）
 * task_id 编码格式：`t2v:xxx` / `i2v:xxx` / `mc:xxx` 用于轮询时还原正确的查询端点
 * 认证：Authorization: Bearer {api_key}
 */
async function callKlingVideoApi(config, log, opts) {
  const {
    prompt, model, duration, aspect_ratio, image_url,
    files_base_url, storage_local_path, video_gen_id,
  } = opts;

  const base = (config.base_url || 'https://api.klingai.com').replace(/\/$/, '');
  const apiKey = config.api_key || '';
  const headers = {
    'Content-Type': 'application/json',
    Authorization: 'Bearer ' + apiKey,
  };

  const m = model || 'kling-video';
  const isMotionControl = m === 'kling-motion-control';

  // 处理图片 URL（本地路径 → base64 转换）
  let imageInput = null;
  const rawImgUrl = (image_url || '').trim();
  if (rawImgUrl) {
    if (rawImgUrl.startsWith('data:')) {
      imageInput = rawImgUrl;
    } else {
      const local = loadStorageImage(rawImgUrl, storage_local_path);
      imageInput = local
        ? `data:${local.mimeType};base64,${local.buffer.toString('base64')}`
        : rawImgUrl;
    }
  }

  const hasImage = !!imageInput;
  const dur = duration ? Number(duration) : 5;
  const klingDuration = dur <= 5 ? '5' : '10';
  const ratio = normalizeAspectRatioForApi(aspect_ratio) || '16:9';

  // 根据模型类型 & 是否有图片确定端点
  let createEp, taskType;
  if (isMotionControl) {
    createEp = '/v1/videos/motion-control';
    taskType = 'mc';
  } else if (hasImage) {
    createEp = '/v1/videos/image2video';
    taskType = 'i2v';
  } else {
    createEp = '/v1/videos/text2video';
    taskType = 't2v';
  }

  // 允许用户通过 config.endpoint 覆盖默认端点
  if (config.endpoint) {
    createEp = config.endpoint.startsWith('/') ? config.endpoint : '/' + config.endpoint;
  }
  const createUrl = base + createEp;

  let body;
  if (taskType === 'i2v' || taskType === 'mc') {
    body = {
      model: m,
      prompt: prompt || '',
      image: { type: 'url', url: imageInput },
      aspect_ratio: ratio,
      duration: klingDuration,
      cfg_scale: 0.5,
      callback_url: '',
    };
  } else {
    body = {
      model: m,
      prompt: prompt || '',
      aspect_ratio: ratio,
      duration: klingDuration,
      cfg_scale: 0.5,
      mode: 'std',
      callback_url: '',
    };
  }

  log.info('[Kling视频] 发送请求', {
    url: createUrl, model: m, task_type: taskType,
    has_image: hasImage, duration: klingDuration, ratio,
    video_gen_id,
  });
  logVideoPostRequest(log, 'Kling', createUrl, body, video_gen_id, {
    model: m,
    task_type: taskType,
    has_image: hasImage,
    duration: klingDuration,
    ratio,
  });

  const res = await fetchVideoWithTimeout(createUrl, { method: 'POST', headers, body: JSON.stringify(body) });
  const raw = await res.text();
  log.info('[Kling视频] 响应摘要', {
    video_gen_id,
    status: res.status,
    ...summarizeProviderResponse(raw),
  });

  if (!res.ok) {
    return videoProviderFailure('Kling', 'video request', res.status, raw);
  }

  let data;
  try { data = JSON.parse(raw); } catch (e) {
    return videoProviderFailure('Kling', 'video response', res.status, raw);
  }

  if (data.code !== undefined && data.code !== 0) {
    return videoProviderFailure('Kling', 'video request', res.status, data, data.code);
  }

  // 同步返回视频 URL（极少见，兜底）
  const directUrl = data?.data?.task_result?.videos?.[0]?.url;
  if (directUrl) {
    log.info('[Kling视频] 同步返回视频', { video_gen_id });
    return { video_url: directUrl };
  }

  const taskId = data?.data?.task_id;
  if (!taskId) {
    return videoProviderFailure('Kling', 'video response', res.status, data);
  }

  // 在 task_id 中编码任务类型，轮询时用于还原正确的查询端点
  const encodedTaskId = taskType + ':' + taskId;
  log.info('[Kling视频] 任务已提交', { video_gen_id, task_id: taskId, task_type: taskType, encoded_id: encodedTaskId });
  return { task_id: encodedTaskId, status: 'submitted' };
}

module.exports = {
  applyKlingOmniEnvOverrides,
  parseConfigSettingsJson,
  resolveKlingSecretKeyBase64Flag,
  resolveKlingOmniBearerToken,
  logKlingOmniAuthDebug,
  resolveKlingOmniBaseUrl,
  resolveKlingOmniCreatePath,
  resolveKlingOmniQueryPathTemplate,
  isKlingOfficialOmniHost,
  callKlingOmniVideoApi,
  parseKlingOmniPollVideoUrl,
  callKlingVideoApi,
};
