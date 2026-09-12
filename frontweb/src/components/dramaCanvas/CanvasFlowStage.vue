<template>
  <VueFlow
    v-if="canvasViewportReady && (nodes.length || canvasMode === 'free')"
    v-model:nodes="nodes"
    v-model:edges="edges"
    :node-types="nodeTypes"
    :default-viewport="initialViewport"
    :min-zoom="0.25"
    :max-zoom="2"
    :nodes-connectable="canvasMode === 'free'"
    :is-valid-connection="isValidFreeConnection"
    :delete-key-code="null"
    :elements-selectable="true"
    :selection-key-code="true"
    :pan-on-drag="[1, 2]"
    :pan-on-scroll="true"
    :fit-view-on-init="false"
    :only-render-visible-elements="true"
    class="vue-flow-canvas"
    @node-double-click="handleNodeDoubleClick"
    @node-click="handleNodeClick"
    @pane-click="handlePaneClick"
    @pane-context-menu="handlePaneContextMenu"
    @node-drag-stop="handleCanvasNodeDragStop"
    @selection-drag-stop="handleCanvasNodeDragStop"
    @connect="handleFreeCanvasConnect"
    @viewport-change="handleViewportChange"
    @move-end="handleCanvasMoveEnd"
    @selection-change="handleSelectionChange"
    @nodes-initialized="handleCanvasNodesInitialized"
  >
    <CanvasFlowAligner />
    <CanvasFlowControls
      :background-mode="canvasBackgroundMode"
      :canvas-interactive="canvasInteractive"
      :zoom-canvas-in="zoomCanvasIn"
      :zoom-canvas-out="zoomCanvasOut"
      :fit-canvas-view="fitCanvasView"
      :toggle-canvas-interactive="toggleCanvasInteractive"
    />
    <template #node-freeCanvas="slotProps">
      <FreeCanvasNode
        :node="slotProps.data.freeNode"
        :free-mode="canvasMode === 'free'"
        :readonly="canvasMode !== 'free'"
        :editing="String(editingFreeNodeId) === String(slotProps.data.freeNode.id)"
        :media-url="resolveFreeCanvasNodeMediaUrl(slotProps.data.freeNode)"
        :config-runtime="freeCanvasConfigRuntime(slotProps.data.freeNode)"
        @update-content="updateFreeNodeContent"
        @request-convert="openFreeCanvasInspectorFor"
        @request-delete="deleteFreeCanvasNode"
        @request-retry="retryFreeCanvasNode"
        @request-configure="configureFreeCanvasNode"
        @request-cancel-config="cancelFreeCanvasConfig"
        @request-retry-config="retryFreeCanvasConfig"
        @request-finish-edit="finishFreeCanvasNodeEditing"
        @request-activate="openFreeCanvasInspectorFor"
      />
    </template>
  </VueFlow>
</template>

<script setup>
import { markRaw } from 'vue'
import { VueFlow } from '@vue-flow/core'

import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/controls/dist/style.css'
import '@vue-flow/minimap/dist/style.css'

import CanvasLabelNode from './CanvasLabelNode.vue'
import CanvasDramaHeaderNode from './CanvasDramaHeaderNode.vue'
import CanvasAssetNode from './CanvasAssetNode.vue'
import CanvasEpisodeNode from './CanvasEpisodeNode.vue'
import CanvasScriptNode from './CanvasScriptNode.vue'
import CanvasStoryboardNode from './CanvasStoryboardNode.vue'
import CanvasMediaNode from './CanvasMediaNode.vue'
import CanvasAddButtonNode from './CanvasAddButtonNode.vue'
import CanvasFlowAligner from './CanvasFlowAligner.vue'
import CanvasFlowControls from './CanvasFlowControls.vue'
import FreeCanvasNode from './FreeCanvasNode.vue'

/** Vue Flow 舞台：节点类型、自由节点槽和缩放控件都挂在这里 */
const nodes = defineModel('nodes', { type: Array, required: true })
const edges = defineModel('edges', { type: Array, required: true })

defineProps({
  canvasMode: { type: String, required: true },
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
})

const nodeTypes = {
  canvasLabel: markRaw(CanvasLabelNode),
  canvasDramaHeader: markRaw(CanvasDramaHeaderNode),
  canvasAsset: markRaw(CanvasAssetNode),
  canvasEpisode: markRaw(CanvasEpisodeNode),
  canvasScript: markRaw(CanvasScriptNode),
  canvasStoryboard: markRaw(CanvasStoryboardNode),
  canvasMedia: markRaw(CanvasMediaNode),
  canvasAddButton: markRaw(CanvasAddButtonNode),
}
</script>

<style scoped>
.vue-flow-canvas {
  width: 100%;
  height: 100%;
  background: #0c0c0f;
}
</style>
