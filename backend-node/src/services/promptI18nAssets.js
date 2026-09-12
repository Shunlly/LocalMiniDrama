/**
 * 角色/道具提取、故事扩展、角色参考表、全能片段、连戏快照与身份锚点提示词。
 * 覆盖缓存在 promptI18n.js；本模块通过 setOverrideCacheRef 注入同一对象，并转发给拆分模块。
 * 实现见 promptI18nAssetCharacters.js / promptI18nAssetScenes.js / promptI18nAssetProps.js / promptI18nAssetOmni.js。
 */

const characters = require('./promptI18nAssetCharacters');
const scenes = require('./promptI18nAssetScenes');
const props = require('./promptI18nAssetProps');
const omni = require('./promptI18nAssetOmni');

/**
 * 注入 promptI18n.js 的同一份覆盖缓存。
 * @param {Record<string, string>} cache
 */
function setOverrideCacheRef(cache) {
  characters.setOverrideCacheRef(cache);
  scenes.setOverrideCacheRef(cache);
  props.setOverrideCacheRef(cache);
  omni.setOverrideCacheRef(cache);
}

module.exports = {
  setOverrideCacheRef,
  getCharacterExtractionPrompt: characters.getCharacterExtractionPrompt,
  getPropExtractionPrompt: props.getPropExtractionPrompt,
  getSceneExtractionPrompt: scenes.getSceneExtractionPrompt,
  getStoryExpansionSystemPrompt: omni.getStoryExpansionSystemPrompt,
  getRolePolishPrompt: characters.getRolePolishPrompt,
  getRoleGenerateImagePrompt: characters.getRoleGenerateImagePrompt,
  getImagePolishPrompt: scenes.getImagePolishPrompt,
  getUniversalOmniSegmentPrompt: omni.getUniversalOmniSegmentPrompt,
  getUniversalOmniPolishPrompt: omni.getUniversalOmniPolishPrompt,
  getContinuitySnapshotPrompt: characters.getContinuitySnapshotPrompt,
  getRegenerateLayoutDescriptionPrompt: scenes.getRegenerateLayoutDescriptionPrompt,
  getIdentityAnchorsPrompt: characters.getIdentityAnchorsPrompt,
  getPropPolishPrompt: props.getPropPolishPrompt,
};
