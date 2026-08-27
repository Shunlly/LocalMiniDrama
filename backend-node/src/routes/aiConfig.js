const aiConfigService = require('../services/aiConfigService');
const response = require('../response');

function list(db) {
  return (req, res) => {
    const list = aiConfigService.listConfigs(db, req.query.service_type);
    response.success(res, list.map(aiConfigService.configForResponse));
  };
}

function get(db) {
  return (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return response.badRequest(res, '无效的配置ID');
    const config = aiConfigService.getConfig(db, id);
    if (!config) return response.notFound(res, '配置不存在');
    response.success(res, aiConfigService.configForResponse(config));
  };
}

function vendorLock(cfg) {
  return (req, res) => {
    const status = aiConfigService.getVendorLockStatus(cfg);
    response.success(res, status);
  };
}

function create(db, log, cfg) {
  return (req, res) => {
    if (aiConfigService.getVendorLockStatus(cfg).enabled) {
      return response.badRequest(res, '当前为厂商锁定模式，不允许添加配置');
    }
    const body = req.body || {};
    if (!body.service_type || !body.name || !body.provider || !body.base_url) {
      return response.badRequest(res, '缺少必填字段: service_type, name, provider, base_url');
    }
    if (body.api_key === undefined || body.api_key === null) {
      return response.badRequest(res, '缺少必填字段: api_key');
    }
    try {
      const config = aiConfigService.createConfig(db, log, {
        ...body,
        model: body.model ?? [],
      });
      response.created(res, aiConfigService.configForResponse(config));
    } catch (err) {
      log.errorw('Create AI config failed', { error: err.message });
      if (err.status === 400) {
        return response.error(res, 400, err.code || 'BAD_REQUEST', err.message, err.details);
      }
      response.internalError(res, '创建失败');
    }
  };
}

function update(db, log, cfg) {
  return (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return response.badRequest(res, '无效的配置ID');

    let body = req.body || {};
    // 锁定模式下只允许修改 api_key、default_model、is_default
    if (aiConfigService.getVendorLockStatus(cfg).enabled) {
      const allowed = {};
      if (body.api_key !== undefined) allowed.api_key = body.api_key;
      if (body.default_model !== undefined) allowed.default_model = body.default_model;
      if (body.is_default !== undefined) allowed.is_default = body.is_default;
      if (body.expected_updated_at !== undefined) allowed.expected_updated_at = body.expected_updated_at;
      body = allowed;
    }

    try {
      const config = aiConfigService.updateConfig(db, log, id, body);
      if (!config) return response.notFound(res, '配置不存在');
      response.success(res, aiConfigService.configForResponse(config));
    } catch (err) {
      log.errorw('Update AI config failed', { error: err.message, config_id: id });
      if (err.status === 400 || err.status === 409) {
        return response.error(res, err.status, err.code || 'BAD_REQUEST', err.message, err.details);
      }
      response.internalError(res, '更新失败');
    }
  };
}

function remove(db, log, cfg) {
  return (req, res) => {
    if (aiConfigService.getVendorLockStatus(cfg).enabled) {
      return response.badRequest(res, '当前为厂商锁定模式，不允许删除配置');
    }
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return response.badRequest(res, '无效的配置ID');
    const ok = aiConfigService.deleteConfig(db, log, id);
    if (!ok) return response.notFound(res, '配置不存在');
    response.success(res, { message: '删除成功' });
  };
}

function bulkUpdateKey(db, log, cfg) {
  return (req, res) => {
    if (!aiConfigService.getVendorLockStatus(cfg).enabled) {
      return response.badRequest(res, '批量换Key仅在厂商锁定模式下可用');
    }
    const { api_key } = req.body || {};
    if (!api_key || !api_key.trim()) {
      return response.badRequest(res, '请提供新的 API Key');
    }
    try {
      const result = aiConfigService.bulkUpdateApiKey(db, log, api_key.trim());
      response.success(res, {
        ...result,
        message: `已更新 ${result.updated} 条配置的 API Key`,
      });
    } catch (err) {
      log.error('Bulk update api_key failed', { error: err.message });
      response.internalError(res, '批量换Key失败');
    }
  };
}

function getSavedConfigFromBody(db, body) {
  if (body.id == null && body.config_id == null) return null;
  const id = parseInt(body.id ?? body.config_id, 10);
  if (isNaN(id)) {
    const err = new Error('无效的配置ID');
    err.status = 400;
    throw err;
  }
  const config = aiConfigService.getConfig(db, id);
  if (!config) {
    const err = new Error('配置不存在');
    err.status = 404;
    throw err;
  }
  return config;
}

function mergeSettingsForRequest(savedSettings, bodySettings) {
  const parse = (value) => {
    if (!value) return {};
    if (typeof value === 'object') return value;
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  };
  const saved = parse(savedSettings);
  const incoming = parse(bodySettings);
  return {
    ...saved,
    ...incoming,
    access_key_id: incoming.access_key_id && !aiConfigService.isMaskedSecret(incoming.access_key_id) ? incoming.access_key_id : saved.access_key_id,
    secret_access_key: incoming.secret_access_key && !aiConfigService.isMaskedSecret(incoming.secret_access_key) ? incoming.secret_access_key : saved.secret_access_key,
    session_token: incoming.session_token && !aiConfigService.isMaskedSecret(incoming.session_token) ? incoming.session_token : saved.session_token,
  };
}

function applySavedConfigSecrets(savedConfig, body) {
  if (!savedConfig) return body;
  const savedSettings = mergeSettingsForRequest(savedConfig.settings, body.settings);
  return {
    ...savedConfig,
    ...body,
    base_url: body.base_url || savedConfig.base_url,
    api_key: body.api_key && !aiConfigService.isMaskedSecret(body.api_key) ? body.api_key : savedConfig.api_key,
    settings: JSON.stringify(savedSettings),
    access_key_id: body.access_key_id && !aiConfigService.isMaskedSecret(body.access_key_id) ? body.access_key_id : savedSettings.access_key_id,
    secret_access_key: body.secret_access_key && !aiConfigService.isMaskedSecret(body.secret_access_key) ? body.secret_access_key : savedSettings.secret_access_key,
    sign_region: body.sign_region || savedSettings.sign_region,
    sign_service: body.sign_service || savedSettings.sign_service,
    session_token: body.session_token && !aiConfigService.isMaskedSecret(body.session_token) ? body.session_token : savedSettings.session_token,
    project_name: body.project_name || savedSettings.project_name,
    path_mode: body.path_mode || savedSettings.path_mode,
    api_version: body.api_version || savedSettings.api_version,
    auth_mode: body.auth_mode || savedSettings.auth_mode,
  };
}

function testConnection(db, log) {
  return async (req, res) => {
    const body = req.body || {};
    let opts;
    try {
      opts = applySavedConfigSecrets(getSavedConfigFromBody(db, body), body);
    } catch (err) {
      if (err.status === 404) return response.notFound(res, err.message);
      return response.badRequest(res, err.message);
    }
    const apiKeyOptional = aiConfigService.isApiKeyOptionalConnection(opts);
    const missingRequiredKey = !apiKeyOptional && (!opts.api_key || aiConfigService.isMaskedSecret(opts.api_key));
    if (!opts.base_url || missingRequiredKey) {
      return response.badRequest(res, apiKeyOptional ? '缺少 base_url' : '缺少 base_url 或 api_key');
    }
    try {
      await aiConfigService.testConnection({
        base_url: opts.base_url,
        api_key: opts.api_key,
        model: opts.model,
        provider: opts.provider,
        api_protocol: opts.api_protocol,
        endpoint: opts.endpoint,
        service_type: opts.service_type,
        settings: opts.settings,
        trusted_origins: req.providerNetworkTrustedOrigins,
        provider_network_policy: req.providerNetworkPolicy,
      });
      response.success(res, { message: '连接测试成功' });
    } catch (err) {
      const { toSafeProviderErrorMessage } = require('../services/providerErrorSanitizer');
      const safeMessage = toSafeProviderErrorMessage(err, {
        provider: opts.provider || 'AI provider',
        operation: 'connection test',
      });
      log.error('AI config test connection failed', { error: safeMessage });
      response.badRequest(res, '连接测试失败: ' + safeMessage);
    }
  };
}

/** ModelArk / 方舟私有资产库：代理调用 CreateAssetGroup、ListAssets 等（与官方 Action 名一致） */
function modelArkAsset(db, log) {
  return async (req, res) => {
    const body = req.body || {};
    const action = (body.action || '').toString().trim();
    try {
      const opts = applySavedConfigSecrets(getSavedConfigFromBody(db, body), body);
      const modelArkAssetProxyService = require('../services/modelArkAssetProxyService');
      const data = await modelArkAssetProxyService.callModelArkAsset(
        {
          base_url: opts.base_url,
          api_key: opts.api_key,
          action,
          body: opts.payload,
          path_mode: opts.path_mode,
          http_method: opts.http_method,
          api_version: opts.api_version,
          auth_mode: opts.auth_mode,
          access_key_id: opts.access_key_id,
          secret_access_key: opts.secret_access_key,
          sign_region: opts.sign_region,
          sign_service: opts.sign_service,
          session_token: opts.session_token,
          project_name: opts.project_name,
          network_policy: req.providerNetworkPolicy,
        },
        log
      );
      response.success(res, data);
    } catch (err) {
      const { toSafeProviderErrorMessage } = require('../services/providerErrorSanitizer');
      const safeMessage = toSafeProviderErrorMessage(err, { provider: 'ModelArk', operation: action || 'request' });
      log.error('model-ark-asset proxy failed', { error: safeMessage, action });
      const status = err.status >= 400 && err.status < 600 ? err.status : 400;
      return response.error(res, status, 'MODEL_ARK_ASSET', safeMessage || '请求失败');
    }
  };
}

/** 即梦2角色认证：仅使用已保存并启用配置的完整网络策略代理素材列表。 */
function listJimeng2MaterialAssets(db, log) {
  return async (req, res) => {
    const body = req.body || {};
    let savedConfig = null;
    try {
      savedConfig = getSavedConfigFromBody(db, body);
    } catch (err) {
      if (err.status === 404) return response.notFound(res, err.message);
      return response.badRequest(res, err.message);
    }
    const base_url = (body.base_url || savedConfig?.base_url || '').toString().trim().replace(/\/$/, '');
    const { normalizeMaterialHubToken } = require('../services/jimengMaterialHubService');
    let api_key = body.api_key && !aiConfigService.isMaskedSecret(body.api_key) ? body.api_key : savedConfig?.api_key || '';
    api_key = normalizeMaterialHubToken(api_key || '');
    if (!base_url || !api_key) {
      return response.badRequest(res, '请先填写网关 URL 与 Token');
    }
    const jimengMaterialHubService = require('../services/jimengMaterialHubService');
    const ctx = { baseUrl: base_url, token: api_key, networkPolicy: req.providerNetworkPolicy };
    const r = await jimengMaterialHubService.listAssets(ctx, { limit: body.limit, cursor: body.cursor }, log);
    if (!r.ok) {
      return response.badRequest(res, String(r.error || '列出素材失败').slice(0, 800));
    }
    response.success(res, r.data);
  };
}

module.exports = function aiConfigRoutes(db, log, cfg) {
  return {
    list: list(db),
    get: get(db),
    vendorLock: vendorLock(cfg),
    create: create(db, log, cfg),
    update: update(db, log, cfg),
    delete: remove(db, log, cfg),
    testConnection: testConnection(db, log),
    listJimeng2MaterialAssets: listJimeng2MaterialAssets(db, log),
    modelArkAsset: modelArkAsset(db, log),
    bulkUpdateKey: bulkUpdateKey(db, log, cfg),
  };
};
