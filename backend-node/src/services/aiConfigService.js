// AI 配置 CRUD，与 Go application/services/ai_service.go 对齐
const { sanitizeProviderText } = require('./comfyUiClient');
const { isTrustedChineseUserError, isTimeoutLikeError, isUserFacingAbort } = require('./providerErrorSanitizer');
const {
  aiConfigValidationError,
  normalizeConfigModels,
  assertDefaultModelMembership,
  resolveConfiguredModel,
  normalizeWritableConfigModels,
  modelToDb,
} = require('./aiConfigModels');
const { listConfigs, getConfig } = require('./aiConfigList');
const {
  normalizeApiKeyForService,
  clearOtherDefault,
  getVendorLockStatus,
  applyVendorLock,
} = require('./aiConfigVendorLock');
const {
  configForResponse,
  getProviderNetworkOptions,
  hasStoredCredentials,
  isExplicitLocalProviderConfig,
  isExplicitLocalProviderHost,
  isMaskedSecret,
  maskSensitiveSettings,
  normalizeProviderBaseUrl,
  normalizeProviderEndpoint,
  preserveMaskedSettings,
  providerUrlValidationError,
  sanitizeProviderEndpointForResponse,
  sanitizeProviderUrlForResponse,
} = require('./aiConfigProviderPrivacy');
const {
  CONNECTION_TEST_TIMEOUT_MS,
  DISCOVER_MODELS_LIMIT,
  DISCOVER_MODELS_MAX_BYTES,
  fetchConnectionProbe,
  probeOpenAICompatibleModels,
  probeOllamaConnection,
  ollamaProbeUrls,
  openAiCompatibleModelsUrl,
  supportsOpenAiCompatibleModelDiscovery,
  isApiKeyOptionalConnection,
  testConnectionUnsafe,
  discoverModelsUnsafe,
  connectionTestUserError,
  collectConnectionSecrets,
  collectDiscoverSecrets,
  toDiscoverModelsError,
  CONNECTION_TEST_FAILED_MESSAGE,
} = require('./aiConfigConnection');


function nextConfigUpdatedAt(previous) {
  const previousMs = Date.parse(String(previous || ''));
  const nowMs = Date.now();
  const nextMs = Number.isFinite(previousMs) ? Math.max(nowMs, previousMs + 1) : nowMs;
  return new Date(nextMs).toISOString();
}

function aiConfigConflictError(id) {
  const error = new Error('AI 配置已被其他操作更新，请刷新后重新确认修改');
  error.code = 'AI_CONFIG_CONFLICT';
  error.status = 409;
  error.details = { config_id: Number(id) };
  return error;
}

function createConfig(db, log, req) {
  const now = new Date().toISOString();
  const normalizedModels = normalizeWritableConfigModels({
    model: req.model,
    default_model: req.default_model,
    is_active: true,
  });
  const model = modelToDb(normalizedModels.model);
  let endpoint = req.endpoint || '';
  let queryEndpoint = req.query_endpoint || '';
  if (!endpoint && req.provider) {
    const p = req.provider.toLowerCase();
    const st = (req.service_type || 'text').toLowerCase();
    if (p === 'openai' || p === 'openai_compatible' || p === 'openai-compatible') {
      if (st === 'text' || st === 'ocr') endpoint = '/chat/completions';
      else if (st === 'transcription') endpoint = '/audio/transcriptions';
      else if (st === 'image') endpoint = '/images/generations';
      else if (st === 'video') {
        endpoint = '/videos';
        queryEndpoint = '/videos/{taskId}';
      }
    } else if (p === 'gemini' || p === 'google') {
      endpoint = '/v1beta/models/{model}:generateContent';
    } else if (p === 'dashscope' || p === 'qwen_image') {
      if (st === 'image' || st === 'storyboard_image') endpoint = '/api/v1/services/aigc/multimodal-generation/generation';
      else if (st === 'video' && p === 'dashscope') {
        endpoint = '/api/v1/services/aigc/image2video/video-synthesis';
        queryEndpoint = '/api/v1/tasks/{taskId}';
      }
    } else if (p === 'volces' || p === 'volcengine' || p === 'volc') {
      if (st === 'video') {
        endpoint = '/contents/generations/tasks';
        queryEndpoint = '/contents/generations/tasks/{taskId}';
      } else if (st === 'image' || st === 'storyboard_image') {
        endpoint = '/images/generations';
      }
    } else if (p === 'nano_banana') {
      if (st === 'image' || st === 'storyboard_image') {
        endpoint = '/api/v1/nanobanana/generate-2';
        queryEndpoint = '/api/v1/nanobanana/record-info';
      }
    } else if (p === 'agnes') {
      if (st === 'text' || st === 'ocr') endpoint = '/chat/completions';
      else if (st === 'transcription') endpoint = '/audio/transcriptions';
      else if (st === 'image' || st === 'storyboard_image') endpoint = '/images/generations';
      else if (st === 'video') {
        endpoint = '/videos';
        queryEndpoint = '/videos/{taskId}';
      }
    } else if (p === 'minimax' && st === 'video') {
      endpoint = '/video_generation';
      queryEndpoint = '/query/video_generation/{taskId}';
    }
  }
  const defaultModel = normalizedModels.default_model;
  const normalizedBaseUrl = normalizeProviderBaseUrl(req.base_url, req);
  endpoint = normalizeProviderEndpoint(endpoint, 'endpoint');
  queryEndpoint = normalizeProviderEndpoint(queryEndpoint, 'query_endpoint');
  const serviceType = req.service_type || 'text';
  const insertConfig = db.transaction(() => {
    if (req.is_default) clearOtherDefault(db, serviceType, null);
    return db.prepare(
      `INSERT INTO ai_service_configs (service_type, provider, api_protocol, name, base_url, api_key, model, default_model, endpoint, query_endpoint, priority, is_default, is_active, settings, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`
    ).run(
      serviceType,
      req.provider || '',
      req.api_protocol || '',
      req.name || '',
      normalizedBaseUrl,
      normalizeApiKeyForService(req.service_type, req.api_key || ''),
      model,
      defaultModel,
      endpoint,
      queryEndpoint,
      req.priority ?? 0,
      req.is_default ? 1 : 0,
      req.settings || null,
      now,
      now
    );
  });
  const info = insertConfig.immediate();
  log.info('AI config created', { config_id: info.lastInsertRowid, provider: req.provider });
  const newId = info.lastInsertRowid;
  return getConfig(db, newId);
}

function updateConfig(db, log, id, req) {
  const applyUpdate = db.transaction(() => {
    const existing = getConfig(db, id);
    if (!existing) return null;

    const expectedUpdatedAt = req.expected_updated_at == null
      ? null
      : String(req.expected_updated_at);
    if (expectedUpdatedAt !== null && expectedUpdatedAt !== String(existing.updated_at || '')) {
      throw aiConfigConflictError(id);
    }
    if (req.service_type != null
      && String(req.service_type).trim() !== String(existing.service_type || '').trim()) {
      throw aiConfigValidationError(
        '已保存配置不能切换服务类型，请新建对应服务类型的配置',
        { field: 'service_type', issue: 'immutable' }
      );
    }

    const normalizedSettings = req.settings !== undefined
      ? (req.settings == null ? null : preserveMaskedSettings(req.settings, existing.settings))
      : existing.settings;
    const candidate = {
      ...existing,
      ...req,
      base_url: req.base_url != null ? req.base_url : existing.base_url,
      api_key: req.api_key != null && !isMaskedSecret(req.api_key) ? req.api_key : existing.api_key,
      settings: normalizedSettings,
    };
    const requiresNetworkValidation = req.base_url != null
      || req.provider != null
      || req.settings !== undefined
      || (req.api_key != null && !isMaskedSecret(req.api_key));
    const normalizedBaseUrl = requiresNetworkValidation
      ? normalizeProviderBaseUrl(candidate.base_url, candidate)
      : existing.base_url;
    let originChanged = String(existing.base_url || '') !== normalizedBaseUrl;
    try {
      originChanged = new URL(existing.base_url).origin !== new URL(normalizedBaseUrl).origin;
    } catch (_) {}
    if (originChanged && new URL(normalizedBaseUrl).protocol === 'http:' && hasStoredCredentials(candidate)) {
      throw providerUrlValidationError('已保存的凭据不能自动迁移到新的 HTTP 服务地址，请重新填写密钥');
    }
    const normalizedModels = normalizeWritableConfigModels({
      model: req.model != null ? req.model : existing.model,
      default_model: req.default_model !== undefined ? req.default_model : existing.default_model,
      is_active: typeof req.is_active === 'boolean' ? req.is_active : existing.is_active,
    });
    const updates = [];
    const params = [];
    if (req.name != null) {
      updates.push('name = ?');
      params.push(req.name);
    }
    if (req.provider != null) {
      updates.push('provider = ?');
      params.push(req.provider);
    }
    if (req.api_protocol != null) {
      updates.push('api_protocol = ?');
      params.push(req.api_protocol);
    }
    if (req.base_url != null) {
      updates.push('base_url = ?');
      params.push(normalizedBaseUrl);
    }
    if (req.api_key != null && !isMaskedSecret(req.api_key)) {
      updates.push('api_key = ?');
      params.push(normalizeApiKeyForService(existing.service_type, req.api_key));
    }
    if (req.model != null) {
      updates.push('model = ?');
      params.push(modelToDb(normalizedModels.model));
    }
    if (req.default_model !== undefined) {
      updates.push('default_model = ?');
      params.push(normalizedModels.default_model);
    }
    if (req.priority != null) {
      updates.push('priority = ?');
      params.push(req.priority);
    }
    if (req.endpoint !== undefined) {
      updates.push('endpoint = ?');
      params.push(normalizeProviderEndpoint(req.endpoint, 'endpoint'));
    }
    if (req.query_endpoint !== undefined) {
      updates.push('query_endpoint = ?');
      params.push(normalizeProviderEndpoint(req.query_endpoint, 'query_endpoint'));
    }
    if (req.settings !== undefined) {
      updates.push('settings = ?');
      params.push(normalizedSettings);
    }
    if (typeof req.is_default === 'boolean') {
      updates.push('is_default = ?');
      params.push(req.is_default ? 1 : 0);
    }
    if (typeof req.is_active === 'boolean') {
      updates.push('is_active = ?');
      params.push(req.is_active ? 1 : 0);
    }
    if (updates.length === 0) return existing;

    // 唯一索引要求先清理同服务类型的旧默认，再写入新的默认配置。
    if (req.is_default === true) clearOtherDefault(db, existing.service_type, id);
    const updatedAt = nextConfigUpdatedAt(existing.updated_at);
    const where = expectedUpdatedAt === null ? ' WHERE id = ?' : ' WHERE id = ? AND updated_at = ?';
    const updateParams = [...params, updatedAt, id];
    if (expectedUpdatedAt !== null) updateParams.push(expectedUpdatedAt);
    const info = db.prepare(
      'UPDATE ai_service_configs SET ' + updates.join(', ') + ', updated_at = ?' + where
    ).run(...updateParams);
    if (info.changes !== 1) throw aiConfigConflictError(id);
    return getConfig(db, id);
  });
  const updated = applyUpdate.immediate();
  if (!updated) return null;
  log.info('AI config updated', { config_id: id });
  return updated;
}

function deleteConfig(db, log, id) {
  const now = new Date().toISOString();
  const result = db.prepare('UPDATE ai_service_configs SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL').run(now, id);
  if (result.changes === 0) return false;
  log.info('AI config deleted', { config_id: id });
  return true;
}

async function testConnection(opts) {
  try {
    return await testConnectionUnsafe(opts);
  } catch (error) {
    const secrets = collectConnectionSecrets(opts);
    const sanitized = sanitizeProviderText(error?.message, secrets) || CONNECTION_TEST_FAILED_MESSAGE;
    const timedOut = isTimeoutLikeError(error, sanitized) || error?.isTimeout === true;
    const cancelled = isUserFacingAbort(error, opts.signal);
    if (cancelled) {
      const message = isTrustedChineseUserError(sanitized) && /取消/.test(sanitized)
        ? sanitized
        : '连接测试已取消';
      throw connectionTestUserError(message, { code: 'ERR_CANCELED', name: 'AbortError' });
    }
    if (timedOut) {
      const message = isTrustedChineseUserError(sanitized) && /超时/.test(sanitized)
        ? sanitized
        : '连接测试超时，请检查服务地址或网络';
      throw connectionTestUserError(message, { code: 'ETIMEDOUT', name: 'TimeoutError', isTimeout: true });
    }
    const message = isTrustedChineseUserError(sanitized) ? sanitized : CONNECTION_TEST_FAILED_MESSAGE;
    const safeError = connectionTestUserError(message, {
      code: error?.code || 'CONNECTION_TEST_FAILED',
      isTimeout: false,
    });
    if (error?.details) safeError.details = error.details;
    const status = Number(error?.status);
    if (error?.code === 'INVALID_PROVIDER_URL' || error?.code === 'INVALID_AI_CONFIG') {
      safeError.status = error.status || 400;
    } else if (Number.isInteger(status) && status >= 400 && status !== 401 && status !== 403) {
      safeError.status = status;
    }
    throw safeError;
  }
}


/**
 * 从 OpenAI 兼容 /v1/models 读取模型目录，供前端合并进模型列表。
 * @param opts { base_url, api_key, provider, service_type, signal }
 * @returns Promise<{ models: Array<{ id: string, name?: string }> }>
 */
async function discoverModels(opts = {}) {
  try {
    return await discoverModelsUnsafe(opts);
  } catch (error) {
    throw toDiscoverModelsError(error, collectDiscoverSecrets(opts));
  }
}


/**
 * 批量替换所有配置的 api_key（仅限锁定模式下使用）
 */
function bulkUpdateApiKey(db, log, newKey) {
  const updateAll = db.transaction(() => {
    const rows = db.prepare(
      'SELECT id, service_type, updated_at FROM ai_service_configs WHERE deleted_at IS NULL ORDER BY id'
    ).all();
    const update = db.prepare('UPDATE ai_service_configs SET api_key = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL');
    const read = db.prepare('SELECT id, updated_at, api_key FROM ai_service_configs WHERE id = ? AND deleted_at IS NULL');
    const confirmations = [];
    let previousUpdatedAt = null;
    for (const row of rows) {
      const updatedAt = nextConfigUpdatedAt(previousUpdatedAt || row.updated_at);
      previousUpdatedAt = updatedAt;
      const apiKey = normalizeApiKeyForService(row.service_type, newKey);
      const info = update.run(apiKey, updatedAt, row.id);
      if (info.changes !== 1) throw aiConfigConflictError(row.id);
      const saved = read.get(row.id);
      confirmations.push({
        id: Number(saved.id),
        updated_at: String(saved.updated_at),
        api_key_set: Boolean(String(saved.api_key || '').trim()) && !isMaskedSecret(saved.api_key),
      });
    }
    return { updated: confirmations.length, confirmations };
  });
  const result = updateAll.immediate();
  log.info('Bulk update api_key', { updated: result.updated });
  return result;
}

module.exports = {
  CONNECTION_TEST_TIMEOUT_MS,
  DISCOVER_MODELS_LIMIT,
  DISCOVER_MODELS_MAX_BYTES,
  fetchConnectionProbe,
  probeOpenAICompatibleModels,
  probeOllamaConnection,
  ollamaProbeUrls,
  openAiCompatibleModelsUrl,
  supportsOpenAiCompatibleModelDiscovery,
  discoverModels,
  isApiKeyOptionalConnection,
  listConfigs,
  getConfig,
  createConfig,
  updateConfig,
  deleteConfig,
  testConnection,
  getVendorLockStatus,
  applyVendorLock,
  bulkUpdateApiKey,
  configForResponse,
  hasStoredCredentials,
  normalizeConfigModels,
  assertDefaultModelMembership,
  resolveConfiguredModel,
  getProviderNetworkOptions,
  isExplicitLocalProviderConfig,
  isExplicitLocalProviderHost,
  isMaskedSecret,
  maskSensitiveSettings,
  preserveMaskedSettings,
  normalizeProviderBaseUrl,
  normalizeProviderEndpoint,
  sanitizeProviderUrlForResponse,
  sanitizeProviderEndpointForResponse,
};
