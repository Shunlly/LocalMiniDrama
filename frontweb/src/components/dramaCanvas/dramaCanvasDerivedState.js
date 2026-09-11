/**
 * 画布页派生状态。只搬家，不改检查器、制作门闩和自由画布选项的计算口径。
 */
import { computed } from 'vue'
import {
  getCanvasPipelineProductionGate,
  getCanvasProductionActionState,
  getCanvasStartMode,
} from '@/utils/canvasActionState'
import { parseCanvasLayout } from '@/utils/canvasLayout'
import { normalizePipeline } from '@/utils/canvasWorkflow'
import { buildFreeCanvasGraph } from '@/utils/freeCanvasAdapter'
import { buildFreeCanvasConfigRuntime } from '@/utils/freeCanvasConfigState'
import {
  buildFreeCanvasStoryboardMediaItems,
  getFreeCanvasAssetSaveEligibility,
} from '@/utils/freeCanvasMedia'

export const PANEL_NODE_TYPES = new Set(['canvasStoryboard', 'canvasMedia', 'canvasAsset', 'canvasScript'])

export function createDramaCanvasDerivedState(ctx = {}) {
  const dramaId = computed(() => ctx.canvasProjectId.value)
  const isCanvasReady = computed(() => ctx.canvasLoadState.value === 'ready' && Boolean(ctx.drama.value))
  const savedLayout = computed(() => ctx.layoutCache.value || parseCanvasLayout(ctx.drama.value?.metadata))
  const projectAssetsById = computed(() => new Map(
    ctx.projectAssets.value.map((asset) => [String(asset.id), asset]),
  ))
  const storyboardsById = computed(() => new Map(
    (ctx.drama.value?.episodes || [])
      .flatMap((episode) => episode.storyboards || [])
      .map((storyboard) => [String(storyboard.id), storyboard]),
  ))
  const freeGraph = computed(() => buildFreeCanvasGraph(ctx.freeCanvas.value, {
    assetsById: projectAssetsById.value,
    storyboardsById: storyboardsById.value,
    selectedNodeIds: ctx.selectedFreeNodeIds.value,
  }))
  const selectedFreeNode = computed(() => (
    ctx.freeCanvas.value.nodes.find((node) => String(node.id) === String(ctx.selectedFreeNodeId.value)) || null
  ))
  const focusedInspectorNode = computed(() => {
    const id = ctx.focusedNodeId.value
    if (!id) return null
    return ctx.nodes.value.find((node) => (
      String(node.id) === String(id) && PANEL_NODE_TYPES.has(node.type)
    )) || null
  })
  const canvasBackgroundMode = computed(() => (
    ctx.canvasMode.value === 'free' ? ctx.freeCanvas.value.background : 'dots'
  ))
  const freeStoryboardMediaItems = computed(() => buildFreeCanvasStoryboardMediaItems(ctx.drama.value, {
    imagesBySbId: ctx.imagesBySbId.value,
    videosBySbId: ctx.videosBySbId.value,
    mediaStatusBySbId: ctx.mediaStatusBySbId.value,
  }))
  const selectedFreeAssetEligibility = computed(() => getFreeCanvasAssetSaveEligibility(
    selectedFreeNode.value,
    {
      projectId: dramaId.value,
      inventory: [...freeStoryboardMediaItems.value, ...ctx.projectAssets.value],
    },
  ))
  const freeAssetOptions = computed(() => ctx.projectAssets.value.map((asset) => ({
    id: asset.id,
    label: asset.name || `素材 ${asset.id}`,
  })))
  const currentEpisode = computed(() => (
    (ctx.drama.value?.episodes || []).find((episode) => String(episode.id) === String(ctx.filterEpisodeId.value)) || null
  ))
  const freeStoryboardOptions = computed(() => (
    (ctx.drama.value?.episodes || []).flatMap((episode) => (
      (episode.storyboards || []).map((storyboard, index) => ({
        id: storyboard.id,
        label: `${episode.title || `第 ${episode.episode_number || '?'} 集`} · ${storyboard.title || `分镜 ${storyboard.storyboard_number || index + 1}`}`,
      }))
    ))
  ))
  const freeConversionTargets = computed(() => [
    ...(ctx.drama.value?.characters || []).map((character) => ({
      value: `character:${character.id}`,
      label: `角色 · ${character.name || character.id}`,
    })),
    ...(ctx.drama.value?.scenes || []).map((scene) => ({
      value: `scene:${scene.id}`,
      label: `场景 · ${scene.location || scene.id}`,
    })),
    ...(ctx.drama.value?.props || []).map((prop) => ({
      value: `prop:${prop.id}`,
      label: `道具 · ${prop.name || prop.id}`,
    })),
    ...freeStoryboardOptions.value.map((storyboard) => ({
      value: `storyboard:${storyboard.id}`,
      label: `分镜 · ${storyboard.label}`,
    })),
  ])
  const freeMediaPickerContext = computed(() => ({
    projectTitle: ctx.drama.value?.title || '当前项目',
    episodeLabel: currentEpisode.value?.title || '',
    usageLabel: '添加到自由画布',
    dramaId: dramaId.value,
    reusePolicy: 'current-or-global',
  }))
  const workflowStoryboardDetails = computed(() => {
    const details = {}
    for (const [episodeIndex, episode] of (ctx.drama.value?.episodes || []).entries()) {
      const episodeTitle = episode.title || `第 ${episode.episode_number ?? episodeIndex + 1} 集`
      for (const [storyboardIndex, storyboard] of (episode.storyboards || []).entries()) {
        const title = [
          storyboard.title,
          storyboard.segment_title,
          storyboard.action,
          storyboard.description,
        ].find((value) => String(value || '').trim())
        details[String(storyboard.id)] = {
          title: String(title || '').trim(),
          episodeTitle,
          storyboardNumber: storyboard.storyboard_number ?? storyboardIndex + 1,
        }
      }
    }
    return details
  })
  const scopedStoryboards = computed(() => {
    if (!ctx.drama.value) return []
    const episodes = ctx.filterEpisodeId.value
      ? (ctx.drama.value.episodes || []).filter((episode) => episode.id === ctx.filterEpisodeId.value)
      : (ctx.drama.value.episodes || [])
    return episodes.flatMap((episode) => episode.storyboards || [])
  })
  const unknownMediaStoryboards = computed(() => (
    scopedStoryboards.value.filter((storyboard) => ctx.mediaStatusBySbId.value?.[storyboard.id]?.state === 'unknown')
  ))
  const scopedMediaWarning = computed(() => {
    const count = unknownMediaStoryboards.value.length
    if (!count) return ''
    return count === 1
      ? '1 个分镜的媒体查询失败，已保留旧结果并标记为未知。为避免重复计费，重新生成图片或视频前请先重试媒体查询。'
      : `${count} 个分镜的媒体查询失败，已保留旧结果并标记为未知。为避免重复计费，重新生成图片或视频前请先重试媒体查询。`
  })
  const activeWorkflowGroup = computed(() => (
    ctx.workflowGroups.value.find((group) => group.id === ctx.activeGroupId.value) || null
  ))
  const activeWorkflowSteps = computed(() => {
    if (!activeWorkflowGroup.value) return []
    const configured = Array.isArray(activeWorkflowGroup.value.pipeline)
      ? activeWorkflowGroup.value.pipeline
      : ctx.pipelineSteps.value
    return normalizePipeline(configured)
  })
  const productionActions = computed(() => getCanvasProductionActionState(ctx.productionReadinessState.value))
  const freeCanvasConfigRuntimeById = computed(() => new Map(
    ctx.freeCanvas.value.nodes
      .filter((node) => node.type === 'config')
      .map((node) => [String(node.id), buildFreeCanvasConfigRuntime(node.id, ctx.freeCanvas.value, {
        gate: productionActions.value.video,
        capability: ctx.freeCanvasVideoCapability.value,
      })]),
  ))
  const selectedFreeConfigRuntime = computed(() => (
    selectedFreeNode.value?.type === 'config'
      ? freeCanvasConfigRuntimeById.value.get(String(selectedFreeNode.value.id))
      : undefined
  ))
  const createWorkflowProductionGate = computed(() => (
    getCanvasPipelineProductionGate(ctx.pipelineSteps.value, productionActions.value)
  ))
  const runWorkflowProductionGate = computed(() => (
    getCanvasPipelineProductionGate(activeWorkflowSteps.value, productionActions.value)
  ))
  const canvasStartMode = computed(() => getCanvasStartMode(ctx.drama.value, ctx.filterEpisodeId.value))

  return {
    dramaId,
    isCanvasReady,
    savedLayout,
    projectAssetsById,
    storyboardsById,
    freeGraph,
    selectedFreeNode,
    focusedInspectorNode,
    canvasBackgroundMode,
    freeStoryboardMediaItems,
    selectedFreeAssetEligibility,
    freeAssetOptions,
    currentEpisode,
    freeStoryboardOptions,
    freeConversionTargets,
    freeMediaPickerContext,
    workflowStoryboardDetails,
    scopedStoryboards,
    unknownMediaStoryboards,
    scopedMediaWarning,
    activeWorkflowGroup,
    activeWorkflowSteps,
    productionActions,
    freeCanvasConfigRuntimeById,
    selectedFreeConfigRuntime,
    createWorkflowProductionGate,
    runWorkflowProductionGate,
    canvasStartMode,
  }
}
