/**
 * 画布页 chrome / workspace / overlay / 失败卡片绑定袋和检查器 provide。
 * 只装配已有状态，不改 persist / workflow 核心写入。
 */
import { computed, provide } from 'vue'

import { CANVAS_CONTEXT_KEY } from '@/composables/useCanvasContext'
import {
  createDramaCanvasChromeBindings,
  createDramaCanvasLoadFailureBindings,
  createDramaCanvasOverlayBindings,
  createDramaCanvasWorkspaceBindings,
} from '@/components/dramaCanvas/dramaCanvasControlBindings.js'
import { pipelineTouchesBillableMedia } from '@/components/dramaCanvas/dramaCanvasBillableMedia.js'
import { getCanvasActionDisabledReasons } from '@/utils/canvasActionState'

export function createDramaCanvasActionDisplay(ctx = {}) {
  const actionReasons = computed(() => {
    const reasons = getCanvasActionDisabledReasons({
      selectedStoryboardCount: ctx.selectedStoryboardIds.value.length,
      pipelineSteps: ctx.pipelineSteps.value,
      activeGroupId: ctx.activeGroupId.value,
      activeWorkflowSteps: ctx.activeWorkflowSteps.value,
      productionActions: ctx.productionActions.value,
      episodeCount: ctx.drama.value?.episodes?.length || 0,
      episodeId: ctx.filterEpisodeId.value,
      episodeHasScript: Boolean(String(ctx.currentEpisode.value?.script_content || '').trim()),
      storyboardCount: ctx.currentEpisode.value?.storyboards?.length || 0,
      workflowRunning: ctx.workflowRunning.value,
      episodeGenerating: ctx.episodeGenerating.value,
    })
    return {
      ...reasons,
      runWorkflow: reasons.runWorkflow || ctx.getBillableMediaUnknownReason(
        pipelineTouchesBillableMedia(ctx.activeWorkflowSteps.value)
          ? (ctx.activeWorkflowGroup.value?.storyboard_ids || [])
          : [],
      ),
      batchImages: reasons.batchImages || ctx.getBillableMediaUnknownReason(
        (ctx.currentEpisode.value?.storyboards || []).map((storyboard) => storyboard.id),
      ),
      batchVideos: reasons.batchVideos || ctx.getBillableMediaUnknownReason(
        (ctx.currentEpisode.value?.storyboards || []).map((storyboard) => storyboard.id),
      ),
    }
  })
  const actionConfigServices = computed(() => ({
    createWorkflow: actionReasons.value.createWorkflow === ctx.createWorkflowProductionGate.value.reason
      ? ctx.createWorkflowProductionGate.value.serviceType
      : '',
    runWorkflow: actionReasons.value.runWorkflow === ctx.runWorkflowProductionGate.value.reason
      ? ctx.runWorkflowProductionGate.value.serviceType
      : '',
    batchVideos: actionReasons.value.batchVideos === ctx.productionActions.value.video.reason
      ? ctx.productionActions.value.video.serviceType
      : '',
  }))
  return { actionReasons, actionConfigServices }
}

export function createDramaCanvasHistoryDisplay(ctx = {}) {
  const canUndoFreeCanvas = computed(() => {
    ctx.freeHistoryRevision.value
    return ctx.canvasMode.value === 'free' && !ctx.freeCanvasReadOnly.value && ctx.canUndoFreeCanvasHistory()
  })
  const canRedoFreeCanvas = computed(() => {
    ctx.freeHistoryRevision.value
    return ctx.canvasMode.value === 'free' && !ctx.freeCanvasReadOnly.value && ctx.canRedoFreeCanvasHistory()
  })
  return { canUndoFreeCanvas, canRedoFreeCanvas }
}

export function createDramaCanvasListModeNavigation(ctx = {}) {
  function goListMode() {
    const episode = ctx.filterEpisodeId.value || ctx.routeEpisodeId()
    const query = episode ? { episode: String(episode) } : {}
    if (ctx.projectListReturnTo.value) query.returnTo = ctx.projectListReturnTo.value
    ctx.router.push({ path: `/film/${ctx.dramaId.value}`, query })
  }
  function closeFreeLibrary() {
    ctx.freeLibraryVisible.value = false
  }
  return { goListMode, closeFreeLibrary }
}

export function provideDramaCanvasContext(ctx = {}) {
  provide('localMiniDrama.canvas.openAiConfig', ctx.openAiConfig)
  provide(CANVAS_CONTEXT_KEY, {
    focusedNodeId: ctx.focusedNodeId,
    drama: ctx.drama,
    imagesBySbId: ctx.imagesBySbId,
    videosBySbId: ctx.videosBySbId,
    mediaStatusBySbId: ctx.mediaStatusBySbId,
    mediaValidity: ctx.mediaValidity,
    setMediaValidity: (nodeId, state) => {
      if (nodeId) ctx.mediaValidity[nodeId] = state
    },
    clearMediaValidity: (nodeId) => {
      if (nodeId) delete ctx.mediaValidity[nodeId]
    },
    productionActions: ctx.productionActions,
    getGenerationOptions: ctx.getCanvasGenerationOptions,
    ensureProductionStepReady: ctx.ensureProductionStepReady,
    beginNodeGeneration: (info) => ctx.nodeGenerationCoordinator.begin(info),
    hasNodeGeneration: () => ctx.nodeGenerationCoordinator.hasActive(),
    getStoryboardMediaQueryStatus: ctx.getStoryboardMediaQueryStatus,
    retryStoryboardMedia: ctx.retryStoryboardMedia,
    openAiConfig: ctx.openAiConfig,
    setFocusedNode: ctx.setFocusedCanvasNode,
    registerFocusGuard: ctx.registerFocusGuard,
    clearFocusedNode: (options) => ctx.setFocusedCanvasNode(null, options),
    setHighlightAsset: ctx.setHighlightAsset,
    refresh: ctx.refreshCanvas,
    refreshDrama: ctx.refreshDrama,
    goMediaLibrary: ctx.goMediaLibrary,
    suppressPaneClick: ctx.suppressPaneClick,
    nodeStatus: ctx.nodeStatus,
    openCreateDialog: (...args) => ctx.openCreateDialog(...args),
    scriptActions: ctx.scriptActionsHolder,
    registerCanvasFlowApi: (api) => {
      ctx.canvasFlowApi.value = api
    },
  })
}

export function createDramaCanvasPageBindings(ctx = {}) {
  const { actionReasons, actionConfigServices } = createDramaCanvasActionDisplay(ctx)
  const { canUndoFreeCanvas, canRedoFreeCanvas } = createDramaCanvasHistoryDisplay(ctx)
  const { goListMode, closeFreeLibrary } = createDramaCanvasListModeNavigation(ctx)
  const freeNodeCount = computed(() => ctx.freeCanvas.value.nodes.length)
  const freeCanvasBackground = computed(() => ctx.freeCanvas.value.background)
  const hideProductionNodes = computed(() => Boolean(ctx.freeCanvas.value.hideProductionNodes))

  const workspaceBindings = createDramaCanvasWorkspaceBindings({
    nodes: ctx.nodes,
    edges: ctx.edges,
    loading: ctx.loading,
    drama: ctx.drama,
    canvasMode: ctx.canvasMode,
    freeLibraryVisible: ctx.freeLibraryVisible,
    freeStoryboardMediaItems: ctx.freeStoryboardMediaItems,
    projectAssets: ctx.projectAssets,
    dramaId: ctx.dramaId,
    freeCanvasUploading: ctx.freeCanvasUploading,
    freeCanvasUploadStatus: ctx.freeCanvasUploadStatus,
    createFreeEntityReference: ctx.createFreeEntityReference,
    createFreeNodeFromLibraryItem: ctx.createFreeNodeFromLibraryItem,
    uploadFreeCanvasFiles: ctx.uploadFreeCanvasFiles,
    openFreeCanvasMediaPicker: ctx.openFreeCanvasMediaPicker,
    setCanvasMode: ctx.setCanvasMode,
    closeFreeLibrary,
    highlightAssetId: ctx.highlightAssetId,
    workflowGroups: ctx.workflowGroups,
    activeGroupId: ctx.activeGroupId,
    workflowStoryboardDetails: ctx.workflowStoryboardDetails,
    workflowOrderSaving: ctx.workflowOrderSaving,
    workflowRunning: ctx.workflowRunning,
    focusScriptNode: ctx.focusScriptNode,
    openCreateDialog: ctx.openCreateDialog,
    clearAssetHighlight: ctx.clearAssetHighlight,
    selectSidebarAsset: ctx.selectSidebarAsset,
    setActiveGroupId: ctx.setActiveGroupId,
    reorderWorkflowStoryboards: ctx.reorderWorkflowStoryboards,
    onCreateWorkflowGroup: ctx.onCreateWorkflowGroup,
    onFreeCanvasDragOver: ctx.onFreeCanvasDragOver,
    onFreeCanvasDrop: ctx.onFreeCanvasDrop,
    canvasViewportReady: ctx.canvasViewportReady,
    initialViewport: ctx.initialViewport,
    isValidFreeConnection: ctx.isValidFreeConnection,
    canvasBackgroundMode: ctx.canvasBackgroundMode,
    canvasInteractive: ctx.canvasInteractive,
    editingFreeNodeId: ctx.editingFreeNodeId,
    zoomCanvasIn: ctx.zoomCanvasIn,
    zoomCanvasOut: ctx.zoomCanvasOut,
    fitCanvasView: ctx.fitCanvasView,
    toggleCanvasInteractive: ctx.toggleCanvasInteractive,
    resolveFreeCanvasNodeMediaUrl: ctx.resolveFreeCanvasNodeMediaUrl,
    freeCanvasConfigRuntime: ctx.freeCanvasConfigRuntime,
    updateFreeNodeContent: ctx.updateFreeNodeContent,
    openFreeCanvasInspectorFor: ctx.openFreeCanvasInspectorFor,
    deleteFreeCanvasNode: ctx.deleteFreeCanvasNode,
    retryFreeCanvasNode: ctx.retryFreeCanvasNode,
    configureFreeCanvasNode: ctx.configureFreeCanvasNode,
    cancelFreeCanvasConfig: ctx.cancelFreeCanvasConfig,
    retryFreeCanvasConfig: ctx.retryFreeCanvasConfig,
    finishFreeCanvasNodeEditing: ctx.finishFreeCanvasNodeEditing,
    onNodeDoubleClick: ctx.onNodeDoubleClick,
    onNodeClick: ctx.onNodeClick,
    onPaneClick: ctx.onPaneClick,
    onPaneContextMenu: ctx.onPaneContextMenu,
    onCanvasNodeDragStop: ctx.onCanvasNodeDragStop,
    onFreeCanvasConnect: ctx.onFreeCanvasConnect,
    onViewportChange: ctx.onViewportChange,
    onCanvasMoveEnd: ctx.onCanvasMoveEnd,
    onSelectionChange: ctx.onSelectionChange,
    onCanvasNodesInitialized: ctx.onCanvasNodesInitialized,
    canvasStartMode: ctx.canvasStartMode,
    filterEpisodeId: ctx.filterEpisodeId,
    freeNodeCount,
    createFreeCanvasNode: ctx.createFreeCanvasNode,
    confirmEpisodeSelection: ctx.confirmEpisodeSelection,
    goListMode,
    canUndoFreeCanvas,
    canRedoFreeCanvas,
    freeCanvasBackground,
    selectedFreeNodeIds: ctx.selectedFreeNodeIds,
    undoFreeCanvas: ctx.undoFreeCanvas,
    redoFreeCanvas: ctx.redoFreeCanvas,
    setFreeCanvasBackground: ctx.setFreeCanvasBackground,
    hideProductionNodes,
    setHideProductionNodes: ctx.setHideProductionNodes,
    toggleFreeCanvasLibrary: ctx.toggleFreeCanvasLibrary,
    copyFreeCanvasSelection: ctx.copyFreeCanvasSelection,
    deleteFreeCanvasSelection: ctx.deleteFreeCanvasSelection,
    workflowOutcomeUnknown: ctx.workflowOutcomeUnknown,
    refreshUnknownWorkflowOutcome: ctx.refreshUnknownWorkflowOutcome,
  })

  const overlayHostBindings = createDramaCanvasOverlayBindings({
    createDialogVisible: ctx.createDialogVisible,
    createDialogType: ctx.createDialogType,
    onCreateSubmit: ctx.onCreateSubmit,
    contextMenuVisible: ctx.contextMenuVisible,
    contextMenuX: ctx.contextMenuX,
    contextMenuY: ctx.contextMenuY,
    canvasMode: ctx.canvasMode,
    onContextMenuSelect: ctx.onContextMenuSelect,
    onContextMenuFreeNode: ctx.onContextMenuFreeNode,
    closeContextMenu: ctx.closeContextMenu,
    freeMediaPickerVisible: ctx.freeMediaPickerVisible,
    freeMediaPickerContext: ctx.freeMediaPickerContext,
    onFreeCanvasMediaPicked: ctx.onFreeCanvasMediaPicked,
    goMediaLibrary: ctx.goMediaLibrary,
    focusedInspectorNode: ctx.focusedInspectorNode,
    dramaId: ctx.dramaId,
    selectedFreeNode: ctx.selectedFreeNode,
    freeCanvasReadOnly: ctx.freeCanvasReadOnly,
    freeInspectorBusy: ctx.freeInspectorBusy,
    freeInspectorAction: ctx.freeInspectorAction,
    selectedFreeAssetEligibility: ctx.selectedFreeAssetEligibility,
    freeAssetOptions: ctx.freeAssetOptions,
    freeStoryboardOptions: ctx.freeStoryboardOptions,
    freeConversionTargets: ctx.freeConversionTargets,
    selectedFreeConfigRuntime: ctx.selectedFreeConfigRuntime,
    updateFreeCanvasNode: ctx.updateFreeCanvasNode,
    convertFreeCanvasReference: ctx.convertFreeCanvasReference,
    saveFreeCanvasNodeAsAsset: ctx.saveFreeCanvasNodeAsAsset,
    configureFreeCanvasNode: ctx.configureFreeCanvasNode,
    cancelFreeCanvasConfig: ctx.cancelFreeCanvasConfig,
    retryFreeCanvasConfig: ctx.retryFreeCanvasConfig,
    generateFreeCanvasConfig: ctx.generateFreeCanvasConfig,
    copyFreeCanvasSelection: ctx.copyFreeCanvasSelection,
    deleteFreeCanvasSelection: ctx.deleteFreeCanvasSelection,
    closeFreeCanvasInspector: ctx.closeFreeCanvasInspector,
  })

  const pageChromeBindings = createDramaCanvasChromeBindings({
    drama: ctx.drama,
    filterEpisodeId: ctx.filterEpisodeId,
    layoutSaveState: ctx.layoutSaveState,
    layoutSaveError: ctx.layoutSaveError,
    episodeGenerating: ctx.episodeGenerating,
    freeCanvasReadOnly: ctx.freeCanvasReadOnly,
    freeCanvasCompatibilityMessage: ctx.freeCanvasCompatibilityMessage,
    scopedMediaWarning: ctx.scopedMediaWarning,
    mediaLoading: ctx.mediaLoading,
    goProjectList: ctx.goProjectList,
    requestEpisodeFilterChange: ctx.requestEpisodeFilterChange,
    retryCanvasSave: ctx.retryCanvasSave,
    cancelEpisodeGenerate: ctx.cancelEpisodeGenerate,
    goListMode,
    retryUnknownStoryboardMedia: ctx.retryUnknownStoryboardMedia,
    selectedStoryboardIds: ctx.selectedStoryboardIds,
    workflowGroups: ctx.workflowGroups,
    activeGroupId: ctx.activeGroupId,
    pipelineSteps: ctx.pipelineSteps,
    workflowRunning: ctx.workflowRunning,
    workflowProgress: ctx.workflowProgress,
    episodeGenProgress: ctx.episodeGenProgress,
    actionReasons,
    actionConfigServices,
    aligningNodes: ctx.aligningNodes,
    isDark: ctx.isDark,
    canvasMode: ctx.canvasMode,
    focusScriptNode: ctx.focusScriptNode,
    openCreateDialog: ctx.openCreateDialog,
    onAlignNodes: ctx.onAlignNodes,
    toggleTheme: ctx.toggleTheme,
    setCanvasMode: ctx.setCanvasMode,
    setPipelineSteps: ctx.setPipelineSteps,
    setActiveGroupId: ctx.setActiveGroupId,
    onCreateWorkflowGroup: ctx.onCreateWorkflowGroup,
    onRunActiveGroup: ctx.onRunActiveGroup,
    cancelActiveWorkflow: ctx.cancelActiveWorkflow,
    onDeleteActiveGroup: ctx.onDeleteActiveGroup,
    aiGenerateStoryboards: ctx.aiGenerateStoryboards,
    batchGenerateImages: ctx.batchGenerateImages,
    batchGenerateVideos: ctx.batchGenerateVideos,
  })

  const loadFailureBindings = createDramaCanvasLoadFailureBindings({
    loading: ctx.loading,
    canvasLoadError: ctx.canvasLoadError,
    canvasLoadNotFound: ctx.canvasLoadNotFound,
    retryCanvasProjectLoad: ctx.retryCanvasProjectLoad,
    goProjectList: ctx.goProjectList,
  })

  return {
    actionReasons,
    actionConfigServices,
    canUndoFreeCanvas,
    canRedoFreeCanvas,
    goListMode,
    closeFreeLibrary,
    workspaceBindings,
    overlayHostBindings,
    pageChromeBindings,
    loadFailureBindings,
  }
}

export function useDramaCanvasPageBindings(ctx = {}) {
  provideDramaCanvasContext(ctx)
  return createDramaCanvasPageBindings(ctx)
}
