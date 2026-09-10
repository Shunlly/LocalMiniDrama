const aiConfigService = require('../services/aiConfigService');
const response = require('../response');
const { publicErrorMessage } = require('./serviceFailure');

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
      return response.badRequest(res, '请填写服务类型、名称、厂商和接口地址');
    }
    if (body.api_key === undefined || body.api_key === null) {
      return response.badRequest(res, '请填写密钥');
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
        return response.error(res, 400, err.code || 'BAD_REQUEST', publicErrorMessage(err, 'AI 配置无效'), err.details);
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
        return response.error(res, err.status, err.code || 'BAD_REQUEST', publicErrorMessage(err, 'AI 配置无效'), err.details);
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
      return response.badRequest(res, '批量换密钥仅在厂商锁定模式下可用');
    }
    const { api_key } = req.body || {};
    if (!api_key || !api_key.trim()) {
      return response.badRequest(res, '请提供新的密钥');
    }
    try {
      const result = aiConfigService.bulkUpdateApiKey(db, log, api_key.trim());
      response.success(res, {
        ...result,
        message: `已更新 ${result.updated} 条配置的密钥`,
      });
    } catch (err) {
      log.error('Bulk update api_key failed', { error: err.message });
      response.internalError(res, '批量换密钥失败');
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

function createClientAbort(req, res, cancelMessage = '连接测试已取消') {
  const controller = new AbortController();
  const abort = () => {
    if (controller.signal.aborted) return;
    const error = new Error(cancelMessage);
    error.code = 'ERR_CANCELED';
    error.name = 'AbortError';
    controller.abort(error);
  };
  const onClose = () => {
    if (!res?.headersSent && !res?.writableEnded) abort();
  };
  if (typeof res?.on === 'function') res.on('close', onClose);
  if (typeof req?.on === 'function') req.on('aborted', abort);
  return {
    signal: controller.signal,
    dispose() {
      if (typeof res?.off === 'function') res.off('close', onClose);
      else if (typeof res?.removeListener === 'function') res.removeListener('close', onClose);
      if (typeof req?.off === 'function') req.off('aborted', abort);
      else if (typeof req?.removeListener === 'function') req.removeListener('aborted', abort);
    },
  };
}

function applySavedConfigSecrets(savedConfig, body) {
  if (!savedConfig) return body;
  const savedSettings = mergeSettingsForRequest(savedConfig.settings, body.settings);
  return {
    ...body,
    ...savedConfig,
    base_url: savedConfig.base_url,
    provider: savedConfig.provider,
    api_protocol: savedConfig.api_protocol,
    endpoint: savedConfig.endpoint,
    query_endpoint: savedConfig.query_endpoint,
    service_type: savedConfig.service_type,
    model: savedConfig.model,
    default_model: savedConfig.default_model,
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
    http_method: body.http_method || savedSettings.http_method,
    action: body.action,
    payload: body.payload,
    limit: body.limit,
    cursor: body.cursor,
  };
}

function testConnection(db, log) {
  return async (req, res) => {
    const body = req.body || {};
    const clientAbort = createClientAbort(req, res);
    let savedConfig = null;
    let opts;
    try {
      savedConfig = getSavedConfigFromBody(db, body);
      opts = applySavedConfigSecrets(savedConfig, body);
    } catch (err) {
      clientAbort.dispose();
      if (err.status === 404) return response.notFound(res, publicErrorMessage(err, '配置不存在'));
      return response.badRequest(res, publicErrorMessage(err, 'AI 配置无效'));
    }
    const apiKeyOptional = aiConfigService.isApiKeyOptionalConnection(opts);
    const missingRequiredKey = !apiKeyOptional && (!opts.api_key || aiConfigService.isMaskedSecret(opts.api_key));
    if (!opts.base_url || missingRequiredKey) {
      clientAbort.dispose();
      return response.badRequest(res, apiKeyOptional ? '缺少接口地址' : '缺少接口地址或密钥');
    }
    try {
      await aiConfigService.testConnection({
        base_url: opts.base_url,
        api_key: opts.api_key,
        model: opts.model,
        default_model: opts.default_model,
        provider: opts.provider,
        api_protocol: opts.api_protocol,
        endpoint: opts.endpoint,
        service_type: opts.service_type,
        settings: savedConfig ? savedConfig.settings : opts.settings,
        trusted_origins: req.providerNetworkTrustedOrigins,
        provider_network_policy: req.providerNetworkPolicy,
        signal: clientAbort.signal,
      });
      if (!res.writableEnded) response.success(res, { message: '连接测试成功' });
    } catch (err) {
      if (res.writableEnded) return;
      if (err?.code === 'INVALID_AI_CONFIG') {
        return response.error(res, err.status || 400, err.code, publicErrorMessage(err, 'AI 配置无效'), err.details);
      }
      const { toSafeProviderErrorMessage } = require('../services/providerErrorSanitizer');
      const trustedMessage = publicErrorMessage(err, '');
      const markedSafe = !!err?.[Symbol.for('localMiniDrama.safeProviderError')];
      const safeMessage = trustedMessage && markedSafe
        ? trustedMessage
        : toSafeProviderErrorMessage(err, {
          provider: opts.provider || 'AI 服务',
          operation: '连接测试',
        });
      log.error('AI config test connection failed', { error: safeMessage });
      log.operation?.({
        operation: 'ai_config_test',
        phase: 'error',
        provider: opts.provider || null,
        error: safeMessage,
      });
      if (err?.code === 'ERR_CANCELED' || err?.name === 'AbortError') {
        return response.badRequest(res, safeMessage || '连接测试已取消');
      }
      if (trustedMessage && markedSafe) {
        return response.badRequest(res, safeMessage);
      }
      response.badRequest(res, '连接测试失败: ' + safeMessage);
    } finally {
      clientAbort.dispose();
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
      if (err.status === 404) return response.notFound(res, publicErrorMessage(err, '配置不存在'));
      return response.badRequest(res, publicErrorMessage(err, 'AI 配置无效'));
    }
    const base_url = (savedConfig?.base_url || '').toString().trim().replace(/\/$/, '');
    const { normalizeMaterialHubToken } = require('../services/jimengMaterialHubService');
    let api_key = body.api_key && !aiConfigService.isMaskedSecret(body.api_key) ? body.api_key : savedConfig?.api_key || '';
    api_key = normalizeMaterialHubToken(api_key || '');
    if (!base_url || !api_key) {
      return response.badRequest(res, '请先填写网关地址与密钥');
    }
    const jimengMaterialHubService = require('../services/jimengMaterialHubService');
    const ctx = { baseUrl: base_url, token: api_key, networkPolicy: req.providerNetworkPolicy };
    const r = await jimengMaterialHubService.listAssets(ctx, { limit: body.limit, cursor: body.cursor }, log);
    if (!r.ok) {
      return response.badRequest(res, publicErrorMessage({ message: r.error }, '列出素材失败'));
    }
    response.success(res, r.data);
  };
}


function sameDiscoverOrigin(left, right) {
  try {
    return new URL(String(left)).origin === new URL(String(right)).origin;
  } catch (_) {
    return false;
  }
}

function sameDiscoverProvider(left, right) {
  return String(left || '').trim().toLowerCase().replace(/-/g, '_')
    === String(right || '').trim().toLowerCase().replace(/-/g, '_');
}

function findSavedConfigByOrigin(db, body) {
  const requested = String(body.base_url || '').trim();
  if (!requested) return null;
  const serviceType = String(body.service_type || '').trim();
  const rows = aiConfigService.listConfigs(db, serviceType || undefined);
  const matches = rows.filter((row) => sameDiscoverOrigin(row.base_url, requested));
  if (!matches.length) return null;
  const provider = String(body.provider || '').trim();
  if (provider) {
    const byProvider = matches.filter((row) => sameDiscoverProvider(row.provider, provider));
    if (byProvider.length) return byProvider[0];
  }
  return matches[0];
}

function resolveDiscoverModelsOptions(db, cfg, body) {
  const lockEnabled = aiConfigService.getVendorLockStatus(cfg).enabled;
  let saved = null;
  if (body.id != null || body.config_id != null) {
    saved = getSavedConfigFromBody(db, body);
  }
  if (lockEnabled) {
    if (!saved) saved = findSavedConfigByOrigin(db, body);
    if (!saved) {
      const err = new Error('当前为厂商锁定模式，只能读取已配置服务的模型目录');
      err.status = 400;
      err.code = 'VENDOR_LOCK_DISCOVER_DENIED';
      throw err;
    }
    return applySavedConfigSecrets(saved, body);
  }
  if (!saved) return body;
  const usingSavedKey = !body.api_key || aiConfigService.isMaskedSecret(body.api_key);
  const merged = applySavedConfigSecrets(saved, body);
  if (usingSavedKey) return merged;
  return {
    ...merged,
    base_url: body.base_url || saved.base_url,
    provider: body.provider || saved.provider,
    service_type: body.service_type || saved.service_type,
    api_protocol: body.api_protocol != null ? body.api_protocol : saved.api_protocol,
    settings: body.settings != null
      ? JSON.stringify(mergeSettingsForRequest(saved.settings, body.settings))
      : saved.settings,
  };
}

function discoverModels(db, log, cfg) {
  return async (req, res) => {
    const body = req.body || {};
    const clientAbort = createClientAbort(req, res, '读取模型目录已取消');
    let opts;
    try {
      opts = resolveDiscoverModelsOptions(db, cfg, body);
    } catch (err) {
      clientAbort.dispose();
      if (err.status === 404) return response.notFound(res, publicErrorMessage(err, '配置不存在'));
      return response.badRequest(res, publicErrorMessage(err, 'AI 配置无效'));
    }
    if (!opts.provider || !opts.base_url) {
      clientAbort.dispose();
      return response.badRequest(res, '请填写厂商和接口地址');
    }
    const apiKeyOptional = aiConfigService.isApiKeyOptionalConnection(opts);
    const missingRequiredKey = !apiKeyOptional && (!opts.api_key || aiConfigService.isMaskedSecret(opts.api_key));
    if (missingRequiredKey) {
      clientAbort.dispose();
      return response.badRequest(res, '请填写密钥');
    }
    try {
      const result = await aiConfigService.discoverModels({
        base_url: opts.base_url,
        api_key: opts.api_key,
        provider: opts.provider,
        service_type: opts.service_type,
        api_protocol: opts.api_protocol,
        settings: opts.settings,
        signal: clientAbort.signal,
      });
      if (!res.writableEnded) response.success(res, result);
    } catch (err) {
      if (res.writableEnded) return;
      const safeMessage = publicErrorMessage(err, '读取模型目录失败，请检查接口地址和密钥');
      log.error('AI config discover models failed', {
        error: safeMessage,
        provider: opts.provider || null,
      });
      log.operation?.({
        operation: 'ai_config_discover_models',
        phase: 'error',
        provider: opts.provider || null,
        error: safeMessage,
      });
      response.badRequest(res, safeMessage);
    } finally {
      clientAbort.dispose();
    }
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
    discoverModels: discoverModels(db, log, cfg),
    listJimeng2MaterialAssets: listJimeng2MaterialAssets(db, log),
    modelArkAsset: modelArkAsset(db, log),
    bulkUpdateKey: bulkUpdateKey(db, log, cfg),
  };
};
