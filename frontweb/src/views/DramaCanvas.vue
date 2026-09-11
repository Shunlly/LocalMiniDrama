<template>
  <div
    class="drama-canvas-page"
    :class="{
      'inspector-open': focusedNodeId,
      'free-inspector-open': selectedFreeNodeId,
      'free-mode': canvasMode === 'free',
    }"
  >
    <CanvasPageChrome v-bind="pageChromeBindings" />

    <CanvasLoadFailureCard
      v-if="canvasLoadState === 'error'"
      ref="canvasLoadFailureRef"
      v-bind="loadFailureBindings"
    />

    <CanvasWorkspace
      v-else
      ref="canvasWorkspaceRef"
      v-bind="workspaceBindings"
    />
    <CanvasOverlayHost v-bind="overlayHostBindings" />
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from '@/utils/elementPlusFeedback.js'

import { useTheme } from '@/composables/useTheme'
import { isCanvasUserAbort } from '@/composables/useCanvasUserError'
import { useDramaCanvasFreeCanvas } from '@/composables/useDramaCanvasFreeCanvas'
import { useDramaCanvasPersist } from '@/composables/useDramaCanvasPersist'
import { useDramaCanvasProjectLoad } from '@/composables/useDramaCanvasProjectLoad'
import { useDramaCanvasWorkflow } from '@/composables/useDramaCanvasWorkflow'
import { useDramaCanvasGraph } from '@/composables/useDramaCanvasGraph'
import { useDramaCanvasViewport } from '@/composables/useDramaCanvasViewport'
import { useDramaCanvasDisplayState } from '@/composables/useDramaCanvasDisplayState'
import { useDramaCanvasPageBindings } from '@/composables/useDramaCanvasPageBindings'
import { useCanvasStoryboardMedia } from '@/composables/useCanvasStoryboardMedia'
import { useCanvasCrud } from '@/composables/useCanvasCrud'
import { useCanvasEpisodeGenerate } from '@/composables/useCanvasEpisodeGenerate'
import { useCanvasScript } from '@/composables/useCanvasScript'
import { createCanvasNodeStatusStore } from '@/composables/useCanvasNodeStatus'
import { createCanvasNodeGenerationCoordinator } from '@/utils/canvasNodeGenerationCoordinator'
import { useCanvasWorkflowOrder } from '@/composables/useCanvasWorkflowOrder'
import {
  createEmptyFreeCanvas,
} from '@/utils/freeCanvasState'
import { getVideoGenerationCapability } from '@/utils/filmCreateActionState'

import CanvasLoadFailureCard from '@/components/dramaCanvas/CanvasLoadFailureCard.vue'
import CanvasPageChrome from '@/components/dramaCanvas/CanvasPageChrome.vue'
import CanvasWorkspace from '@/components/dramaCanvas/CanvasWorkspace.vue'
import CanvasOverlayHost from '@/components/dramaCanvas/CanvasOverlayHost.vue'
import {
  coreCanvasDramaAPI,
  friendlyCanvasProjectLoadError,
  isCanvasAbortError,
} from '@/components/dramaCanvas/dramaCanvasProjectRequest.js'
import {
  pipelineTouchesBillableMedia,
} from '@/components/dramaCanvas/dramaCanvasBillableMedia.js'
import { createDramaCanvasDerivedState } from '@/components/dramaCanvas/dramaCanvasDerivedState.js'
import { createDramaCanvasFocusSync, createDramaCanvasPaneEvents } from '@/components/dramaCanvas/dramaCanvasFocusSync.js'
import { createDramaCanvasContextMenu } from '@/components/dramaCanvas/dramaCanvasContextMenu.js'
import {
  createDramaCanvasBatchGenerate,
  createDramaCanvasProductionGates,
} from '@/components/dramaCanvas/dramaCanvasBatchGenerate.js'
import { createDramaCanvasNavigation } from '@/components/dramaCanvas/dramaCanvasNavigation.js'
import { createDramaCanvasLeaveHelpers } from '@/components/dramaCanvas/dramaCanvasLeaveHelpers.js'
import { createDramaCanvasLeaveProtection } from '@/components/dramaCanvas/dramaCanvasLeaveProtection.js'
import { createDramaCanvasRouteFocus } from '@/components/dramaCanvas/dramaCanvasRouteFocus.js'
import { createDramaCanvasProjectActions } from '@/components/dramaCanvas/dramaCanvasProjectActions.js'
import { workflowRunsAPI } from '@/api/workflowRuns'
import { aiAPI } from '@/api/ai'

const route = useRoute()
const router = useRouter()
const canvasProjectId = computed(() => Number(route.params.id))
const canvasInstanceActive = ref(true)
const { isDark, toggle: toggleTheme } = useTheme()
const {
  imagesBySbId,
  videosBySbId,
  mediaStatusBySbId,
  mediaLoading,
  loadForDrama,
  loadForStoryboards,
} = useCanvasStoryboardMedia()

const loading = ref(false)
const drama = ref(null)
const canvasLoadState = ref('loading')
const canvasLoadError = ref('')
const canvasLoadNotFound = ref(false)
const canvasLoadFailureRef = ref(null)
const nodes = ref([])
const edges = ref([])
const productionGraph = ref({ nodes: [], edges: [] })
const freeCanvas = ref(createEmptyFreeCanvas())
const freeCanvasReadOnly = ref(false)
const freeCanvasCompatibilityMessage = ref('')
const canvasMode = ref('production')
const selectedFreeNodeId = ref(null)
const selectedFreeNodeIds = ref([])
const selectedFreeEdgeIds = ref([])
const editingFreeNodeId = ref(null)
const freeInspectorBusy = ref(false)
const freeInspectorAction = ref('')
const projectAssets = ref([])
const freeMediaPickerVisible = ref(false)
const freeLibraryVisible = ref(true)
const freeCanvasUploading = ref(false)
const freeCanvasUploadStatus = ref('')
const filterEpisodeId = ref(null)
const highlightAssetId = ref(null)
const layoutCache = ref(null)
const workflowGroups = ref([])
const activeGroupId = ref(null)
const selectedStoryboardIds = ref([])
const pipelineSteps = ref(['image', 'video', 'audio'])
const workflowRunStarting = ref(false)
const workflowRunning = ref(false)
const workflowProgress = ref('')
const activeWorkflowRun = ref(null)
const workflowOutcomeUnknown = ref(false)
const currentViewport = ref({ x: 0, y: 0, zoom: 0.9 })
const productionViewport = ref({ x: 0, y: 0, zoom: 0.9 })
const focusedNodeId = ref(null)
const canvasWorkspaceRef = ref(null)
const canvasMainRef = computed(() => canvasWorkspaceRef.value?.canvasMainRef ?? null)
const canvasViewportReady = ref(false)
const contextMenuVisible = ref(false)
const contextMenuX = ref(0)
const contextMenuY = ref(0)
const contextMenuFlowPos = ref(null)
const paneClickSuppressed = ref(false)
const nodeStatus = createCanvasNodeStatusStore()
const nodeGenerationCoordinator = createCanvasNodeGenerationCoordinator()
const aligningNodes = ref(false)
const canvasFlowApi = ref(null)
const canvasInteractive = ref(true)
const initialFitDone = ref(false)
const mediaValidity = reactive({})
const productionReadinessState = ref({ status: 'loading', data: null })
const freeCanvasVideoCapability = ref(getVideoGenerationCapability([], { loading: true }))

let readinessRequestId = 0
let freeCanvasCapabilityRequestId = 0
const canvasCommandBridge = {
  scheduleLayoutSave() {},
  resetFreeCanvasClipboard() {},
  finishFreeCanvasNodeEditing() {},
  setCanvasMode: async () => {},
  activateFreeCanvasNode() {},
  loadCanvasProject: async () => false,
  rebuildGraph() {},
  cancelScheduledCanvasSave() {},
  refreshProductionReadiness() {},
  refreshFreeCanvasVideoCapability() {},
  focusFreeCanvasNodeTrigger() {},
  submitCreate: async () => {},
}
const freeHistoryRevision = ref(0)


const {
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
} = createDramaCanvasDerivedState({
  canvasProjectId,
  canvasLoadState,
  drama,
  layoutCache,
  projectAssets,
  freeCanvas,
  selectedFreeNodeIds,
  selectedFreeNodeId,
  focusedNodeId,
  nodes,
  canvasMode,
  imagesBySbId,
  videosBySbId,
  mediaStatusBySbId,
  filterEpisodeId,
  workflowGroups,
  activeGroupId,
  pipelineSteps,
  productionReadinessState,
  freeCanvasVideoCapability,
})

const {
  projectListReturnTo,
  initialViewport,
  hasSavedViewport,
  getStoryboardMediaQueryStatus,
  getBillableMediaUnknownReason,
  ensureKnownStoryboardMedia,
  focusCanvasNode,
  screenToFlowPosition,
  currentCanvasProjectId,
  isCanvasProjectCurrent,
  isActiveWorkflowRun,
  isWorkflowAbortError,
  safeFreeCanvasError,
  MIN_READABLE_CANVAS_ZOOM,
} = useDramaCanvasDisplayState({
  route,
  drama,
  mediaStatusBySbId,
  canvasMode,
  freeCanvas,
  savedLayout,
  canvasFlowApi,
  currentViewport,
  canvasMainRef,
  canvasViewportReady,
  canvasProjectId,
  activeWorkflowRun,
})
const FREE_INSPECTOR_FOCUS_TIMEOUT_MS = 800
const FREE_INSPECTOR_FOCUS_POLL_MS = 10

const leaveHelperCtx = {
  nodeGenerationCoordinator,
  freeCanvasUploading,
  episodeGenerating: { value: false },
  abortEpisodeGenerate() {},
}
const {
  ensureEpisodeGenerationFinished,
  ensureNodeGenerationFinished,
  ensureFreeCanvasUploadFinished,
} = createDramaCanvasLeaveHelpers(leaveHelperCtx)

const {
  restoreFocusedNodeSelection,
  hasFocusedNodePendingWork,
  confirmFocusedNodeLeave,
  focusCanvasNodeTrigger,
  setFocusedCanvasNode,
  registerFocusGuard,
} = createDramaCanvasFocusSync({
  focusedNodeId,
  nodes,
  selectedStoryboardIds,
  focusCanvasNode,
  ensureNodeGenerationFinished,
})

const dramaCanvasRouteFocusCtx = {
  route,
  router,
  canvasProjectId,
  canvasInstanceActive,
  drama,
  selectedFreeNodeId,
  selectedFreeNodeIds,
  selectedFreeEdgeIds,
  freeCanvas,
  canvasMode,
  nodes,
  filterEpisodeId,
  focusedNodeId,
  highlightAssetId,
  layoutCache,
  productionGraph,
  projectAssets,
  freeMediaPickerVisible,
  activeGroupId,
  workflowOutcomeUnknown,
  selectedStoryboardIds,
  editingFreeNodeId,
  initialFitDone,
  canvasInteractive,
  mediaValidity,
  productionReadinessState,
  freeCanvasVideoCapability,
  nextTick,
  document,
  setTimeout,
  Date,
  Number,
  String,
  FREE_INSPECTOR_FOCUS_TIMEOUT_MS,
  FREE_INSPECTOR_FOCUS_POLL_MS,
  getVideoGenerationCapability,
  setFocusedCanvasNode,
  loadForDrama,
  setCanvasMode: (...args) => canvasCommandBridge.setCanvasMode(...args),
  activateFreeCanvasNode: (...args) => canvasCommandBridge.activateFreeCanvasNode(...args),
  loadCanvasProject: (...args) => canvasCommandBridge.loadCanvasProject(...args),
  rebuildGraph: (...args) => canvasCommandBridge.rebuildGraph(...args),
  cancelScheduledCanvasSave: (...args) => canvasCommandBridge.cancelScheduledCanvasSave(...args),
  refreshProductionReadiness: (...args) => canvasCommandBridge.refreshProductionReadiness(...args),
  refreshFreeCanvasVideoCapability: (...args) => canvasCommandBridge.refreshFreeCanvasVideoCapability(...args),
  focusFreeCanvasNodeTrigger: (...args) => canvasCommandBridge.focusFreeCanvasNodeTrigger(...args),
  layoutDirty: { value: false },
  failedCanvasSaveOperation: { value: null },
  layoutSaveError: { value: '' },
  layoutSaveState: { value: 'idle' },
}
const {
  routeFocusNodeId,
  routeEpisodeId,
  canvasRouteContext,
  claimCanvasEntityFocus,
  claimRouteEntityFocus,
  ownsCanvasEntityFocus,
  waitForFreeCanvasInspectorFocus,
  synchronizeRouteFocusedEntity,
  startCanvasRouteSynchronization,
  requestEpisodeFilterChange,
  closeFreeCanvasInspector,
} = createDramaCanvasRouteFocus(dramaCanvasRouteFocusCtx)

const {
  freeCanvasUiMode,
  normalizeFreeCanvasForProject,
  hydrateFreeCanvasState,
  loadProjectAssets,
  modeScopedProductionGraph,
  mergeActiveCanvasGraphs,
  pruneFreeCanvasSelection,
  commitFreeCanvasState,
  applyFreeCanvasHistoryState,
  setCanvasMode,
  undoFreeCanvas,
  redoFreeCanvas,
  setFreeCanvasBackground,
  syncWorkflowFromDrama,
  rebuildGraph,
  applyHighlight,
  selectSidebarAsset,
  setHighlightAsset,
  clearAssetHighlight,
  canUndoFreeCanvasHistory,
  canRedoFreeCanvasHistory,
} = useDramaCanvasGraph({
  canvasProjectId,
  dramaId,
  drama,
  nodes,
  edges,
  productionGraph,
  freeCanvas,
  freeCanvasReadOnly,
  freeCanvasCompatibilityMessage,
  canvasMode,
  selectedFreeNodeId,
  selectedFreeNodeIds,
  selectedFreeEdgeIds,
  editingFreeNodeId,
  freeHistoryRevision,
  projectAssets,
  highlightAssetId,
  filterEpisodeId,
  savedLayout,
  workflowGroups,
  activeGroupId,
  imagesBySbId,
  videosBySbId,
  getStoryboardMediaQueryStatus,
  currentViewport,
  productionViewport,
  canvasFlowApi,
  freeGraph,
  focusedNodeId,
  setFocusedCanvasNode,
  isCanvasAbortError,
  scheduleLayoutSave: (...args) => canvasCommandBridge.scheduleLayoutSave(...args),
  resetFreeCanvasClipboard: (...args) => canvasCommandBridge.resetFreeCanvasClipboard(...args),
  finishFreeCanvasNodeEditing: (...args) => canvasCommandBridge.finishFreeCanvasNodeEditing(...args),
  closeFreeCanvasInspector,
})
canvasCommandBridge.setCanvasMode = setCanvasMode
canvasCommandBridge.rebuildGraph = rebuildGraph

const {
  loadCanvasProject,
  retryCanvasProjectLoad,
  loadDrama,
  hasProcessingStoryboards,
  startStatusPoll,
  stopStatusPoll,
  invalidateCanvasLoads,
} = useDramaCanvasProjectLoad({
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
})

canvasCommandBridge.loadCanvasProject = loadCanvasProject

const dramaCanvasProjectActionsCtx = {
  focusedNodeId,
  loadCanvasProject,
  route,
  router,
  dramaId,
  canvasMode,
  selectedFreeNodeId,
  routeEpisodeId,
  routeFocusNodeId,
  isCanvasUserAbort,
  ElMessage,
  safeFreeCanvasError,
  submitCreate: (...args) => canvasCommandBridge.submitCreate(...args),
}
const {
  refreshDrama,
  refreshCanvas,
  onCreateSubmit,
  buildCanvasReturnTo,
} = createDramaCanvasProjectActions(dramaCanvasProjectActionsCtx)

const contextMenuCtx = {
  paneClickSuppressed,
  screenToFlowPosition,
  contextMenuFlowPos,
  contextMenuX,
  contextMenuY,
  contextMenuVisible,
  canvasMode,
  pendingFlowPosition: { value: null },
  openCreateDialog() {},
  createFreeCanvasNode() {},
}
const {
  suppressPaneClick,
  clearPaneClickSuppress,
  onPaneContextMenu,
  closeContextMenu,
  onContextMenuSelect,
  onContextMenuFreeNode,
} = createDramaCanvasContextMenu(contextMenuCtx)

const productionGateCtx = {
  drama,
  imagesBySbId,
  productionActions,
  dramaId,
  productionReadinessState,
  workflowRunsAPI,
  aiAPI,
  safeFreeCanvasError,
  loadForStoryboards,
  rebuildGraph,
  unknownMediaStoryboards,
  requestEpisodeFilterChange,
  pipelineSteps,
  activeGroupId,
  freeCanvasVideoCapability,
  readinessRequestId: {
    get value() { return readinessRequestId },
    set value(next) { readinessRequestId = next },
  },
  freeCanvasCapabilityRequestId: {
    get value() { return freeCanvasCapabilityRequestId },
    set value(next) { freeCanvasCapabilityRequestId = next },
  },
}
const {
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
} = createDramaCanvasProductionGates(productionGateCtx)
canvasCommandBridge.refreshProductionReadiness = refreshProductionReadiness
canvasCommandBridge.refreshFreeCanvasVideoCapability = refreshFreeCanvasVideoCapability

const {
  goProjectList,
  navigateToStoryboard,
  goMediaLibrary,
  openAiConfig,
} = createDramaCanvasNavigation({
  router,
  projectListReturnTo,
  dramaId,
  buildCanvasReturnTo,
})

const scriptActionsHolder = {}

const {
  layoutSaveState,
  layoutSaveError,
  failedCanvasSaveOperation,
  layoutDirty,
  canvasSaveCoordinator,
  scheduleLayoutSave,
  cancelScheduledCanvasSave,
  hasPendingCanvasSaves,
  waitForCanvasSaveSettlement,
  persistCanvasState,
  retryCanvasSave,
  abandonCanvasSaveOperation,
  disposeCanvasPersist,
} = useDramaCanvasPersist({
  canvasProjectId,
  canvasInstanceActive,
  dramaId,
  drama,
  nodes,
  currentViewport,
  productionViewport,
  freeCanvas,
  freeCanvasReadOnly,
  canvasMode,
  layoutCache,
  workflowGroups,
  normalizeFreeCanvasForProject,
  mergeActiveCanvasGraphs,
  freeCanvasUiMode,
  safeFreeCanvasError,
})
canvasCommandBridge.scheduleLayoutSave = scheduleLayoutSave
canvasCommandBridge.cancelScheduledCanvasSave = cancelScheduledCanvasSave
dramaCanvasRouteFocusCtx.layoutDirty = layoutDirty
dramaCanvasRouteFocusCtx.failedCanvasSaveOperation = failedCanvasSaveOperation
dramaCanvasRouteFocusCtx.layoutSaveError = layoutSaveError
dramaCanvasRouteFocusCtx.layoutSaveState = layoutSaveState


const {
  workflowOrderSaving,
  reorderWorkflowStoryboards,
} = useCanvasWorkflowOrder({
  workflowGroups,
  persist: () => persistCanvasState({ groupsOnly: true, reportError: false }),
  onSaveFailed: (error, result) => {
    abandonCanvasSaveOperation(result?.operation)
    ElMessage.error(`分镜排序保存失败，已恢复原顺序：${safeFreeCanvasError(error, '保存失败')}`)
  },
  setMediaValidity: (nodeId, state) => {
    if (nodeId) mediaValidity[nodeId] = state
  },
  clearMediaValidity: (nodeId) => {
    if (nodeId) delete mediaValidity[nodeId]
  },
})

const {
  createDialogVisible,
  createDialogType,
  pendingFlowPosition,
  openCreateDialog,
  submitCreate,
} = useCanvasCrud({
  drama,
  routeProjectId: canvasProjectId,
  canvasMode,
  filterEpisodeId,
  layoutCache,
  focusedNodeId,
  setFocusedNode: setFocusedCanvasNode,
  setEpisodeFilter: requestEpisodeFilterChange,
  refreshCanvas,
  persistCanvasState,
})
contextMenuCtx.pendingFlowPosition = pendingFlowPosition
contextMenuCtx.openCreateDialog = openCreateDialog
canvasCommandBridge.submitCreate = submitCreate

const {
  isFreeCanvasNodeId,
  shouldIgnoreEmptyFreeSelection,
  resetFreeCanvasClipboard,
  freeCanvasConfigRuntime,
  configureFreeCanvasNode,
  cancelFreeCanvasConfig,
  retryFreeCanvasConfig,
  generateFreeCanvasConfig,
  createFreeCanvasNode,
  updateFreeCanvasNode,
  updateFreeNodeContent,
  activateFreeCanvasNode,
  openFreeCanvasInspectorFor,
  startFreeCanvasNodeEditing,
  finishFreeCanvasNodeEditing,
  focusFreeCanvasNodeTrigger,
  deleteFreeCanvasNode,
  deleteFreeCanvasSelection,
  retryFreeCanvasNode,
  isValidFreeConnection,
  onFreeCanvasConnect,
  resolveFreeCanvasNodeMediaUrl,
  openFreeCanvasMediaPicker,
  toggleFreeCanvasLibrary,
  createFreeEntityReference,
  createFreeNodeFromLibraryItem,
  onFreeCanvasMediaPicked,
  uploadFreeCanvasFiles,
  onFreeCanvasDragOver,
  onFreeCanvasDrop,
  copyFreeCanvasSelection,
  handleFreeCanvasKeydown,
  convertFreeCanvasReference,
  saveFreeCanvasNodeAsAsset,
} = useDramaCanvasFreeCanvas({
  canvasMode,
  setCanvasMode,
  freeCanvas,
  freeCanvasReadOnly,
  nodes,
  edges,
  selectedFreeNodeId,
  selectedFreeNodeIds,
  selectedFreeEdgeIds,
  editingFreeNodeId,
  canvasMainRef,
  currentViewport,
  freeCanvasConfigRuntimeById,
  openAiConfig,
  commitFreeCanvasState,
  refreshProductionReadiness,
  refreshFreeCanvasVideoCapability,
  projectAssets,
  projectAssetsById,
  storyboardsById,
  drama,
  dramaId,
  canvasInstanceActive,
  freeMediaPickerVisible,
  freeLibraryVisible,
  freeCanvasUploading,
  freeCanvasUploadStatus,
  filterEpisodeId,
  imagesBySbId,
  videosBySbId,
  mediaStatusBySbId,
  freeStoryboardMediaItems,
  loadProjectAssets,
  loadForDrama,
  persistCanvasState,
  loadCanvasProject,
  mergeActiveCanvasGraphs,
  cancelScheduledCanvasSave,
  normalizeFreeCanvasForProject,
  contextMenuVisible,
  closeContextMenu,
  closeFreeCanvasInspector,
  undoFreeCanvas,
  redoFreeCanvas,
  claimCanvasEntityFocus,
  ownsCanvasEntityFocus,
  waitForFreeCanvasInspectorFocus,
  screenToFlowPosition,
  freeInspectorBusy,
  freeInspectorAction,
})
canvasCommandBridge.resetFreeCanvasClipboard = resetFreeCanvasClipboard
canvasCommandBridge.finishFreeCanvasNodeEditing = finishFreeCanvasNodeEditing
canvasCommandBridge.activateFreeCanvasNode = activateFreeCanvasNode
canvasCommandBridge.focusFreeCanvasNodeTrigger = focusFreeCanvasNodeTrigger
contextMenuCtx.createFreeCanvasNode = createFreeCanvasNode

const {
  fitCanvasView,
  zoomCanvasIn,
  zoomCanvasOut,
  toggleCanvasInteractive,
  onCanvasNodesInitialized,
  onSelectionChange,
  onViewportChange,
  syncProductionGraphPositions,
  onCanvasNodeDragStop,
  onCanvasMoveEnd,
  onAlignNodes,
} = useDramaCanvasViewport({
  canvasFlowApi,
  canvasMode,
  canvasInteractive,
  currentViewport,
  productionViewport,
  productionGraph,
  nodes,
  freeCanvas,
  selectedStoryboardIds,
  selectedFreeNodeId,
  selectedFreeNodeIds,
  selectedFreeEdgeIds,
  editingFreeNodeId,
  initialFitDone,
  hasSavedViewport,
  aligningNodes,
  drama,
  filterEpisodeId,
  workflowGroups,
  imagesBySbId,
  videosBySbId,
  layoutCache,
  MIN_READABLE_CANVAS_ZOOM,
  shouldIgnoreEmptyFreeSelection,
  isFreeCanvasNodeId,
  scheduleLayoutSave,
  commitFreeCanvasState,
  persistCanvasState,
  setFocusedCanvasNode,
  currentCanvasProjectId,
  isCanvasProjectCurrent,
  routeFocusNodeId,
  synchronizeRouteFocusedEntity,
  claimRouteEntityFocus,
  safeFreeCanvasError,
})



const {
  episodeGenerating,
  episodeGenProgress,
  aiGenerateStoryboards: runAiGenerateStoryboards,
  batchGenerateImages: runBatchGenerateImages,
  batchGenerateVideos: runBatchGenerateVideos,
  abortEpisodeGenerate,
} = useCanvasEpisodeGenerate({
  drama,
  filterEpisodeId,
  imagesBySbId,
  videosBySbId,
  refreshCanvas,
  nodeStatus,
})

leaveHelperCtx.episodeGenerating = episodeGenerating
leaveHelperCtx.abortEpisodeGenerate = abortEpisodeGenerate

const {
  handleCanvasBeforeUnload,
  runCanvasNavigationBarrier,
  guardCanvasRouteUpdate,
} = createDramaCanvasLeaveProtection({
  hasFocusedNodePendingWork,
  layoutDirty,
  failedCanvasSaveOperation,
  hasPendingCanvasSaves,
  canvasProjectId,
  freeCanvasUploading,
  workflowRunning,
  episodeGenerating,
  nodeGenerationCoordinator,
  ElMessageBox,
  activeWorkflowRun,
  workflowProgress,
  cancelScheduledCanvasSave,
  waitForCanvasSaveSettlement,
  retryCanvasSave,
  persistCanvasState,
  layoutSaveState,
  layoutSaveError,
  canvasSaveCoordinator,
  Number,
  ensureNodeGenerationFinished,
  ensureEpisodeGenerationFinished,
  ensureFreeCanvasUploadFinished,
  confirmFocusedNodeLeave,
  canvasRouteContext,
  route,
})
onBeforeRouteLeave(() => runCanvasNavigationBarrier())
onBeforeRouteUpdate(guardCanvasRouteUpdate)

const {
  cancelEpisodeGenerate,
  focusScriptNode,
  aiGenerateStoryboards,
  batchGenerateImages,
  batchGenerateVideos,
} = createDramaCanvasBatchGenerate({
  abortEpisodeGenerate,
  canvasMode,
  currentEpisode,
  filterEpisodeId,
  drama,
  requestEpisodeFilterChange,
  setFocusedCanvasNode,
  runAiGenerateStoryboards,
  runBatchGenerateImages,
  runBatchGenerateVideos,
  ensureKnownStoryboardMedia,
  ensureProductionStepReady,
})

Object.assign(
  scriptActionsHolder,
  useCanvasScript({
    drama,
    dramaId,
    refreshCanvas: refreshDrama,
    nodeStatus,
  })
)

const {
  onCreateWorkflowGroup,
  onDeleteActiveGroup,
  onRunActiveGroup,
  cancelActiveWorkflow,
  refreshUnknownWorkflowOutcome,
} = useDramaCanvasWorkflow({
  canvasMode,
  selectedStoryboardIds,
  pipelineSteps,
  workflowGroups,
  activeGroupId,
  ensureProductionPipelineReady,
  persistCanvasState,
  rebuildGraph,
  currentCanvasProjectId,
  isCanvasProjectCurrent,
  workflowRunStarting,
  workflowRunning,
  workflowOutcomeUnknown,
  activeWorkflowSteps,
  pipelineTouchesBillableMedia,
  ensureKnownStoryboardMedia,
  drama,
  activeWorkflowRun,
  workflowProgress,
  loadCanvasProject,
  isActiveWorkflowRun,
  isWorkflowAbortError,
  getCanvasGenerationOptions,
  safeFreeCanvasError,
})

const {
  onPaneClick,
  onNodeClick,
  onNodeDoubleClick,
} = createDramaCanvasPaneEvents({
  paneClickSuppressed,
  closeFreeCanvasInspector,
  finishFreeCanvasNodeEditing,
  selectedFreeNodeIds,
  selectedFreeEdgeIds,
  setFocusedCanvasNode,
  closeContextMenu,
  isFreeCanvasNodeId,
  canvasMode,
  openFreeCanvasInspectorFor,
  startFreeCanvasNodeEditing,
  openCreateDialog,
  restoreFocusedNodeSelection,
  selectSidebarAsset,
  activeGroupId,
  workflowGroups,
  navigateToStoryboard,
})

watch(
  () => [String(route.params.id || ''), routeFocusNodeId(), routeEpisodeId()],
  ([projectId, focusNodeId, episodeId], previousIntent) => {
    const resetProject = !previousIntent || projectId !== previousIntent[0]
    const contextChanged = previousIntent && (
      previousIntent[1] !== focusNodeId
      || (previousIntent[2] ?? null) !== episodeId
    )
    if (!resetProject && !contextChanged) return
    void startCanvasRouteSynchronization({ resetProject })
  },
  { immediate: true, flush: 'sync' },
 )

watch(drama, () => startStatusPoll())

onMounted(() => {
  window.addEventListener('beforeunload', handleCanvasBeforeUnload)
  window.addEventListener('keydown', handleFreeCanvasKeydown, true)
})

onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', handleCanvasBeforeUnload)
  window.removeEventListener('keydown', handleFreeCanvasKeydown, true)
  activeWorkflowRun.value?.controller?.abort()
  activeWorkflowRun.value = null
  abortEpisodeGenerate()
  nodeGenerationCoordinator.stopWaiting('画布已关闭，后台任务和供应商计费可能继续')
  if (layoutDirty.value) {
    void persistCanvasState({ layoutOnly: true, reportError: false, allowDuringTeardown: true })
  }
  canvasInstanceActive.value = false
  invalidateCanvasLoads()
  readinessRequestId++
  freeCanvasCapabilityRequestId++
  disposeCanvasPersist()
  clearPaneClickSuppress()
  stopStatusPoll()
})

const {
  goListMode,
  workspaceBindings,
  overlayHostBindings,
  pageChromeBindings,
  loadFailureBindings,
} = useDramaCanvasPageBindings({
  selectedStoryboardIds,
  pipelineSteps,
  activeGroupId,
  activeWorkflowSteps,
  productionActions,
  drama,
  filterEpisodeId,
  currentEpisode,
  workflowRunning,
  episodeGenerating,
  getBillableMediaUnknownReason,
  activeWorkflowGroup,
  createWorkflowProductionGate,
  runWorkflowProductionGate,
  freeHistoryRevision,
  canvasMode,
  freeCanvasReadOnly,
  canUndoFreeCanvasHistory,
  canRedoFreeCanvasHistory,
  routeEpisodeId,
  projectListReturnTo,
  router,
  dramaId,
  freeLibraryVisible,
  freeCanvas,
  openAiConfig,
  focusedNodeId,
  imagesBySbId,
  videosBySbId,
  mediaStatusBySbId,
  mediaValidity,
  getCanvasGenerationOptions,
  ensureProductionStepReady,
  nodeGenerationCoordinator,
  getStoryboardMediaQueryStatus,
  retryStoryboardMedia,
  setFocusedCanvasNode,
  registerFocusGuard,
  setHighlightAsset,
  refreshCanvas,
  refreshDrama,
  suppressPaneClick,
  nodeStatus,
  openCreateDialog,
  scriptActionsHolder,
  canvasFlowApi,
  nodes,
  edges,
  loading,
  freeStoryboardMediaItems,
  projectAssets,
  freeCanvasUploading,
  freeCanvasUploadStatus,
  createFreeEntityReference,
  createFreeNodeFromLibraryItem,
  uploadFreeCanvasFiles,
  openFreeCanvasMediaPicker,
  setCanvasMode,
  highlightAssetId,
  workflowGroups,
  workflowStoryboardDetails,
  workflowOrderSaving,
  focusScriptNode,
  clearAssetHighlight,
  selectSidebarAsset,
  setActiveGroupId,
  reorderWorkflowStoryboards,
  onFreeCanvasDragOver,
  onFreeCanvasDrop,
  canvasViewportReady,
  initialViewport,
  isValidFreeConnection,
  canvasBackgroundMode,
  canvasInteractive,
  editingFreeNodeId,
  zoomCanvasIn,
  zoomCanvasOut,
  fitCanvasView,
  toggleCanvasInteractive,
  resolveFreeCanvasNodeMediaUrl,
  freeCanvasConfigRuntime,
  updateFreeNodeContent,
  openFreeCanvasInspectorFor,
  deleteFreeCanvasNode,
  retryFreeCanvasNode,
  configureFreeCanvasNode,
  cancelFreeCanvasConfig,
  retryFreeCanvasConfig,
  generateFreeCanvasConfig,
  finishFreeCanvasNodeEditing,
  onNodeDoubleClick,
  onNodeClick,
  onPaneClick,
  onPaneContextMenu,
  onCanvasNodeDragStop,
  onFreeCanvasConnect,
  onViewportChange,
  onCanvasMoveEnd,
  onSelectionChange,
  onCanvasNodesInitialized,
  canvasStartMode,
  createFreeCanvasNode,
  confirmEpisodeSelection,
  selectedFreeNodeIds,
  undoFreeCanvas,
  redoFreeCanvas,
  setFreeCanvasBackground,
  toggleFreeCanvasLibrary,
  copyFreeCanvasSelection,
  deleteFreeCanvasSelection,
  workflowOutcomeUnknown,
  refreshUnknownWorkflowOutcome,
  createDialogVisible,
  createDialogType,
  onCreateSubmit,
  contextMenuVisible,
  contextMenuX,
  contextMenuY,
  onContextMenuSelect,
  onContextMenuFreeNode,
  closeContextMenu,
  freeMediaPickerVisible,
  freeMediaPickerContext,
  onFreeCanvasMediaPicked,
  goMediaLibrary,
  focusedInspectorNode,
  selectedFreeNode,
  freeInspectorBusy,
  freeInspectorAction,
  selectedFreeAssetEligibility,
  freeAssetOptions,
  freeStoryboardOptions,
  freeConversionTargets,
  selectedFreeConfigRuntime,
  updateFreeCanvasNode,
  convertFreeCanvasReference,
  saveFreeCanvasNodeAsAsset,
  closeFreeCanvasInspector,
  layoutSaveState,
  layoutSaveError,
  freeCanvasCompatibilityMessage,
  scopedMediaWarning,
  mediaLoading,
  goProjectList,
  requestEpisodeFilterChange,
  retryCanvasSave,
  cancelEpisodeGenerate,
  retryUnknownStoryboardMedia,
  workflowProgress,
  episodeGenProgress,
  aligningNodes,
  isDark,
  onAlignNodes,
  toggleTheme,
  setPipelineSteps,
  onCreateWorkflowGroup,
  onRunActiveGroup,
  cancelActiveWorkflow,
  onDeleteActiveGroup,
  aiGenerateStoryboards,
  batchGenerateImages,
  batchGenerateVideos,
  canvasLoadError,
  canvasLoadNotFound,
  retryCanvasProjectLoad,
})

</script>

<style scoped src="./DramaCanvas.css"></style>

<style>
html.light .drama-canvas-page {
  --canvas-project-surface: linear-gradient(135deg, #eef2ff 0%, #ffffff 72%);
  --canvas-episode-surface: #f5f3ff;
  --canvas-script-surface: #fffbeb;
  --canvas-card-surface: #ffffff;
  --canvas-node-surface: #ffffff;
  --canvas-add-surface: rgba(255, 255, 255, 0.96);
  --canvas-add-character-surface: #f0fdf4;
  --canvas-add-scene-surface: #eff6ff;
  --canvas-add-prop-surface: #fffbeb;
  --canvas-add-storyboard-surface: #f5f3ff;
  --canvas-media-text-surface: #ffffff;
  --canvas-media-universal-surface: #faf5ff;
  --canvas-media-image-surface: #eef2ff;
  --canvas-media-video-surface: #fdf2f8;
  --canvas-media-audio-surface: #fffbeb;
  --canvas-panel-surface: rgba(255, 255, 255, 0.98);
  --canvas-media-well: #f3f4f6;
  --canvas-video-well: #e5e7eb;
  --canvas-chip-surface: rgba(15, 23, 42, 0.08);
  --canvas-chip-surface-soft: rgba(15, 23, 42, 0.06);
  --canvas-loading-surface: rgba(17, 24, 39, 0.82);
  --canvas-spinner-track: rgba(15, 23, 42, 0.16);
  --canvas-project-title: #312e81;
  --canvas-text-primary: #27272a;
  --canvas-text-secondary: #374151;
  --canvas-text-muted: #4b5563;
  --canvas-text-subtle: #6b7280;
  --canvas-text-faint: #6b7280;
  --canvas-episode-text: #4c1d95;
  --canvas-indigo-text: #4338ca;
  --canvas-indigo-strong: #4f46e5;
  --canvas-violet-text: #6d28d9;
  --canvas-amber-text: #92400e;
  --canvas-amber-strong: #b45309;
  --canvas-emerald-text: #047857;
  --canvas-blue-text: #1d4ed8;
  --canvas-pink-text: #be185d;
  --canvas-success-text: #047857;
  --canvas-info-text: #1d4ed8;
  --canvas-danger-text: #b91c1c;
  --canvas-indigo-border: rgba(67, 56, 202, 0.48);
  --canvas-violet-border: rgba(109, 40, 217, 0.5);
  --canvas-amber-border: rgba(180, 83, 9, 0.5);
  --canvas-emerald-border: rgba(4, 120, 87, 0.5);
  --canvas-blue-border: rgba(29, 78, 216, 0.48);
  --canvas-pink-border: rgba(190, 24, 93, 0.45);
  --canvas-raised-shadow: 0 10px 28px rgba(15, 23, 42, 0.14);
  --canvas-node-focus-shadow: 0 8px 24px rgba(15, 23, 42, 0.14);
  --canvas-project-shadow: 0 8px 24px rgba(15, 23, 42, 0.14);
  --canvas-divider: #e4e4e7;
  --canvas-divider-strong: #d4d4d8;
  --canvas-focus-ring: #6d28d9;
  background: var(--bg-page);
}
html.light .vue-flow-canvas { background: #eef2ff; }
html.light .drama-canvas-page .sidebar-item.active {
  background: rgba(4, 120, 87, 0.12);
  color: var(--canvas-emerald-text);
}
html.light .drama-canvas-page .wf-item-meta,
html.light .drama-canvas-page .sidebar-workflow-empty p {
  color: var(--canvas-text-subtle);
}
html.light .drama-canvas-page .vue-flow__minimap {
  background: rgba(255, 255, 255, 0.94);
  border-color: #c7d2fe;
}
html.light .drama-canvas-page .vue-flow__minimap-mask {
  fill: rgba(79, 70, 229, 0.08);
}
html.light .drama-canvas-page .vue-flow__minimap-node {
  fill: #c7d2fe;
  stroke: #6366f1;
}
html.light .drama-canvas-page .vue-flow__controls {
  border-color: #c7d2fe;
}
html.light .drama-canvas-page .vue-flow__controls button {
  background: #ffffff;
  border-color: #d4d4d8;
  color: #27272a;
}
html.light .drama-canvas-page .vue-flow__controls button:hover {
  background: #f5f3ff;
  color: #6d28d9;
}
</style>
