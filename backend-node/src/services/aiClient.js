// 与 Go pkg/ai + application/services/ai_service 对齐：读取 ai_service_configs，调用 OpenAI 兼容的 chat completions
const aiConfigService = require('./aiConfigService');
const {
  filterActiveConfigs,
  selectDefaultConfig,
  resolveConfigForModel,
  selectConfigForModel,
  selectServiceConfig,
} = require('./aiConfigList');
const { applyDeepSeekChatOptions } = require('./deepseekConfig');
const {
  generateTextWithVision,
  resolveEntityImageSource,
  extractDescriptionFromImage,
  EXTRACT_PROMPTS,
  isRefusalResponse,
} = require('./aiClientVision');
const {
  createProviderHttpError,
  createSafeProviderLogger,
  summarizeProviderResponse,
  toSafeProviderErrorMessage,
} = require('./providerErrorSanitizer');
const {
  providerNetworkOptions,
  throwIfAborted,
  postJSONNonStream,
  postJSONWithTimeout,
  postJSONStream,
} = require('./aiHttp');

const SERVICE_TYPE_LABELS = Object.freeze({
  text: '文本',
  image: '图片',
  video: '视频',
  tts: '配音',
  vision: '视觉',
  ocr: '图片识别',
});

function serviceTypeLabel(serviceType) {
  const key = String(serviceType || '').trim().toLowerCase();
  return SERVICE_TYPE_LABELS[key] || '对应';
}

function missingEnabledModelError(serviceType) {
  return new Error(`未配置文本模型，请在「AI 配置」中添加${serviceTypeLabel(serviceType)}类型且已启用的配置`);
}

function missingModelConfigError(serviceType) {
  return new Error(`未配置文本模型，请在「AI 配置」中添加${serviceTypeLabel(serviceType)}类型的配置`);
}

// 使用前端设置的「默认」与「优先级」：listConfigs 已按 is_default DESC, priority DESC 排序
function getDefaultConfig(db, serviceType, preferredProvider) {
  const configs = aiConfigService.listConfigs(db, serviceType);
  return selectServiceConfig(configs, { preferredProvider }).config;
}

function getConfigForModel(db, serviceType, modelName, preferredProvider) {
  const configs = aiConfigService.listConfigs(db, serviceType);
  return selectConfigForModel(configs, modelName, preferredProvider);
}

function buildChatUrl(config) {
  const base = (config.base_url || '').replace(/\/$/, '');
  let ep = config.endpoint || '/chat/completions';
  if (!ep.startsWith('/')) ep = '/' + ep;
  return base + ep;
}

function getModelFromConfig(config, preferredModel) {
  return aiConfigService.resolveConfiguredModel(config, preferredModel, 'gpt-3.5-turbo');
}

function buildAuthHeaders(config) {
  const apiKey = String(config?.api_key || '').trim();
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

/**
 * 从 ai_model_map 表查找业务场景对应的模型配置
 * 返回 { config, modelOverride } 或 null（未配置时）
 */
function getConfigFromModelMap(db, sceneKey, expectedServiceType) {
  try {
    const row = db.prepare('SELECT * FROM ai_model_map WHERE key = ?').get(sceneKey);
    if (!row) return null;
    const mappedServiceType = String(row.service_type || 'text').trim().toLowerCase();
    const requestedServiceType = String(expectedServiceType || '').trim().toLowerCase();
    if (requestedServiceType && mappedServiceType !== requestedServiceType) return null;
    const configs = aiConfigService.listConfigs(db, mappedServiceType);
    const active = filterActiveConfigs(configs);
    let config = null;
    if (row.config_id) {
      config = active.find((item) => String(item.id) === String(row.config_id)) || null;
    }
    if (!config && row.model_override) config = selectConfigForModel(active, row.model_override);
    if (!config) config = selectDefaultConfig(active);
    return config ? { config, modelOverride: row.model_override || null } : null;
  } catch (_) {
    return null;
  }
}

function resolveTextRoute(db, serviceType, options = {}) {
  const requestedServiceType = String(serviceType || 'text').trim().toLowerCase() || 'text';
  const preferredModel = String(options.model ?? '').trim();
  const preferredProvider = options.provider ?? options.preferred_provider ?? options.preferredProvider;
  if (options.scene_key) {
    const mapped = getConfigFromModelMap(db, options.scene_key, requestedServiceType);
    if (mapped) return { ...mapped, source: 'scene_key', serviceType: requestedServiceType };
  }
  let config = preferredModel
    ? getConfigForModel(db, requestedServiceType, preferredModel, preferredProvider)
    : null;
  if (preferredModel && !config) {
    const configs = aiConfigService.listConfigs(db, requestedServiceType);
    if (resolveConfigForModel(configs, preferredModel, preferredProvider).ambiguous) return null;
  }
  const source = config ? 'model' : 'default';
  if (!config) config = getDefaultConfig(db, requestedServiceType, preferredProvider);
  return config
    ? { config, modelOverride: null, source, serviceType: requestedServiceType }
    : null;
}

async function generateText(db, log, serviceType, userPrompt, systemPrompt, options = {}) {
  throwIfAborted(options.signal);
  log = createSafeProviderLogger(log);
  const { model: preferredModel, temperature = 0.7, json_mode = false, min_max_tokens = null, streamCallback = null, scene_key = null } = options;

  // F2: 若传入 scene_key，优先从 ai_model_map 查找对应的模型路由配置
  const route = resolveTextRoute(db, serviceType, options);
  if (!route) {
    throw missingEnabledModelError(serviceType);
  }
  const { config, modelOverride: routedModelOverride } = route;
  if (scene_key && route.source === 'scene_key') {
    log.info('AI generateText: scene_key routing', { scene_key, config_id: config.id, model_override: routedModelOverride });
  }
  // scene_key 路由的模型覆盖优先级 > preferredModel
  const effectivePreferredModel = routedModelOverride || preferredModel;
  const model = getModelFromConfig(config, effectivePreferredModel);
  const url = buildChatUrl(config);

  // 解析 settings 里的 max_tokens 上限（用户在 AI 配置里可设置 {"max_tokens": 8192}）
  let settingsMaxTokens = null;
  try {
    if (config.settings) {
      const s = typeof config.settings === 'string' ? JSON.parse(config.settings) : config.settings;
      if (s && typeof s.max_tokens === 'number' && s.max_tokens > 0) settingsMaxTokens = s.max_tokens;
    }
  } catch (_) {}

  // 最终 max_tokens：优先取调用方传入值，但不超过 settings 里的上限；
  // 若调用方未传，则使用 settings 值（有的话）；两者都没有则不传（让模型用自己默认值）。
  // min_max_tokens：调用方可声明一个最低需求量，确保多集生成等场景不被用户的小上限截断，
  // 此时 finalMaxTokens = max(min_max_tokens, settingsMaxTokens ?? min_max_tokens)。
  let finalMaxTokens = null;
  if (options.max_tokens != null) {
    finalMaxTokens = Number(options.max_tokens);
    if (settingsMaxTokens != null && finalMaxTokens > settingsMaxTokens) {
      log.warn('AI generateText: max_tokens 超过配置上限，已截断', {
        requested: finalMaxTokens, capped_to: settingsMaxTokens, model,
      });
      finalMaxTokens = settingsMaxTokens;
    }
  } else if (settingsMaxTokens != null) {
    finalMaxTokens = settingsMaxTokens;
  }
  // 确保不低于调用方声明的最低需求
  if (min_max_tokens != null) {
    const minVal = Number(min_max_tokens);
    if (finalMaxTokens == null || finalMaxTokens < minVal) {
      if (finalMaxTokens != null) {
        log.warn('AI generateText: max_tokens 低于任务最低需求，已提升', {
          was: finalMaxTokens, raised_to: minVal, model,
        });
      }
      finalMaxTokens = minVal;
    }
  }

  let body = {
    model,
    messages: [
      ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
      { role: 'user', content: userPrompt },
    ],
    temperature: Number(temperature),
    ...(finalMaxTokens != null ? { max_tokens: finalMaxTokens } : {}),
    ...(json_mode ? { response_format: { type: 'json_object' } } : {}),
  };
  body = applyDeepSeekChatOptions(config, body);
  const startMs = Date.now();
  log.info('AI generateText request', { url: url.slice(0, 60), model, max_tokens: finalMaxTokens ?? '(model default)', json_mode, stream: true });
  const requestHeaders = buildAuthHeaders(config);
  if (options.idempotency_key) {
    requestHeaders['Idempotency-Key'] = String(options.idempotency_key).trim().slice(0, 200);
  }
  const res = await postJSONStream(url, requestHeaders, body, 60000, (receivedLen, event, accumulated) => {
    if (event === 'first_token') {
      log.info('AI stream first token', { model, ttft_ms: Date.now() - startMs });
    } else if (receivedLen > 0 && receivedLen % 500 < 20) {
      // 每积累约 500 字符记录一次进度
      log.info('AI stream progress', { model, received_chars: receivedLen, elapsed_ms: Date.now() - startMs });
    }
    // 调用者提供的流式回调（如分镜增量解析），传入当前已积累的完整文本
    if (streamCallback && accumulated) streamCallback(accumulated);
  }, providerNetworkOptions(config, options.provider_dns_lookup, options.signal));
  // 流式模式下 res.body 已是拼接好的完整文本内容（非 JSON）
  const content = res.body;
  const elapsedMs = Date.now() - startMs;
  if (!content) {
    throw new Error('AI 返回内容为空');
  }
  log.info('AI response received', { model, text_length: content.length, elapsed_ms: elapsedMs });
  return content;
}

/**
 * 与 generateText 相同的路由与鉴权，但将模型增量以 delta 回调给调用方；返回完整拼接文本。
 * @param {(delta: string) => void} onDelta 仅增量片段（UTF-8 字符串）
 */
async function streamGenerateText(db, log, serviceType, userPrompt, systemPrompt, options = {}, onDelta) {
  throwIfAborted(options.signal);
  log = createSafeProviderLogger(log);
  const { model: preferredModel, temperature = 0.7, json_mode = false, min_max_tokens = null, scene_key = null } = options;
  const route = resolveTextRoute(db, serviceType, options);
  if (!route) {
    throw missingEnabledModelError(serviceType);
  }
  const { config, modelOverride: routedModelOverride } = route;
  if (scene_key && route.source === 'scene_key') {
    log.info('AI streamGenerateText: scene_key routing', { scene_key, config_id: config.id, model_override: routedModelOverride });
  }
  const effectivePreferredModel = routedModelOverride || preferredModel;
  const model = getModelFromConfig(config, effectivePreferredModel);
  const url = buildChatUrl(config);

  let settingsMaxTokens = null;
  try {
    if (config.settings) {
      const s = typeof config.settings === 'string' ? JSON.parse(config.settings) : config.settings;
      if (s && typeof s.max_tokens === 'number' && s.max_tokens > 0) settingsMaxTokens = s.max_tokens;
    }
  } catch (_) {}

  let finalMaxTokens = null;
  if (options.max_tokens != null) {
    finalMaxTokens = Number(options.max_tokens);
    if (settingsMaxTokens != null && finalMaxTokens > settingsMaxTokens) {
      log.warn('AI streamGenerateText: max_tokens 超过配置上限，已截断', {
        requested: finalMaxTokens,
        capped_to: settingsMaxTokens,
        model,
      });
      finalMaxTokens = settingsMaxTokens;
    }
  } else if (settingsMaxTokens != null) {
    finalMaxTokens = settingsMaxTokens;
  }
  if (min_max_tokens != null) {
    const minVal = Number(min_max_tokens);
    if (finalMaxTokens == null || finalMaxTokens < minVal) {
      if (finalMaxTokens != null) {
        log.warn('AI streamGenerateText: max_tokens 低于任务最低需求，已提升', { was: finalMaxTokens, raised_to: minVal });
      }
      finalMaxTokens = minVal;
    }
  }

  let body = {
    model,
    messages: [
      ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
      { role: 'user', content: userPrompt },
    ],
    temperature: Number(temperature),
    ...(finalMaxTokens != null ? { max_tokens: finalMaxTokens } : {}),
    ...(json_mode ? { response_format: { type: 'json_object' } } : {}),
  };
  body = applyDeepSeekChatOptions(config, body);
  const silenceMs = options.silence_timeout_ms != null ? Number(options.silence_timeout_ms) : 120000;
  const startMs = Date.now();
  log.info('AI streamGenerateText request', {
    url: url.slice(0, 60),
    model,
    max_tokens: finalMaxTokens ?? '(model default)',
    json_mode,
    stream: true,
  });
  let lastLen = 0;
  const res = await postJSONStream(
    url,
    buildAuthHeaders(config),
    body,
    silenceMs,
    (receivedLen, event, accumulated) => {
      if (event === 'first_token') {
        log.info('AI stream first token', { model, ttft_ms: Date.now() - startMs });
      }
      if (!accumulated || accumulated.length <= lastLen) return;
      const delta = accumulated.slice(lastLen);
      lastLen = accumulated.length;
      if (onDelta && delta) onDelta(delta);
    },
    providerNetworkOptions(config, options.provider_dns_lookup, options.signal)
  );
  const content = res.body;
  if (!content) {
    throw new Error('AI 返回内容为空');
  }
  log.info('AI streamGenerateText done', { model, text_length: content.length, elapsed_ms: Date.now() - startMs });
  return content;
}

module.exports = {
  buildAuthHeaders,
  buildChatUrl,
  missingModelConfigError,
  getDefaultConfig,
  getConfigForModel,
  getConfigFromModelMap,
  getModelFromConfig,
  resolveTextRoute,
  generateText,
  streamGenerateText,
  generateTextWithVision,
  resolveEntityImageSource,
  extractDescriptionFromImage,
  EXTRACT_PROMPTS,
  isRefusalResponse,
  postJSONWithTimeout,
};
