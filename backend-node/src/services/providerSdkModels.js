'use strict';

// 从 providerSdkService 拆出的模型列表规范化：TTS 配置按供应商/模型筛选。
// 指定模型未命中时返回 null，不回退到其他配置；匹配规则包含 default_model。
// 保持原语义，不是改走共享 selectServiceConfig，也不是新增真实厂商接入。

const aiConfigService = require('./aiConfigService');

function normalizeModelCandidates(config = {}) {
  const source = Array.isArray(config.model) ? config.model : [config.model];
  return [...source, config.default_model];
}

function configHasSelectedModel(config, selectedModel) {
  return normalizeModelCandidates(config).some((model) => String(model || '').trim() === selectedModel);
}

function filterConfigsByPreferredProvider(configs, preferredProvider) {
  const list = Array.isArray(configs) ? configs : [];
  if (!preferredProvider) return list;
  const normalizedProvider = String(preferredProvider).trim().toLowerCase();
  return list.filter((config) => String(config.provider || '').trim().toLowerCase() === normalizedProvider);
}

function filterConfigsByPreferredModel(configs, preferredModel) {
  const list = Array.isArray(configs) ? configs : [];
  if (!preferredModel) return list;
  const selectedModel = String(preferredModel).trim();
  return list.filter((config) => configHasSelectedModel(config, selectedModel));
}

function getActiveTtsConfig(db, preferredModel, preferredProvider) {
  let active = aiConfigService.listConfigs(db, 'tts').filter((config) => config.is_active);
  active = filterConfigsByPreferredProvider(active, preferredProvider);
  active = filterConfigsByPreferredModel(active, preferredModel);
  return active.find((config) => config.is_default) || active[0] || null;
}

module.exports = {
  normalizeModelCandidates,
  configHasSelectedModel,
  filterConfigsByPreferredProvider,
  filterConfigsByPreferredModel,
  getActiveTtsConfig,
};