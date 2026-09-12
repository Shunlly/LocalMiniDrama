'use strict';

// 图生请求运行时：超时、取消、Idempotency 与错误包装。协议推断已拆到 protocol.js。

const { AsyncLocalStorage } = require('async_hooks');
const { secureHttpFetch, validateHttpRequestTarget } = require('../secureHttpFetch');
const { toUserFacingGatewayError } = require('../providerErrorSanitizer');
const {
  ANTI_SPLIT_NEGATIVE_PROMPT,
  mergeNegativePromptFragments,
  inferProtocol,
} = require('./protocol');
const {
  classifyHttpFailure,
  createTimeoutController,
  isRequestCanceled,
  isRequestTimeout,
  normalizeProviderRequestError,
  operationCancelledError,
  rethrowIfRequestCanceled,
  throwIfAborted,
  withRequestRetry,
} = require('./requestError');

/** 图生 POST 走 Node http(s)，并把 AbortSignal 传到真正请求；取消必须销毁连接，不能只 reject Promise。 */
const IMAGE_HTTP_TIMEOUT_MS = 600000;
const IMAGE_POLL_RESPONSE_MAX_BYTES = 2 * 1024 * 1024;
const IMAGE_JSON_REQUEST_MAX_BYTES = 128 * 1024 * 1024;
const IMAGE_JSON_RESPONSE_MAX_BYTES = 128 * 1024 * 1024;
const IMAGE_PROVIDER_LABEL = '图片服务';
const imageRequestContext = new AsyncLocalStorage();

function normalizeIdempotencyKey(value) {
  return String(value || '').trim().slice(0, 200);
}

function isOperationCancelled(error, signal) {
  return isRequestCanceled(error, signal);
}

function abortableDelay(ms, signal) {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(finish, ms);
    function cleanup() {
      signal?.removeEventListener('abort', abort);
    }
    function finish() {
      cleanup();
      resolve();
    }
    function abort() {
      clearTimeout(timer);
      cleanup();
      reject(normalizeProviderRequestError(signal.reason || new Error('请求已取消'), { signal }));
    }
    signal?.addEventListener('abort', abort, { once: true });
  });
}

function userFacingGatewayError(error, options = {}) {
  return toUserFacingGatewayError(error, {
    provider: options.provider || IMAGE_PROVIDER_LABEL,
    operation: options.operation || 'image request',
  }) || '图片请求失败，请稍后重试';
}

function resolveImageJsonTimeoutMs(timeoutMs) {
  const parsed = Number(timeoutMs);
  if (!Number.isFinite(parsed) || parsed <= 0) return IMAGE_HTTP_TIMEOUT_MS;
  return Math.max(1, Math.round(parsed));
}

function assertImageJsonBodyLimit(bodyStr) {
  const bytes = Buffer.byteLength(bodyStr);
  if (bytes > IMAGE_JSON_REQUEST_MAX_BYTES) {
    const error = new Error('图片请求体超过大小限制');
    error.name = 'UnsafeMediaReferenceError';
    error.code = 'UNSAFE_MEDIA_REFERENCE';
    throw error;
  }
  return bodyStr;
}

function retryOptionsFromNetwork(networkOptions, parentSignal) {
  const options = {
    signal: parentSignal,
    provider: IMAGE_PROVIDER_LABEL,
    operation: 'image request',
  };
  if (Number.isFinite(Number(networkOptions.retryDelayMs))) {
    options.delayMs = Math.max(0, Number(networkOptions.retryDelayMs));
  }
  if (Number.isFinite(Number(networkOptions.maxAttempts))) {
    options.maxAttempts = Number(networkOptions.maxAttempts);
  }
  return options;
}

async function readJsonResponse(response) {
  if (response && typeof response.text === 'function') {
    const raw = await response.text();
    const statusCode = Number(response.status ?? response.statusCode ?? 0);
    return { statusCode, raw: String(raw || '') };
  }
  return {
    statusCode: Number(response?.statusCode || response?.status || 0),
    raw: String(response?.raw || ''),
  };
}

async function dispatchImageJsonPost(url, headers, bodyStr, signal, networkOptions, timeoutMs) {
  throwIfAborted(signal);
  const fetchImpl = networkOptions.fetchImpl || networkOptions.fetch_impl;
  if (typeof fetchImpl === 'function') {
    await validateHttpRequestTarget(url, networkOptions);
    throwIfAborted(signal);
    const response = await fetchImpl(url, {
      method: 'POST',
      headers,
      body: bodyStr,
      signal,
    });
    throwIfAborted(signal);
    return readJsonResponse(response);
  }
  const response = await secureHttpFetch(url, {
    method: 'POST',
    headers,
    body: bodyStr,
    signal,
  }, {
    trustedOrigins: networkOptions.trustedOrigins,
    allowPrivateOrigins: networkOptions.allowPrivateOrigins,
    requireHttpsForPublic: networkOptions.requireHttpsForPublic === true,
    lookup: networkOptions.lookup,
    timeoutMs,
    maxBytes: networkOptions.maxBytes || networkOptions.maxResponseBytes || IMAGE_JSON_RESPONSE_MAX_BYTES,
    maxRedirects: networkOptions.maxRedirects,
  });
  throwIfAborted(signal);
  return readJsonResponse(response);
}

async function postJSONWithTimeout(url, headers, body, timeoutMs, networkOptions = {}) {
  const context = imageRequestContext.getStore() || {};
  const mergedNetworkOptions = { ...(context.networkOptions || {}), ...networkOptions };
  const parentSignal = mergedNetworkOptions.signal;
  const idempotencyKey = normalizeIdempotencyKey(
    mergedNetworkOptions.idempotencyKey || context.idempotencyKey
  );
  const requestHeaders = { ...(headers || {}) };
  if (idempotencyKey) requestHeaders['Idempotency-Key'] = idempotencyKey;
  const bodyStr = assertImageJsonBodyLimit(typeof body === 'string' ? body : JSON.stringify(body));
  const boundedTimeoutMs = resolveImageJsonTimeoutMs(timeoutMs);
  throwIfAborted(parentSignal);

  return withRequestRetry(async () => {
    const timeout = createTimeoutController(boundedTimeoutMs, parentSignal, {
      provider: IMAGE_PROVIDER_LABEL,
      operation: 'image request',
    });
    try {
      return await dispatchImageJsonPost(
        url,
        requestHeaders,
        bodyStr,
        timeout.signal,
        mergedNetworkOptions,
        boundedTimeoutMs
      );
    } catch (error) {
      throw normalizeProviderRequestError(error, {
        signal: timeout.signal,
        provider: IMAGE_PROVIDER_LABEL,
        operation: 'image request',
      });
    } finally {
      timeout.dispose();
    }
  }, retryOptionsFromNetwork(mergedNetworkOptions, parentSignal));
}

function imageProviderFailure(provider, operation, status, responseBody, code) {
  const error = classifyHttpFailure({ provider, operation, status, responseBody, code });
  const result = { error: userFacingGatewayError(error, { provider, operation }) };
  if (error.retryable === true) result.retryable = true;
  return result;
}

function imageProviderException(error, provider, operation, signal) {
  const classified = normalizeProviderRequestError(error, { provider, operation, signal });
  if (isRequestCanceled(classified, signal) || isRequestTimeout(classified, signal) || classified.retryable === true) {
    throw classified;
  }
  return classified;
}

function imageProviderCaughtError(error, provider, operation, signal) {
  const classified = imageProviderException(error, provider, operation, signal);
  const result = { error: userFacingGatewayError(classified, { provider, operation }) };
  if (classified.retryable === true) result.retryable = true;
  return result;
}

module.exports = {
  IMAGE_HTTP_TIMEOUT_MS,
  IMAGE_POLL_RESPONSE_MAX_BYTES,
  imageRequestContext,
  normalizeIdempotencyKey,
  operationCancelledError,
  throwIfAborted,
  isOperationCancelled,
  abortableDelay,
  postJSONWithTimeout,
  imageProviderFailure,
  imageProviderException,
  imageProviderCaughtError,
  userFacingGatewayError,
  rethrowIfRequestCanceled,
  ANTI_SPLIT_NEGATIVE_PROMPT,
  mergeNegativePromptFragments,
  inferProtocol,
};
