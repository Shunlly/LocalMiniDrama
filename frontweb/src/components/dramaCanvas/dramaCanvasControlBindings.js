import { computed, isRef, unref } from 'vue'

/**
 * 把画布页已有状态装配成可 v-bind 的属性袋。
 * 只搬家，不创建新状态，不改离开保护和生成门闩。
 */
export function createDramaCanvasControlBindings(values, modelKeys = []) {
  const updaters = {}
  for (const key of modelKeys) {
    const model = values[key]
    updaters[`onUpdate:${key}`] = (next) => {
      if (isRef(model)) model.value = next
    }
  }
  return computed(() => {
    const bindings = { ...updaters }
    for (const [key, value] of Object.entries(values)) {
      bindings[key] = unref(value)
    }
    return bindings
  })
}

/** 工作区侧栏、舞台、空态和底栏绑定源 */
export function createDramaCanvasWorkspaceBindings(ctx = {}) {
  return createDramaCanvasControlBindings({
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
    closeFreeLibrary: ctx.closeFreeLibrary,
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
    handleFreeCanvasDragOver: ctx.onFreeCanvasDragOver,
    handleFreeCanvasDrop: ctx.onFreeCanvasDrop,
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
    handleNodeDoubleClick: ctx.onNodeDoubleClick,
    handleNodeClick: ctx.onNodeClick,
    handlePaneClick: ctx.onPaneClick,
    handlePaneContextMenu: ctx.onPaneContextMenu,
    handleCanvasNodeDragStop: ctx.onCanvasNodeDragStop,
    handleFreeCanvasConnect: ctx.onFreeCanvasConnect,
    handleViewportChange: ctx.onViewportChange,
    handleCanvasMoveEnd: ctx.onCanvasMoveEnd,
    handleSelectionChange: ctx.onSelectionChange,
    handleCanvasNodesInitialized: ctx.onCanvasNodesInitialized,
    canvasStartMode: ctx.canvasStartMode,
    filterEpisodeId: ctx.filterEpisodeId,
    freeNodeCount: ctx.freeNodeCount,
    createFreeCanvasNode: ctx.createFreeCanvasNode,
    confirmEpisodeSelection: ctx.confirmEpisodeSelection,
    goListMode: ctx.goListMode,
    canUndoFreeCanvas: ctx.canUndoFreeCanvas,
    canRedoFreeCanvas: ctx.canRedoFreeCanvas,
    freeCanvasBackground: ctx.freeCanvasBackground,
    selectedFreeNodeIds: ctx.selectedFreeNodeIds,
    undoFreeCanvas: ctx.undoFreeCanvas,
    redoFreeCanvas: ctx.redoFreeCanvas,
    setFreeCanvasBackground: ctx.setFreeCanvasBackground,
    toggleFreeCanvasLibrary: ctx.toggleFreeCanvasLibrary,
    copyFreeCanvasSelection: ctx.copyFreeCanvasSelection,
    deleteFreeCanvasSelection: ctx.deleteFreeCanvasSelection,
    workflowOutcomeUnknown: ctx.workflowOutcomeUnknown,
    refreshUnknownWorkflowOutcome: ctx.refreshUnknownWorkflowOutcome,
  }, ['nodes', 'edges'])
}

/** 创建弹窗、右键菜单、素材选择器和检查器绑定源 */
export function createDramaCanvasOverlayBindings(ctx = {}) {
  return createDramaCanvasControlBindings({
    createDialogVisible: ctx.createDialogVisible,
    createDialogType: ctx.createDialogType,
    handleCreateSubmit: ctx.onCreateSubmit,
    contextMenuVisible: ctx.contextMenuVisible,
    contextMenuX: ctx.contextMenuX,
    contextMenuY: ctx.contextMenuY,
    canvasMode: ctx.canvasMode,
    handleContextMenuSelect: ctx.onContextMenuSelect,
    handleContextMenuFreeNode: ctx.onContextMenuFreeNode,
    closeContextMenu: ctx.closeContextMenu,
    freeMediaPickerVisible: ctx.freeMediaPickerVisible,
    freeMediaPickerContext: ctx.freeMediaPickerContext,
    handleFreeCanvasMediaPicked: ctx.onFreeCanvasMediaPicked,
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
    closeFreeCanvasInspector: ctx.closeFreeCanvasInspector,
  }, ['createDialogVisible', 'freeMediaPickerVisible'])
}

/** 页头、集数筛选和桌面工具条绑定源 */
export function createDramaCanvasChromeBindings(ctx = {}) {
  return createDramaCanvasControlBindings({
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
    goListMode: ctx.goListMode,
    retryUnknownStoryboardMedia: ctx.retryUnknownStoryboardMedia,
    selectedStoryboardIds: ctx.selectedStoryboardIds,
    workflowGroups: ctx.workflowGroups,
    activeGroupId: ctx.activeGroupId,
    pipelineSteps: ctx.pipelineSteps,
    workflowRunning: ctx.workflowRunning,
    workflowProgress: ctx.workflowProgress,
    episodeGenProgress: ctx.episodeGenProgress,
    actionReasons: ctx.actionReasons,
    actionConfigServices: ctx.actionConfigServices,
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
}

/** 加载失败卡片绑定源 */
export function createDramaCanvasLoadFailureBindings(ctx = {}) {
  return createDramaCanvasControlBindings({
    loading: ctx.loading,
    error: ctx.canvasLoadError,
    notFound: ctx.canvasLoadNotFound,
    retryCanvasProjectLoad: ctx.retryCanvasProjectLoad,
    goProjectList: ctx.goProjectList,
  })
}
