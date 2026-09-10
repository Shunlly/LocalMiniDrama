'use strict';

// 图生请求运行时：超时、取消、Idempotency、错误包装与协议推断。

const { AsyncLocalStorage } = require('async_hooks');
const { secureHttpFetch, validateHttpRequestTarget } = require('../secureHttpFetch');
const {
  classifyHttpFailure,
  createTimeoutController,
  isRequestCanceled,
  isRequestTimeout,
  normalizeProviderRequestError,
  operationCancelledError,
  rethrowIfRequestCanceled,
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

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  throw normalizeProviderRequestError(signal.reason || new Error('请求已取消'), { signal });
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

function userFacingGatewayError(error) {
  if (typeof error === 'string') {
    const text = error.trim();
    return text || '图片请求失败，请稍后重试';
  }
  if (error && typeof error.message === 'string' && error.message.trim()) return error.message;
  return '图片请求失败，请稍后重试';
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
  const result = { error: userFacingGatewayError(error) };
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
  const result = { error: userFacingGatewayError(classified) };
  if (classified.retryable === true) result.retryable = true;
  return result;
}

// 多参考图时注入到所有支持 negative_prompt 的模型，防止生成分割/拼贴布局；同时加入安全词以减少敏感拦截
const ANTI_SPLIT_NEGATIVE_PROMPT = 'nsfw, nudity, naked, violence, blood, gore, sensitive content, split panels, side-by-side layout, collage, diptych, triptych, grid layout, multiple panels, comparison view, composite image, two images in one frame';

function mergeNegativePromptFragments(auto, user) {
  const a = (auto || '').trim();
  const u = (user || '').trim();
  if (a && u) return `${a}, ${u}`;
  return a || u || '';
}

/**
 * 根据 provider 名推断接口规范（api_protocol 未设置时的兜底逻辑）
 * 已明确设置 api_protocol 的配置不会走此函数。
 */
function inferProtocol(provider, model) {
  const p = String(provider || '').toLowerCase();
  if (p === 'comfyui' || p === 'comfy_ui') return 'comfyui';
  if (p === 'dashscope' || p === 'qwen_image') return 'dashscope';
  if (p === 'nano_banana') return 'nano_banana';
  if (p === 'gemini' || p === 'google') return 'gemini';
  if (p === 'volces' || p === 'volcengine' || p === 'volc') return 'volcengine';
  if (/seedream|doubao/i.test(model || '')) return 'volcengine';
  if (p === 'kling' || p === 'klingai') return 'kling';
  if (/^kling-/i.test(model || '')) return 'kling';
  if (p === 'agnes' || /agnes-image|apihub\.agnes-ai\.com/i.test(String(model || ''))) return 'agnes';
  return 'openai';
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
