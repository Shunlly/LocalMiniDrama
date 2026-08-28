import { nextTick } from 'vue'
import { ElMessage } from 'element-plus'
import { requestCoreJson } from '@/utils/coreJsonRequest'
import { backfillDramaStylePromptMetadataIfNeeded } from '@/constants/styleOptions'

export function useFilmCreateProjectLoad(deps = {}) {
  const {
    store,
    dramaId,
    currentEpisodeId,
    projectLifecycle,
    episodeSwitchController,
    syncEpisodeRouteQuery,
    resetStoryboardMediaContext,
    ensureStoryboardMediaContext,
    storyboardMediaStateController,
    syncStoryboardStateFromEpisode,
    markScriptDraftSaved,
    loadStoryboardMedia,
    recoverAndSyncEpisodeTasks,
    loadPipelineConcurrency,
    refreshVideoGenerationCapability,
    refreshProductionReadiness,
    scriptTitle,
    selectedEpisodeId,
    savedCurrentEpisodeNumber,
    storyInput,
    storyStyle,
    storyType,
    generationStyle,
    projectAspectRatio,
    videoClipDuration,
    storyboardIncludeNarration,
    storyboardUniversalOmni,
    storyboardUseFirstLastFrame,
    lastFrameUseFirstLayoutLock,
    gridMode,
    projectLoadState,
    projectLoadPending,
    projectLoadError,
    projectLoadNotFound,
    projectDependencyWarning,
    projectDependencyLoading,
    projectLoadFailureRef,
    scriptDraftController,
  } = deps

  let projectLoadRequestId = 0
  let projectDependencyRequestId = 0

  function invalidateProjectLoads() {
    projectLoadRequestId += 1
    projectDependencyRequestId += 1
  }

  async function onEpisodeSelect(epId) {
    try {
      const result = await episodeSwitchController.select(epId)
      if (!result.changed) syncEpisodeRouteQuery(selectedEpisodeId.value)
      return result
    } catch (_) {
      syncEpisodeRouteQuery(selectedEpisodeId.value)
      ElMessage.error('当前剧本保存失败，未切换剧集，请重试。')
      return { changed: false, episode: store.currentEpisode || null, reason: 'save_failed' }
    }
  }

  function applySelectedEpisode(ep) {
    resetStoryboardMediaContext(dramaId.value, ep?.id ?? null)
    if (!ep) {
      store.setCurrentEpisode(null)
      store.setScriptContent('')
      scriptTitle.value = ''
      selectedEpisodeId.value = null
      syncStoryboardStateFromEpisode(null)
      markScriptDraftSaved()
      return
    }
    store.setCurrentEpisode(ep)
    store.setScriptContent(ep.script_content || '')
    scriptTitle.value = ep.title || '第' + (ep.episode_number || 0) + '集'
    selectedEpisodeId.value = ep.id
    syncStoryboardStateFromEpisode(ep)
    markScriptDraftSaved()
  }

  function friendlyFilmProjectLoadError(error) {
    const status = Number(error?.status || error?.response?.status)
    if (status === 404) return '该项目不存在，或已移入回收站。'
    if (status >= 500) return '本地服务暂时不可用，请稍后重试。'
    return '无法连接本地服务，请确认服务已经启动后重试。'
  }

  async function refreshProjectDependencies(episodeId, { includeProjectCapabilities = false } = {}) {
    const dependencyRequestId = ++projectDependencyRequestId
    projectDependencyLoading.value = true
    projectDependencyWarning.value = ''
    const dependencyJobs = [
      loadStoryboardMedia(),
      recoverAndSyncEpisodeTasks(episodeId),
    ]
    if (includeProjectCapabilities) {
      dependencyJobs.push(
        loadPipelineConcurrency(),
        refreshVideoGenerationCapability(),
        refreshProductionReadiness(),
      )
    }
    const [mediaResult, taskResult] = await Promise.allSettled(dependencyJobs)
    if (dependencyRequestId !== projectDependencyRequestId) return false

    const mediaFailed = mediaResult.status === 'rejected' || mediaResult.value?.failedCount > 0
    const warnings = []
    if (taskResult.status === 'rejected') warnings.push('生成任务状态暂时无法同步')
    projectDependencyWarning.value = warnings.length
      ? `${warnings.join('；')}。项目已正常打开，可重试加载素材。`
      : ''
    projectDependencyLoading.value = false
    return !mediaFailed && warnings.length === 0
  }

  async function retryProjectDependencies() {
    if (projectLoadState.value !== 'ready') return
    await refreshProjectDependencies(currentEpisodeId.value, { includeProjectCapabilities: true })
  }

  const coreDramaAPI = projectLifecycle.guardApi({
    get(id) {
      return requestCoreJson(`/dramas/${encodeURIComponent(id)}`)
    },
    saveOutline(id, data) {
      return requestCoreJson(`/dramas/${encodeURIComponent(id)}/outline`, { method: 'PUT', body: data })
    },
  })

  async function loadDrama({
    blocking = projectLoadState.value !== 'ready',
    expectedContext,
  } = {}) {
    if (expectedContext && !storyboardMediaStateController.isCurrentContext(expectedContext)) {
      return { stale: true }
    }
    const requestedDramaId = Number(store.dramaId)
    if (!Number.isFinite(requestedDramaId) || requestedDramaId <= 0) return false
    const requestId = ++projectLoadRequestId
    projectLoadPending.value = true
    projectLoadError.value = ''
    projectLoadNotFound.value = false
    projectDependencyWarning.value = ''
    if (blocking) projectLoadState.value = 'loading'
    try {
      let d = await coreDramaAPI.get(requestedDramaId)
      d = await backfillDramaStylePromptMetadataIfNeeded(coreDramaAPI, requestedDramaId, d)
      if (
        requestId !== projectLoadRequestId
        || (expectedContext && !storyboardMediaStateController.isCurrentContext(expectedContext))
      ) return { stale: true }
      store.setDrama(d)
      // 项目描述仅用于项目说明；生成草稿独立存储，不能隐式触发生成语义。
      storyInput.value = (d.metadata?.story_generation_draft || '').toString().trim()
      storyStyle.value = (d.metadata && d.metadata.story_style) ? d.metadata.story_style : ''
      storyType.value = d.genre || ''
      generationStyle.value = d.style || ''
      projectAspectRatio.value = (d.metadata && d.metadata.aspect_ratio) ? d.metadata.aspect_ratio : '16:9'
      videoClipDuration.value = (d.metadata && d.metadata.video_clip_duration) ? Number(d.metadata.video_clip_duration) : 5
      storyboardIncludeNarration.value = !!(d.metadata && d.metadata.storyboard_include_narration)
      storyboardUniversalOmni.value = !!(d.metadata && d.metadata.storyboard_universal_omni)
      storyboardUseFirstLastFrame.value = !!(d.metadata && d.metadata.storyboard_use_first_last_frame)
      lastFrameUseFirstLayoutLock.value = d.metadata?.last_frame_use_first_layout_lock !== false
      if (storyboardUseFirstLastFrame.value && gridMode.value !== 'single') {
        gridMode.value = 'single'
      }
      const list = d.episodes || []
      // 优先保持当前选中的集（按 id 在最新列表中查找），避免 AI 生成角色等操作后误切到其他集
      const currentId = selectedEpisodeId.value
      let ep = currentId != null ? list.find((e) => Number(e.id) === Number(currentId)) : null
      if (!ep) {
        const wantNum = savedCurrentEpisodeNumber.value
        ep = list.find((e) => Number(e.episode_number) === Number(wantNum)) || list[0] || null
      }
      store.setCurrentEpisode(ep)
      if (ep) {
        store.setScriptContent(ep.script_content || '')
        scriptTitle.value = ep.title || '第' + (ep.episode_number || 0) + '集'
        selectedEpisodeId.value = ep.id
      } else {
        store.setScriptContent('')
        scriptTitle.value = ''
        selectedEpisodeId.value = null
      }
      ensureStoryboardMediaContext(requestedDramaId, ep?.id ?? null)
      markScriptDraftSaved()
      syncStoryboardStateFromEpisode(ep)
      projectLoadState.value = 'ready'
      projectLoadNotFound.value = false
      await refreshProjectDependencies(ep?.id, { includeProjectCapabilities: true })
      return true
    } catch (e) {
      if (requestId !== projectLoadRequestId) return false
      scriptDraftController.dispose()
      store.reset()
      store.setDrama({ id: requestedDramaId })
      projectLoadNotFound.value = Number(e?.status || e?.response?.status) === 404
      projectLoadError.value = friendlyFilmProjectLoadError(e)
      projectLoadState.value = 'error'
      projectDependencyWarning.value = ''
      await nextTick()
      projectLoadFailureRef.value?.focus()
      return false
    } finally {
      if (requestId === projectLoadRequestId) projectLoadPending.value = false
    }
  }

  async function retryFilmProjectLoad() {
    await loadDrama({ blocking: true })
  }

  return {
    onEpisodeSelect,
    applySelectedEpisode,
    friendlyFilmProjectLoadError,
    refreshProjectDependencies,
    retryProjectDependencies,
    loadDrama,
    retryFilmProjectLoad,
    invalidateProjectLoads,
  }
}
