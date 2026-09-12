// 模型列表与默认模型解析：缺成员时 fail-closed，不回退到列表外的模型。
function aiConfigValidationError(message, details) {
  const error = new Error(message);
  error.code = 'INVALID_AI_CONFIG';
  error.status = 400;
  error.details = details;
  return error;
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

module.exports = {
  aiConfigValidationError,
  normalizeModelList,
  normalizeDefaultModel,
  normalizeConfigModels,
  assertDefaultModelMembership,
  resolveConfiguredModel,
  normalizeWritableConfigModels,
  modelToDb,
  modelFromDb,
};
