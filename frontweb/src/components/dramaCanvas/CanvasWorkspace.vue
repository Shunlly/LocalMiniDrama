<template>
  <div v-loading="loading" class="canvas-shell">
    <FreeCanvasAssetSidebar
      v-if="drama && canvasMode === 'free' && freeLibraryVisible"
      :characters="drama.characters || []"
      :scenes="drama.scenes || []"
      :props-list="drama.props || []"
      :storyboard-media="freeStoryboardMediaItems"
      :assets="projectAssets"
      :project-id="dramaId"
      :uploading="freeCanvasUploading"
      :upload-status="freeCanvasUploadStatus"
      @add-entity="createFreeEntityReference"
      @add-media="createFreeNodeFromLibraryItem"
      @upload-files="uploadFreeCanvasFiles"
      @open-picker="openFreeCanvasMediaPicker"
      @go-production="setCanvasMode('production')"
      @close="closeFreeLibrary"
    />
    <CanvasProductionSidebar
      v-if="drama && canvasMode === 'production'"
      :drama="drama"
      :canvas-mode="canvasMode"
      :highlight-asset-id="highlightAssetId"
      :workflow-groups="workflowGroups"
      :active-group-id="activeGroupId"
      :workflow-storyboard-details="workflowStoryboardDetails"
      :workflow-order-saving="workflowOrderSaving"
      :workflow-running="workflowRunning"
      :focus-script-node="focusScriptNode"
      :open-create-dialog="openCreateDialog"
      :clear-asset-highlight="clearAssetHighlight"
      :select-sidebar-asset="selectSidebarAsset"
      :set-active-group-id="setActiveGroupId"
      :reorder-workflow-storyboards="reorderWorkflowStoryboards"
    />

    <div ref="canvasMainRef" class="canvas-main" @dragover="handleFreeCanvasDragOver" @drop="handleFreeCanvasDrop">
      <CanvasFlowStage
        v-model:nodes="nodes"
        v-model:edges="edges"
        :canvas-mode="canvasMode"
        :canvas-viewport-ready="canvasViewportReady"
        :initial-viewport="initialViewport"
        :is-valid-free-connection="isValidFreeConnection"
        :canvas-background-mode="canvasBackgroundMode"
        :canvas-interactive="canvasInteractive"
        :editing-free-node-id="editingFreeNodeId"
        :zoom-canvas-in="zoomCanvasIn"
        :zoom-canvas-out="zoomCanvasOut"
        :fit-canvas-view="fitCanvasView"
        :toggle-canvas-interactive="toggleCanvasInteractive"
        :resolve-free-canvas-node-media-url="resolveFreeCanvasNodeMediaUrl"
        :free-canvas-config-runtime="freeCanvasConfigRuntime"
        :update-free-node-content="updateFreeNodeContent"
        :open-free-canvas-inspector-for="openFreeCanvasInspectorFor"
        :delete-free-canvas-node="deleteFreeCanvasNode"
        :retry-free-canvas-node="retryFreeCanvasNode"
        :configure-free-canvas-node="configureFreeCanvasNode"
        :cancel-free-canvas-config="cancelFreeCanvasConfig"
        :retry-free-canvas-config="retryFreeCanvasConfig"
        :finish-free-canvas-node-editing="finishFreeCanvasNodeEditing"
        :handle-node-double-click="handleNodeDoubleClick"
        :handle-node-click="handleNodeClick"
        :handle-pane-click="handlePaneClick"
        :handle-pane-context-menu="handlePaneContextMenu"
        :handle-canvas-node-drag-stop="handleCanvasNodeDragStop"
        :handle-free-canvas-connect="handleFreeCanvasConnect"
        :handle-viewport-change="handleViewportChange"
        :handle-canvas-move-end="handleCanvasMoveEnd"
        :handle-selection-change="handleSelectionChange"
        :handle-canvas-nodes-initialized="handleCanvasNodesInitialized"
      />
      <CanvasEmptyOverlays
        :canvas-mode="canvasMode"
        :loading="loading"
        :canvas-start-mode="canvasStartMode"
        :episodes="drama?.episodes || []"
        :selected-episode-id="filterEpisodeId"
        :free-node-count="freeNodeCount"
        :create-free-canvas-node="createFreeCanvasNode"
        :open-free-canvas-media-picker="openFreeCanvasMediaPicker"
        :hide-production-nodes="hideProductionNodes"
        :set-hide-production-nodes="setHideProductionNodes"
        @create-episode="openCreateDialog('episode')"
        @confirm-episode="confirmEpisodeSelection"
        @go-list="goListMode"
      />
      <FreeCanvasToolbar
        v-if="canvasMode === 'free'"
        class="free-canvas-bottom-toolbar"
        :mode="canvasMode"
        :show-mode-switch="false"
        :can-undo="canUndoFreeCanvas"
        :can-redo="canRedoFreeCanvas"
        :background-mode="freeCanvasBackground"
        :library-visible="freeLibraryVisible"
        :selection-count="selectedFreeNodeIds.length"
        :hide-production-nodes="hideProductionNodes"
        @create-node="createFreeCanvasNode"
        @undo="undoFreeCanvas"
        @redo="redoFreeCanvas"
        @fit-view="fitCanvasView"
        @set-background="setFreeCanvasBackground"
        @toggle-hide-production="setHideProductionNodes"
        @toggle-library="toggleFreeCanvasLibrary"
        @copy-selection="copyFreeCanvasSelection"
        @delete-selection="deleteFreeCanvasSelection"
      />
    </div>
    <CanvasUnknownOutcomeBar
      v-if="workflowOutcomeUnknown"
      :loading="loading"
      :refresh-unknown-workflow-outcome="refreshUnknownWorkflowOutcome"
    />
  </div>
</template>

<script setup>
import { ref } from 'vue'

import CanvasProductionSidebar from './CanvasProductionSidebar.vue'
import CanvasEmptyOverlays from './CanvasEmptyOverlays.vue'
import CanvasUnknownOutcomeBar from './CanvasUnknownOutcomeBar.vue'
import CanvasFlowStage from './CanvasFlowStage.vue'
import FreeCanvasAssetSidebar from './FreeCanvasAssetSidebar.vue'
import FreeCanvasToolbar from './FreeCanvasToolbar.vue'

/** 画布壳层：侧栏、Vue Flow 舞台、空态和自由画布底栏 */
const nodes = defineModel('nodes', { type: Array, required: true })
const edges = defineModel('edges', { type: Array, required: true })

defineProps({
  loading: { type: Boolean, default: false },
  drama: { type: Object, default: null },
  canvasMode: { type: String, required: true },
  freeLibraryVisible: { type: Boolean, default: true },
  freeStoryboardMediaItems: { type: Array, default: () => [] },
  projectAssets: { type: Array, default: () => [] },
  dramaId: { type: [String, Number], default: '' },
  freeCanvasUploading: { type: Boolean, default: false },
  freeCanvasUploadStatus: { type: String, default: '' },
  createFreeEntityReference: { type: Function, required: true },
  createFreeNodeFromLibraryItem: { type: Function, required: true },
  uploadFreeCanvasFiles: { type: Function, required: true },
  openFreeCanvasMediaPicker: { type: Function, required: true },
  setCanvasMode: { type: Function, required: true },
  closeFreeLibrary: { type: Function, required: true },
  highlightAssetId: { default: null },
  workflowGroups: { type: Array, default: () => [] },
  activeGroupId: { default: null },
  workflowStoryboardDetails: { type: Object, default: () => ({}) },
  workflowOrderSaving: { type: Boolean, default: false },
  workflowRunning: { type: Boolean, default: false },
  focusScriptNode: { type: Function, required: true },
  openCreateDialog: { type: Function, required: true },
  clearAssetHighlight: { type: Function, required: true },
  selectSidebarAsset: { type: Function, required: true },
  setActiveGroupId: { type: Function, required: true },
  reorderWorkflowStoryboards: { type: Function, required: true },
  handleFreeCanvasDragOver: { type: Function, required: true },
  handleFreeCanvasDrop: { type: Function, required: true },
  canvasViewportReady: { type: Boolean, default: false },
  initialViewport: { type: Object, required: true },
  isValidFreeConnection: { type: Function, required: true },
  canvasBackgroundMode: { type: String, default: 'dots' },
  canvasInteractive: { type: Boolean, default: true },
  editingFreeNodeId: { default: null },
  zoomCanvasIn: { type: Function, required: true },
  zoomCanvasOut: { type: Function, required: true },
  fitCanvasView: { type: Function, required: true },
  toggleCanvasInteractive: { type: Function, required: true },
  resolveFreeCanvasNodeMediaUrl: { type: Function, required: true },
  freeCanvasConfigRuntime: { type: Function, required: true },
  updateFreeNodeContent: { type: Function, required: true },
  openFreeCanvasInspectorFor: { type: Function, required: true },
  deleteFreeCanvasNode: { type: Function, required: true },
  retryFreeCanvasNode: { type: Function, required: true },
  configureFreeCanvasNode: { type: Function, required: true },
  cancelFreeCanvasConfig: { type: Function, required: true },
  retryFreeCanvasConfig: { type: Function, required: true },
  finishFreeCanvasNodeEditing: { type: Function, required: true },
  handleNodeDoubleClick: { type: Function, required: true },
  handleNodeClick: { type: Function, required: true },
  handlePaneClick: { type: Function, required: true },
  handlePaneContextMenu: { type: Function, required: true },
  handleCanvasNodeDragStop: { type: Function, required: true },
  handleFreeCanvasConnect: { type: Function, required: true },
  handleViewportChange: { type: Function, required: true },
  handleCanvasMoveEnd: { type: Function, required: true },
  handleSelectionChange: { type: Function, required: true },
  handleCanvasNodesInitialized: { type: Function, required: true },
  canvasStartMode: { type: String, default: '' },
  filterEpisodeId: { default: null },
  freeNodeCount: { type: Number, default: 0 },
  createFreeCanvasNode: { type: Function, required: true },
  confirmEpisodeSelection: { type: Function, required: true },
  goListMode: { type: Function, required: true },
  canUndoFreeCanvas: { type: Boolean, default: false },
  canRedoFreeCanvas: { type: Boolean, default: false },
  freeCanvasBackground: { type: String, default: 'dots' },
  hideProductionNodes: { type: Boolean, default: false },
  selectedFreeNodeIds: { type: Array, default: () => [] },
  undoFreeCanvas: { type: Function, required: true },
  redoFreeCanvas: { type: Function, required: true },
  setFreeCanvasBackground: { type: Function, required: true },
  setHideProductionNodes: { type: Function, required: true },
  toggleFreeCanvasLibrary: { type: Function, required: true },
  copyFreeCanvasSelection: { type: Function, required: true },
  deleteFreeCanvasSelection: { type: Function, required: true },
  workflowOutcomeUnknown: { type: Boolean, default: false },
  refreshUnknownWorkflowOutcome: { type: Function, required: true },
})

const canvasMainRef = ref(null)

defineExpose({ canvasMainRef })
</script>

<style scoped>
.canvas-shell {
  flex: 1;
  display: flex;
  min-height: 0;
}

.canvas-main {
  flex: 1;
  min-width: 0;
  min-height: 0;
  height: 100%;
  position: relative;
  transition: margin-right 0.2s ease;
}

.free-canvas-bottom-toolbar {
  position: absolute;
  left: 50%;
  bottom: 16px;
  z-index: 1100;
  max-width: min(720px, calc(100% - 160px));
  transform: translateX(-50%);
  overflow-x: auto;
  box-shadow: var(--canvas-raised-shadow, 0 12px 32px rgba(0, 0, 0, 0.45));
}

@media (max-width: 760px) {
  .free-canvas-bottom-toolbar {
    max-width: calc(100% - 24px);
  }
}
</style>