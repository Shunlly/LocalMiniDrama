"use strict";

const aiConfigService = require('../aiConfigService');
const { selectServiceConfig } = require('../aiConfigList');

function resolveAssetUserNegativeForApi(explicitModelName, storedNegative) {
  const hasModel = explicitModelName != null && String(explicitModelName).trim().length > 0;
  const neg = storedNegative != null ? String(storedNegative).trim() : '';
  return hasModel && neg ? neg : '';
}

function getDefaultImageConfig(db, preferredModel, preferredProvider, imageServiceType) {
  const serviceType = imageServiceType || 'image';
  let configs = aiConfigService.listConfigs(db, serviceType);
  if (configs.length === 0 && serviceType === 'storyboard_image') {
    configs = aiConfigService.listConfigs(db, 'image');
  }
  return selectServiceConfig(configs, { preferredModel, preferredProvider }).config;
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
