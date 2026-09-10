import { nextTick } from 'vue'
import { ElMessage } from 'element-plus'

import { dramaAPI } from '@/api/drama'
import { isCanvasUserAbort } from '@/composables/useCanvasUserError'
import {
  parseCanvasLayout,
  resolveViewport,
} from '@/utils/canvasLayout'

/** 画布项目加载、失败重试、静默刷新与处理中轮询 */
export function useDramaCanvasProjectLoad(deps) {
  const {
    isCanvasReady,
    canvasInstanceActive,
    dramaId,
    loading,
    canvasLoadState,
    canvasLoadError,
    canvasLoadNotFound,
    coreCanvasDramaAPI,
    drama,
    nodes,
    edges,
    layoutCache,
    syncWorkflowFromDrama,
    productionViewport,
    hydrateFreeCanvasState,
    currentViewport,
    canvasMode,
    freeCanvas,
    filterEpisodeId,
    routeEpisodeId,
    loadForDrama,
    loadProjectAssets,
    rebuildGraph,
    isCanvasAbortError,
    friendlyCanvasProjectLoadError,
    canvasLoadFailureRef,
    claimRouteEntityFocus,
    synchronizeRouteFocusedEntity,
    safeFreeCanvasError,
  } = deps

  let canvasLoadRequestId = 0
  let pollTimer = null

  async function loadCanvasProject({
    blocking = !isCanvasReady.value,
    preserveOnError = !blocking,
    preserveFreeState = !blocking,
    requestOptions = {},
  } = {}) {
    const requestedDramaId = dramaId.value
    if (!canvasInstanceActive.value || !Number.isFinite(requestedDramaId) || requestedDramaId <= 0) return false
    const requestId = ++canvasLoadRequestId
    loading.value = true
    if (blocking) canvasLoadState.value = 'loading'
    canvasLoadError.value = ''
    canvasLoadNotFound.value = false
    try {
      const loadedDrama = await coreCanvasDramaAPI.get(requestedDramaId, requestOptions)
      if (!canvasInstanceActive.value || requestId !== canvasLoadRequestId || requestedDramaId !== dramaId.value) return false
      drama.value = loadedDrama
      layoutCache.value = parseCanvasLayout(drama.value.metadata)
      syncWorkflowFromDrama()
      const vp = resolveViewport(layoutCache.value)
      productionViewport.value = vp
      if (!preserveFreeState) hydrateFreeCanvasState(drama.value.metadata)
      currentViewport.value = canvasMode.value === 'free' ? { ...freeCanvas.value.viewport } : vp
      filterEpisodeId.value = routeEpisodeId()
      await Promise.all([
        loadForDrama(drama.value, filterEpisodeId.value, requestOptions),
        loadProjectAssets(requestedDramaId, requestOptions),
      ])
      if (!canvasInstanceActive.value || requestId !== canvasLoadRequestId || requestedDramaId !== dramaId.value) return false
      rebuildGraph()
      canvasLoadState.value = 'ready'
      canvasLoadNotFound.value = false
      return true
    } catch (error) {
      if (isCanvasAbortError(error, requestOptions.signal)) throw error
      if (!canvasInstanceActive.value || requestId !== canvasLoadRequestId || requestedDramaId !== dramaId.value) return false
      if (!preserveOnError) {
        drama.value = null
        nodes.value = []
        edges.value = []
        layoutCache.value = null
      }
      canvasLoadNotFound.value = Number(error?.status || error?.response?.status) === 404
      canvasLoadError.value = friendlyCanvasProjectLoadError(error)
      if (!preserveOnError) {
        canvasLoadState.value = 'error'
        await nextTick()
        canvasLoadFailureRef.value?.focus()
      }
      return false
    } finally {
      if (canvasInstanceActive.value && requestId === canvasLoadRequestId) loading.value = false
    }
  }

  async function retryCanvasProjectLoad() {
    const ownership = claimRouteEntityFocus()
    const loaded = await loadCanvasProject({ blocking: true, preserveOnError: false })
    if (loaded) await synchronizeRouteFocusedEntity(ownership)
  }

  async function loadDrama(silent = false) {
    if (!dramaId.value) return
    if (!silent) loading.value = true
    try {
      drama.value = await dramaAPI.get(dramaId.value)
      layoutCache.value = parseCanvasLayout(drama.value.metadata)
      syncWorkflowFromDrama()
      const vp = resolveViewport(layoutCache.value)
      currentViewport.value = vp
      filterEpisodeId.value = routeEpisodeId()
      await loadForDrama(drama.value, filterEpisodeId.value)
      rebuildGraph()
    } catch (e) {
      if (!silent && !isCanvasUserAbort(e)) ElMessage.error(safeFreeCanvasError(e, '加载项目失败'))
    } finally {
      if (!silent) loading.value = false
    }
  }

  function hasProcessingStoryboards() {
    for (const ep of drama.value?.episodes || []) {
      for (const sb of ep.storyboards || []) {
        if (sb.status === 'processing') return true
      }
    }
    return false
  }

  function startStatusPoll() {
    stopStatusPoll()
    if (!hasProcessingStoryboards()) return
    pollTimer = setInterval(() => {
      if (hasProcessingStoryboards()) loadCanvasProject({ blocking: false, preserveOnError: true })
      else stopStatusPoll()
    }, 8000)
  }

  function stopStatusPoll() {
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }

  function invalidateCanvasLoads() {
    canvasLoadRequestId++
  }

  return {
    loadCanvasProject,
    retryCanvasProjectLoad,
    loadDrama,
    hasProcessingStoryboards,
    startStatusPoll,
    stopStatusPoll,
    invalidateCanvasLoads,
  }
}
