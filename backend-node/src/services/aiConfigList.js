// 配置列表读取与选择：指定供应商未命中时 fail-closed，不偷用其他配置。
const { modelFromDb, normalizeConfigModels } = require('./aiConfigModels');

const LIST_ORDER = 'ORDER BY is_default DESC, priority DESC, created_at DESC';

function normalizeProvider(value) {
  return String(value || '').trim().toLowerCase();
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

function listConfigs(db, serviceType) {
  let sql = 'SELECT * FROM ai_service_configs WHERE deleted_at IS NULL ' + LIST_ORDER;
  const params = [];
  if (serviceType) {
    sql = 'SELECT * FROM ai_service_configs WHERE deleted_at IS NULL AND service_type = ? ' + LIST_ORDER;
    params.push(serviceType);
  }
  const rows = params.length ? db.prepare(sql).all(...params) : db.prepare(sql).all();
  return rows.map(rowToConfig);
}

function getConfig(db, id) {
  const row = db.prepare('SELECT * FROM ai_service_configs WHERE id = ? AND deleted_at IS NULL').get(id);
  return row ? rowToConfig(row) : null;
}

function filterActiveConfigs(configs, preferredProvider) {
  const list = Array.isArray(configs) ? configs : [];
  let active = list.filter((config) => config.is_active);
  const provider = normalizeProvider(preferredProvider);
  if (provider) {
    active = active.filter((config) => normalizeProvider(config.provider) === provider);
  }
  return active;
}

function selectDefaultConfig(configs) {
  const list = Array.isArray(configs) ? configs : [];
  const defaultOne = list.find((config) => config.is_default);
  return defaultOne || list[0] || null;
}

function resolveConfigForModel(configs, modelName, preferredProvider) {
  const active = filterActiveConfigs(configs, preferredProvider);
  const selectedModel = String(modelName ?? '').trim();
  const matches = active.filter((config) => {
    const models = normalizeConfigModels(config).model;
    return selectedModel && models.includes(selectedModel);
  });
  if (matches.length <= 1) return { config: matches[0] || null, ambiguous: false };
  const defaultMatch = matches.find((config) => config.is_default);
  if (defaultMatch) return { config: defaultMatch, ambiguous: false };
  const providers = new Set(matches.map((config) => normalizeProvider(config.provider)));
  return providers.size === 1
    ? { config: matches[0], ambiguous: false }
    : { config: null, ambiguous: true };
}

function selectConfigForModel(configs, modelName, preferredProvider) {
  return resolveConfigForModel(configs, modelName, preferredProvider).config;
}

function selectServiceConfig(configs, options = {}) {
  const preferredModel = options.preferredModel;
  const preferredProvider = options.preferredProvider;
  const provider = normalizeProvider(preferredProvider);
  const active = filterActiveConfigs(configs, preferredProvider);
  if (provider && active.length === 0) {
    return { config: null, ambiguous: false, reason: 'provider_not_found' };
  }
  if (active.length === 0) {
    return { config: null, ambiguous: false, reason: 'no_active' };
  }
  const selectedModel = String(preferredModel ?? '').trim();
  if (selectedModel) {
    const resolved = resolveConfigForModel(configs, selectedModel, preferredProvider);
    if (resolved.ambiguous) return { ...resolved, reason: 'ambiguous' };
    if (resolved.config) return { ...resolved, reason: 'model' };
  }
  return { config: selectDefaultConfig(active), ambiguous: false, reason: 'default' };
}

module.exports = {
  rowToConfig,
  listConfigs,
  getConfig,
  normalizeProvider,
  filterActiveConfigs,
  selectDefaultConfig,
  resolveConfigForModel,
  selectConfigForModel,
  selectServiceConfig,
};
