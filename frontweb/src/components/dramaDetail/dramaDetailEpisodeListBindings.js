import { computed, unref } from 'vue'

/**
 * 把剧集详情页已有的剧集列表状态装配成可 v-bind 的属性袋。
 * 不创建新状态，也不改批量导入离开保护。
 */
export function createDramaDetailEpisodeListBindings(values = {}) {
  return computed(() => ({
    addingEpisode: unref(values.addingEpisode),
    deletingEpisodeId: unref(values.deletingEpisodeId),
    dramaId: unref(values.dramaId),
    episodeEmptyState: unref(values.episodeEmptyState),
    episodes: unref(values.episodes),
    epStatusLabel: values.epStatusLabel,
    handleReadinessAction: values.handleReadinessAction,
    nextEpisodeNumber: unref(values.nextEpisodeNumber),
    onAddEpisode: values.onAddEpisode,
    onBatchImportEpisodes: values.onBatchImportEpisodes,
    onDeleteEpisode: values.onDeleteEpisode,
    openEpisodeBatchImport: values.openEpisodeBatchImport,
    withProjectListReturnTo: values.withProjectListReturnTo,
  }))
}
