'use strict';

const { AsyncLocalStorage } = require('async_hooks');
const aiConfigService = require('../aiConfigService');
const {
  fetchVideoWithTimeout: runtimeFetchVideoWithTimeout,
} = require('./providerRuntime');
const {
  createSafeProviderLogger,
  sanitizeLogValue,
} = require('../providerErrorSanitizer');
const {
  classifyHttpFailure,
  isRequestCanceled,
  isRequestTimeout,
  normalizeProviderRequestError,
  operationCancelledError,
} = require('./requestError');

const createSafeVideoLogger = createSafeProviderLogger;
const videoRequestContext = new AsyncLocalStorage();

function normalizeIdempotencyKey(value) {
  return String(value || '').trim().slice(0, 200);
}

function fetchVideoWithTimeout(url, options = {}, timeoutMs, networkOptions) {
  const requestContext = videoRequestContext.getStore();
  const idempotencyKey = normalizeIdempotencyKey(requestContext?.idempotencyKey);
  const headers = idempotencyKey
    ? { ...(options.headers || {}), 'Idempotency-Key': idempotencyKey }
    : options.headers;
  return runtimeFetchVideoWithTimeout(
    url,
    { ...options, headers, redirect: 'error' },
    timeoutMs,
    networkOptions || requestContext?.networkOptions || {}
  );
}

function videoProviderFailure(provider, operation, status, responseBody, code) {
  const pollStatus = extractPollTaskStatus(responseBody);
  if (isPollTaskCancelled(pollStatus)) {
    throw operationCancelledError('视频生成已取消');
  }
  const error = classifyHttpFailure({ provider, operation, status, responseBody, code });
  const result = { error };
  if (error.retryable === true) result.retryable = true;
  return result;
}

function videoProviderException(error, provider, operation, signal) {
  const classified = normalizeProviderRequestError(error, { provider, operation, signal });
  if (isRequestCanceled(classified, signal) || isRequestTimeout(classified, signal) || classified.retryable === true) {
    throw classified;
  }
  return classified;
}

/**
 * ?? provider ??????????api_protocol ??????????
 */
function inferVideoProtocol(provider) {
  const p = String(provider || '').toLowerCase();
  if (p === 'minimax' || p === 'hailuo') return 'minimax';
  if (p === 'dashscope') return 'dashscope';
  if (p === 'gemini' || p === 'google') return 'gemini';
  if (p === 'volces' || p === 'volcengine' || p === 'volc') return 'volcengine';
  if (p === 'vidu') return 'vidu';
  if (p === 'ffir') return 'kling_omni';
  if (p === 'kling' || p === 'klingai') return 'kling';
  if (p === 'jimeng_ai_api') return 'jimeng_ai_api';
  if (p === 'xai' || p === 'grok') return 'xai';
  if (p === 'agnes') return 'agnes';
  return 'openai';
}

/**
 * 显式 api_protocol 优先；未配置时推断。
 * Grok / xAI 官方为 prompt + aspect_ratio + GET /v1/videos/{request_id}，与中转站用的 ratio + content 不同。
 */
function resolveVideoProtocol(config, modelHint) {
  const provider = (config.provider || '').toLowerCase();
  const explicit = String(config.api_protocol || '').trim();
  let protocol = explicit.toLowerCase() || inferVideoProtocol(provider);
  const baseLower = String(config.base_url || '').toLowerCase();
  const modelLower = String(modelHint || '').toLowerCase();
  if (!explicit && protocol === 'openai') {
    if (/api\.x\.ai(\/|$)/.test(baseLower)) protocol = 'xai';
    else if (/grok-imagine|grok.*video/.test(modelLower)) protocol = 'xai';
    else if (provider === 'agnes' || /agnes-video|apihub\.agnes-ai\.com/i.test(baseLower)) protocol = 'agnes';
    else if (provider === 'openai' && (/\bsora(?:-|$)/.test(modelLower) || /api\.openai\.com/.test(baseLower))) protocol = 'sora';
  }
  return protocol;
}

/** Omni-Video 文档支持的 aspect_ratio；有参考图时也必须传，否则接口易默认 16:9 */
const KLING_OMNI_ASPECT_RATIOS = new Set(['9:16', '16:9', '1:1', '4:3', '3:4', '3:2', '2:3']);

/**
 * 归一化前端/元数据里的画幅字符串，便于命中可灵枚举（全角冒号、别名等）
 * @returns {string|null} 可灵支持的比值，无法识别时返回 null
 */
function normalizeAspectRatioForApi(raw) {
  if (raw == null) return null;
  let s = String(raw)
    .trim()
    .replace(/\uFF1A/g, ':')
    .replace(/[×xX＊*]/g, ':')
    .replace(/\s+/g, '');
  if (!s) return null;
  const lower = s.toLowerCase();
  const aliases = {
    portrait: '9:16',
    landscape: '16:9',
    square: '1:1',
    vertical: '9:16',
    horizontal: '16:9',
  };
  if (aliases[lower]) s = aliases[lower];
  return KLING_OMNI_ASPECT_RATIOS.has(s) ? s : null;
}

// ?????? API ????? /contents/generations/tasks?base ???????????????
const VOLC_VIDEO_CREATE_PATH = '/contents/generations/tasks';
const VOLC_VIDEO_QUERY_PATH = '/contents/generations/tasks';

function getVolcVideoBase(config) {
  let base = (config.base_url || '').replace(/\/$/, '');
  base = base.replace(/\/(contents|video)\/.*$/i, '');
  return base || 'https://ark.cn-beijing.volces.com/api/v3';
}

/**
 * 非官方火山厂商（中转、自托管等）走 OpenAI/即梦类路径；默认 /video/generations 为旧版中转。
 * volcengine_omni 传入 defaultEndpoint: '/v1/videos/generations' 以对齐方舟文档与 302.ai / jimeng-free-api。
 */
function buildVideoUrl(config, options = {}) {
  const p = (config.provider || '').toLowerCase();
  const isVolc = p === 'volces' || p === 'volcengine' || p === 'volc';
  if (isVolc) return getVolcVideoBase(config) + VOLC_VIDEO_CREATE_PATH;
  const base = (config.base_url || '').replace(/\/$/, '');
  const fallbackEp = options.defaultEndpoint != null ? options.defaultEndpoint : '/video/generations';
  let ep = config.endpoint || fallbackEp;
  if (!ep.startsWith('/')) ep = '/' + ep;
  return base + ep;
}

function buildQueryUrl(config, taskId) {
  const p = (config.provider || '').toLowerCase();
  const proto = resolveVideoProtocol(config);
  const isDashScope = proto === 'dashscope' || p === 'dashscope';
  const isVolc = p === 'volces' || p === 'volcengine' || p === 'volc';
  const isSora = proto === 'sora';
  if (isVolc) return getVolcVideoBase(config) + VOLC_VIDEO_QUERY_PATH + '/' + encodeURIComponent(taskId);
  const base = (config.base_url || '').replace(/\/$/, '');
  let defaultEp;
  if (isSora) defaultEp = '/v1/videos/{taskId}';
  else if (proto === 'xai') defaultEp = '/v1/videos/{taskId}';
  else if (proto === 'veo3') defaultEp = '/v1/video/query?id={taskId}';
  else if (isDashScope) defaultEp = '/api/v1/tasks/{taskId}';
  else if (proto === 'volcengine_omni') defaultEp = '/v1/videos/generations/async/{taskId}';
  else if (proto === 'agnes') defaultEp = '/videos/{taskId}';
  else defaultEp = '/video/task/{taskId}';
  let ep = config.query_endpoint || defaultEp;
  ep = String(ep).replace(/\{taskId\}/gi, encodeURIComponent(taskId)).replace(/\{task_id\}/gi, encodeURIComponent(taskId)).replace(/\{id\}/gi, encodeURIComponent(taskId));
  if (!ep.startsWith('/')) ep = '/' + ep;
  return base + ep;
}

// ????????? ? API ?? ID ???API ????+???????
const VOLC_MODEL_ALIASES = {
  'doubao-seedance-1.0-pro-fast':  'doubao-seedance-1-0-pro-250528',
  'doubao-seedance-1.0-pro':       'doubao-seedance-1-0-pro-250528',
  'doubao-seedance-1-0-pro':       'doubao-seedance-1-0-pro-250528',
  'doubao-seedance-1.0-lite':      'doubao-seedance-1-0-lite-250428',
  'doubao-seedance-1-0-lite':      'doubao-seedance-1-0-lite-250428',
  'doubao-seedance-1.5-pro':       'doubao-seedance-1-5-pro-251215',
  'doubao-seedance-1-5-pro':       'doubao-seedance-1-5-pro-251215',
  'doubao-seedance-2.0-pro':       'doubao-seedance-2-0-260128',
  'doubao-seedance-2-0-pro':       'doubao-seedance-2-0-260128',
  'doubao-seedance-2.0-fast':      'doubao-seedance-2-0-fast-260128',
  'doubao-seedance-2-0-fast':      'doubao-seedance-2-0-fast-260128',
};

function normalizeVolcModel(name) {
  if (!name) return name;
  return VOLC_MODEL_ALIASES[name.toLowerCase()] || name;
}

function getModelFromConfig(config, preferredModel) {
  return aiConfigService.resolveConfiguredModel(config, preferredModel, '');
}

/** 仅把 http(s) 当作可下载直链，避免方舟/中转让 result_url 填入错误文案 */
function isPlausibleHttpVideoUrl(s) {
  if (typeof s !== 'string') return false;
  const t = s.trim();
  return /^https?:\/\//i.test(t);
}

function coerceHttpVideoUrl(s) {
  return isPlausibleHttpVideoUrl(s) ? String(s).trim() : null;
}

/** 轮询 JSON 中的任务状态（兼容中转 data.data.status = FAILURE） */
function extractPollTaskStatus(data) {
  if (!data || typeof data !== 'object') return '';
  const candidates = [
    data.status,
    data.state,
    data.task_status,
    data.data?.status,
    data.data?.state,
    data.data?.task_status,
    data.output?.task_status,
  ];
  for (const c of candidates) {
    if (c != null && String(c).trim() !== '') return String(c).trim().toLowerCase();
  }
  return '';
}

function isPollTaskCancelled(status) {
  return status === 'cancelled' || status === 'canceled' || status === 'cancelled_by_user';
}

function isPollTaskFailed(status) {
  return (
    status === 'failed' ||
    status === 'failure' ||
    status === 'error' ||
    isPollTaskCancelled(status) ||
    status === 'fail'
  );
}

/** 失败时的可读错误（fail_reason、非 http 的 result_url 等） */
function extractPollFailureMessage(data) {
  if (!data || typeof data !== 'object') return '';
  const inner = data.data && typeof data.data === 'object' && !Array.isArray(data.data) ? data.data : null;
  const deep = inner?.data && typeof inner.data === 'object' ? inner.data : null;
  const candidates = [
    inner?.fail_reason,
    data.fail_reason,
    inner?.message,
    deep?.msg,
    data.error?.message,
    typeof data.error === 'string' ? data.error : null,
    data.message,
    typeof data.msg === 'string' ? data.msg : null,
  ];
  for (const c of candidates) {
    if (c == null) continue;
    const s = String(c).trim();
    if (s && !/^https?:\/\//i.test(s)) return s;
  }
  for (const rec of [inner, data]) {
    if (!rec || typeof rec !== 'object') continue;
    for (const k of ['result_url', 'video_url']) {
      const u = rec[k];
      if (typeof u === 'string' && u.trim() && !isPlausibleHttpVideoUrl(u)) return u.trim();
    }
  }
  return '';
}

/** 单层对象上的视频地址：兼容中转站使用 result_url 而非 video_url */
function videoUrlFromRecord(rec) {
  if (!rec || typeof rec !== 'object') return null;
  return (
    coerceHttpVideoUrl(rec.video_url) ||
    coerceHttpVideoUrl(rec.result_url) ||
    coerceHttpVideoUrl(rec.url) ||
    coerceHttpVideoUrl(rec.output_url) ||
    // Agnes Video V2.0 完成态有时将 MP4 直链放在 remixed_from_video_id
    coerceHttpVideoUrl(rec.remixed_from_video_id) ||
    null
  );
}

/** 方舟 / 豆包 Seedance 等：video.transcoded_video.origin.video_url，或 play/download 直链 */
function videoUrlFromArkVideoNode(video) {
  if (!video || typeof video !== 'object') return null;
  const origin =
    video.transcoded_video && typeof video.transcoded_video === 'object' ? video.transcoded_video.origin : null;
  if (origin && typeof origin === 'object' && typeof origin.video_url === 'string') {
    const u = coerceHttpVideoUrl(origin.video_url);
    if (u) return u;
  }
  for (const k of ['download_url', 'play_url', 'url', 'video_url']) {
    const u = coerceHttpVideoUrl(video[k]);
    if (u) return u;
  }
  return null;
}

/** 查询结果里 item_list[0] 形态（与中转站 videos 控制器一致） */
function pickVideoUrlFromItemList(list) {
  if (!Array.isArray(list) || !list.length) return null;
  const item = list[0];
  if (!item || typeof item !== 'object') return null;
  const ca = item.common_attr;
  const fromCommon =
    ca &&
    ca.transcoded_video &&
    typeof ca.transcoded_video === 'object' &&
    ca.transcoded_video.origin &&
    typeof ca.transcoded_video.origin.video_url === 'string' &&
    ca.transcoded_video.origin.video_url.trim()
      ? ca.transcoded_video.origin.video_url.trim()
      : null;
  const fromVideo = videoUrlFromArkVideoNode(item.video);
  const fromResult = coerceHttpVideoUrl(item.result_url);
  const flat = videoUrlFromRecord(item);
  return fromCommon || fromVideo || fromResult || flat || null;
}

/**
 * 方舟类「任务查询」里常见：result 本体无 video_url，而在 result.content.video_url
 */
function pickVideoUrlFromResultShape(obj) {
  if (!obj || typeof obj !== 'object') return null;
  let x = videoUrlFromRecord(obj);
  if (x) return typeof x === 'string' ? x.trim() : x;
  const inner = obj.content;
  if (inner && typeof inner === 'object') {
    x = videoUrlFromRecord(inner);
    if (x) return typeof x === 'string' ? x.trim() : x;
    const il = pickVideoUrlFromItemList(inner.item_list);
    if (il) return il;
    if (inner.video && typeof inner.video === 'object') {
      const v = videoUrlFromArkVideoNode(inner.video) || inner.video.url || inner.video.video_url;
      if (v && typeof v === 'string') return v.trim();
    }
  }
  return null;
}

/**
 * OpenAI/Veo/Sora 类中转 JSON 中解析直链（含各层 result_url）
 */
function pickProxyVideoUrl(data) {
  if (!data || typeof data !== 'object') return null;
  const topList = pickVideoUrlFromItemList(data.item_list);
  if (topList) return topList;
  if (data.video && typeof data.video === 'object') {
    const vu =
      videoUrlFromArkVideoNode(data.video) ||
      coerceHttpVideoUrl(data.video.url) ||
      coerceHttpVideoUrl(data.video.video_url);
    if (vu) return vu;
  }
  let u = videoUrlFromRecord(data);
  if (u) return u;
  const d = data.data;
  if (d && typeof d === 'object' && !Array.isArray(d)) {
    const nestedList = pickVideoUrlFromItemList(d.item_list);
    if (nestedList) return nestedList;
    u = videoUrlFromRecord(d);
    if (u) return u;
    if (d.video && typeof d.video === 'object') {
      const dv =
        videoUrlFromArkVideoNode(d.video) ||
        coerceHttpVideoUrl(d.video.url) ||
        coerceHttpVideoUrl(d.video.video_url);
      if (dv) return dv;
    }
    if (d.result && typeof d.result === 'object') {
      const dr = pickVideoUrlFromResultShape(d.result);
      if (dr) return dr;
    }
  }
  const r = data.result;
  if (r && typeof r === 'object') {
    const pr = pickVideoUrlFromResultShape(r);
    if (pr) return pr;
  }
  const c = data.content;
  if (c && typeof c === 'object') {
    const cl = pickVideoUrlFromItemList(c.item_list);
    if (cl) return cl;
    u = videoUrlFromRecord(c);
    if (u) return u;
    if (c.video && typeof c.video === 'object') {
      const cv =
        videoUrlFromArkVideoNode(c.video) ||
        coerceHttpVideoUrl(c.video.url) ||
        coerceHttpVideoUrl(c.video.video_url);
      if (cv) return cv;
    }
  }
  for (const k of ['videos', 'generations', 'works']) {
    const arr = data[k];
    if (Array.isArray(arr) && arr[0]) {
      u = videoUrlFromRecord(arr[0]);
      if (u) return u;
      const res = arr[0].resource;
      if (res && res.resource) return res.resource;
    }
  }
  if (Array.isArray(d) && d[0]) {
    u = videoUrlFromRecord(d[0]);
    if (u) return u;
  }
  return null;
}

// ? DashScope ?????????? URL
function parseDashScopeVideoUrl(data) {
  const out = data?.output;
  if (!out) return null;
  let u = videoUrlFromRecord(out);
  if (u) return u;
  if (out.output && typeof out.output === 'object') {
    u = videoUrlFromRecord(out.output);
    if (u) return u;
  }
  const results = out.results || out.result;
  if (Array.isArray(results) && results[0]) {
    const rec = results[0];
    u = videoUrlFromRecord(rec);
    if (u) return u;
    if (rec.output && typeof rec.output === 'object') {
      u = videoUrlFromRecord(rec.output);
      if (u) return u;
    }
  }
  const choices = out.choices;
  if (Array.isArray(choices) && choices[0]) {
    const c = choices[0];
    const msg = c?.message?.content || c?.content;
    if (Array.isArray(msg)) {
      for (const m of msg) {
        if (m) {
          u = videoUrlFromRecord(m);
          if (u) return u;
        }
      }
    }
  }
  return null;
}

function summarizeMediaValueForLog(value) {
  if (value == null) return value;
  const s = String(value);
  if (s.startsWith('data:')) return `(base64, ${s.length} chars)`;
  return sanitizeLogValue(s, 'media_url');
}

/** 格式化视频 POST JSON 请求体，便于日志排查参考图/关键帧策略 */
function formatVideoPostBodyForLog(body) {
  if (!body || typeof body !== 'object') return body;
  const clone = JSON.parse(JSON.stringify(body));

  if (Array.isArray(clone.extra_body?.image)) {
    clone.extra_body.image = clone.extra_body.image.map((url, i) => `[${i}] ${summarizeMediaValueForLog(url)}`);
  }
  if (typeof clone.image === 'string') {
    clone.image = summarizeMediaValueForLog(clone.image);
  }
  if (clone.image && typeof clone.image === 'object' && clone.image.url) {
    clone.image = { ...clone.image, url: summarizeMediaValueForLog(clone.image.url) };
  }
  if (Array.isArray(clone.images)) {
    clone.images = clone.images.map((u, i) => `[${i}] ${summarizeMediaValueForLog(u)}`);
  }
  if (Array.isArray(clone.image_list)) {
    clone.image_list = clone.image_list.map((item, i) => {
      const out = { ...item, index: i };
      if (out.url) out.url = summarizeMediaValueForLog(out.url);
      if (out.image) out.image = summarizeMediaValueForLog(out.image);
      if (out.image_url) out.image_url = summarizeMediaValueForLog(out.image_url);
      return out;
    });
  }
  if (Array.isArray(clone.content)) {
    clone.content = clone.content.map((part) => {
      if (part?.type === 'text' && typeof part.text === 'string') {
        return {
          ...part,
          text: `[REDACTED_PROMPT length=${part.text.length}]`,
        };
      }
      if (part?.type === 'image_url' && part.image_url?.url) {
        return {
          ...part,
          image_url: { ...part.image_url, url: summarizeMediaValueForLog(part.image_url.url) },
        };
      }
      if (part?.image_url && typeof part.image_url === 'string') {
        return { ...part, image_url: summarizeMediaValueForLog(part.image_url) };
      }
      return part;
    });
  }
  const sanitized = sanitizeLogValue(clone);
  if (clone.extra_body && typeof clone.extra_body === 'object' && !Array.isArray(clone.extra_body)) {
    sanitized.extra_body = Object.fromEntries(
      Object.entries(clone.extra_body).map(([key, value]) => [key, sanitizeLogValue(value, key)])
    );
  }
  return sanitized;
}

function logVideoPostRequest(log, provider, url, body, video_gen_id, meta = {}) {
  const formatted = formatVideoPostBodyForLog(body);
  log.info(`[${provider}] Video POST 摘要`, { video_gen_id, url, ...meta });
  log.info(`[${provider}] Video POST 请求体`, {
    video_gen_id,
    post_body: JSON.stringify(formatted, null, 2),
  });
}

module.exports = {
  createSafeVideoLogger,
  videoRequestContext,
  normalizeIdempotencyKey,
  fetchVideoWithTimeout,
  videoProviderFailure,
  videoProviderException,
  inferVideoProtocol,
  resolveVideoProtocol,
  KLING_OMNI_ASPECT_RATIOS,
  normalizeAspectRatioForApi,
  getVolcVideoBase,
  buildVideoUrl,
  buildQueryUrl,
  normalizeVolcModel,
  getModelFromConfig,
  isPlausibleHttpVideoUrl,
  coerceHttpVideoUrl,
  extractPollTaskStatus,
  isPollTaskCancelled,
  isPollTaskFailed,
  extractPollFailureMessage,
  videoUrlFromRecord,
  videoUrlFromArkVideoNode,
  pickVideoUrlFromItemList,
  pickVideoUrlFromResultShape,
  pickProxyVideoUrl,
  parseDashScopeVideoUrl,
  summarizeMediaValueForLog,
  formatVideoPostBodyForLog,
  logVideoPostRequest,
};
