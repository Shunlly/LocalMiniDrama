// 与 Go StoryboardService.GenerateStoryboard + processStoryboardGeneration 对齐
// 镜号排序、列表装配、生成纯函数、保存、生成编排与拆镜见 episodeStoryboard*
const {
  normalizeStoryboardShotNumber,
  dedupeStoryboardRowsByNumber,
} = require('./episodeStoryboardOrdering');
const {
  getStoryboardsForEpisode,
} = require('./episodeStoryboardAssembly');
const {
  generateVideoPrompt,
} = require('./episodeStoryboardGeneration');
const {
  rebuildVideoPromptForStoryboard,
} = require('./episodeStoryboardSave');
const {
  generateStoryboard,
} = require('./episodeStoryboardProcess');
const {
  splitStoryboardByAudio,
} = require('./episodeStoryboardSplit');

module.exports = {
  normalizeStoryboardShotNumber,
  dedupeStoryboardRowsByNumber,
  getStoryboardsForEpisode,
  generateStoryboard,
  /** 与分镜入库时一致的「视频提示词」拼装（供经典模式润色等复用） */
  composeStoryboardVideoPrompt: generateVideoPrompt,
  rebuildVideoPromptForStoryboard,
  splitStoryboardByAudio,
};
