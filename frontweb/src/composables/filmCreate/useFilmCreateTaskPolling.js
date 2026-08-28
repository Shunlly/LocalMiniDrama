export function useFilmCreateTaskPolling(deps = {}) {
  const {
    genStore,
    dramaId,
    currentEpisodeId,
    store,
    ElMessage,
    loadDrama,
  } = deps
  /** 无 task_id 时轮询刷新直到资源出现图片或超时（用于角色/道具/场景图生成） */
  async function pollUntilResourceHasImage(checker, maxAttempts = 20, intervalMs = 3000) {
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((r) => setTimeout(r, intervalMs))
      await loadDrama()
      if (checker()) return
    }
  }

  function resolvePollMeta(meta = {}) {
    return {
      dramaId: meta.dramaId ?? dramaId.value,
      episodeId: meta.episodeId ?? currentEpisodeId.value,
      dramaTitle: meta.dramaTitle ?? store.drama?.title,
      episodeNumber: meta.episodeNumber ?? store.currentEpisode?.episode_number,
      resourceType: meta.resourceType || 'unknown',
      resourceId: meta.resourceId,
      label: meta.label,
      ...meta,
    }
  }

  function pollTask(taskId, onDone, meta = {}) {
    return genStore.pollTask(taskId, resolvePollMeta(meta), onDone, { ElMessage })
  }
  return {
    pollUntilResourceHasImage,
    resolvePollMeta,
    pollTask,
  }
}
