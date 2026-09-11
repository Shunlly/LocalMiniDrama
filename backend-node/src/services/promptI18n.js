// 语言解析与用户模板装配见 promptI18nResolve.js；目录正文见 promptI18nCatalog.js；场景参考图润色/生图见 promptI18nScene.js；分镜系统提示与首/关键/尾帧见 promptI18nStoryboard.js；角色/道具/提取/全能/身份锚点见 promptI18nAssets.js。
const {
  getDefaultPromptBody,
  getLockedSuffix,
} = require('./promptI18nCatalog');
const {
  getLanguage,
  isEnglish,
  formatUserPrompt,
  buildStoryExpansionUserPrompt,
  getRealisticPhysicalScaleContract,
} = require('./promptI18nResolve');
const {
  getScenePolishPrompt,
  getScenePolishPromptSingle,
  getSceneGenerateImagePrompt,
  getSceneGenerateSingleImagePrompt,
} = require('./promptI18nScene');
const promptI18nStoryboard = require('./promptI18nStoryboard');
const promptI18nAssets = require('./promptI18nAssets');

// 内存覆盖缓存：key => body（仅存可编辑部分，不含锁定的 JSON 格式要求）
const _overrideCache = {};
promptI18nStoryboard.setOverrideCacheRef(_overrideCache);
promptI18nAssets.setOverrideCacheRef(_overrideCache);
const {
  getFirstFramePrompt,
  getKeyFramePrompt,
  getLastFramePrompt,
  getStoryboardSystemPrompt,
  getUniversalOmniMultiBeatFormatSpec,
  getStoryboardUniversalOmniModeSuffix,
  getStoryboardUserPromptSuffix,
  getStoryboardNarrationExtraInstructions,
} = promptI18nStoryboard;
const {
  getCharacterExtractionPrompt,
  getPropExtractionPrompt,
  getSceneExtractionPrompt,
  getStoryExpansionSystemPrompt,
  getRolePolishPrompt,
  getRoleGenerateImagePrompt,
  getImagePolishPrompt,
  getUniversalOmniSegmentPrompt,
  getUniversalOmniPolishPrompt,
  getContinuitySnapshotPrompt,
  getRegenerateLayoutDescriptionPrompt,
  getIdentityAnchorsPrompt,
  getPropPolishPrompt,
} = promptI18nAssets;

function loadOverridesIntoCache(overrides) {
  for (const o of overrides) {
    _overrideCache[o.key] = o.content;
  }
}

function setOverrideInMemory(key, content) {
  _overrideCache[key] = content;
}

function clearOverrideInMemory(key) {
  delete _overrideCache[key];
}

module.exports = {
  getLanguage,
  isEnglish,
  getCharacterExtractionPrompt,
  getPropExtractionPrompt,
  formatUserPrompt,
  getFirstFramePrompt,
  getKeyFramePrompt,
  getLastFramePrompt,
  getSceneExtractionPrompt,
  getStoryboardSystemPrompt,
  getUniversalOmniMultiBeatFormatSpec,
  getStoryboardUniversalOmniModeSuffix,
  getStoryboardUserPromptSuffix,
  getStoryboardNarrationExtraInstructions,
  getStoryExpansionSystemPrompt,
  buildStoryExpansionUserPrompt,
  getRolePolishPrompt,
  getRoleGenerateImagePrompt,
  getScenePolishPrompt,
  getScenePolishPromptSingle,
  getSceneGenerateImagePrompt,
  getSceneGenerateSingleImagePrompt,
  getImagePolishPrompt,
  getUniversalOmniSegmentPrompt,
  getUniversalOmniPolishPrompt,
  getContinuitySnapshotPrompt,
  getIdentityAnchorsPrompt,
  getPropPolishPrompt,
  loadOverridesIntoCache,
  setOverrideInMemory,
  clearOverrideInMemory,
  getDefaultPromptBody,
  getLockedSuffix,
  getRegenerateLayoutDescriptionPrompt,
  getRealisticPhysicalScaleContract,
};


