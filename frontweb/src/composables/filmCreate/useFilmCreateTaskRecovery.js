import { GEN_RESOURCE } from '@/stores/generationTaskStore'
import { syncGeneratingSetsFromStore, buildEpisodeContext } from '@/composables/useGenerationTaskSync'

export function useFilmCreateTaskRecovery(deps = {}) {
  const {
    dramaId,
    currentEpisodeId,
    store,
    genStore,
    ElMessage,
    videoErrorMsg,
    generatingCharIds,
    generatingPropIds,
    generatingSceneIds,
    generatingSbImageIds,
    generatingSbFirstImageIds,
    generatingSbLastImageIds,
    generatingSbVideoIds,
    currentStoryboardMediaContext,
    loadSingleStoryboardMedia,
    captureDramaRefresh,
  } = deps
  function getGeneratingSetsBag() {
    return {
      generatingCharIds,
      generatingPropIds,
      generatingSceneIds,
      generatingSbImageIds,
      generatingSbFirstImageIds,
      generatingSbLastImageIds,
      generatingSbVideoIds,
    }
  }

  function buildSbGenMeta(sb, resourceType, labelPrefix) {
    const num = sb?.storyboard_number ?? sb?.id
    const epNum = store.currentEpisode?.episode_number
    const dramaTitle = store.drama?.title || ''
    const epLabel = dramaTitle ? `${dramaTitle} · 第${epNum ?? ''}集` : `第${epNum ?? ''}集`
    return {
      dramaId: dramaId.value,
      episodeId: currentEpisodeId.value,
      dramaTitle,
      episodeNumber: epNum,
      resourceType,
      resourceId: sb.id,
      label: `${epLabel} ${labelPrefix} #${num}`,
    }
  }

  /** 分镜视频是否正在生成（单条点击、批量、一键成片、任务恢复均覆盖） */
  function isSbVideoGenerating(sbId) {
    if (generatingSbVideoIds.has(sbId)) return true
    if (sbId == null || dramaId.value == null || currentEpisodeId.value == null) return false
    return genStore.isRunning({
      dramaId: dramaId.value,
      episodeId: currentEpisodeId.value,
      resourceType: GEN_RESOURCE.SB_VIDEO,
      resourceId: sbId,
    })
  }
  async function recoverAndSyncEpisodeTasks(epId) {
    const did = dramaId.value
    const eid = epId ?? currentEpisodeId.value
    if (!did || !eid) return
    const ctx = buildEpisodeContext(store, did, eid)
    const mediaContext = currentStoryboardMediaContext(did, eid)
    await genStore.recoverPendingForEpisode({
      ...ctx,
      ElMessage,
      callbacks: {
        onStoryboardMedia: (sbId) => loadSingleStoryboardMedia(sbId, mediaContext),
        onDramaRefresh: captureDramaRefresh(mediaContext),
        onEpisodeMergeComplete: () => {
          store.setVideoStatus('done', did, eid)
          store.setVideoProgress(100, did, eid)
        },
        onEpisodeMergeFailed: (err) => {
          store.setVideoStatus('error', did, eid)
          videoErrorMsg.value = err || '视频生成失败'
        },
      },
    })
    syncGeneratingSetsFromStore(genStore, did, eid, getGeneratingSetsBag())
    const mergeRunning = genStore.getRunningForEpisode(did, eid).some(
      (t) => t.resourceType === GEN_RESOURCE.EPISODE_MERGE
    )
    if (mergeRunning) {
      store.setVideoStatus('generating', did, eid)
    }
  }
  // 任务恢复结束

  return {
    getGeneratingSetsBag,
    buildSbGenMeta,
    isSbVideoGenerating,
    recoverAndSyncEpisodeTasks,
  }
}
