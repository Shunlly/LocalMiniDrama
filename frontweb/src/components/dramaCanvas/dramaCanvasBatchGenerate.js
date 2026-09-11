/**
 * 画布批量生成、制作门闩和集数选择。只搬家，不改计费媒体拦截和取消语义。
 */
import { getCurrentInstance, onBeforeUnmount } from 'vue'
import { ElMessage } from '@/utils/elementPlusFeedback.js'
import { resolveCanvasEpisodeId } from '@/utils/canvasUiState'
import { scriptNodeId } from '@/composables/useCanvasScript'
import {
  findStoryboardInDrama,
  getDramaGenerationOptions,
} from '@/utils/canvasWorkflow'
import {
  getCanvasPipelineProductionGate,
  getCanvasProductionStepGate,
  normalizeCanvasProductionReadiness,
} from '@/utils/canvasActionState'
import { getVideoGenerationCapability } from '@/utils/filmCreateActionState'
import { subscribeAiConfigChanged } from '@/utils/aiConfigChangeBus.js'

export function createDramaCanvasProductionGates(ctx = {}) {
  function getCanvasGenerationOptions() {
    return {
      ...getDramaGenerationOptions(ctx.drama.value),
      imagesBySbId: ctx.imagesBySbId.value,
    }
  }

  function ensureProductionStepReady(step) {
    const gate = getCanvasProductionStepGate(step, ctx.productionActions.value)
    if (gate.ready) return true
    ElMessage.warning(gate.reason)
    return false
  }

  function ensureProductionPipelineReady(steps) {
    const gate = getCanvasPipelineProductionGate(steps, ctx.productionActions.value)
    if (gate.ready) return true
    ElMessage.warning(gate.reason)
    return false
  }

  async function refreshProductionReadiness() {
    const requestedDramaId = ctx.dramaId.value
    const requestId = ++ctx.readinessRequestId.value
    ctx.productionReadinessState.value = { status: 'loading', data: null }
    try {
      const response = await ctx.workflowRunsAPI.getNovel2AnimeReadiness({
        drama_id: requestedDramaId,
        qa_mode: 'production',
      })
      const normalized = normalizeCanvasProductionReadiness(response)
      if (requestId !== ctx.readinessRequestId.value || requestedDramaId !== ctx.dramaId.value) return
      ctx.productionReadinessState.value = { status: 'loaded', data: normalized }
    } catch (error) {
      if (requestId !== ctx.readinessRequestId.value || requestedDramaId !== ctx.dramaId.value) return
      ctx.productionReadinessState.value = {
        status: 'error',
        data: null,
        error: ctx.safeFreeCanvasError(error, '正式制作能力加载失败'),
      }
    }
  }

  async function refreshFreeCanvasVideoCapability() {
    const requestedDramaId = ctx.dramaId.value
    const requestId = ++ctx.freeCanvasCapabilityRequestId.value
    ctx.freeCanvasVideoCapability.value = getVideoGenerationCapability([], { loading: true })
    try {
      const configs = await ctx.aiAPI.list('video')
      if (requestId !== ctx.freeCanvasCapabilityRequestId.value || requestedDramaId !== ctx.dramaId.value) return
      ctx.freeCanvasVideoCapability.value = getVideoGenerationCapability(configs)
    } catch (_) {
      if (requestId !== ctx.freeCanvasCapabilityRequestId.value || requestedDramaId !== ctx.dramaId.value) return
      ctx.freeCanvasVideoCapability.value = getVideoGenerationCapability([], { failed: true })
    }
  }

  async function retryStoryboardMedia(storyboardId) {
    const found = findStoryboardInDrama(ctx.drama.value, storyboardId)
    const storyboard = found?.storyboard
    if (!storyboard) return false
    const result = await ctx.loadForStoryboards([storyboard], { prune: false })
    ctx.rebuildGraph()
    return result.failedCount === 0
  }

  async function retryUnknownStoryboardMedia() {
    if (!ctx.unknownMediaStoryboards.value.length) return
    await ctx.loadForStoryboards(ctx.unknownMediaStoryboards.value, { prune: false })
    ctx.rebuildGraph()
  }

  async function confirmEpisodeSelection(value) {
    const drama = ctx.drama
    const episodeId = resolveCanvasEpisodeId(drama.value?.episodes, value)
    if (episodeId === null) {
      ElMessage.warning('该剧集已不可用，请重新选择')
      return
    }
    const requestEpisodeFilterChange = ctx.requestEpisodeFilterChange
    await requestEpisodeFilterChange(episodeId)
  }

  function setPipelineSteps(value) {
    ctx.pipelineSteps.value = Array.isArray(value) ? value : []
  }

  function setActiveGroupId(value) {
    ctx.activeGroupId.value = value || null
  }

  function refreshCapabilitiesFromAiConfigChange() {
    return Promise.allSettled([
      refreshProductionReadiness(),
      refreshFreeCanvasVideoCapability(),
    ])
  }

  const vueInstance = getCurrentInstance()
  const listenToAiConfigChanges = ctx.listenToAiConfigChanges ?? Boolean(vueInstance)
  const stopAiConfigChangeListener = listenToAiConfigChanges
    ? subscribeAiConfigChanged(() => {
      void refreshCapabilitiesFromAiConfigChange()
    })
    : () => {}
  if (vueInstance && listenToAiConfigChanges) onBeforeUnmount(stopAiConfigChangeListener)

  return {
    getCanvasGenerationOptions,
    ensureProductionStepReady,
    ensureProductionPipelineReady,
    refreshProductionReadiness,
    refreshFreeCanvasVideoCapability,
    retryStoryboardMedia,
    retryUnknownStoryboardMedia,
    confirmEpisodeSelection,
    setPipelineSteps,
    setActiveGroupId,
    stopAiConfigChangeListener,
  }
}

export function createDramaCanvasBatchGenerate(ctx = {}) {
  function cancelEpisodeGenerate() {
    ctx.abortEpisodeGenerate()
  }

  async function focusScriptNode() {
    if (ctx.canvasMode.value !== 'production') return
    let epId = ctx.filterEpisodeId.value
    if (!epId) {
      const eps = ctx.drama.value?.episodes || []
      if (eps.length === 1) epId = eps[0].id
    }
    if (!epId) {
      ElMessage.warning('请先选择或新建集数')
      return
    }
    if (!ctx.filterEpisodeId.value && !await ctx.requestEpisodeFilterChange(epId)) return
    await ctx.setFocusedCanvasNode(scriptNodeId(epId))
  }

  async function aiGenerateStoryboards() {
    if (ctx.canvasMode.value !== 'production') return
    if (!ctx.currentEpisode.value) {
      await focusScriptNode()
      if (!ctx.currentEpisode.value) return
    }
    if (!String(ctx.currentEpisode.value?.script_content || '').trim()) {
      ElMessage.warning('当前集还没有剧本，请先编写或导入剧本')
      await focusScriptNode()
      return
    }
    await ctx.runAiGenerateStoryboards()
  }

  async function batchGenerateImages() {
    if (ctx.canvasMode.value !== 'production') return
    if (!ctx.ensureKnownStoryboardMedia((ctx.currentEpisode.value?.storyboards || []).map((storyboard) => storyboard.id))) return
    await ctx.runBatchGenerateImages()
  }

  async function batchGenerateVideos() {
    const ensureProductionStepReady = ctx.ensureProductionStepReady
    if (ctx.canvasMode.value !== 'production') return
    if (!ensureProductionStepReady('video')) return
    if (!ctx.ensureKnownStoryboardMedia((ctx.currentEpisode.value?.storyboards || []).map((storyboard) => storyboard.id))) return
    await ctx.runBatchGenerateVideos()
  }

  return {
    cancelEpisodeGenerate,
    focusScriptNode,
    aiGenerateStoryboards,
    batchGenerateImages,
    batchGenerateVideos,
  }
}
