'use strict';

const uploadService = require('../uploadService');
const { secureHttpFetch } = require('../secureHttpFetch');

const DEFAULT_TIMEOUTS_MS = Object.freeze({
  request: 120000,
  media: 30000,
  poll: 30000,
  synchronous: 600000,
});

const TIMEOUT_ENV_KEYS = Object.freeze({
  request: 'VIDEO_REQUEST_TIMEOUT_MS',
  media: 'VIDEO_MEDIA_TIMEOUT_MS',
  poll: 'VIDEO_POLL_REQUEST_TIMEOUT_MS',
  synchronous: 'VIDEO_SYNC_REQUEST_TIMEOUT_MS',
});

const MAX_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_LOG_STRING_LENGTH = 2000;
const MAX_LOG_ARRAY_LENGTH = 20;
const MAX_LOG_OBJECT_KEYS = 50;
const MAX_LOG_DEPTH = 6;
const MAX_LOG_ARGUMENT_LENGTH = 8000;
const SAFE_LOGGER = Symbol('safeVideoLogger');

function normalizeTimeoutMs(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.max(Math.round(parsed), 1), MAX_TIMEOUT_MS);
}

function resolveVideoTimeoutMs(kind = 'request') {
  const timeoutKind = Object.hasOwn(DEFAULT_TIMEOUTS_MS, kind) ? kind : 'request';
  return normalizeTimeoutMs(
    process.env[TIMEOUT_ENV_KEYS[timeoutKind]],
    DEFAULT_TIMEOUTS_MS[timeoutKind]
  );
}

function createFallbackTimeoutSignal(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    const error = new Error(`Video provider request timed out after ${timeoutMs}ms`);
    error.name = 'TimeoutError';
    controller.abort(error);
  }, timeoutMs);
  if (typeof timer.unref === 'function') timer.unref();
  return controller.signal;
}

function createTimeoutSignal(timeoutMs) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(timeoutMs);
  }
  return createFallbackTimeoutSignal(timeoutMs);
}

function combineAbortSignals(signals) {
  const activeSignals = signals.filter(Boolean);
  if (activeSignals.length === 1) return activeSignals[0];
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.any === 'function') {
    return AbortSignal.any(activeSignals);
  }

  const controller = new AbortController();
  const abortFrom = (signal) => {
    if (!controller.signal.aborted) controller.abort(signal.reason);
  };
  for (const signal of activeSignals) {
    if (signal.aborted) {
      abortFrom(signal);
      break;
    }
    signal.addEventListener('abort', () => abortFrom(signal), { once: true });
  }
  return controller.signal;
}

/**
 * Keeps both the request and response-body stream bounded. The timeout signal is
 * intentionally not cleared when headers arrive, so a stalled body is aborted too.
 */
async function fetchVideoWithTimeout(
  url,
  options = {},
  timeoutMs = resolveVideoTimeoutMs('request'),
  networkOptions = {}
) {
  const boundedTimeoutMs = normalizeTimeoutMs(timeoutMs, resolveVideoTimeoutMs('request'));
  const timeoutSignal = createTimeoutSignal(boundedTimeoutMs);
  const signal = options.signal
    ? combineAbortSignals([options.signal, timeoutSignal])
    : timeoutSignal;
  if (typeof networkOptions.fetchImpl === 'function') {
    await uploadService.validatePublicHttpUrl(url, {
      trustedOrigins: networkOptions.trustedOrigins,
      lookup: networkOptions.lookup,
    });
    return networkOptions.fetchImpl(url, { ...options, signal });
  }
  return secureHttpFetch(url, { ...options, signal }, {
    trustedOrigins: networkOptions.trustedOrigins,
    lookup: networkOptions.lookup,
    timeoutMs: boundedTimeoutMs,
    maxBytes: networkOptions.maxBytes || 128 * 1024 * 1024,
    maxRedirects: networkOptions.maxRedirects,
  });
}

function sanitizeUrlForLog(value) {
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

function replaceUrlsInText(value) {
  return value.replace(/https?:\/\/[^\s"'<>\\]+/gi, (match) => sanitizeUrlForLog(match));
}

function sanitizeString(value) {
  const raw = String(value);
  if (/^data:/i.test(raw)) return `(data URL, ${raw.length} chars)`;
  let sanitized = raw
    .replace(/\b(Bearer|Token)\s+[^\s,;"'}\]]+/gi, '$1 [REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[REDACTED_API_KEY]')
    .replace(/\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED_JWT]')
    .replace(/([?&](?:api[_-]?key|access[_-]?token|token|signature|sig|x-amz-signature)=)[^&#\s"']+/gi, '$1[REDACTED]');
  sanitized = replaceUrlsInText(sanitized);
  if (sanitized.length > MAX_LOG_STRING_LENGTH) {
    return `${sanitized.slice(0, MAX_LOG_STRING_LENGTH)}... [TRUNCATED ${sanitized.length} chars]`;
  }
  return sanitized;
}

function normalizeLogKey(key) {
  return String(key || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[-\s]+/g, '_')
    .toLowerCase();
}

function isLengthOnlyKey(key) {
  return /(?:_len|_length|_chars|_count|_bytes|_size|_parts_b64url_len)$/.test(
    normalizeLogKey(key)
  );
}

function isSecretKey(key) {
  if (!key || isLengthOnlyKey(key)) return false;
  const normalized = normalizeLogKey(key);
  return /(?:^|_)(?:authorization|api_?key|access_?key|secret(?:_?key)?|token|credential|password|access_?key_?hint|iss)(?:$|_)/.test(normalized) ||
    normalized === 'x_goog_api_key';
}

function isPromptKey(key) {
  if (!key || isLengthOnlyKey(key)) return false;
  return /(?:^|_)(?:prompt|negative_prompt|text_prompt)(?:$|_)/.test(normalizeLogKey(key));
}

function looksLikeSerializedJsonKey(key) {
  return /(?:^|_)(?:raw|body|post_body|response|parsed_json|data|output)(?:$|_)/.test(
    normalizeLogKey(key)
  );
}

function sanitizeLogValue(value, key = '', depth = 0, seen = new WeakSet()) {
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function' || typeof value === 'symbol') return `[${typeof value}]`;

  if (typeof value === 'string') {
    if (isSecretKey(key)) return '[REDACTED]';
    if (isPromptKey(key)) return `[REDACTED_PROMPT length=${value.length}]`;
    if (looksLikeSerializedJsonKey(key)) {
      const trimmed = value.trim();
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          return sanitizeString(
            JSON.stringify(sanitizeLogValue(JSON.parse(value), key, depth + 1, seen))
          );
        } catch (_) {}
      }
      if (!/^https?:\/\//i.test(trimmed) && !/^data:/i.test(trimmed)) {
        return `[REDACTED_OPAQUE length=${value.length}]`;
      }
    }
    return sanitizeString(value);
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: sanitizeString(value.message || ''),
      code: value.code,
    };
  }
  if (depth >= MAX_LOG_DEPTH) return '[TRUNCATED_DEPTH]';
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);

  if (Array.isArray(value)) {
    const result = value
      .slice(0, MAX_LOG_ARRAY_LENGTH)
      .map((item) => sanitizeLogValue(item, key, depth + 1, seen));
    if (value.length > MAX_LOG_ARRAY_LENGTH) {
      result.push(`[TRUNCATED ${value.length - MAX_LOG_ARRAY_LENGTH} items]`);
    }
    return result;
  }

  const result = {};
  const entries = Object.entries(value);
  for (const [entryKey, entryValue] of entries.slice(0, MAX_LOG_OBJECT_KEYS)) {
    result[entryKey] = sanitizeLogValue(entryValue, entryKey, depth + 1, seen);
  }
  if (entries.length > MAX_LOG_OBJECT_KEYS) {
    result._truncated_keys = entries.length - MAX_LOG_OBJECT_KEYS;
  }
  return result;
}

function createSafeVideoLogger(log) {
  if (log && log[SAFE_LOGGER]) return log;
  const target = log || {};
  const safeLog = {};
  for (const level of ['debug', 'info', 'warn', 'error']) {
    safeLog[level] = (...args) => {
      if (typeof target[level] !== 'function') return undefined;
      const sanitizedArgs = args.map((arg, index) => {
        const sanitized = sanitizeLogValue(arg, index === 0 ? 'message' : 'meta');
        if (typeof sanitized === 'string') return sanitized;
        const serialized = JSON.stringify(sanitized);
        if (serialized == null || serialized.length <= MAX_LOG_ARGUMENT_LENGTH) return sanitized;
        return {
          _truncated: true,
          original_chars: serialized.length,
          preview: sanitizeString(serialized),
        };
      });
      return target[level].apply(target, sanitizedArgs);
    };
  }
  Object.defineProperty(safeLog, SAFE_LOGGER, { value: true });
  return safeLog;
}

module.exports = {
  createSafeVideoLogger,
  fetchVideoWithTimeout,
  resolveVideoTimeoutMs,
  sanitizeLogValue,
  sanitizeUrlForLog,
};
