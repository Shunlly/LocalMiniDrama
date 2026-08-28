'use strict';

// 图生请求运行时：超时、取消、Idempotency、错误包装与协议推断。

const { AsyncLocalStorage } = require('async_hooks');
const { postJSONWithTimeout: postJSONWithTimeoutBase } = require('../aiClient');
const {
  providerFailure,
  sanitizeProviderException,
} = require('../providerErrorSanitizer');

/** 图生 POST 使用 Node http(s)，默认 10 分钟，避免 undici fetch 大包体/慢链路下模糊失败 */
const IMAGE_HTTP_TIMEOUT_MS = 600000;
const IMAGE_POLL_RESPONSE_MAX_BYTES = 2 * 1024 * 1024;
const imageRequestContext = new AsyncLocalStorage();

function normalizeIdempotencyKey(value) {
  return String(value || '').trim().slice(0, 200);
}

function operationCancelledError(reason) {
  if (reason instanceof Error && reason.code === 'OPERATION_CANCELLED') return reason;
  const error = new Error(reason instanceof Error ? reason.message : String(reason || '操作已取消'));
  error.name = 'AbortError';
  error.code = 'OPERATION_CANCELLED';
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw operationCancelledError(signal.reason);
}

function isOperationCancelled(error, signal) {
  return signal?.aborted || error?.code === 'OPERATION_CANCELLED' || error?.name === 'AbortError';
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
      reject(operationCancelledError(signal.reason));
    }
    signal?.addEventListener('abort', abort, { once: true });
  });
}

function postJSONWithTimeout(url, headers, body, timeoutMs, networkOptions = {}) {
  const context = imageRequestContext.getStore() || {};
  const idempotencyKey = normalizeIdempotencyKey(context.idempotencyKey);
  return postJSONWithTimeoutBase(
    url,
    idempotencyKey ? { ...(headers || {}), 'Idempotency-Key': idempotencyKey } : headers,
    body,
    timeoutMs,
    { ...(context.networkOptions || {}), ...networkOptions }
  );
}

function imageProviderFailure(provider, operation, status, responseBody, code) {
  return providerFailure({ provider, operation, status, responseBody, code });
}

function imageProviderException(error, provider, operation) {
  return sanitizeProviderException(error, { provider, operation });
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
  ANTI_SPLIT_NEGATIVE_PROMPT,
  mergeNegativePromptFragments,
  inferProtocol,
};
