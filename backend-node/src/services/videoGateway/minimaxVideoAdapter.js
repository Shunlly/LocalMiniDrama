'use strict';

const { fetchVideoWithTimeout, resolveVideoTimeoutMs } = require('./providerRuntime');
const aiConfigService = require('../aiConfigService');

const CANCELLED_STATES = new Set(['cancelled', 'canceled', 'cancelled_by_user', 'deleted']);
const COMPLETED_STATES = new Set(['success', 'succeeded', 'completed', 'done']);
const FAILED_STATES = new Set(['fail', 'failed', 'error', 'rejected']);
const PENDING_STATES = new Set([
  'preparing', 'queueing', 'queued', 'processing', 'pending', 'submitted', 'running', 'in_progress',
]);
const MAX_RESPONSE_BYTES = 1024 * 1024;
const DEFAULT_CANCEL_TIMEOUT_MS = 5000;

class VideoAdapterError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'VideoAdapterError';
    this.provider = 'minimax';
    this.code = options.code || 'MINIMAX_VIDEO_ERROR';
    this.retryable = options.retryable === true;
  }
}

function requireConfig(config) {
  if (!config?.api_key || !config?.base_url) {
    throw new TypeError('MiniMax video base_url and api_key are required');
  }
  const baseUrl = new URL(config.base_url);
  if (!['http:', 'https:'].includes(baseUrl.protocol) || baseUrl.username || baseUrl.password) {
    throw new TypeError('MiniMax video base_url must be a valid HTTP URL');
  }
  return baseUrl;
}

function endpointUrl(baseUrl, endpoint, fallback) {
  const raw = String(endpoint || fallback);
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\') || /[\r\n]/.test(raw)) {
    throw new TypeError('MiniMax video endpoint must be a relative path');
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
  const raw = String(endpoint || fallback)
    .replace(/\{taskId\}|\{task_id\}|\{id\}/gi, encoded);
  const parsed = new URL(raw, 'http://adapter.invalid');
  if (!/\{(?:taskId|task_id|id)\}/i.test(String(endpoint || fallback))) {
    parsed.searchParams.set('task_id', taskId);
  }
  return `${parsed.pathname}${parsed.search}`;
}

function requireTaskId(value) {
  const taskId = String(value ?? '');
  if (!taskId || taskId.length > 200 || !/^[A-Za-z0-9_-]+$/.test(taskId)) {
    throw new TypeError('MiniMax video task id is invalid');
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
    data?.video_url, data?.url, data?.download_url, data?.file?.download_url,
    data?.data?.video_url, data?.data?.url, data?.data?.download_url,
    data?.data?.file?.download_url,
  ];
  return candidates.find((value) => typeof value === 'string' && /^https?:\/\//i.test(value)) || null;
}

function pickTaskId(data) {
  return data?.task_id || data?.id || data?.data?.task_id || data?.data?.id || null;
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

async function readJson(response) {
  const length = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(length) && length > MAX_RESPONSE_BYTES) {
    throw new VideoAdapterError('MiniMax video response is too large', { retryable: true });
  }
  const text = await response.text();
  if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) {
    throw new VideoAdapterError('MiniMax video response is too large', { retryable: true });
  }
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_) {
    throw new VideoAdapterError('MiniMax video response is invalid', { retryable: true });
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
          '/video_generation/{taskId}',
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

function createBody(input) {
  const body = {
    model: String(input.model || 'MiniMax-Hailuo-2.3'),
    prompt: String(input.prompt || ''),
  };
  if (input.duration != null) body.duration = Number(input.duration);
  if (input.resolution) body.resolution = String(input.resolution);
  const firstFrame = input.first_frame_image || input.first_frame_url || input.image_url;
  if (firstFrame) body.first_frame_image = String(firstFrame);
  if (typeof input.prompt_optimizer === 'boolean') body.prompt_optimizer = input.prompt_optimizer;
  return body;
}

async function createMinimaxVideo(config, input = {}, runtime = {}) {
  runtime = withProviderNetworkPolicy(config, runtime);
  const baseUrl = requireConfig(config);
  const signal = runtime.signal;
  if (signal?.aborted) throw signal.reason;
  const remoteCancellation = createRemoteCancellation(runtime, config, baseUrl);
  const requestSignal = new AbortController().signal;
  signal?.addEventListener('abort', () => {
    remoteCancellation.cancel().catch(() => {});
  }, { once: true });
  let taskId = null;
  try {
    const response = await providerFetch(
      endpointUrl(baseUrl, config.endpoint, '/video_generation'),
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.api_key}`,
          'Content-Type': 'application/json',
          ...(runtime.idempotency_key ? { 'Idempotency-Key': runtime.idempotency_key } : {}),
        },
        body: JSON.stringify(createBody(input)),
        signal: requestSignal,
      },
      runtime
    );
    if (!response.ok) {
      throw new VideoAdapterError(`MiniMax video request failed with HTTP ${response.status}`, {
        retryable: response.status === 408 || response.status === 429 || response.status >= 500,
      });
    }
    const data = await readJson(response);
    if (data?.base_resp?.status_code != null && Number(data.base_resp.status_code) !== 0) {
      return { error: 'MiniMax video request failed' };
    }
    const status = pickStatus(data);
    if (FAILED_STATES.has(status) || data?.error) return { error: 'MiniMax video request failed' };
    const videoUrl = pickVideoUrl(data);
    if (videoUrl) return { status: 'completed', video_url: videoUrl };
    taskId = requireTaskId(pickTaskId(data));
    remoteCancellation.settle(taskId);
    if (signal?.aborted) {
      await remoteCancellation.cancel();
      throw signal.reason;
    }
    return { status: status || 'pending', task_id: taskId };
  } finally {
    remoteCancellation.settle(taskId);
  }
}

async function retrieveMinimaxFile(config, fileId, runtime = {}) {
  runtime = withProviderNetworkPolicy(config, runtime);
  const baseUrl = requireConfig(config);
  const value = String(fileId ?? '');
  if (!/^\d{1,64}$/.test(value)) throw new TypeError('MiniMax file id is invalid');
  const parsed = new URL(String(config.file_endpoint || '/files/retrieve'), 'http://adapter.invalid');
  parsed.searchParams.set('file_id', value);
  const response = await providerFetch(
    endpointUrl(baseUrl, `${parsed.pathname}${parsed.search}`, parsed.pathname),
    { method: 'GET', headers: { Authorization: `Bearer ${config.api_key}` }, signal: runtime.signal },
    runtime
  );
  if (!response.ok) return { error: `MiniMax video file request failed with HTTP ${response.status}` };
  const data = await readJson(response);
  const videoUrl = pickVideoUrl(data);
  return videoUrl ? { status: 'completed', video_url: videoUrl } : { error: 'MiniMax video file has no URL' };
}

async function pollMinimaxVideo(config, taskId, runtime = {}) {
  runtime = withProviderNetworkPolicy(config, runtime);
  const baseUrl = requireConfig(config);
  const normalizedTaskId = requireTaskId(taskId);
  if (runtime.signal?.aborted) throw runtime.signal.reason;
  const remoteCancellation = createRemoteCancellation(runtime, config, baseUrl);
  remoteCancellation.settle(normalizedTaskId);
  const endpoint = withTaskId(
    config.query_endpoint,
    '/query/video_generation?task_id=',
    normalizedTaskId
  );
  const response = await providerFetch(
    endpointUrl(baseUrl, endpoint, endpoint),
    { method: 'GET', headers: { Authorization: `Bearer ${config.api_key}` }, signal: runtime.signal },
    runtime
  );
  if (!response.ok) return { error: `MiniMax video task failed with HTTP ${response.status}` };
  const data = await readJson(response);
  if (data?.base_resp?.status_code != null && Number(data.base_resp.status_code) !== 0) {
    return { error: 'MiniMax video task failed' };
  }
  const status = pickStatus(data);
  if (FAILED_STATES.has(status) || CANCELLED_STATES.has(status) || data?.error) {
    return { error: 'MiniMax video task failed' };
  }
  const videoUrl = pickVideoUrl(data);
  if (videoUrl) return { status: 'completed', video_url: videoUrl };
  const fileId = data?.file_id || data?.file?.file_id || data?.data?.file_id;
  if (fileId && (COMPLETED_STATES.has(status) || !status)) {
    return retrieveMinimaxFile(config, fileId, runtime);
  }
  if (PENDING_STATES.has(status)) return { status: 'pending', task_id: normalizedTaskId };
  if (COMPLETED_STATES.has(status)) return { error: 'MiniMax video task completed without a video URL' };
  return { error: 'MiniMax video task returned an unknown status' };
}

module.exports = {
  VideoAdapterError,
  createMinimaxVideo,
  pollMinimaxVideo,
  retrieveMinimaxFile,
};
