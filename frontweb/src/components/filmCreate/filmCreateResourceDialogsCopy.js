/** 素材库弹窗加入本集禁用原因 */

export function describeAddToEpisodeDisabledReason(episodeId) {
  return episodeId ? '' : '请先创建或选择剧集'
}
