'use strict';

const { isSensitiveFieldKey } = require('./sensitiveFieldPolicy');

const MAX_LOG_STRING_CHARS = 2000;
const MAX_LOG_ARRAY_ITEMS = 20;
const MAX_LOG_OBJECT_KEYS = 50;
const MAX_LOG_DEPTH = 6;
const MAX_LOG_ARGUMENT_CHARS = 8000;
const SAFE_LOGGER = Symbol.for('localMiniDrama.safeProviderLogger');
const SAFE_PROVIDER_ERROR = Symbol.for('localMiniDrama.safeProviderError');

function normalizeKey(key) {
  return String(key || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[-\s]+/g, '_')
    .toLowerCase();
}

function byteLength(value) {
  if (value == null) return 0;
  if (Buffer.isBuffer(value)) return value.length;
  if (typeof value === 'string') return Buffer.byteLength(value);
  try {
    return Buffer.byteLength(JSON.stringify(value));
  } catch (_) {
    return 0;
  }
}

const OPERATION_LABELS = Object.freeze({
  request: '请求',
  'image request': '图片请求',
  'image generation': '图片生成',
  'image response': '图片响应',
  'image task': '图片任务',
  'image stream': '图片流',
  'video request': '视频请求',
  'video generation': '视频生成',
  'video response': '视频响应',
  'video task': '视频任务',
  'video task response': '视频任务响应',
  tts: '配音',
  speech: '配音',
  'tts request': '配音请求',
  'audio speech': '配音',
  // ModelArk / 即梦资产库 OpenAPI Action，避免把英文 Action 原样拼进用户文案。
  ListAssetGroups: '列出资产组',
  CreateAssetGroup: '创建资产组',
  UpdateAssetGroup: '更新资产组',
  DeleteAssetGroup: '删除资产组',
  ListAssets: '列出资产',
  CreateAsset: '创建资产',
  UpdateAsset: '更新资产',
  DeleteAsset: '删除资产',
  GetAsset: '查询资产',
  GetAssetGroup: '查询资产组',
});

const PROVIDER_LABELS = Object.freeze({
  Provider: '厂商',
  provider: '厂商',
  'Video provider': '视频服务',
  'video provider': '视频服务',
  Video: '视频服务',
  video: '视频服务',
  'Image provider': '图片服务',
  'image provider': '图片服务',
  Image: '图片服务',
  image: '图片服务',
  'Jimeng material hub': '即梦素材库',
  TTS: 'TTS',
  MiniMax: 'MiniMax',
  OpenAI: 'OpenAI',
});

// 产品允许品牌名保留英文；连续两个未允许拉丁词视为不可信。
const ALLOWED_LATIN_TOKEN_RE = /^(?:ffmpeg|libx264|tesseract|comfyui|openai|ollama|minimax|seedance|kling|gemini|sora|dashscope|volcengine|vidu|agnes|jimeng|wikimedia|commons|openverse|http|https|json|pdf|txt|zip|api|tts|ocr|url|jwt|bearer|sqlite|modelark)$/i;
const MIXED_TECHNICAL_ENGLISH_RE = /invalid api key|incorrect api key|invalid\s*authorization|invalidauthorization|invalid\s+token|this model does not support|image generation did not complete|video generation did not complete|model is overloaded|retry later|request failed with status code/i;
const AUTH_FAILURE_RE = /invalid\s*authorization|invalidauthorization|\bunauthorized\b|invalid\s+(?:api\s+)?key|invalid\s+token|authentication(?:\s+\w+){0,3}\s+(?:rejected|failed)|authorization\s+is\s+not\s+active|\b(?:AUTH_DENIED|ACCESS_DENIED|INVALID_AUTH)\b/i;
const SCREAMING_ERROR_CODE_RE = /\b[A-Z]{3,}(?:_[A-Z0-9]+){1,}\b/;
const GENERIC_PROVIDER_ALIAS_RE = /\b(?:image|video)(?:\s+provider)?\b/i;

function safeLabel(value, fallback) {
  const label = String(value || '').trim();
  return /^[A-Za-z0-9\u4e00-\u9fff][A-Za-z0-9\u4e00-\u9fff ._/-]{0,63}$/.test(label) ? label : fallback;
}

function defaultProviderLabel(operation) {
  const op = String(operation || '').toLowerCase();
  if (op.includes('video') || op.includes('视频')) return '视频服务';
  if (op.includes('image') || op.includes('图片') || op.includes('视觉')) return '图片服务';
  return '厂商';
}

function labeledProvider(value, operation) {
  const raw = String(value || '').trim();
  if (!raw) return defaultProviderLabel(operation);
  if (PROVIDER_LABELS[raw]) return PROVIDER_LABELS[raw];
  const lower = raw.toLowerCase();
  for (const [key, label] of Object.entries(PROVIDER_LABELS)) {
    if (key.toLowerCase() === lower) return label;
  }
  return safeLabel(raw, defaultProviderLabel(operation));
}

function hasUntrustedEnglishRun(text) {
  const words = String(text).match(/[A-Za-z][A-Za-z0-9+.-]{3,}/g) || [];
  let run = 0;
  for (const word of words) {
    if (ALLOWED_LATIN_TOKEN_RE.test(word)) {
      run = 0;
      continue;
    }
    run += 1;
    if (run >= 2) return true;
  }
  return false;
}

function labeledOperation(value) {
  const raw = String(value || '').trim();
  if (!raw) return '请求';
  return OPERATION_LABELS[raw] || OPERATION_LABELS[raw.toLowerCase()] || safeLabel(raw, '请求');
}

function sanitizeUrl(value) {
  const raw = String(value || '');
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return raw;
    const queryMarker = parsed.search ? '?[REDACTED]' : '';
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}${queryMarker}`;
  } catch (_) {
    return raw;
  }
}

function replaceUrls(value) {
  return value.replace(/https?:\/\/[^\s"'<>\\]+/gi, (url) => sanitizeUrl(url));
}

function sanitizeProviderText(value, secrets = []) {
  // 连接测试等同场景：按已知密钥清洗厂商回显，避免合成密钥进入日志。
  let text = String(value || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
  for (const secret of secrets) {
    const token = String(secret || '');
    if (!token) continue;
    text = text.split(token).join('********');
  }
  text = text
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer ********')
    .replace(/((?:api[-_]?key|access[-_]?token|token|secret|authorization)["'\s:=]+)[^\s,"'}]+/gi, '$1********')
    .replace(/https?:\/\/[^\s"']+/gi, (rawUrl) => {
      try {
        const parsed = new URL(rawUrl);
        return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
      } catch (_) {
        return '[redacted-url]';
      }
    });
  return text.slice(0, 300);
}

function sanitizeString(value) {
  const raw = String(value);
  if (/^data:/i.test(raw)) return `[REDACTED_DATA_URL length=${raw.length}]`;

  let sanitized = raw
    .replace(/\b(Authorization\s*[:=]\s*)(?:Bearer|Basic)?\s*[^\s,;"'}\]]+/gi, '$1[REDACTED]')
    .replace(/\b(Bearer|Basic|Token)\s+[^\s,;"'}\]]+/gi, '$1 [REDACTED]')
    .replace(/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{6,}\b/g, '[REDACTED_API_KEY]')
    .replace(/\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED_JWT]')
    .replace(/\b((?:api[_-]?key|access[_-]?token|secret(?:[_-]?key)?|password)\s*[:=]\s*)[^\s,;"'}\]]+/gi, '$1[REDACTED]')
    .replace(/([?&](?:api[_-]?key|access[_-]?token|token|signature|sig|x-amz-[^=]*signature)=)[^&#\s"']+/gi, '$1[REDACTED]');
  sanitized = replaceUrls(sanitized);
  if (sanitized.length > MAX_LOG_STRING_CHARS) {
    return `${sanitized.slice(0, MAX_LOG_STRING_CHARS)}... [TRUNCATED length=${sanitized.length}]`;
  }
  return sanitized;
}

function safeProviderCode(value) {
  if (value == null || value === '') return null;
  const code = String(value).trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,79}$/.test(code)) return null;
  if (/^(?:https?|data):/i.test(code)) return null;
  return code;
}

function parseJsonBody(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'object' && !Buffer.isBuffer(value)) return value;
  const text = Buffer.isBuffer(value) ? value.toString('utf8') : String(value);
  try {
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}

function extractProviderCode(value) {
  const data = parseJsonBody(value);
  if (!data || typeof data !== 'object') return null;
  const candidates = [
    data.code,
    data.error_code,
    data.err_code,
    data.status_code,
    data.error?.code,
    data.error?.error_code,
    data.output?.code,
  ];
  for (const candidate of candidates) {
    const code = safeProviderCode(candidate);
    if (code) return code;
  }
  return null;
}

function extractProviderCodeFromMessage(value) {
  const match = String(value?.message || value || '').match(
    /(?:^|[;(]\s*)code\s+([A-Za-z0-9][A-Za-z0-9_.:/-]{0,79})(?=\s*(?:;|\)|$))/i
  );
  return safeProviderCode(match?.[1]);
}

function extractHttpStatus(value) {
  if (value && typeof value === 'object') {
    for (const candidate of [value.status, value.statusCode, value.httpStatus, value.http_status, value.response?.status]) {
      const status = Number(candidate);
      if (Number.isInteger(status) && status >= 100 && status <= 599) return status;
    }
  }
  const match = String(value?.message || value || '').match(/\bHTTP\s*[:=]?\s*(\d{3})\b/i)
    || String(value?.message || value || '').match(/(?:^|\D)([1-5]\d{2})(?:\D|$)/);
  return match ? Number(match[1]) : null;
}

function summarizeProviderResponse(value) {
  const responseBytes = byteLength(value);
  if (value == null || responseBytes === 0) {
    return { response_format: 'empty', response_bytes: 0 };
  }

  const parsed = parseJsonBody(value);
  if (parsed == null) {
    return {
      redacted: '[REDACTED_PROVIDER_RESPONSE]',
      response_format: 'non_json',
      response_bytes: responseBytes,
    };
  }

  const summary = {
    redacted: '[REDACTED_PROVIDER_RESPONSE]',
    response_format: 'json',
    response_bytes: responseBytes,
  };
  const providerCode = extractProviderCode(parsed);
  if (providerCode) summary.provider_code = providerCode;
  if (Array.isArray(parsed)) {
    summary.response_item_count = parsed.length;
  } else if (parsed && typeof parsed === 'object') {
    const keys = Object.keys(parsed);
    summary.response_key_count = keys.length;
    summary.response_keys = keys.slice(0, 20);
  }
  return summary;
}

function stringifyErrorText(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Error) {
    return [value.message, value.name, value.code, value.providerCode].filter(Boolean).join(' ');
  }
  try {
    return JSON.stringify(value);
  } catch (_) {
    return String(value);
  }
}

function looksLikeAuthFailure(...values) {
  return values.some((value) => AUTH_FAILURE_RE.test(stringifyErrorText(value)));
}

function userFacingHttpStatus(options = {}) {
  if (looksLikeAuthFailure(
    options.code,
    options.responseBody,
    options.responseData,
    options.message,
    options.status,
  )) {
    return 401;
  }
  return extractHttpStatus(options.status);
}

function statusAction(status, responseFormat) {
  if (status === 400 || status === 422) return '请求被拒绝，请检查所选模型和参数';
  if (status === 401) return '认证失败，请检查厂商密钥';
  if (status === 403) return '请求被禁止，请检查权限和内容安全策略';
  if (status === 404) return '未找到接口、模型或任务，请检查厂商配置';
  if (status === 408) return '厂商请求超时，请稍后重试';
  if (status === 409) return '厂商报告请求冲突，请重新发起请求';
  if (status === 429) return '厂商限流或配额不足，请稍后重试';
  if (status >= 500) return '厂商暂时不可用，请稍后重试';
  if (responseFormat === 'non_json') return '厂商返回了无法解析的错误';
  return '厂商返回错误，请检查配置后重试';
}

function buildProviderErrorMessage(options = {}) {
  const provider = labeledProvider(options.provider, options.operation);
  const operation = labeledOperation(options.operation);
  const status = userFacingHttpStatus(options);
  const responseValue = options.responseBody !== undefined
    ? options.responseBody
    : options.responseData;
  const summary = summarizeProviderResponse(responseValue);
  return `${provider} ${operation}失败：${statusAction(status, summary.response_format)}。`;
}

function createProviderHttpError(options = {}) {
  const status = extractHttpStatus(options.status);
  const providerCode = safeProviderCode(options.code)
    || extractProviderCode(options.responseBody ?? options.responseData);
  const error = new Error(buildProviderErrorMessage({ ...options, status, code: providerCode }));
  error.name = 'ProviderError';
  if (status) error.status = status;
  if (providerCode) error.providerCode = providerCode;
  error.responseBytes = byteLength(options.responseBody ?? options.responseData);
  Object.defineProperty(error, SAFE_PROVIDER_ERROR, { value: true });
  return error;
}

function isUnsafeMediaError(error) {
  return error?.code === 'UNSAFE_MEDIA_REFERENCE'
    || error?.name === 'UnsafeMediaReferenceError';
}

function isCancelLikeError(error) {
  if (!error || typeof error !== 'object' || isTimeoutLikeError(error)) return false;
  const name = String(error.name || '');
  const code = String(error.code || '');
  return name === 'AbortError'
    || name === 'CanceledError'
    || code === 'OPERATION_CANCELLED'
    || code === 'ERR_CANCELED'
    || code === 'ABORT_ERR';
}

function isNetworkLikeError(error, errorCode) {
  const code = String(errorCode || error?.code || '');
  if (/^(?:ERR_NETWORK|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ENETUNREACH|ENOTFOUND|EPIPE)$/i.test(code)) return true;
  return /network error|failed to fetch|fetch failed|load failed|socket hang up|ECONNREFUSED|ENOTFOUND/i.test(`${code} ${error?.message || error || ''}`);
}

function cancelProviderError(error) {
  const raw = String(error?.message || '').trim();
  const safeError = new Error(isTrustedChineseUserError(raw) ? raw : '操作已取消');
  safeError.name = 'AbortError';
  safeError.code = 'OPERATION_CANCELLED';
  safeError.retryable = false;
  if (error instanceof Error) safeError.cause = error;
  Object.defineProperty(safeError, SAFE_PROVIDER_ERROR, { value: true });
  return safeError;
}

function sanitizeProviderException(error, options = {}) {
  if (isUnsafeMediaError(error) || error?.[SAFE_PROVIDER_ERROR]) return error;
  if (isCancelLikeError(error)) return cancelProviderError(error);
  const status = extractHttpStatus(error) || extractHttpStatus(options.status);
  const errorCode = safeProviderCode(error?.providerCode)
    || safeProviderCode(error?.code)
    || safeProviderCode(options.code);
  const responseBody = options.responseBody
    ?? error?.response?.data
    ?? error?.response?.body;
  const safeError = createProviderHttpError({
    ...options,
    status,
    code: errorCode,
    responseBody,
    message: error?.message,
  });
  if (error?.retryable === true) safeError.retryable = true;
  if (isTimeoutLikeError(error) || /(?:^|_)TIME(?:D)?OUT$/i.test(errorCode || '')) {
    safeError.message = `${labeledProvider(options.provider, options.operation)} ${labeledOperation(options.operation)}超时，请稍后重试。`;
    safeError.retryable = true;
  } else if (isNetworkLikeError(error, errorCode)) {
    safeError.message = `${labeledProvider(options.provider, options.operation)} ${labeledOperation(options.operation)}网络连接失败，请检查网络后重试。`;
    safeError.retryable = true;
  }
  return safeError;
}

function isTimeoutLikeError(error, raw) {
  if (error?.isTimeout === true || error?.name === 'TimeoutError') return true;
  const code = String(error?.code || '');
  if (/(?:^|_)TIME(?:D)?OUT$/i.test(code) || code === 'ETIMEDOUT' || code === 'ECONNABORTED') return true;
  // 中文「超时」也要认，避免 AbortError + 超时文案被当成取消。
  return /timeout after|silence timeout|timed?\s*out|请求超时|超时/i.test(String(raw || error?.message || ''));
}

function isUserFacingAbort(error, signal) {
  if (isTimeoutLikeError(error, error && error.message) || isTimeoutLikeError(signal && signal.reason) || error?.isTimeout === true) {
    return false;
  }
  if (isCancelLikeError(error)) return true;
  return signal?.aborted === true;
}

function toSafeProviderErrorMessage(error, options = {}) {
  if (error?.[SAFE_PROVIDER_ERROR] && isTrustedChineseUserError(error.message)) {
    return error.message;
  }
  if (isUnsafeMediaError(error)) {
    const raw = sanitizeString(error.message || '媒体引用不安全');
    return isTrustedChineseUserError(raw) ? raw : '媒体引用不安全，请检查地址后重试';
  }
  const source = typeof error === 'string' ? error : error?.message || error;
  if (isTimeoutLikeError(error, source)) {
    return `${labeledProvider(options.provider, options.operation)} ${labeledOperation(options.operation)}超时，请稍后重试。`;
  }
  if (isCancelLikeError(error)) {
    const raw = String(error?.message || '').trim();
    return isTrustedChineseUserError(raw) ? raw : '操作已取消';
  }
  if (isNetworkLikeError(error, error?.code) || isNetworkLikeError(source)) {
    return `${labeledProvider(options.provider, options.operation)} ${labeledOperation(options.operation)}网络连接失败，请检查网络后重试。`;
  }
  const status = extractHttpStatus(error) || extractHttpStatus(source) || extractHttpStatus(options.status);
  const code = safeProviderCode(error?.providerCode)
    || safeProviderCode(error?.code)
    || safeProviderCode(options.code)
    || extractProviderCode(source)
    || extractProviderCodeFromMessage(source);
  return buildProviderErrorMessage({
    ...options,
    status,
    code,
    message: typeof source === 'string' ? source : error?.message,
    responseBody: options.responseBody !== undefined ? options.responseBody : source,
  });
}

function toUserFacingGatewayError(error, options = {}) {
  if (typeof error === 'string') {
    const text = error.trim();
    if (isTrustedChineseUserError(text)) return text;
    return toSafeProviderErrorMessage(error, options);
  }
  if (error && typeof error.message === 'string' && isTrustedChineseUserError(error.message)) {
    return error.message;
  }
  return toSafeProviderErrorMessage(error, options);
}

function providerFailure(options = {}) {
  return { error: buildProviderErrorMessage(options) };
}

function isTrustedChineseUserError(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || text.length > 240) return false;
  if (!/[\u4e00-\u9fff]/.test(text)) return false;
  if (/https?:\/\//i.test(text) || /response_bytes=|\bHTTP\s*[:=]?\s*\d{3}\b/i.test(text)) return false;
  if (looksLikeAuthFailure(text) || SCREAMING_ERROR_CODE_RE.test(text)) return false;
  if (/\/(?:v\d+|api|models)\b/i.test(text)) return false;
  if (/\bcode\s+[A-Za-z0-9_.:/-]+/i.test(text)) return false;
  if (/\bsk-[A-Za-z0-9._-]{6,}\b/i.test(text)) return false;
  if (/\b(Bearer|Basic)\s+/i.test(text)) return false;
  if (/\b(unauthorized|forbidden|not found|bad request|internal server error|too many requests|service unavailable|gateway timeout|timed?\s*out|network error|failed to fetch|fetch failed|load failed|typeerror|referenceerror|aborted)\b/i.test(text)) {
    return false;
  }
  if (MIXED_TECHNICAL_ENGLISH_RE.test(text)) return false;
  if (/\b(ECONNREFUSED|ENOTFOUND|ECONNRESET|ETIMEDOUT|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|EPROTO|ENOENT|EACCES|EPERM|EPIPE|ENOSPC|SQLITE_[A-Z0-9]+|getaddrinfo|socket hang up)\b/i.test(text)) {
    return false;
  }
  if (/\bat\s+[A-Za-z_$][\w.$]*\s*\([^)]*:\d+:\d+\)/.test(text)) return false;
  if (/[A-Za-z][A-Za-z0-9]*_[A-Za-z0-9_]+/.test(text)) return false;
  if (/^[A-Za-z][A-Za-z0-9_]*\s*不能为空/.test(text)) return false;
  if (/不支持的\s+[A-Za-z_]+/.test(text)) return false;
  if (GENERIC_PROVIDER_ALIAS_RE.test(text)) return false;
  if (hasUntrustedEnglishRun(text)) return false;
  return true;
}

function isSqliteLikeError(error, raw) {
  const text = `${error && error.code || ''} ${raw || ''}`;
  return /\bSQLITE_[A-Z0-9]+\b/i.test(text)
    || /\bno such table\b/i.test(text)
    || /\bdatabase is locked\b/i.test(text);
}

function toUserFacingProcessError(error, fallback = '处理失败，请稍后重试') {
  const raw = typeof error === 'string' ? error.trim() : String(error?.message || '').trim();
  if (isTimeoutLikeError(error, raw)) {
    return isTrustedChineseUserError(raw) ? raw : '请求超时，请稍后重试';
  }
  if (isUserFacingAbort(error)) {
    return isTrustedChineseUserError(raw) ? raw : '操作已取消';
  }
  if (isSqliteLikeError(error, raw)) return fallback;
  if (error?.[SAFE_PROVIDER_ERROR]) {
    return isTrustedChineseUserError(raw) ? raw : toSafeProviderErrorMessage(error);
  }
  if (isTrustedChineseUserError(raw)) return raw;
  if (isUnsafeMediaError(error)) {
    return toSafeProviderErrorMessage(error, { provider: '本地合成', operation: '视频后处理' });
  }
  return fallback;
}

function toVisionExtractUserError(error) {
  const raw = String((error && error.message) || error || '');
  const fallback = /image|vision|visual|multimodal/i.test(raw)
    ? '当前模型不支持图片识别，请在「AI 配置」中改用支持视觉的模型后重试'
    : '从图片提取描述失败，请稍后重试';
  return toUserFacingProcessError(error, fallback);
}

function sanitizeProviderResult(result, options = {}) {
  if (!result || typeof result !== 'object' || !result.error) return result;
  if (isTrustedChineseUserError(result.error)) return result;
  return {
    ...result,
    error: toSafeProviderErrorMessage(result.error, options),
  };
}

function isLengthOnlyKey(key) {
  return /(?:_len|_length|_chars|_count|_bytes|_size|_ms|_kb|_mb)$/.test(normalizeKey(key));
}

function isSecretKey(key) {
  if (!key || isLengthOnlyKey(key)) return false;
  return isSensitiveFieldKey(key);
}

function isPromptKey(key) {
  if (!key || isLengthOnlyKey(key)) return false;
  return /(?:^|_)(?:prompt|negative_prompt|text_prompt)(?:$|_)/.test(normalizeKey(key));
}

function isUrlKey(key) {
  return /(?:^|_)(?:url|uri)(?:$|_)/.test(normalizeKey(key));
}

function isOpaqueProviderKey(key) {
  if (!key || isLengthOnlyKey(key)) return false;
  return /(?:^|_)(?:raw|body|response|data|output|result|preview)(?:$|_)/.test(normalizeKey(key));
}

function isErrorTextKey(key) {
  if (!key || isLengthOnlyKey(key)) return false;
  return /(?:^|_)(?:error|message|msg|error_hint)(?:$|_)/.test(normalizeKey(key));
}

function summarizeUntrustedError(value) {
  const status = extractHttpStatus(value);
  const code = extractProviderCode(value);
  const summary = {
    redacted: '[REDACTED_PROVIDER_ERROR]',
    error_length: String(value?.message || value || '').length,
  };
  if (status) summary.http_status = status;
  if (code) summary.provider_code = code;
  return summary;
}

function sanitizeLogValue(value, key = '', depth = 0, seen = new WeakSet()) {
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function' || typeof value === 'symbol') return `[${typeof value}]`;

  if (isSecretKey(key)) return '[REDACTED]';
  if (isPromptKey(key)) {
    return `[REDACTED_PROMPT length=${typeof value === 'string' ? value.length : byteLength(value)}]`;
  }
  if (isOpaqueProviderKey(key)) return summarizeProviderResponse(value);
  if (isErrorTextKey(key)) return summarizeUntrustedError(value);

  if (typeof value === 'string') {
    return isUrlKey(key) ? sanitizeUrl(value) : sanitizeString(value);
  }
  if (value instanceof Error) return summarizeUntrustedError(value);
  if (depth >= MAX_LOG_DEPTH) return '[TRUNCATED_DEPTH]';
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);

  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_LOG_ARRAY_ITEMS)
      .map((item) => sanitizeLogValue(item, key, depth + 1, seen));
    if (value.length > MAX_LOG_ARRAY_ITEMS) {
      items.push(`[TRUNCATED ${value.length - MAX_LOG_ARRAY_ITEMS} items]`);
    }
    return items;
  }

  const result = {};
  const entries = Object.entries(value);
  for (const [entryKey, entryValue] of entries.slice(0, MAX_LOG_OBJECT_KEYS)) {
    result[entryKey] = sanitizeLogValue(entryValue, entryKey, depth + 1, seen);
  }
  if (entries.length > MAX_LOG_OBJECT_KEYS) result._truncated_keys = entries.length - MAX_LOG_OBJECT_KEYS;
  return result;
}

function createSafeProviderLogger(log) {
  if (log?.[SAFE_LOGGER]) return log;
  const target = log || {};
  const safeLog = {};
  for (const level of ['debug', 'info', 'warn', 'error']) {
    safeLog[level] = (...args) => {
      if (typeof target[level] !== 'function') return undefined;
      const safeArgs = args.map((arg, index) => {
        const safe = sanitizeLogValue(arg, index === 0 ? 'log_message' : 'meta');
        if (typeof safe === 'string') return safe;
        const serialized = JSON.stringify(safe);
        if (!serialized || serialized.length <= MAX_LOG_ARGUMENT_CHARS) return safe;
        return {
          redacted: '[REDACTED_OVERSIZED_LOG_ARGUMENT]',
          argument_bytes: Buffer.byteLength(serialized),
        };
      });
      return target[level].apply(target, safeArgs);
    };
  }
  Object.defineProperty(safeLog, SAFE_LOGGER, { value: true });
  return safeLog;
}


const TTS_HTTP_MESSAGES = Object.freeze({
  400: '配音参数无效，请检查「AI 配置」后重试',
  401: 'TTS 认证失败，请检查「AI 配置」中的密钥后重试',
  403: 'TTS 认证失败，请检查「AI 配置」中的密钥后重试',
  404: 'TTS 接口不存在，请检查「AI 配置」后重试',
  408: '配音生成繁忙，请稍后重试',
  429: '配音生成繁忙，请稍后重试',
});

function ttsHttpFailureMessage(status) {
  const code = Number(status);
  if (TTS_HTTP_MESSAGES[code]) return TTS_HTTP_MESSAGES[code];
  return '配音生成失败，请稍后重试';
}

function ttsBusinessFailureMessage(providerCode) {
  const code = Number(providerCode);
  if (code === 1001) return '配音生成超时，请稍后重试';
  if (code === 1002) return '配音生成繁忙，请稍后重试';
  if (code === 1004 || code === 1008 || code === 2049) return ttsHttpFailureMessage(401);
  return '配音生成失败，请稍后重试';
}

function toUserFacingTtsMessage(error, options = {}) {
  const raw = typeof error === 'string' ? String(error).trim() : String(error?.message || '').trim();
  if (isTimeoutLikeError(error, raw)) {
    return '配音生成超时，请稍后重试';
  }
  if (error && typeof error === 'object' && (error.code === 'OPERATION_CANCELLED' || error.name === 'AbortError')) {
    return isTrustedChineseUserError(raw) ? raw : '操作已取消';
  }
  if (looksLikeAuthFailure(error, raw, options.code, options.status, options.responseBody)) {
    return ttsHttpFailureMessage(401);
  }
  const status = extractHttpStatus(error) || extractHttpStatus(options.status);
  if (status) return ttsHttpFailureMessage(status);
  const businessCode = safeProviderCode(error?.providerCode)
    || safeProviderCode(options.code)
    || safeProviderCode(error?.code);
  if (businessCode && /^\d+$/.test(businessCode) && Number(businessCode) !== 0) {
    return ttsBusinessFailureMessage(businessCode);
  }
  if (/redirect/i.test(raw) && !isTrustedChineseUserError(raw)) {
    return 'TTS 请求被重定向，已拦截，请检查服务地址后重试';
  }
  if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ECONNRESET|ENETUNREACH|ERR_NETWORK|network error|failed to fetch|fetch failed|load failed|socket hang up/i.test(`${error?.code || ''} ${raw}`)) {
    return '配音服务连接失败，请检查网络后重试';
  }
  if (isTrustedChineseUserError(raw)) return raw;
  return '配音生成失败，请稍后重试';
}

module.exports = {
  buildProviderErrorMessage,
  createProviderHttpError,
  createSafeProviderLogger,
  providerFailure,
  sanitizeLogValue,
  sanitizeProviderException,
  sanitizeProviderResult,
  sanitizeProviderText,
  sanitizeString,
  sanitizeUrl,
  summarizeProviderResponse,
  isTimeoutLikeError,
  isCancelLikeError,
  isUserFacingAbort,
  isNetworkLikeError,
  isTrustedChineseUserError,
  labeledProvider,
  looksLikeAuthFailure,
  ttsBusinessFailureMessage,
  ttsHttpFailureMessage,
  toSafeProviderErrorMessage,
  toUserFacingGatewayError,
  toUserFacingProcessError,
  toVisionExtractUserError,
  toUserFacingTtsMessage,
};
