import { watch } from 'vue'

export function useFilmCreateRouteSync(deps = {}) {
  const {
    route,
    router,
    store,
    dramaId,
    invalidateProjectLoads,
    resetStoryboardMediaContext,
    loadDrama,
    projectLoadError,
    projectLoadNotFound,
    projectDependencyWarning,
    projectLoadPending,
    projectDependencyLoading,
    projectLoadState,
    selectedEpisodeId,
    savedCurrentEpisodeNumber,
    storyInput,
    scriptTitle,
    storyStyle,
    storyType,
    scriptLanguage,
    scriptStoryboardStyle,
    generationStyle,
    markScriptDraftSaved,
    onEpisodeSelect,
  } = deps

  function applyRouteToStore() {
    const id = route.params.id
    invalidateProjectLoads()
    resetStoryboardMediaContext(id && id !== 'new' ? Number(id) : null, null)
    projectLoadError.value = ''
    projectLoadNotFound.value = false
    projectDependencyWarning.value = ''
    projectLoadPending.value = false
    projectDependencyLoading.value = false
    if (id && id !== 'new') {
      projectLoadState.value = 'loading'
      store.reset()
      store.setDrama({ id: Number(id) })
      if (route.query.episode) {
        selectedEpisodeId.value = Number(route.query.episode)
      } else {
        selectedEpisodeId.value = null
      }
      loadDrama({ blocking: true })
    } else {
      projectLoadState.value = 'ready'
      store.reset()
      storyInput.value = ''
      scriptTitle.value = ''
      selectedEpisodeId.value = null
      savedCurrentEpisodeNumber.value = 1
      storyStyle.value = ''
      storyType.value = ''
      scriptLanguage.value = 'zh'
      scriptStoryboardStyle.value = ''
      generationStyle.value = ''
      markScriptDraftSaved()
    }
  }

  // 剧本分集切换时同步 URL query 参数（?episode=<episode_id>），使刷新/分享页面仍保持当前选中集
  // 同时监听 query 变化，支持浏览器前进/后退时自动切换对应集次
  function syncEpisodeRouteQuery(episodeId) {
    if (!dramaId.value) return
    const currentInQuery = route.query.episode != null ? Number(route.query.episode) : null
    const desired = episodeId != null ? Number(episodeId) : null
    if (currentInQuery === desired) return
    const newQuery = { ...route.query }
    if (desired != null) newQuery.episode = String(desired)
    else delete newQuery.episode
    router.replace({ query: newQuery }).catch(() => {})
  }

  watch(
    () => selectedEpisodeId.value,
    syncEpisodeRouteQuery,
    { flush: 'post' }
  )

  watch(
    () => route.query.episode,
    (newEp) => {
      if (!dramaId.value) return
      const newVal = newEp != null ? Number(newEp) : null
      const currentSel = selectedEpisodeId.value != null ? Number(selectedEpisodeId.value) : null
      if (currentSel !== newVal) {
        onEpisodeSelect(newVal)
      }
    }
  )

  return {
    applyRouteToStore,
    syncEpisodeRouteQuery,
  }
}
