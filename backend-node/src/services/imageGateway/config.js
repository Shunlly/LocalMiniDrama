"use strict";

const aiConfigService = require('../aiConfigService');

function resolveAssetUserNegativeForApi(explicitModelName, storedNegative) {
  const hasModel = explicitModelName != null && String(explicitModelName).trim().length > 0;
  const neg = storedNegative != null ? String(storedNegative).trim() : '';
  return hasModel && neg ? neg : '';
}

function getDefaultImageConfig(db, preferredModel, preferredProvider, imageServiceType) {
  const serviceType = imageServiceType || 'image';
  const selectedModel = String(preferredModel ?? '').trim();
  let configs = aiConfigService.listConfigs(db, serviceType);
  if (configs.length === 0 && serviceType === 'storyboard_image') {
    configs = aiConfigService.listConfigs(db, 'image');
  }
  let active = configs.filter((config) => config.is_active);
  if (active.length === 0) return null;
  if (preferredProvider && String(preferredProvider).trim()) {
    const want = String(preferredProvider).trim().toLowerCase();
    const byProvider = active.filter((config) => (config.provider || '').toLowerCase() === want);
    if (byProvider.length === 0) return null;
    active = byProvider;
  }
  if (selectedModel) {
    const matches = active.filter((config) => {
      const models = aiConfigService.normalizeConfigModels(config).model;
      return models.includes(selectedModel);
    });
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) {
      const defaultMatch = matches.find((config) => config.is_default);
      if (defaultMatch) return defaultMatch;
      const providers = new Set(matches.map((config) => String(config.provider || '').toLowerCase()));
      if (providers.size === 1) return matches[0];
      return null;
    }
  }
  const defaultOne = active.find((config) => config.is_default);
  if (defaultOne) return defaultOne;
  return active[0];
}

function buildImageUrl(config) {
  const base = (config.base_url || '').replace(/\/$/, '');
  let endpoint = config.endpoint || '/images/generations';
  if (!endpoint.startsWith('/')) endpoint = `/${endpoint}`;
  return base + endpoint;
}

function getModelFromConfig(config, preferredModel) {
  return aiConfigService.resolveConfiguredModel(config, preferredModel, 'dall-e-3');
}

module.exports = {
  resolveAssetUserNegativeForApi,
  getDefaultImageConfig,
  buildImageUrl,
  getModelFromConfig,
};
