// 连接探测与模型发现：失败时 fail-closed，不把供应商原文或密钥回传给用户。

const { applyDeepSeekConnectivityOptions } = require('./deepseekConfig');
const { probeComfyUiConnection } = require('./comfyUiClient');
const { requireCompleteProviderNetworkPolicy } = require('./providerNetworkPolicy');
const {
  normalizeConfigModels,
  resolveConfiguredModel,
} = require('./aiConfigModels');
const {
  getProviderNetworkOptions,
  normalizeProviderBaseUrl,
} = require('./aiConfigProviderPrivacy');
const {
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
} = require('./aiConfigConnectionProbe');
const {
  DISCOVER_MODELS_LIMIT,
  DISCOVER_MODELS_MAX_BYTES,
  DISCOVER_MODEL_ID_MAX_LEN,
  UNSUPPORTED_MODEL_DISCOVERY_MESSAGE,
  parseDiscoveredModelRows,
  looksLikeSecretModelId,
  mapProviderUrlDiscoverMessage,
  discoverModelsUserError,
  collectDiscoverSecrets,
  toDiscoverModelsError,
} = require('./aiConfigConnectionDiscover');

function collectConnectionSecrets(opts = {}) {
  return [opts.api_key, opts.access_key_id, opts.secret_access_key, opts.session_token]
    .filter((value) => value != null && String(value).length >= 3)
    .map(String);
}

/**
 * 测试连接：与 Go AIService.TestConnection 对齐，根据 provider 发最小请求验证 base_url + api_key
 * @param opts { base_url, api_key, model (string|string[]), provider?, endpoint?, settings? }
 * @returns Promise<void> 成功 resolve，失败 reject(error)
 */
async function testConnectionUnsafe(opts) {
  const base = normalizeProviderBaseUrl(opts.base_url, opts);
  if (!base) throw new Error('请填写接口地址');
  const providerNetwork = opts.provider_network_policy
    ? requireCompleteProviderNetworkPolicy(opts.provider_network_policy, base)
    : getProviderNetworkOptions(opts, { lookup: opts.provider_dns_lookup });
  const provider = (opts.provider || 'openai').toLowerCase();
  const apiProtocol = (opts.api_protocol || '').toLowerCase();
  const serviceType = (opts.service_type || '').toLowerCase();
  const networkOptions = {
    ...providerNetwork,
    fetchImpl: opts.fetch_impl,
    signal: opts.signal,
  };
  const normalizedModels = normalizeConfigModels(opts);
  let model = '';
  if (normalizedModels.default_model || normalizedModels.model.length) {
    model = resolveConfiguredModel(opts);
  }
  if (!model && (opts.provider === 'gemini' || opts.provider === 'google')) throw new Error('请填写模型名称');
  let endpoint = opts.endpoint || '';
  if (!opts.api_key && !isApiKeyOptionalConnection({ provider, api_protocol: apiProtocol })) {
    throw new Error('密钥必填');
  }

  if (provider === 'ollama') {
    await probeOllamaConnection(base, opts.api_key || '', networkOptions);
    return;
  }

  if (serviceType === 'ocr' || serviceType === 'transcription') {
    await probeOcrOrTranscriptionConnection({
      base,
      apiKey: opts.api_key,
      model,
      provider,
      apiProtocol,
      serviceType,
      networkOptions,
    });
    return;
  }

  if (provider === 'comfyui' || provider === 'comfy_ui' || apiProtocol === 'comfyui' || apiProtocol === 'comfy_ui') {
    await probeComfyUiConnection({
      base_url: base,
      api_key: opts.api_key || '',
      settings: opts.settings,
    }, {
      fetch_impl: opts.fetch_impl,
      provider_network_policy: providerNetwork,
      signal: opts.signal,
    });
    return;
  }

  // --- NanoBanana ---
  if (provider === 'nano_banana') {
    // 用 record-info 查询一个不存在的 taskId：401/403=key 无效，404=key 有效已联通
    const url = base + '/api/v1/nanobanana/record-info?taskId=test-connectivity';
    const res = await fetchConnectionProbe(url, {
      method: 'GET',
      headers: { Authorization: 'Bearer ' + (opts.api_key || '') },
    }, networkOptions);
    await throwIfUnauthorizedConnection(res);
    return;
  }

  // --- Gemini ---
  if (provider === 'gemini' || provider === 'google') {
    endpoint = endpoint || '/v1beta/models/{model}:generateContent';
    const path = endpoint.replace(/{model}/g, model || 'gemini-pro');
    const url = base + (path.startsWith('/') ? path : '/' + path) + '?key=' + encodeURIComponent(opts.api_key || '');
    const body = { contents: [{ parts: [{ text: 'Hello' }] }] };
    const res = await fetchConnectionProbe(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, networkOptions);
    if (!res.ok) {
      await throwIfUnauthorizedConnection(res);
      await drainConnectionProbeBody(res);
      throw connectionTestUserError(CONNECTION_TEST_FAILED_MESSAGE);
    }
    const data = await res.json().catch(() => ({}));
    if (data.candidates == null && data.error != null) {
      throw connectionTestUserError(CONNECTION_TEST_FAILED_MESSAGE);
    }
    return;
  }

  if (isOpenAiCompatibleConnectionProbe({ provider, api_protocol: apiProtocol, service_type: serviceType })) {
    await probeOpenAICompatibleModels(base, opts.api_key, networkOptions);
    return;
  }

  // --- TTS 语音合成 ---
  if (serviceType === 'tts') {
    // MiniMax T2A：用 /v1/models 或直接对 chat 端点做轻量探针
    const ttsBase = base.includes('minimaxi.com') || base.includes('minimax') ? base : base;
    // 尝试调用一个极简的 MiniMax T2A 请求（1 字，验证 key 合法性）
    // 为避免真实扣费，使用非计费的 list-voices 或 models 接口
    const probeUrl = ttsBase + '/text_to_speech';
    const probeBody = JSON.stringify({ model: model || 'speech-02-hd', text: 'hi', stream: false });
    const res = await fetchConnectionProbe(probeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (opts.api_key || '') },
      body: probeBody,
    }, networkOptions);
    await throwIfUnauthorizedConnection(res);
    // 其他状态（400 缺参数、404 端点不对等）说明网络通、key 疑似有效
    return;
  }

  // service_type 作为主要判断信号
  const isImageService = serviceType === 'image' || serviceType === 'storyboard_image';
  const isVideoService = serviceType === 'video';
  const hasImageEndpoint = !!(endpoint && endpoint.includes('/images/'));

  const isDashscope = provider === 'dashscope' || provider === 'qwen_image';
  const isVolcengine = provider === 'volces' || provider === 'volcengine' || provider === 'volc';
  const modelLower = model.toLowerCase();

  // 兜底识别图片/视频模型（service_type 未传时使用）
  const looksLikeImageModel = /seedream|image2video|text2image|img2img|wanx|wan\d|flux|stable.?diff|dall.?e|imagen|agnes-image|-image$/i.test(modelLower)
    || (isVolcengine && /seedream|vision|image/i.test(modelLower));
  const looksLikeVideoModel = /seedance|video.?gen|video2video|kf2v|cogvideo|sora|kling|agnes-video/i.test(modelLower);
  // DashScope 图片/视频专用端点特征
  const isDashscopeNonChatEndpoint = isDashscope && !!(endpoint && (endpoint.includes('aigc') || endpoint.includes('multimodal') || endpoint.includes('video')));

  // 综合判断是否为图片服务
  const treatAsImage = isImageService || hasImageEndpoint || isDashscopeNonChatEndpoint
    || looksLikeImageModel
    || (isVolcengine && !serviceType && !endpoint);

  // --- DashScope 图片 / 视频 / 分镜 ---
  // 通义万象 / WAN 系列：API key 通过 compatible-mode chat 接口验证即可（同一 key 通用）
  if (isDashscope && (isImageService || isVideoService || looksLikeImageModel || looksLikeVideoModel || isDashscopeNonChatEndpoint)) {
    const chatUrl = base.replace(/\/(api\/v1|compatible-mode)\/.*$/, '') + '/compatible-mode/v1/chat/completions';
    const body = { model: 'qwen-turbo', messages: [{ role: 'user', content: 'hi' }], max_tokens: 1 };
    const res = await fetchConnectionProbe(chatUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + opts.api_key },
      body: JSON.stringify(body),
    }, networkOptions);
    await throwIfUnauthorizedConnection(res);
    return;
  }

  // --- 视频生成服务（非 DashScope）：通过 chat/completions 验证 key 合法性 ---
  // 视频生成 API 调用代价高昂，无法直接测试；但同账号 chat 接口验证 key 有效性即可
  if (isVideoService || looksLikeVideoModel) {
    const chatPath = '/chat/completions';
    const url = base + chatPath;
    const body = { model: model || '', messages: [{ role: 'user', content: 'hi' }], max_tokens: 1 };
    const res = await fetchConnectionProbe(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (opts.api_key || '') },
      body: JSON.stringify(body),
    }, networkOptions);
    await throwIfUnauthorizedConnection(res);
    return;
  }

  // --- OpenAI 兼容图片生成（volcengine、OpenAI DALL·E、其他）---
  if (treatAsImage) {
    endpoint = endpoint || '/images/generations';
    const path = endpoint.startsWith('/') ? endpoint : '/' + endpoint;
    const url = base + path;
    const body = { model: model || '', prompt: 'test connectivity', n: 1 };
    const res = await fetchConnectionProbe(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + (opts.api_key || ''),
      },
      body: JSON.stringify(body),
    }, networkOptions);
    await throwIfUnauthorizedConnection(res);
    if (!res.ok) {
      // 其他 4xx/5xx：如果能解析出明确的 auth 错误才拒绝，否则视为联通
      const text = await res.text();
      let parsed = null;
      try { parsed = JSON.parse(text); } catch {}
      const msg = String(parsed?.error?.message || parsed?.message || '').toLowerCase();
      const isAuthErr = msg.includes('unauthorized') || msg.includes('invalid api key')
        || msg.includes('authentication') || msg.includes('forbidden');
      if (isAuthErr) throw connectionTestUserError(CONNECTION_TEST_AUTH_MESSAGE, { code: 'CONNECTION_TEST_UNAUTHORIZED' });
      // 其他错误（如模型不支持某个 API 参数）说明网络通、key 有效
      return;
    }
    return;
  }

  // --- OpenAI / 默认：chat completions ---
  endpoint = endpoint || '/chat/completions';
  const path = endpoint.startsWith('/') ? endpoint : '/' + endpoint;
  const url = base + path;
  let body = {
    model: model || 'gpt-3.5-turbo',
    messages: [{ role: 'user', content: 'Hello' }],
    max_tokens: 5,
  };
  body = applyDeepSeekConnectivityOptions(
    { provider, base_url: base, settings: opts.settings },
    body
  );
  const res = await fetchConnectionProbe(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + (opts.api_key || ''),
    },
    body: JSON.stringify(body),
  }, networkOptions);
  if (!res.ok) {
    await throwIfUnauthorizedConnection(res);
    await drainConnectionProbeBody(res);
    throw connectionTestUserError(CONNECTION_TEST_FAILED_MESSAGE);
  }
  const data = await res.json().catch(() => ({}));
  if (data.choices == null && data.error != null) {
    throw connectionTestUserError(CONNECTION_TEST_FAILED_MESSAGE);
  }
}

function sanitizeDiscoveredModel(entry) {
  return require('./aiConfigConnectionDiscover').sanitizeDiscoveredModel(entry);
}

async function discoverModelsUnsafe(opts = {}) {
  return require('./aiConfigConnectionDiscover').discoverModelsUnsafe(opts);
}

module.exports = {
  CONNECTION_TEST_TIMEOUT_MS,
  CONNECTION_TEST_FAILED_MESSAGE,
  DISCOVER_MODELS_LIMIT,
  DISCOVER_MODELS_MAX_BYTES,
  DISCOVER_MODEL_ID_MAX_LEN,
  UNSUPPORTED_MODEL_DISCOVERY_MESSAGE,
  fetchConnectionProbe,
  probeOpenAICompatibleModels,
  probeOpenAICompatibleChat,
  probeOllamaConnection,
  ollamaProbeUrls,
  openAiCompatibleModelsUrl,
  supportsOpenAiCompatibleModelDiscovery,
  isApiKeyOptionalConnection,
  isOpenAiCompatibleConnectionProbe,
  parseDiscoveredModelRows,
  sanitizeDiscoveredModel,
  looksLikeSecretModelId,
  mapProviderUrlDiscoverMessage,
  discoverModelsUserError,
  collectConnectionSecrets,
  collectDiscoverSecrets,
  connectionTestUserError,
  toDiscoverModelsError,
  testConnectionUnsafe,
  discoverModelsUnsafe,
};
