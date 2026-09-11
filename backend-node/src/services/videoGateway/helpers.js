'use strict';

const { AsyncLocalStorage } = require('async_hooks');
const aiConfigService = require('../aiConfigService');
const {
  fetchVideoWithTimeout: runtimeFetchVideoWithTimeout,
} = require('./providerRuntime');
const {
  createSafeProviderLogger,
  sanitizeLogValue,
  toUserFacingGatewayError,
} = require('../providerErrorSanitizer');
const {
  classifyHttpFailure,
  isRequestCanceled,
  isRequestTimeout,
  normalizeProviderRequestError,
  operationCancelledError,
} = require('./requestError');
const pollParse = require('./pollParse');
const {
  extractPollTaskStatus,
  isPollTaskCancelled,
} = pollParse;

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
  const result = { error: toUserFacingGatewayError(error, { provider, operation }) };
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

/** 按 provider 推断协议；显式 api_protocol 优先。 */
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

// 官方火山 API 创建/查询路径：/contents/generations/tasks
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

// 火山模型别名：前端展示名 -> API 模型 ID
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
  isPlausibleHttpVideoUrl: pollParse.isPlausibleHttpVideoUrl,
  coerceHttpVideoUrl: pollParse.coerceHttpVideoUrl,
  extractPollTaskStatus,
  isPollTaskCancelled,
  isPollTaskFailed: pollParse.isPollTaskFailed,
  extractPollFailureMessage: pollParse.extractPollFailureMessage,
  videoUrlFromRecord: pollParse.videoUrlFromRecord,
  videoUrlFromArkVideoNode: pollParse.videoUrlFromArkVideoNode,
  pickVideoUrlFromItemList: pollParse.pickVideoUrlFromItemList,
  pickVideoUrlFromResultShape: pollParse.pickVideoUrlFromResultShape,
  pickProxyVideoUrl: pollParse.pickProxyVideoUrl,
  parseDashScopeVideoUrl: pollParse.parseDashScopeVideoUrl,
  summarizeMediaValueForLog,
  formatVideoPostBodyForLog,
  logVideoPostRequest,
};
