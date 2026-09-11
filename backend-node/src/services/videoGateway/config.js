'use strict';

const aiConfigService = require('../aiConfigService');
const { selectServiceConfig } = require('../aiConfigList');

// 按 is_default、priority 选择当前启用的视频配置。指定供应商未命中时不回退。
function getDefaultVideoConfig(db, preferredModel, preferredProvider) {
  const configs = aiConfigService.listConfigs(db, 'video');
  return selectServiceConfig(configs, { preferredModel, preferredProvider }).config;
}

module.exports = {
  getDefaultVideoConfig,
};
