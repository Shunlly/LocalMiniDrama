'use strict';

const { fetchVideoWithTimeout, resolveVideoTimeoutMs } = require('./providerRuntime');
const aiConfigService = require('../aiConfigService');

const CANCELLED_STATES = new Set(['cancelled', 'canceled', 'cancelled_by_user', 'deleted']);
const COMPLETED_STATES = new Set(['completed', 'succeeded', 'success', 'done']);
const FAILED_STATES = new Set(['failed', 'error', 'rejected']);
const PENDING_STATES = new Set(['queued', 'pending', 'processing', 'in_progress', 'running', 'submitted']);
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_CREATE_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 250;
const DEFAULT_CANCEL_TIMEOUT_MS = 5000;

class VideoAdapterError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'VideoAdapterError';
    this.provider = 'sora';
    this.code = options.code || 'SORA_VIDEO_ERROR';
    this.retryable = options.retryable === true;
  }
}

function requireConfig(config) {
  if (!config?.api_key || !config?.base_url) {
    throw new TypeError('Sora video base_url and api_key are required');
  }
  const baseUrl = new URL(config.base_url);
  if (!['http:', 'https:'].includes(baseUrl.protocol) || baseUrl.username || baseUrl.password) {
    throw new TypeError('Sora video base_url must be a valid HTTP URL');
  }
  return baseUrl;
}

function endpointUrl(baseUrl, endpoint, fallback) {
  const raw = String(endpoint || fallback);
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\') || /[\r\n]/.test(raw)) {
    throw new TypeError('Sora video endpoint must be a relative path');
  }
  const result = new URL(baseUrl.href);
  const basePath = result.pathname.replace(/\/+$/, '');
  let endpointPath = raw;
  if (/(?:^|\/)v1$/i.test(basePath) && /^\/v1(?:\/|$)/i.test(endpointPath)) {
    endpointPath = endpointPath.slice(3) || '/';
  }
  const parsed = new URL(endpointPath, 'http://adapter.invalid');
  result.pathname = `${basePath}/${parsed.pathname.replace(/^\/+/, '')}`.replace(/\/{2,}/g, '/');
  result.search = parsed.search;
  return result;
}

function withTaskId(endpoint, fallback, taskId) {
  const encoded = encodeURIComponent(taskId);
  const template = String(endpoint || fallback);
  const raw = template
    .replace(/\{taskId\}|\{task_id\}|\{id\}/gi, encoded);
  if (/\{(?:taskId|task_id|id)\}/i.test(template)) return raw;
  const parsed = new URL(raw, 'http://adapter.invalid');
  parsed.pathname = `${parsed.pathname.replace(/\/+$/, '')}/${encoded}`;
  return `${parsed.pathname}${parsed.search}`;
}

function requireTaskId(value) {
  const taskId = String(value ?? '');
  if (!taskId || taskId.length > 200 || !/^[A-Za-z0-9_-]+$/.test(taskId)) {
    throw new TypeError('Sora video task id is invalid');
  }
  return taskId;
}

function pickStatus(data) {
  return String(data?.status || data?.state || data?.data?.status || data?.data?.state || '')
    .trim()
    .toLowerCase();
}

function pickVideoUrl(data) {
  const candidates = [
    data?.video_url, data?.url, data?.output?.video_url, data?.output?.url,
    data?.result?.video_url, data?.result?.url, data?.data?.video_url, data?.data?.url,
    data?.data?.output?.video_url, data?.data?.output?.url, data?.result_url,
  ];
  return candidates.find((value) => typeof value === 'string' && /^https?:\/\//i.test(value)) || null;
}

function pickTaskId(data) {
  return data?.id || data?.task_id || data?.request_id || data?.data?.id || data?.data?.task_id || null;
}

async function providerFetch(url, options, runtime) {
  return fetchVideoWithTimeout(
    url.href,
    options,
    resolveVideoTimeoutMs('request'),
    runtime.networkOptions || {}
  );
}

function withProviderNetworkPolicy(config, runtime = {}) {
  const existing = runtime.networkOptions || {};
  return {
    ...runtime,
    networkOptions: aiConfigService.getProviderNetworkOptions(config, {
      ...existing,
      fetchImpl: existing.fetchImpl || runtime.fetch,
      lookup: existing.lookup || runtime.lookup || config.provider_dns_lookup,
      signal: runtime.signal,
    }),
  };
}

function transientStatus(status) {
  return status === 408 || status === 429 || status >= 500;
}

function retryDelayMs(response, attempt) {
  const retryAfter = Number(response?.headers?.get?.('retry-after'));
  if (Number.isFinite(retryAfter) && retryAfter >= 0) {
    return Math.min(retryAfter * 1000, 5000);
  }
  return DEFAULT_RETRY_DELAY_MS * (2 ** Math.max(0, attempt - 1));
}

function abortableDelay(ms, signal) {
  if (signal?.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, ms);
    function done() {
      signal?.removeEventListener('abort', aborted);
      resolve();
    }
    function aborted() {
      clearTimeout(timer);
      signal.removeEventListener('abort', aborted);
      reject(signal.reason);
    }
    signal?.addEventListener('abort', aborted, { once: true });
  });
}

function retryableTransportError(error) {
  if (error?.retryable === true) return true;
  if (/^(?:TimeoutError|NetworkError)$/i.test(String(error?.name || ''))) return true;
  return /^(?:EAI_AGAIN|ECONNREFUSED|ECONNRESET|ENETUNREACH|ENOTFOUND|EPIPE|ETIMEDOUT)$/i
    .test(String(error?.code || ''));
}

function createRequestBody(input) {
  const body = new FormData();
  body.append('model', String(input.model || 'sora-2'));
  body.append('prompt', String(input.prompt || ''));
  body.append('seconds', String(input.seconds ?? input.duration ?? 4));
  body.append('size', String(input.size || '720x1280'));
  body.append('watermark', String(input.watermark ?? false));
  body.append('private', String(input.private ?? false));
  appendInputReference(body, input.input_reference);
  return body;
}

async function readJson(response) {
  const length = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(length) && length > MAX_RESPONSE_BYTES) {
    throw new VideoAdapterError('Sora video response is too large', { retryable: true });
  }
  const text = await response.text();
  if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) {
    throw new VideoAdapterError('Sora video response is too large', { retryable: true });
  }
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_) {
    throw new VideoAdapterError('Sora video response is invalid', { retryable: true });
  }
}

function cancellationConfirmed(response, data) {
  if (response.status === 204) return true;
  const status = pickStatus(data);
  if (CANCELLED_STATES.has(status)) return true;
  if (data?.deleted === true) return true;
  return String(data?.result || data?.action || '').trim().toLowerCase() === 'deleted';
}

function createRemoteCancellation(runtime, config, baseUrl) {
  let resolveTaskId;
  let settled = false;
  let cancellationPromise;
  const taskIdPromise = new Promise((resolve) => { resolveTaskId = resolve; });

  const settle = (taskId = null) => {
    if (settled) return;
    settled = true;
    resolveTaskId(taskId);
  };

  const cancel = (options = {}) => {
    if (!cancellationPromise) {
      cancellationPromise = (async () => {
        const taskId = await taskIdPromise;
        if (!taskId) return { confirmed: false };
        const cancelSignal = options.signal
          || (typeof AbortSignal?.timeout === 'function'
            ? AbortSignal.timeout(DEFAULT_CANCEL_TIMEOUT_MS)
            : undefined);
        if (cancelSignal?.aborted) throw cancelSignal.reason;
        const endpoint = withTaskId(
          config.cancel_endpoint,
          config.endpoint || '/v1/videos',
          taskId
        );
        const response = await providerFetch(endpointUrl(baseUrl, endpoint, endpoint), {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${config.api_key}` },
          signal: cancelSignal,
        }, { ...runtime, signal: cancelSignal });
        if (!response.ok) return { confirmed: false };
        const data = response.status === 204 ? null : await readJson(response);
        return { confirmed: cancellationConfirmed(response, data) };
      })().catch((error) => {
        cancellationPromise = null;
        throw error;
      });
    }
    return cancellationPromise;
  };

  runtime.register_remote_cancel?.(cancel);
  return { cancel, settle };
}

function appendInputReference(body, reference) {
  if (!reference) return;
  const buffer = Buffer.isBuffer(reference) ? reference : reference.buffer;
  if (!Buffer.isBuffer(buffer)) throw new TypeError('Sora input_reference must contain a Buffer');
  const contentType = String(reference.contentType || reference.mimeType || 'application/octet-stream');
  const filename = String(reference.filename || 'reference.bin');
  body.append('input_reference', new Blob([buffer], { type: contentType }), filename);
}

async function createSoraVideo(config, input = {}, runtime = {}) {
  runtime = withProviderNetworkPolicy(config, runtime);
  const baseUrl = requireConfig(config);
  const signal = runtime.signal;
  if (signal?.aborted) throw signal.reason;
  const remoteCancellation = createRemoteCancellation(runtime, config, baseUrl);
  const requestSignal = new AbortController().signal;
  let taskId = null;

  try {
    let response;
    let data;
    for (let attempt = 1; attempt <= MAX_CREATE_ATTEMPTS; attempt += 1) {
      try {
        response = await providerFetch(
          endpointUrl(baseUrl, config.endpoint, '/v1/videos'),
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${config.api_key}`,
              ...(runtime.idempotency_key ? { 'Idempotency-Key': runtime.idempotency_key } : {}),
            },
            body: createRequestBody(input),
            signal: requestSignal,
          },
          runtime
        );
        if (!response.ok) {
          if (transientStatus(response.status)
            && runtime.idempotency_key
            && attempt < MAX_CREATE_ATTEMPTS) {
            await abortableDelay(retryDelayMs(response, attempt), signal);
            continue;
          }
          throw new VideoAdapterError(`Sora video request failed with HTTP ${response.status}`, {
            retryable: transientStatus(response.status),
          });
        }
        data = await readJson(response);
        break;
      } catch (error) {
        if (signal?.aborted) throw signal.reason;
        if (!runtime.idempotency_key
          || !retryableTransportError(error)
          || attempt === MAX_CREATE_ATTEMPTS) throw error;
        await abortableDelay(DEFAULT_RETRY_DELAY_MS * (2 ** (attempt - 1)), signal);
      }
    }
    const status = pickStatus(data);
    if (FAILED_STATES.has(status) || CANCELLED_STATES.has(status) || data?.error) {
      return { error: 'Sora video request failed' };
    }
    const videoUrl = pickVideoUrl(data);
    if (videoUrl) return { status: 'completed', video_url: videoUrl };
    taskId = requireTaskId(pickTaskId(data));
    remoteCancellation.settle(taskId);
    if (signal?.aborted) {
      await remoteCancellation.cancel();
      throw signal.reason;
    }
    return { status: status || 'processing', task_id: taskId };
  } finally {
    remoteCancellation.settle(taskId);
  }
}

async function pollSoraVideo(config, taskId, runtime = {}) {
  runtime = withProviderNetworkPolicy(config, runtime);
  const baseUrl = requireConfig(config);
  const normalizedTaskId = requireTaskId(taskId);
  if (runtime.signal?.aborted) throw runtime.signal.reason;
  const remoteCancellation = createRemoteCancellation(runtime, config, baseUrl);
  remoteCancellation.settle(normalizedTaskId);
  const endpoint = withTaskId(
    config.query_endpoint,
    config.endpoint || '/v1/videos',
    normalizedTaskId
  );
  const response = await providerFetch(
    endpointUrl(baseUrl, endpoint, endpoint),
    { method: 'GET', headers: { Authorization: `Bearer ${config.api_key}` }, signal: runtime.signal },
    runtime
  );
  if (!response.ok) {
    if (transientStatus(response.status)) {
      return { status: 'pending', task_id: normalizedTaskId, retryable: true };
    }
    return { error: `Sora video task failed with HTTP ${response.status}` };
  }
  const data = await readJson(response);
  const status = pickStatus(data);
  if (FAILED_STATES.has(status) || CANCELLED_STATES.has(status) || data?.error) {
    return { error: 'Sora video task failed' };
  }
  const videoUrl = pickVideoUrl(data);
  if (videoUrl) return { status: 'completed', video_url: videoUrl };
  if (COMPLETED_STATES.has(status)) return { error: 'Sora video task completed without a video URL' };
  if (PENDING_STATES.has(status)) return { status: 'pending', task_id: normalizedTaskId };
  return { error: 'Sora video task returned an unknown status' };
}

module.exports = {
  VideoAdapterError,
  createSoraVideo,
  pollSoraVideo,
};
