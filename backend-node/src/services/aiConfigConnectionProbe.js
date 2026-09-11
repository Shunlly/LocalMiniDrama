// 连接探测：失败时 fail-closed，不把供应商原文或密钥回传给用户。

const { secureHttpFetch, validateHttpRequestTarget } = require('./secureHttpFetch');

function normalizedProviderId(value) {
  return String(value || '').trim().toLowerCase().replace(/-/g, '_');
}

const CONNECTION_TEST_TIMEOUT_MS = 15000;
const SAFE_PROVIDER_ERROR = Symbol.for('localMiniDrama.safeProviderError');
const CONNECTION_TEST_AUTH_MESSAGE = '认证失败，请检查密钥';
const CONNECTION_TEST_FAILED_MESSAGE = '连接测试失败，请检查接口地址和密钥';
const UNSUPPORTED_OCR_TRANSCRIPTION_PROBE_MESSAGE = '当前厂商不支持自动连接测试，请保存后用一张样例图/一段样例音频验证';

function connectionTestUserError(message, extra = {}) {
  const error = extra.cause ? new Error(message, { cause: extra.cause }) : new Error(message);
  error.code = extra.code || 'CONNECTION_TEST_FAILED';
  error.status = extra.status || 400;
  if (extra.name) error.name = extra.name;
  if (extra.isTimeout) error.isTimeout = true;
  Object.defineProperty(error, SAFE_PROVIDER_ERROR, { value: true });
  return error;
}

async function drainConnectionProbeBody(res) {
  try { await res.text(); } catch (_) {}
}

async function throwIfUnauthorizedConnection(res) {
  if (res.status !== 401 && res.status !== 403) return;
  await drainConnectionProbeBody(res);
  throw connectionTestUserError(CONNECTION_TEST_AUTH_MESSAGE, { code: 'CONNECTION_TEST_UNAUTHORIZED' });
}

async function fetchConnectionProbe(url, options = {}, networkOptions = {}) {
  const controller = new AbortController();
  const parentSignal = options.signal || networkOptions.signal;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    const reason = Object.assign(new Error('连接测试超时，请检查服务地址或网络'), {
      code: 'ETIMEDOUT',
      isTimeout: true,
    });
    controller.abort(reason);
  }, CONNECTION_TEST_TIMEOUT_MS);
  const onParentAbort = () => {
    if (!controller.signal.aborted) controller.abort(parentSignal?.reason);
  };
  parentSignal?.addEventListener('abort', onParentAbort);
  if (parentSignal?.aborted) onParentAbort();
  const requestOptions = { ...options, redirect: 'error', signal: controller.signal };
  try {
    if (typeof networkOptions.fetchImpl === 'function') {
      await validateHttpRequestTarget(url, networkOptions);
      if (controller.signal.aborted) {
        throw controller.signal.reason || Object.assign(new Error('连接测试已取消'), { code: 'ERR_CANCELED', name: 'AbortError' });
      }
      const probe = networkOptions.fetchImpl(url, requestOptions);
      return await new Promise((resolve, reject) => {
        const onAbort = () => reject(controller.signal.reason || Object.assign(new Error('连接测试已取消'), { code: 'ERR_CANCELED', name: 'AbortError' }));
        if (controller.signal.aborted) {
          onAbort();
          return;
        }
        controller.signal.addEventListener('abort', onAbort, { once: true });
        Promise.resolve(probe).then(
          (value) => {
            controller.signal.removeEventListener('abort', onAbort);
            resolve(value);
          },
          (error) => {
            controller.signal.removeEventListener('abort', onAbort);
            reject(error);
          }
        );
      });
    }
    return await secureHttpFetch(url, requestOptions, {
      trustedOrigins: networkOptions.trustedOrigins,
      allowPrivateOrigins: networkOptions.allowPrivateOrigins,
      requireHttpsForPublic: true,
      lookup: networkOptions.lookup,
      timeoutMs: CONNECTION_TEST_TIMEOUT_MS,
      maxBytes: 2 * 1024 * 1024,
    });
  } catch (error) {
    const reason = controller.signal.reason || parentSignal?.reason || error;
    if (timedOut || error?.isTimeout === true || reason?.isTimeout === true) {
      throw new Error('连接测试超时，请检查服务地址或网络');
    }
    if (error?.name === 'AbortError' || reason?.name === 'AbortError' || error?.code === 'ERR_CANCELED' || reason?.code === 'ERR_CANCELED') {
      const cancel = new Error('连接测试已取消');
      cancel.code = 'ERR_CANCELED';
      cancel.name = 'AbortError';
      throw cancel;
    }
    throw error;
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener('abort', onParentAbort);
  }
}

async function probeOpenAICompatibleModels(base, apiKey, networkOptions) {
  const url = openAiCompatibleModelsUrl(base);
  const headers = {};
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const res = await fetchConnectionProbe(url, {
    method: 'GET',
    headers,
  }, networkOptions);
  if (res.ok) return;
  await throwIfUnauthorizedConnection(res);
  await drainConnectionProbeBody(res);
  throw connectionTestUserError(CONNECTION_TEST_FAILED_MESSAGE);
}

function isOpenAiCompatibleConnectionProbe(opts = {}) {
  const provider = normalizedProviderId(opts.provider);
  const protocol = normalizedProviderId(opts.api_protocol);
  if (!supportsOpenAiCompatibleModelDiscovery(opts)) return false;
  return protocol === 'openai'
    || protocol === 'openai_compatible'
    || provider === 'openai'
    || provider === 'openai_compatible';
}

async function probeOpenAICompatibleChat(base, apiKey, model, networkOptions) {
  const url = `${String(base || '').replace(/\/$/, '')}/chat/completions`;
  const res = await fetchConnectionProbe(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: model || 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 1,
    }),
  }, networkOptions);
  await throwIfUnauthorizedConnection(res);
}

async function probeOcrOrTranscriptionConnection({
  base,
  apiKey,
  model,
  provider,
  apiProtocol,
  serviceType,
  networkOptions,
}) {
  const probeOpts = { provider, api_protocol: apiProtocol, service_type: serviceType };
  if (isOpenAiCompatibleConnectionProbe(probeOpts)) {
    await probeOpenAICompatibleModels(base, apiKey, networkOptions);
    return;
  }
  // 转写对尚未标明 OpenAI 协议、但仍兼容 chat 的厂商走轻量 chat 探测，不上传音频。
  const protocol = normalizedProviderId(apiProtocol);
  if (serviceType === 'transcription'
    && supportsOpenAiCompatibleModelDiscovery(probeOpts)
    && (!protocol || protocol === 'openai' || protocol === 'openai_compatible')) {
    await probeOpenAICompatibleChat(base, apiKey, model, networkOptions);
    return;
  }
  throw connectionTestUserError(UNSUPPORTED_OCR_TRANSCRIPTION_PROBE_MESSAGE, {
    code: 'UNSUPPORTED_CONNECTION_TEST',
  });
}

function isApiKeyOptionalConnection(opts = {}) {
  const provider = String(opts.provider || '').trim().toLowerCase().replace(/-/g, '_');
  const protocol = String(opts.api_protocol || '').trim().toLowerCase().replace(/-/g, '_');
  return provider === 'ollama'
    || provider === 'comfyui'
    || provider === 'comfy_ui'
    || protocol === 'comfyui'
    || protocol === 'comfy_ui';
}

function ollamaProbeUrls(baseUrl) {
  const parsed = new URL(baseUrl);
  const pathWithoutSlash = parsed.pathname.replace(/\/+$/, '');
  const rootPath = pathWithoutSlash.replace(/\/v1$/i, '');
  const root = (parsed.origin + rootPath).replace(/\/+$/, '');
  const openAiBase = /\/v1$/i.test(pathWithoutSlash)
    ? (parsed.origin + pathWithoutSlash)
    : (root + '/v1');
  return [root + '/api/tags', openAiBase + '/models'];
}

// 按 base 是否已以 /v1 结尾决定请求 /models 还是 /v1/models
function openAiCompatibleModelsUrl(baseUrl) {
  const parsed = new URL(baseUrl);
  const pathWithoutSlash = parsed.pathname.replace(/\/+$/, '');
  if (/\/v1$/i.test(pathWithoutSlash)) {
    return `${parsed.origin}${pathWithoutSlash}/models`;
  }
  const root = `${parsed.origin}${pathWithoutSlash}`.replace(/\/+$/, '');
  return `${root}/v1/models`;
}

function supportsOpenAiCompatibleModelDiscovery(opts = {}) {
  const provider = normalizedProviderId(opts.provider);
  const protocol = normalizedProviderId(opts.api_protocol);
  const serviceType = normalizedProviderId(opts.service_type);
  if (provider === 'comfyui' || provider === 'comfy_ui' || protocol === 'comfyui' || protocol === 'comfy_ui') {
    return false;
  }
  if (provider.startsWith('jimeng') || serviceType.startsWith('jimeng')) return false;
  if (protocol === 'gemini' || protocol === 'google') return false;
  if ((provider === 'gemini' || provider === 'google') && protocol !== 'openai') return false;
  return true;
}

async function probeOllamaConnection(baseUrl, apiKey, networkOptions) {
  const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
  for (const url of ollamaProbeUrls(baseUrl)) {
    try {
      const response = await fetchConnectionProbe(url, { method: 'GET', headers }, networkOptions);
      if (response.ok) return;
      await drainConnectionProbeBody(response);
    } catch (_) {}
  }
  throw connectionTestUserError(CONNECTION_TEST_FAILED_MESSAGE);
}

module.exports = {
  CONNECTION_TEST_TIMEOUT_MS,
  CONNECTION_TEST_AUTH_MESSAGE,
  CONNECTION_TEST_FAILED_MESSAGE,
  fetchConnectionProbe,
  probeOpenAICompatibleModels,
  probeOpenAICompatibleChat,
  probeOllamaConnection,
  probeOcrOrTranscriptionConnection,
  ollamaProbeUrls,
  openAiCompatibleModelsUrl,
  supportsOpenAiCompatibleModelDiscovery,
  isApiKeyOptionalConnection,
  isOpenAiCompatibleConnectionProbe,
  connectionTestUserError,
  drainConnectionProbeBody,
  throwIfUnauthorizedConnection,
};
