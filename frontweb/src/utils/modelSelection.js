export function parseModelList(models, defaultModel = '') {
  if (Array.isArray(models)) {
    return models.map((m) => String(m).trim()).filter(Boolean)
  }
  if (typeof models === 'string') {
    return models.split(/[\n,，]/).map((s) => s.trim()).filter(Boolean)
  }
  return defaultModel ? [String(defaultModel).trim()].filter(Boolean) : []
}

export function getSelectableModels(configs, serviceType, configId) {
  const list = Array.isArray(configs) ? configs : []
  const hasExplicitConfig = configId !== null
    && configId !== undefined
    && String(configId).trim() !== ''
  const selectedConfig = hasExplicitConfig
    ? list.find((c) => String(c.id) === String(configId)
      && c.service_type === serviceType
      && c.is_active)
    : null
  // 已指定的配置无效时返回空列表，避免把模型回退到另一个厂商或服务类型。
  if (hasExplicitConfig && !selectedConfig) return []
  const config = selectedConfig
    || list.find((c) => c.service_type === serviceType && c.is_active && c.is_default)
    || list.find((c) => c.service_type === serviceType && c.is_active)

  if (!config) return []
  return parseModelList(config.model, config.default_model)
}
