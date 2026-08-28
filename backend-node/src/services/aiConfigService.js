// AI 配置 CRUD，与 Go application/services/ai_service.go 对齐
const fs = require('fs');
const net = require('net');
const path = require('path');
const { normalizeMaterialHubToken } = require('./jimengMaterialHubService');

function normalizeApiKeyForService(serviceType, apiKey) {
  if (serviceType === 'jimeng2_character_auth' && apiKey != null) {
    return normalizeMaterialHubToken(apiKey);
  }
  return apiKey;
}
const { applyDeepSeekConnectivityOptions } = require('./deepseekConfig');
const { probeComfyUiConnection, sanitizeProviderText } = require('./comfyUiClient');
const uploadService = require('./uploadService');
const { secureHttpFetch, validateHttpRequestTarget } = require('./secureHttpFetch');
const { requireCompleteProviderNetworkPolicy } = require('./providerNetworkPolicy');
const {
  fieldKeyWords: settingKeyWords,
  isSensitiveFieldKey: isSensitiveSettingKey,
} = require('./sensitiveFieldPolicy');
const MASKED_SECRET = '********';

const LOCAL_ONLY_PROVIDERS = new Set([
  'comfyui',
  'comfy_ui',
  'jimeng_ai_api',
  'lmstudio',
  'local_openai',
  'local_sd',
  'local_tts',
  'ollama',
]);
const LOCAL_MODE_CAPABLE_PROVIDERS = new Set([
  ...LOCAL_ONLY_PROVIDERS,
  'openai_compatible',
]);
const BLOCKED_LOCAL_HOSTS = new Set([
  'instance-data',
  'metadata',
  'metadata.azure.internal',
  'metadata.google.internal',
]);
const BLOCKED_PROVIDER_IPS = new Set([
  '100.100.100.200',
  '168.63.129.16',
  '169.254.169.254',
  '169.254.170.2',
  'fd00:ec2::254',
]);

function providerUrlValidationError(message) {
  const error = new Error(message);
  error.code = 'INVALID_PROVIDER_URL';
  error.status = 400;
  return error;
}

function aiConfigValidationError(message, details) {
  const error = new Error(message);
  error.code = 'INVALID_AI_CONFIG';
  error.status = 400;
  error.details = details;
  return error;
}

function normalizedProviderId(value) {
  return String(value || '').trim().toLowerCase().replace(/-/g, '_');
}

function isAllowedLocalIpv4(hostname) {
  const octets = hostname.split('.').map(Number);
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
    return false;
  }
  return octets[0] === 10
    || octets[0] === 127
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168);
}

function isAllowedLocalIpv6(hostname) {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === '::1') return true;
  const first = host.split(':', 1)[0];
  if (!/^[0-9a-f]{4}$/.test(first)) return false;
  return (parseInt(first, 16) & 0xfe00) === 0xfc00;
}

function isExplicitLocalProviderHost(hostname) {
  const host = String(hostname || '').trim().replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (!host
    || BLOCKED_LOCAL_HOSTS.has(host)
    || BLOCKED_PROVIDER_IPS.has(host)
    || host.endsWith('.metadata.google.internal')) return false;
  const family = net.isIP(host);
  if (family === 4) return isAllowedLocalIpv4(host);
  if (family === 6) return isAllowedLocalIpv6(host);
  return !host.includes('.')
    || host === 'localhost'
    || host.endsWith('.localhost')
    || host.endsWith('.local')
    || host.endsWith('.internal')
    || host.endsWith('.home.arpa')
    || host.endsWith('.docker.internal');
}

function isExplicitLocalProviderConfig(config = {}) {
  const provider = normalizedProviderId(config.provider);
  if (!LOCAL_MODE_CAPABLE_PROVIDERS.has(provider)) return false;
  const settings = parseSettingsValue(config.settings) || {};
  return settings.allow_local_http === true;
}

function normalizeProviderBaseUrl(value, config = {}) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  let parsed;
  try {
    parsed = new URL(raw);
  } catch (_) {
    throw providerUrlValidationError('base_url 必须是合法的 HTTP(S) URL');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw providerUrlValidationError('base_url 仅支持 HTTP(S)');
  }
  if (parsed.username || parsed.password) {
    throw providerUrlValidationError('base_url 不得包含用户名或密码，请使用认证字段');
  }
  if (parsed.search) {
    throw providerUrlValidationError('base_url 不得包含查询参数，请使用 endpoint 或认证字段');
  }
  if (parsed.hash) {
    throw providerUrlValidationError('base_url 不得包含 URL 片段');
  }
  const localTarget = isExplicitLocalProviderHost(parsed.hostname);
  const localMode = isExplicitLocalProviderConfig(config);
  const normalizedHost = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (BLOCKED_LOCAL_HOSTS.has(normalizedHost)
    || BLOCKED_PROVIDER_IPS.has(normalizedHost)
    || normalizedHost.endsWith('.metadata.google.internal')
    || (net.isIP(normalizedHost) && !localTarget && !uploadService.isGloballyRoutableIp(normalizedHost))) {
    throw providerUrlValidationError('服务地址指向被拦截或不可路由的网络位置');
  }
  if (localTarget && !localMode) {
    throw providerUrlValidationError('私有或本地服务地址需要使用已识别的本地 Provider 模式');
  }
  if (parsed.protocol === 'http:' && (!localTarget || !localMode)) {
    throw providerUrlValidationError('公网服务地址必须使用 HTTPS');
  }
  return parsed.toString().replace(/\/$/, '');
}

function getProviderNetworkOptions(config = {}, overrides = {}) {
  const baseUrl = normalizeProviderBaseUrl(config.base_url, config);
  if (!baseUrl) throw providerUrlValidationError('base_url 必填');
  const parsed = new URL(baseUrl);
  const allowPrivate = isExplicitLocalProviderHost(parsed.hostname) && isExplicitLocalProviderConfig(config);
  return {
    ...overrides,
    baseUrl,
    trustedOrigins: [baseUrl],
    allowPrivateOrigins: allowPrivate ? [baseUrl] : [],
    requireHttpsForPublic: true,
  };
}

function sanitizeProviderUrlForResponse(value) {
  const raw = String(value || '').trim();
  if (!raw) return raw;
  try {
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol)) return '';
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString().replace(/\/$/, '');
  } catch (_) {
    return '';
  }
}

function isMaskedSecret(value) {
  return String(value || '').trim() === MASKED_SECRET;
}

function hasSecret(value) {
  return value != null && String(value).trim() !== '';
}

function maskSecretValue(value) {
  return hasSecret(value) ? MASKED_SECRET : '';
}

const SAFE_RESPONSE_HEADER_NAMES = new Set([
  'accept',
  'acceptencoding',
  'cachecontrol',
  'contenttype',
  'useragent',
]);

function isHeaderContainerKey(key) {
  return settingKeyWords(key).some((word) => word === 'header' || word === 'headers');
}

function isSafeResponseHeaderName(name) {
  return SAFE_RESPONSE_HEADER_NAMES.has(settingKeyWords(name).join(''));
}

function isSensitiveQueryParameter(key) {
  const compact = settingKeyWords(key).join('');
  return compact === 'auth'
    || compact === 'apikey'
    || compact === 'key'
    || compact === 'sig'
    || /authorization|bearer|cookie|credential|password|secret|signature|sessiontoken|token/.test(compact)
    || (compact.includes('key') && /access|api|auth|client|private|secret|session|signing|xapi/.test(compact));
}

const SAFE_PROVIDER_QUERY_PARAMETERS = new Set([
  'alt',
  'apiversion',
  'format',
  'page',
  'pagesize',
  'prettyprint',
  'responseformat',
  'version',
  'view',
]);

function isSafeProviderQueryParameter(key) {
  return SAFE_PROVIDER_QUERY_PARAMETERS.has(settingKeyWords(key).join(''));
}

function normalizeProviderEndpoint(value, fieldName = 'endpoint') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.length > 2048
    || !raw.startsWith('/')
    || raw.startsWith('//')
    || raw.includes('\\')
    || /[\u0000-\u0020\u007f]/.test(raw)) {
    throw providerUrlValidationError(`${fieldName} 必须是受控的相对 URL 路径`);
  }
  if (raw.includes('#')) throw providerUrlValidationError(`${fieldName} 不得包含 URL 片段`);
  const queryIndex = raw.indexOf('?');
  const pathname = queryIndex >= 0 ? raw.slice(0, queryIndex) : raw;
  const query = queryIndex >= 0 ? raw.slice(queryIndex + 1) : '';
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch (_) {
    throw providerUrlValidationError(`${fieldName} 包含无效的 URL 编码`);
  }
  if (decodedPath.includes('\\') || decodedPath.split('/').some((segment) => segment === '.' || segment === '..')) {
    throw providerUrlValidationError(`${fieldName} 包含不安全的路径段`);
  }
  for (const key of new URLSearchParams(query).keys()) {
    if (isSensitiveQueryParameter(key) || !isSafeProviderQueryParameter(key)) {
      throw providerUrlValidationError(`${fieldName} 不得在查询参数中携带凭据`);
    }
  }
  return raw;
}

function sanitizeProviderEndpointForResponse(value) {
  const raw = String(value || '').trim();
  if (!raw) return raw;
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\') || /[\u0000-\u001f\u007f]/.test(raw)) return '';
  const hashIndex = raw.indexOf('#');
  const withoutHash = hashIndex >= 0 ? raw.slice(0, hashIndex) : raw;
  const queryIndex = withoutHash.indexOf('?');
  if (queryIndex < 0) return withoutHash;
  const pathname = withoutHash.slice(0, queryIndex);
  const params = new URLSearchParams(withoutHash.slice(queryIndex + 1));
  for (const key of [...params.keys()]) {
    if (isSensitiveQueryParameter(key) || !isSafeProviderQueryParameter(key)) params.delete(key);
  }
  const query = params.toString();
  return `${pathname}${query ? `?${query}` : ''}`;
}

function sanitizeProtocolRelativeProviderUrl(value) {
  try {
    const parsed = new URL(`https:${value}`);
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    parsed.hash = '';
    return `//${parsed.host}${parsed.pathname}`.replace(/\/$/, '');
  } catch (_) {
    return '';
  }
}

function sanitizeRelativeProviderLocation(value) {
  const hashIndex = value.indexOf('#');
  const withoutHash = hashIndex >= 0 ? value.slice(0, hashIndex) : value;
  const queryIndex = withoutHash.indexOf('?');
  if (queryIndex < 0) return withoutHash;
  const pathname = withoutHash.slice(0, queryIndex);
  const params = new URLSearchParams(withoutHash.slice(queryIndex + 1));
  for (const key of [...params.keys()]) {
    if (isSensitiveQueryParameter(key) || !isSafeProviderQueryParameter(key)) params.delete(key);
  }
  const query = params.toString();
  return `${pathname}${query ? `?${query}` : ''}`;
}

function sanitizeProviderLocationForResponse(value) {
  if (typeof value !== 'string') return value;
  const raw = value.trim();
  if (!raw) return value;
  if (/^https?:\/\//i.test(raw)) return sanitizeProviderUrlForResponse(raw);
  if (raw.startsWith('//')) return sanitizeProtocolRelativeProviderUrl(raw);
  if (raw.startsWith('/') || /^[A-Za-z0-9._~-]+\/[^\s]*[?#]/.test(raw)) {
    return sanitizeRelativeProviderLocation(raw);
  }

  return value
    .replace(/https?:\/\/[^\s,"'<>[\]{}(),;]+/gi, (url) => sanitizeProviderUrlForResponse(url))
    .replace(/(^|[^:])(\/\/[^\s,"'<>[\]{}(),;]+)/gi, (match, prefix, url) => (
      `${prefix}${sanitizeProtocolRelativeProviderUrl(url)}`
    ))
    .replace(
      /[A-Za-z0-9._~:@%+=\/-]+\?[^\s,"'<>[\]{}(),;]+/gi,
      (url) => sanitizeRelativeProviderLocation(url)
    );
}

function maskHeaderCollection(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return maskSecretValue(entry);
      const headerName = entry.name ?? entry.key ?? '';
      const safe = isSafeResponseHeaderName(headerName);
      const out = {};
      for (const [key, child] of Object.entries(entry)) {
        if (key === 'name' || key === 'key') out[key] = child;
        else if (key === 'value' || key === 'values') out[key] = safe
          ? maskSensitiveSettingsObject(child, key)
          : maskSecretValue(child);
        else out[key] = isSensitiveSettingKey(key) ? maskSecretValue(child) : maskSensitiveSettingsObject(child, key);
      }
      return out;
    });
  }
  if (!value || typeof value !== 'object') return maskSecretValue(value);
  const out = {};
  for (const [name, child] of Object.entries(value)) {
    out[name] = isSafeResponseHeaderName(name)
      ? maskSensitiveSettingsObject(child, name)
      : maskSecretValue(child);
  }
  return out;
}

function maskSensitiveSettingsObject(value, parentKey = '') {
  if (isHeaderContainerKey(parentKey)) return maskHeaderCollection(value);
  if (Array.isArray(value)) return value.map((child) => maskSensitiveSettingsObject(child, parentKey));
  if (typeof value === 'string') return sanitizeProviderLocationForResponse(value);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if (isSensitiveSettingKey(key)) {
      out[key] = maskSecretValue(child);
    } else if (isHeaderContainerKey(key)) {
      out[key] = maskHeaderCollection(child);
    } else {
      out[key] = maskSensitiveSettingsObject(child, key);
    }
  }
  return out;
}

function parseSettingsValue(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function maskSensitiveSettings(settings) {
  const parsed = parseSettingsValue(settings);
  if (!parsed) {
    if (typeof settings !== 'string') return settings;
    let masked = settings.replace(
      /([A-Za-z][A-Za-z0-9_-]*)(\s*[:=]\s*)(.*?)(?=(?:\s+|,\s*)[A-Za-z][A-Za-z0-9_-]*\s*[:=]|[,}\n]|$)/g,
      (match, key, separator) => isSensitiveSettingKey(key)
        ? `${key}${separator}${MASKED_SECRET}`
        : match
    );
    masked = masked.replace(/\b(sk-[A-Za-z0-9._-]{6,})\b/g, '********');
    return sanitizeProviderLocationForResponse(masked);
  }
  return JSON.stringify(maskSensitiveSettingsObject(parsed));
}

function preserveMaskedSettingsValue(nextValue, existingValue) {
  if (isMaskedSecret(nextValue)) return existingValue;
  if (Array.isArray(nextValue)) {
    return nextValue.map((item, index) => preserveMaskedSettingsValue(item, Array.isArray(existingValue) ? existingValue[index] : undefined));
  }
  if (nextValue && typeof nextValue === 'object') {
    const out = {};
    for (const [key, child] of Object.entries(nextValue)) {
      out[key] = preserveMaskedSettingsValue(child, existingValue && typeof existingValue === 'object' ? existingValue[key] : undefined);
    }
    return out;
  }
  return nextValue;
}

function preserveMaskedSettings(nextSettings, existingSettings) {
  if (nextSettings == null) return nextSettings;
  const nextParsed = parseSettingsValue(nextSettings);
  if (!nextParsed) return nextSettings;
  const existingParsed = parseSettingsValue(existingSettings) || {};
  return JSON.stringify(preserveMaskedSettingsValue(nextParsed, existingParsed));
}

function hasStoredCredentialValue(value) {
  const normalized = String(value || '').trim();
  return normalized !== '' && normalized !== MASKED_SECRET;
}

function hasStoredCredentials(config = {}) {
  if (hasStoredCredentialValue(config.api_key)) return true;
  const settings = parseSettingsValue(config.settings) || {};
  const credentialPairs = [
    ['kling_access_key', 'kling_secret_key'],
    ['access_key', 'secret_key'],
    ['access_key_id', 'secret_access_key'],
  ];
  return credentialPairs.some(([accessKey, secretKey]) => (
    hasStoredCredentialValue(settings[accessKey])
      && hasStoredCredentialValue(settings[secretKey])
  ));
}

function configForResponse(config) {
  if (!config) return config;
  const maskedConfig = maskSensitiveSettingsObject(config);
  return {
    ...maskedConfig,
    base_url: sanitizeProviderUrlForResponse(config.base_url),
    endpoint: sanitizeProviderEndpointForResponse(config.endpoint),
    query_endpoint: sanitizeProviderEndpointForResponse(config.query_endpoint),
    api_key: maskSecretValue(config.api_key),
    api_key_set: hasStoredCredentialValue(config.api_key),
    credential_set: hasStoredCredentials(config),
    settings: maskSensitiveSettings(config.settings),
  };
}

function normalizeModelList(model) {
  const source = Array.isArray(model) ? model : (model == null ? [] : [model]);
  const seen = new Set();
  const normalized = [];
  for (const item of source) {
    const value = String(item ?? '').trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    normalized.push(value);
  }
  return normalized;
}

function normalizeDefaultModel(defaultModel) {
  const normalized = String(defaultModel ?? '').trim();
  return normalized || null;
}

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

function normalizeConfigModels(config = {}) {
  return {
    model: normalizeModelList(config.model),
    default_model: normalizeDefaultModel(config.default_model),
  };
}

function assertDefaultModelMembership(config = {}) {
  const normalized = normalizeConfigModels(config);
  if (normalized.default_model && !normalized.model.includes(normalized.default_model)) {
    throw aiConfigValidationError(
      '默认模型不在可用模型列表中，请在 AI 配置中重新选择默认模型',
      { field: 'default_model', issue: 'not_in_model_list' }
    );
  }
  return normalized;
}

function resolveConfiguredModel(config = {}, preferredModel, fallback) {
  const normalized = assertDefaultModelMembership(config);
  const preferred = String(preferredModel ?? '').trim();
  if (preferred && !normalized.model.includes(preferred)) {
    throw aiConfigValidationError(
      '请求的模型不在可用模型列表中，请在 AI 配置中重新选择模型',
      { field: 'model', issue: 'not_in_model_list' }
    );
  }
  return preferred
    || normalized.default_model
    || normalized.model[0]
    || String(fallback ?? '').trim();
}

function normalizeWritableConfigModels(config = {}) {
  const inactive = config.is_active === false || config.is_active === 0;
  return inactive ? normalizeConfigModels(config) : assertDefaultModelMembership(config);
}

function modelToDb(model) {
  if (model == null) return null;
  return JSON.stringify(normalizeModelList(model));
}

function modelFromDb(val) {
  if (val == null || val === '') return [];
  try {
    const arr = JSON.parse(val);
    return Array.isArray(arr) ? arr : [String(arr)];
  } catch {
    return [String(val)];
  }
}

function listConfigs(db, serviceType) {
  const order = 'ORDER BY is_default DESC, priority DESC, created_at DESC';
  let sql = 'SELECT * FROM ai_service_configs WHERE deleted_at IS NULL ' + order;
  const params = [];
  if (serviceType) {
    sql = 'SELECT * FROM ai_service_configs WHERE deleted_at IS NULL AND service_type = ? ' + order;
    params.push(serviceType);
  }
  const rows = params.length ? db.prepare(sql).all(...params) : db.prepare(sql).all();
  return rows.map(rowToConfig);
}

function clearOtherDefault(db, serviceType, exceptId) {
  if (exceptId == null) {
    db.prepare(
      'UPDATE ai_service_configs SET is_default = 0 WHERE deleted_at IS NULL AND service_type = ?'
    ).run(serviceType);
    return;
  }
  db.prepare(
    'UPDATE ai_service_configs SET is_default = 0 WHERE deleted_at IS NULL AND service_type = ? AND id != ?'
  ).run(serviceType, exceptId);
}

function getConfig(db, id) {
  const row = db.prepare('SELECT * FROM ai_service_configs WHERE id = ? AND deleted_at IS NULL').get(id);
  return row ? rowToConfig(row) : null;
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
    if (p === 'openai') {
      if (st === 'text') endpoint = '/chat/completions';
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
      if (st === 'text') endpoint = '/chat/completions';
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

function rowToConfig(r) {
  const cfg = {
    id: r.id,
    service_type: r.service_type,
    provider: r.provider,
    api_protocol: r.api_protocol || '',
    name: r.name,
    base_url: r.base_url,
    api_key: r.api_key,
    model: modelFromDb(r.model),
    default_model: r.default_model ? String(r.default_model).trim() : null,
    endpoint: r.endpoint,
    query_endpoint: r.query_endpoint,
    priority: r.priority ?? 0,
    is_default: !!r.is_default,
    is_active: r.is_active == null ? true : !!r.is_active,
    settings: r.settings,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
  // TTS 配置：从 settings JSON 展开 voice_id / group_id 供 ttsService 直接读取
  if (r.service_type === 'tts' && r.settings) {
    try {
      const s = JSON.parse(r.settings);
      if (s.voice_id) cfg.voice_id = s.voice_id;
      if (s.group_id) cfg.group_id = s.group_id;
    } catch (_) {}
  }
  return cfg;
}

/**
 * 测试连接：与 Go AIService.TestConnection 对齐，根据 provider 发最小请求验证 base_url + api_key
 * @param opts { base_url, api_key, model (string|string[]), provider?, endpoint?, settings? }
 * @returns Promise<void> 成功 resolve，失败 reject(error)
 */
const CONNECTION_TEST_TIMEOUT_MS = 15000;

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
  const url = `${base}/models`;
  const res = await fetchConnectionProbe(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}` },
  }, networkOptions);
  if (res.ok) return;
  const text = await res.text();
  let detail = '';
  try {
    const parsed = JSON.parse(text);
    detail = parsed?.error?.message || parsed?.message || '';
  } catch (_) {
    detail = text;
  }
  const suffix = detail ? ` - ${String(detail).slice(0, 150)}` : '';
  throw new Error(`模型列表探测失败: ${res.status}${suffix}`);
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
  const root = `${parsed.origin}${rootPath}`.replace(/\/+$/, '');
  const openAiBase = /\/v1$/i.test(pathWithoutSlash)
    ? `${parsed.origin}${pathWithoutSlash}`
    : `${root}/v1`;
  return [`${root}/api/tags`, `${openAiBase}/models`];
}

async function probeOllamaConnection(baseUrl, apiKey, networkOptions) {
  const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
  const failures = [];
  for (const url of ollamaProbeUrls(baseUrl)) {
    try {
      const response = await fetchConnectionProbe(url, { method: 'GET', headers }, networkOptions);
      if (response.ok) return;
      const raw = await response.text();
      failures.push({ status: response.status, detail: sanitizeProviderText(raw, apiKey ? [apiKey] : []) });
    } catch (error) {
      failures.push({ detail: sanitizeProviderText(error?.message, apiKey ? [apiKey] : []) });
    }
  }
  const last = failures[failures.length - 1] || {};
  const status = last.status ? ` (HTTP ${last.status})` : '';
  const detail = last.detail ? `: ${last.detail}` : '';
  throw new Error(`Ollama 模型列表探测失败${status}${detail}`);
}

async function testConnectionUnsafe(opts) {
  const base = normalizeProviderBaseUrl(opts.base_url, opts);
  if (!base) throw new Error('base_url 必填');
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
  if (!model && (opts.provider === 'gemini' || opts.provider === 'google')) throw new Error('model 必填');
  let endpoint = opts.endpoint || '';
  if (!opts.api_key && !isApiKeyOptionalConnection({ provider, api_protocol: apiProtocol })) {
    throw new Error('api_key 必填');
  }

  if (provider === 'ollama') {
    await probeOllamaConnection(base, opts.api_key || '', networkOptions);
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
    if (res.status === 401 || res.status === 403) {
      const text = await res.text();
      let errMsg = `API Key 无效 (${res.status})`;
      try { const j = JSON.parse(text); errMsg = j.msg || j.message || errMsg; } catch {}
      throw new Error(errMsg);
    }
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
      const text = await res.text();
      throw new Error(`请求失败: ${res.status} ${text.slice(0, 200)}`);
    }
    const data = await res.json().catch(() => ({}));
    if (data.candidates == null && data.error != null) {
      throw new Error(data.error.message || data.error || 'Gemini 返回错误');
    }
    return;
  }

  if (apiProtocol === 'openai' || provider === 'openai' || provider === 'openai-compatible') {
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
    if (res.status === 401 || res.status === 403) {
      const text = await res.text();
      let errMsg = `API Key 无效 (${res.status})`;
      try { const j = JSON.parse(text); errMsg = j.base_resp?.status_msg || j.error?.message || j.message || errMsg; } catch {}
      throw new Error(errMsg);
    }
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
    // 401/403 = key 无效，其他均视为联通
    if (res.status === 401 || res.status === 403) {
      const text = await res.text();
      let errMsg = `API Key 无效 (${res.status})`;
      try { const j = JSON.parse(text); errMsg = j.error?.message || j.message || errMsg; } catch {}
      throw new Error(errMsg);
    }
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
    // 401/403 = key 无效；其他（400 模型不存在等）视为联通
    if (res.status === 401 || res.status === 403) {
      const text = await res.text();
      let errMsg = `API Key 无效 (${res.status})`;
      try { const j = JSON.parse(text); errMsg = j.error?.message || j.message || errMsg; } catch {}
      throw new Error(errMsg);
    }
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
    // 401/403 = key 无效；其他状态（含 400 参数错误、429 限流等）表示已联通
    if (res.status === 401 || res.status === 403) {
      const text = await res.text();
      let errMsg = `API Key 无效 (${res.status})`;
      try {
        const j = JSON.parse(text);
        errMsg = j.error?.message || j.message || errMsg;
      } catch {}
      throw new Error(errMsg);
    }
    if (!res.ok) {
      // 其他 4xx/5xx：如果能解析出明确的 auth 错误才拒绝，否则视为联通
      const text = await res.text();
      let parsed = null;
      try { parsed = JSON.parse(text); } catch {}
      const msg = parsed?.error?.message || parsed?.message || '';
      const lmsg = msg.toLowerCase();
      const isAuthErr = lmsg.includes('unauthorized') || lmsg.includes('invalid api key')
        || lmsg.includes('authentication') || lmsg.includes('forbidden');
      if (isAuthErr) throw new Error(`API Key 无效: ${msg || res.status}`);
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
    const text = await res.text();
    let errMsg = `请求失败: ${res.status}`;
    try {
      const j = JSON.parse(text);
      errMsg += ' - ' + (j.error?.message || j.message || j.error || text.slice(0, 150));
    } catch {
      if (text) errMsg += ' - ' + text.slice(0, 150);
    }
    throw new Error(errMsg);
  }
  const data = await res.json().catch(() => ({}));
  if (data.choices == null && data.error != null) {
    throw new Error(data.error.message || data.error || '接口返回错误');
  }
}

async function testConnection(opts) {
  try {
    return await testConnectionUnsafe(opts);
  } catch (error) {
    const secrets = [opts?.api_key, opts?.access_key_id, opts?.secret_access_key, opts?.session_token]
      .filter((value) => value != null && String(value).length >= 3)
      .map(String);
    const message = sanitizeProviderText(error?.message, secrets) || '连接测试失败';
    const safeError = new Error(message);
    if (error?.code) safeError.code = error.code;
    if (error?.status) safeError.status = error.status;
    if (error?.details) safeError.details = error.details;
    throw safeError;
  }
}

/**
 * 返回 vendor_lock 状态
 */
function getVendorLockStatus(cfg) {
  const lock = cfg?.vendor_lock;
  return {
    enabled: !!(lock?.enabled),
    config_file: lock?.config_file || '',
  };
}

function normalizeVendorSettings(settings) {
  if (settings == null || settings === '') return null;
  return typeof settings === 'string' ? settings : JSON.stringify(settings);
}

function normalizeVendorConfig(item, index) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    throw new Error(`config at index ${index} must be an object`);
  }
  const serviceType = String(item.service_type || 'text').trim() || 'text';
  const normalizedModels = normalizeWritableConfigModels({
    model: item.model,
    default_model: item.default_model,
    is_active: true,
  });
  const config = {
    service_type: serviceType,
    provider: String(item.provider || '').trim(),
    api_protocol: String(item.api_protocol || ''),
    name: String(item.name || ''),
    base_url: String(item.base_url || ''),
    api_key: normalizeApiKeyForService(serviceType, String(item.api_key || '')),
    model: modelToDb(normalizedModels.model) || '[]',
    default_model: normalizedModels.default_model,
    endpoint: String(item.endpoint || ''),
    query_endpoint: String(item.query_endpoint || ''),
    priority: item.priority ?? 0,
    is_default: item.is_default ? 1 : 0,
    is_active: 1,
    settings: normalizeVendorSettings(item.settings),
  };
  config.base_url = normalizeProviderBaseUrl(config.base_url, config);
  config.endpoint = normalizeProviderEndpoint(config.endpoint, 'endpoint');
  config.query_endpoint = normalizeProviderEndpoint(config.query_endpoint, 'query_endpoint');
  return config;
}

function reconcileVendorConfigDefaults(configs) {
  const defaults = new Map();
  for (const config of configs) {
    if (!config.is_default) continue;
    const current = defaults.get(config.service_type);
    if (!current || Number(config.priority || 0) > Number(current.priority || 0)) {
      if (current) current.is_default = 0;
      defaults.set(config.service_type, config);
    } else {
      config.is_default = 0;
    }
  }
  return configs;
}

function vendorConfigIdentity(config) {
  return `${String(config.service_type || 'text').trim().toLowerCase()}\u0000${String(config.provider || '').trim().toLowerCase()}`;
}

function pickVendorConfigRow(rows, config, claimedIds) {
  const identity = vendorConfigIdentity(config);
  const available = rows.filter((row) => !claimedIds.has(row.id) && vendorConfigIdentity(row) === identity);
  const named = available.filter((row) => String(row.name || '') === config.name);
  return named.find((row) => row.deleted_at == null)
    || available.find((row) => row.deleted_at == null)
    || named[0]
    || available[0]
    || null;
}

function vendorRowMatches(row, config) {
  return row.deleted_at == null
    && String(row.service_type || '') === config.service_type
    && String(row.provider || '') === config.provider
    && String(row.api_protocol || '') === config.api_protocol
    && String(row.name || '') === config.name
    && String(row.base_url || '') === config.base_url
    && String(row.api_key || '') === String(config.api_key || '')
    && String(row.model || '') === config.model
    && (row.default_model == null ? null : String(row.default_model)) === config.default_model
    && String(row.endpoint || '') === config.endpoint
    && String(row.query_endpoint || '') === config.query_endpoint
    && Number(row.priority || 0) === Number(config.priority || 0)
    && Number(row.is_default || 0) === config.is_default
    && Number(row.is_active == null ? 1 : row.is_active) === config.is_active
    && (row.settings == null ? null : String(row.settings)) === config.settings;
}

/**
 * Synchronize vendor-lock configs atomically while retaining matching row IDs.
 * Existing API keys remain user-managed; all other fields come from the lock file.
 */
function applyVendorLock(db, log, cfg) {
  const status = getVendorLockStatus(cfg);
  if (!status.enabled) return;

  const configFile = status.config_file;
  if (!configFile) {
    log.warn && log.warn('vendor_lock enabled but config_file is empty');
    return;
  }

  const candidates = [
    path.join(process.cwd(), 'configs', configFile),
    path.join(__dirname, '..', '..', 'configs', configFile),
  ];
  let raw = null;
  for (const p of candidates) {
    if (fs.existsSync(p)) { raw = fs.readFileSync(p, 'utf8'); break; }
  }
  if (!raw) {
    log?.warn?.('[vendor_lock] config file not found', { config_file: configFile });
    return;
  }

  let configs;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('config file must be a JSON array');
    configs = reconcileVendorConfigDefaults(parsed.map(normalizeVendorConfig));
  } catch (e) {
    log?.error?.('[vendor_lock] failed to parse config file', { error: e.message });
    return;
  }

  const synchronize = db.transaction(() => {
    const now = new Date().toISOString();
    const existing = db.prepare(
      'SELECT * FROM ai_service_configs ORDER BY CASE WHEN deleted_at IS NULL THEN 0 ELSE 1 END, id ASC'
    ).all();
    const claimedIds = new Set();
    const synchronized = [];
    let inserted = 0;
    let updated = 0;

    const update = db.prepare(
      `UPDATE ai_service_configs
          SET service_type = ?, provider = ?, api_protocol = ?, name = ?, base_url = ?, api_key = ?,
              model = ?, default_model = ?, endpoint = ?, query_endpoint = ?, priority = ?, is_default = ?,
              is_active = ?, settings = ?, updated_at = ?, deleted_at = NULL
        WHERE id = ?`
    );
    const insert = db.prepare(
      `INSERT INTO ai_service_configs
        (service_type, provider, api_protocol, name, base_url, api_key, model, default_model, endpoint, query_endpoint, priority, is_default, is_active, settings, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    for (const serviceType of new Set(configs.map((config) => config.service_type))) {
      clearOtherDefault(db, serviceType, null);
    }

    for (const config of configs) {
      const row = pickVendorConfigRow(existing, config, claimedIds);
      const values = {
        ...config,
        api_key: row ? row.api_key : config.api_key,
      };
      let id;
      if (row) {
        id = row.id;
        claimedIds.add(id);
        if (!vendorRowMatches(row, values)) {
          update.run(
            values.service_type, values.provider, values.api_protocol, values.name, values.base_url,
            values.api_key, values.model, values.default_model, values.endpoint, values.query_endpoint,
            values.priority, values.is_default, values.is_active, values.settings, now, id
          );
          updated += 1;
        }
      } else {
        const info = insert.run(
          values.service_type, values.provider, values.api_protocol, values.name, values.base_url,
          values.api_key, values.model, values.default_model, values.endpoint, values.query_endpoint,
          values.priority, values.is_default, values.is_active, values.settings, now, now
        );
        id = Number(info.lastInsertRowid);
        claimedIds.add(id);
        inserted += 1;
      }
      synchronized.push({ id, name: values.name, identity: vendorConfigIdentity(values) });
    }

    const softDelete = db.prepare(
      'UPDATE ai_service_configs SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL'
    );
    for (const row of existing) {
      if (!claimedIds.has(row.id) && row.deleted_at == null) softDelete.run(now, now, row.id);
    }

    const remap = db.prepare('UPDATE ai_model_map SET config_id = ?, updated_at = ? WHERE config_id = ?');
    for (const row of existing) {
      if (claimedIds.has(row.id)) continue;
      const sameIdentity = synchronized.filter((item) => item.identity === vendorConfigIdentity(row));
      const replacement = sameIdentity.find((item) => item.name === String(row.name || '')) || sameIdentity[0];
      if (replacement) remap.run(replacement.id, now, row.id);
    }
    db.prepare(
      `UPDATE ai_model_map
          SET config_id = NULL, updated_at = ?
        WHERE config_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM ai_service_configs config
             WHERE config.id = ai_model_map.config_id AND config.deleted_at IS NULL
          )`
    ).run(now);

    return { count: configs.length, inserted, updated };
  });

  const result = synchronize.immediate();
  for (const item of configs) {
    log?.info?.('[vendor_lock] config loaded', {
      service_type: item.service_type,
      provider: item.provider,
      api_protocol: item.api_protocol || '(auto)',
      endpoint: item.endpoint || '(auto)',
    });
  }
  log?.info?.('[vendor_lock] configs synchronized', { ...result, config_file: configFile });
  return result;
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
        api_key_set: hasStoredCredentialValue(saved.api_key),
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
  fetchConnectionProbe,
  probeOpenAICompatibleModels,
  probeOllamaConnection,
  ollamaProbeUrls,
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
