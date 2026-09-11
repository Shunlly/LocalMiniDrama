'use strict';

// 从 providerSdkService 拆出的错误装配：供应商/轨道/素材中文标签、合成错误码与失败文案。
// 保持原语义，不是新增真实厂商接入。

const { toUserFacingProcessError } = require('./providerErrorSanitizer');

function productionProviderTypeLabel(providerType) {
  if (providerType === 'image') return '图片供应商';
  if (providerType === 'video') return '视频供应商';
  if (providerType === 'tts') return '配音供应商';
  if (providerType === 'compositor') return '合成供应商';
  return '供应商';
}

function timelineTrackTypeLabel(type) {
  switch (String(type || '')) {
    case 'video': return '视频';
    case 'subtitle': return '字幕';
    case 'voice': return '旁白';
    case 'dialogue': return '对白';
    case 'effect': return '音效';
    case 'bgm': return '背景音乐';
    case 'transition': return '转场';
    default: return String(type || '未知');
  }
}

function productionAssetTypeLabel(type) {
  switch (String(type || '')) {
    case 'character': return '角色';
    case 'scene': return '场景';
    case 'prop': return '道具';
    default: return String(type || '素材');
  }
}

function productionCompositeError(message) {
  const error = new Error(message);
  error.code = 'PRODUCTION_TIMELINE_INVALID';
  return error;
}

function failedInvocationMessage(providerType) {
  return `${productionProviderTypeLabel(providerType)}请求失败，请稍后重试`;
}

function assembleProductionFailure(prefix, error, fallback) {
  return new Error(`${prefix}：${toUserFacingProcessError(error, fallback)}`);
}

module.exports = {
  productionProviderTypeLabel,
  timelineTrackTypeLabel,
  productionAssetTypeLabel,
  productionCompositeError,
  failedInvocationMessage,
  assembleProductionFailure,
};