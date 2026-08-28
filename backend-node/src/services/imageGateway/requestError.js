'use strict';

// 图片/视频 Gateway 共用的请求失败分类：与前端 requestError 对齐。
// 取消不得记成失败；超时可重试；用户可见文案使用简体中文。
// 本模块只做客户端分类，不接真实厂商。

const { summarizeProviderResponse } = require('../providerErrorSanitizer');

const SAFE_PROVIDER_ERROR = Symbol.for('localMiniDrama.safeProviderError');
const DEFAULT_JSON_TIMEOUT_MS = 15_000;
const DEFAULT_RETRY_DELAY_MS = 400;

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
});

function abortLikeError(error) {
  const name = String(error?.name || '');
  return name === 'CanceledError' || name === 'AbortError';
}

function timeoutLikeError(error) {
  if (!error || typeof error !== 'object') return false;
  if (error.isTimeout === true) return true;
  const code = String(error.code || error.providerCode || '');
  if (code === 'ECONNABORTED' || code === 'ETIMEDOUT' || code === 'TIMEOUT' || /(?:^|_)TIME(?:D)?OUT$/i.test(code)) {
    return true;
  }
  if (String(error.name || '') === 'TimeoutError') return true;
  return /timeout|timed\s*out|超时/i.test(String(error.message || ''));
}

function timeoutFromAbortSignal(signal) {
  return timeoutLikeError(signal?.reason);
}

function isRequestTimeout(error, signal) {
  return timeoutLikeError(error)
    || timeoutLikeError(error?.cause)
    || timeoutFromAbortSignal(error?.config?.signal)
    || timeoutFromAbortSignal(signal);
}

function isRequestCanceled(error, signal) {
  if (isRequestTimeout(error, signal)) return false;
  return error?.code === 'ERR_CANCELED'
    || error?.code === 'OPERATION_CANCELLED'
    || abortLikeError(error)
    || (signal?.aborted === true && !timeoutFromAbortSignal(signal) && (error == null || abortLikeError(error) || error === signal.reason));
}

function extractHttpStatus(error) {
  if (error && typeof error === 'object') {
    for (const candidate of [error.status, error.statusCode, error.httpStatus, error.http_status, error.response?.status]) {
      const status = Number(candidate);
      if (Number.isInteger(status) && status >= 100 && status <= 599) return status;
    }
  }
  const match = String(error?.message || error || '').match(/\bHTTP\s*[:=]?\s*(\d{3})\b/i);
  return match ? Number(match[1]) : null;
}

function isRequestNetworkError(error, signal) {
  if (extractHttpStatus(error) || error?.response) return false;
  if (isRequestCanceled(error, signal) || isRequestTimeout(error, signal)) return false;
  const code = String(error?.code || '');
  if (/^(?:ERR_NETWORK|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ENETUNREACH|ENOTFOUND|EPIPE)$/i.test(code)) return true;
  return /network error|fetch failed|socket hang up|ECONNREFUSED|ENOTFOUND/i.test(String(error?.message || ''));
}

function shouldRetryRequest(error, attempt, signal) {
  if (isRequestTimeout(error, signal) || error?.retryable === true) return true;
  if (isRequestCanceled(error, signal)) return false;
  const status = extractHttpStatus(error);
  if (Number.isInteger(status) && status >= 400 && status < 500) return status === 408 || status === 429;
  if (Number.isInteger(status) && status >= 500) return true;
  return isRequestNetworkError(error, signal);
}

function markSafeProviderError(error) {
  if (!error || typeof error !== 'object') return error;
  if (!error[SAFE_PROVIDER_ERROR]) {
    Object.defineProperty(error, SAFE_PROVIDER_ERROR, { value: true });
  }
  return error;
}

function operationLabel(operation) {
  const key = String(operation || '').trim();
  return OPERATION_LABELS[key] || OPERATION_LABELS[key.toLowerCase()] || '请求';
}

function providerLabel(provider) {
  const label = String(provider || '').trim();
  return label || '厂商';
}

function looksEnglishOnly(message) {
  const text = String(message || '').trim();
  if (!text) return true;
  if (/[\u4e00-\u9fff]/.test(text)) return false;
  return /abort|cancel|timeout|timed out|network error|fetch failed|operation was aborted/i.test(text);
}

function userFacingCancelMessage(reason) {
  const message = reason instanceof Error ? reason.message : String(reason || '');
  return looksEnglishOnly(message) ? '请求已取消' : message;
}

function operationCancelledError(reason) {
  if (reason && typeof reason === 'object' && isRequestTimeout(reason)) {
    return requestTimeoutError(reason, { cause: reason });
  }
  if (reason instanceof Error && isRequestCanceled(reason) && reason.code === 'OPERATION_CANCELLED') {
    return markSafeProviderError(reason);
  }
  const error = new Error(userFacingCancelMessage(reason));
  error.name = 'AbortError';
  error.code = 'OPERATION_CANCELLED';
  if (reason instanceof Error) error.cause = reason;
  return markSafeProviderError(error);
}

function requestTimeoutError(source, options = {}) {
  const provider = providerLabel(options.provider);
  const operation = operationLabel(options.operation);
  const error = new Error(`${provider} ${operation}超时，请稍后重试`);
  error.name = 'TimeoutError';
  error.code = 'ETIMEDOUT';
  error.isTimeout = true;
  error.retryable = true;
  error.provider = options.provider || null;
  error.operation = options.operation || null;
  if (source instanceof Error) error.cause = source;
  return markSafeProviderError(error);
}

function requestNetworkError(source, options = {}) {
  const provider = providerLabel(options.provider);
  const operation = operationLabel(options.operation);
  const code = source?.code ? String(source.code) : '';
  const suffix = /^(?:EAI_AGAIN|ECONNREFUSED|ECONNRESET|ENETUNREACH|ENOTFOUND|EPIPE)$/i.test(code)
    ? `（code ${code}）`
    : '';
  const error = new Error(`${provider} ${operation}网络连接失败${suffix}，请检查网络后重试`);
  error.name = 'NetworkError';
  error.code = code || 'ERR_NETWORK';
  error.retryable = true;
  error.provider = options.provider || null;
  error.operation = options.operation || null;
  if (source instanceof Error) error.cause = source;
  return markSafeProviderError(error);
}

function httpFailureAction(status, responseFormat) {
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

function classifyHttpFailure(options = {}) {
  const provider = providerLabel(options.provider);
  const operation = operationLabel(options.operation);
  const status = extractHttpStatus({ status: options.status, message: options.responseBody })
    || extractHttpStatus(options.status);
  const summary = summarizeProviderResponse(options.responseBody);
  const code = options.code != null && String(options.code).trim() !== ''
    ? String(options.code).trim()
    : (summary.provider_code || '');
  const details = [];
  if (status) details.push(`HTTP ${status}`);
  if (code && /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,79}$/.test(code)) details.push(`code ${code}`);
  if (summary.response_bytes > 0) details.push(`response_bytes=${summary.response_bytes}`);
  const suffix = details.length ? ` (${details.join('; ')})` : '';
  const error = new Error(`${provider} ${operation}失败${suffix}。${httpFailureAction(status, summary.response_format)}`);
  error.name = 'ProviderError';
  if (status) error.status = status;
  if (code) error.providerCode = code;
  error.retryable = status === 408 || status === 429 || (Number.isInteger(status) && status >= 500);
  error.provider = options.provider || null;
  error.operation = options.operation || null;
  return markSafeProviderError(error);
}

function describeProviderRequestError(error, options = {}) {
  const classified = normalizeProviderRequestError(error, options);
  return classified?.message || `${providerLabel(options.provider)} ${operationLabel(options.operation)}失败`;
}

function normalizeProviderRequestError(error, options = {}) {
  const signal = options.signal;
  if (error && error[SAFE_PROVIDER_ERROR]) {
    if (isRequestTimeout(error, signal) && error.retryable !== true) error.retryable = true;
    return error;
  }
  if (error?.code === 'UNSAFE_MEDIA_REFERENCE' || error?.name === 'UnsafeMediaReferenceError') {
    return error;
  }
  if (isRequestTimeout(error, signal)) return requestTimeoutError(error, options);
  if (isRequestCanceled(error, signal)) return operationCancelledError(error);
  if (isRequestNetworkError(error, signal)) return requestNetworkError(error, options);
  const status = extractHttpStatus(error) || extractHttpStatus(options.status);
  if (status || options.responseBody != null) {
    return classifyHttpFailure({
      provider: options.provider,
      operation: options.operation,
      status,
      code: options.code || error?.providerCode || error?.code,
      responseBody: options.responseBody != null ? options.responseBody : error,
    });
  }
  const message = String(error?.message || error || '').trim();
  const fallback = new Error(
    looksEnglishOnly(message)
      ? `${providerLabel(options.provider)} ${operationLabel(options.operation)}失败，请稍后重试`
      : message
  );
  fallback.name = error?.name || 'ProviderError';
  fallback.code = error?.code;
  fallback.retryable = error?.retryable === true;
  if (error instanceof Error) fallback.cause = error;
  return markSafeProviderError(fallback);
}

function rethrowIfRequestCanceled(error, signal) {
  if (isRequestCanceled(error, signal)) {
    throw operationCancelledError(error);
  }
  return error;
}

function gatewayErrorResult(error, options = {}) {
  const classified = error && error[SAFE_PROVIDER_ERROR]
    ? error
    : normalizeProviderRequestError(error, options);
  if (isRequestCanceled(classified, options.signal)) throw classified;
  const result = { error: classified };
  if (classified.retryable === true) result.retryable = true;
  return result;
}

function createTimeoutController(timeoutMs, parentSignal) {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = Math.max(1, Number(timeoutMs) || DEFAULT_JSON_TIMEOUT_MS);
  const timer = setTimeout(() => {
    timedOut = true;
    const reason = requestTimeoutError(null, { operation: 'request' });
    controller.abort(reason);
  }, timeout);
  const onParentAbort = () => {
    if (!controller.signal.aborted) controller.abort(parentSignal?.reason);
  };
  parentSignal?.addEventListener('abort', onParentAbort, { once: true });
  if (parentSignal?.aborted) onParentAbort();
  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    dispose() {
      clearTimeout(timer);
      parentSignal?.removeEventListener('abort', onParentAbort);
    },
  };
}

async function withRequestRetry(task, options = {}) {
  if (typeof task !== 'function') throw new TypeError('withRequestRetry 需要可执行函数');
  const maxAttempts = Math.max(1, Number(options.maxAttempts) || 2);
  const delayMs = Math.max(0, Number(options.delayMs) || DEFAULT_RETRY_DELAY_MS);
  const signal = options.signal;
  const shouldRetry = typeof options.shouldRetry === 'function'
    ? options.shouldRetry
    : (error, attempt) => shouldRetryRequest(error, attempt, signal);
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (signal?.aborted) {
      throw normalizeProviderRequestError(signal.reason || new Error('请求已取消'), { signal, ...options });
    }
    try {
      return await task(attempt);
    } catch (error) {
      lastError = normalizeProviderRequestError(error, { signal, ...options });
      if (isRequestCanceled(lastError, signal) || attempt >= maxAttempts || !shouldRetry(lastError, attempt)) {
        throw lastError;
      }
      await new Promise((resolve, reject) => {
        let settled = false;
        const onAbort = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(normalizeProviderRequestError(signal?.reason || new Error('请求已取消'), { signal, ...options }));
        };
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          signal?.removeEventListener('abort', onAbort);
          resolve();
        }, delayMs * attempt);
        if (!signal) return;
        if (signal.aborted) onAbort();
        else signal.addEventListener('abort', onAbort, { once: true });
      });
    }
  }
  throw lastError;
}

module.exports = {
  DEFAULT_JSON_TIMEOUT_MS,
  classifyHttpFailure,
  createTimeoutController,
  describeProviderRequestError,
  gatewayErrorResult,
  isRequestCanceled,
  isRequestNetworkError,
  isRequestTimeout,
  markSafeProviderError,
  normalizeProviderRequestError,
  operationCancelledError,
  requestTimeoutError,
  rethrowIfRequestCanceled,
  shouldRetryRequest,
  withRequestRetry,
};
