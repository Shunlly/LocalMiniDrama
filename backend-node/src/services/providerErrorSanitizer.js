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

function safeLabel(value, fallback) {
  const label = String(value || '').trim();
  return /^[A-Za-z0-9\u4e00-\u9fff][A-Za-z0-9\u4e00-\u9fff ._/-]{0,63}$/.test(label) ? label : fallback;
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
    for (const candidate of [value.status, value.statusCode, value.httpStatus, value.http_status]) {
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

function statusAction(status, responseFormat) {
  if (status === 400 || status === 422) return '请求被拒绝，请检查所选模型和请求参数';
  if (status === 401) return '认证失败，请检查 Provider 凭据';
  if (status === 403) return '请求被禁止，请检查 Provider 权限和内容策略';
  if (status === 404) return '接口、模型或任务不存在，请检查 Provider 配置';
  if (status === 408) return 'Provider 超时，请重试';
  if (status === 409) return 'Provider 报告请求冲突，请使用新的请求重试';
  if (status === 429) return 'Provider 达到速率限制或额度，请稍后重试或检查额度';
  if (status >= 500) return 'Provider 暂时不可用，请稍后重试';
  if (responseFormat === 'non_json') return 'Provider 返回了无法解析的错误响应';
  return 'Provider 返回错误，请检查配置后重试';
}

function buildProviderErrorMessage(options = {}) {
  const provider = safeLabel(options.provider, 'Provider');
  const operation = safeLabel(options.operation, '请求');
  const status = extractHttpStatus(options.status);
  const responseValue = options.responseBody !== undefined
    ? options.responseBody
    : options.responseData;
  const summary = summarizeProviderResponse(responseValue);
  const code = safeProviderCode(options.code) || extractProviderCode(responseValue);
  const details = [];
  if (status) details.push(`HTTP ${status}`);
  if (code) details.push(`code ${code}`);
  if (summary.response_bytes > 0) details.push(`response_bytes=${summary.response_bytes}`);
  const suffix = details.length ? ` (${details.join('; ')})` : '';
  return `${provider} ${operation} 失败${suffix}：${statusAction(status, summary.response_format)}。`;
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

function sanitizeProviderException(error, options = {}) {
  if (isUnsafeMediaError(error) || error?.[SAFE_PROVIDER_ERROR]) return error;
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
  });
  if (error?.retryable === true) safeError.retryable = true;
  if (/timeout|abort/i.test(String(error?.name || '')) || /(?:^|_)TIME(?:D)?OUT$/i.test(errorCode || '')) {
    safeError.message = `${safeLabel(options.provider, 'Provider')} ${safeLabel(options.operation, '请求')} 超时${errorCode ? ` (code ${errorCode})` : ''}，请重试。`;
  } else if (errorCode && /^(?:EAI_AGAIN|ECONNREFUSED|ECONNRESET|ENETUNREACH|ENOTFOUND|EPIPE)$/i.test(errorCode)) {
    safeError.message = `${safeLabel(options.provider, 'Provider')} ${safeLabel(options.operation, '请求')} 失败 (code ${errorCode})：网络连接失败，请检查服务地址后重试。`;
  }
  return safeError;
}

function toSafeProviderErrorMessage(error, options = {}) {
  if (error?.[SAFE_PROVIDER_ERROR]) return error.message;
  if (isUnsafeMediaError(error)) return sanitizeString(error.message || '媒体引用不安全');
  const source = typeof error === 'string' ? error : error?.message || error;
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
    responseBody: options.responseBody !== undefined ? options.responseBody : source,
  });
}

function providerFailure(options = {}) {
  return { error: buildProviderErrorMessage(options) };
}

function sanitizeProviderResult(result, options = {}) {
  if (!result || typeof result !== 'object' || !result.error) return result;
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

module.exports = {
  buildProviderErrorMessage,
  createProviderHttpError,
  createSafeProviderLogger,
  providerFailure,
  sanitizeLogValue,
  sanitizeProviderException,
  sanitizeProviderResult,
  sanitizeString,
  sanitizeUrl,
  summarizeProviderResponse,
  toSafeProviderErrorMessage,
};
