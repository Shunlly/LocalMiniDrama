<template>
  <CanvasCreateDialog
    v-model="createDialogVisible"
    :type="createDialogType"
    :on-submit="handleCreateSubmit"
  />
  <CanvasContextMenu
    :visible="contextMenuVisible"
    :x="contextMenuX"
    :y="contextMenuY"
    :free-mode="canvasMode === 'free'"
    @select="handleContextMenuSelect"
    @free-node="handleContextMenuFreeNode"
    @close="closeContextMenu"
  />
  <GlobalMediaPickerDialog
    v-model="freeMediaPickerVisible"
    title="添加自由画布素材"
    accept="all"
    :context="freeMediaPickerContext"
    @select="handleFreeCanvasMediaPicked"
    @open-library="goMediaLibrary"
  />
  <CanvasInspectorDock
    v-if="focusedInspectorNode"
    :key="`${dramaId}:${focusedInspectorNode.id}`"
    :node="focusedInspectorNode"
  />
  <FreeCanvasContextBar
    v-if="canvasMode === 'free' && selectedFreeNode"
    :node="selectedFreeNode"
    :readonly="canvasMode !== 'free' || freeCanvasReadOnly"
    :busy="freeInspectorBusy"
    :config-runtime="selectedFreeConfigRuntime"
    :save-asset-eligibility="selectedFreeAssetEligibility"
    @copy="copyFreeCanvasSelection"
    @delete="deleteFreeCanvasSelection"
    @generate="generateFreeCanvasConfig"
    @configure="configureFreeCanvasNode"
    @cancel="cancelFreeCanvasConfig"
    @save-asset="saveFreeCanvasNodeAsAsset"
  />
  <FreeCanvasInspector
    v-if="selectedFreeNode"
    :key="`${dramaId}:${selectedFreeNode.id}`"
    class="free-canvas-inspector-dock"
    :data-free-node-id="String(selectedFreeNode.id)"
    :node="selectedFreeNode"
    :readonly="canvasMode !== 'free' || freeCanvasReadOnly"
    :busy="freeInspectorBusy"
    :converting="freeInspectorAction === 'convert'"
    :saving-asset="freeInspectorAction === 'save-asset'"
    :save-asset-eligibility="selectedFreeAssetEligibility"
    :asset-options="freeAssetOptions"
    :storyboard-options="freeStoryboardOptions"
    :conversion-targets="freeConversionTargets"
    :config-runtime="selectedFreeConfigRuntime"
    @update-node="updateFreeCanvasNode"
    @convert-reference="convertFreeCanvasReference"
    @save-asset="saveFreeCanvasNodeAsAsset"
    @configure="configureFreeCanvasNode"
    @cancel-config="cancelFreeCanvasConfig"
    @retry-config="retryFreeCanvasConfig"
    @generate-config="generateFreeCanvasConfig"
    @close="closeFreeCanvasInspector"
  />
</template>

<script setup>
import CanvasCreateDialog from './CanvasCreateDialog.vue'
import CanvasContextMenu from './CanvasContextMenu.vue'
import CanvasInspectorDock from './CanvasInspectorDock.vue'
import FreeCanvasInspector from './FreeCanvasInspector.vue'
import FreeCanvasContextBar from './FreeCanvasContextBar.vue'
import GlobalMediaPickerDialog from '@/components/GlobalMediaPickerDialog.vue'

/** 画布创建弹窗、右键菜单、素材选择器和两侧检查器的控件接线 */
const createDialogVisible = defineModel('createDialogVisible', { type: Boolean, default: false })
const freeMediaPickerVisible = defineModel('freeMediaPickerVisible', { type: Boolean, default: false })

defineProps({
  createDialogType: { type: String, default: 'storyboard' },
  handleCreateSubmit: { type: Function, required: true },
  contextMenuVisible: { type: Boolean, default: false },
  contextMenuX: { type: Number, default: 0 },
  contextMenuY: { type: Number, default: 0 },
  canvasMode: { type: String, required: true },
  handleContextMenuSelect: { type: Function, required: true },
  handleContextMenuFreeNode: { type: Function, required: true },
  closeContextMenu: { type: Function, required: true },
  freeMediaPickerContext: { type: Object, default: null },
  handleFreeCanvasMediaPicked: { type: Function, required: true },
  goMediaLibrary: { type: Function, required: true },
  focusedInspectorNode: { type: Object, default: null },
  dramaId: { type: [String, Number], default: '' },
  selectedFreeNode: { type: Object, default: null },
  freeCanvasReadOnly: { type: Boolean, default: false },
  freeInspectorBusy: { type: Boolean, default: false },
  freeInspectorAction: { type: String, default: '' },
  selectedFreeAssetEligibility: { type: Object, default: null },
  freeAssetOptions: { type: Array, default: () => [] },
  freeStoryboardOptions: { type: Array, default: () => [] },
  freeConversionTargets: { type: Array, default: () => [] },
  selectedFreeConfigRuntime: { type: Object, default: undefined },
  updateFreeCanvasNode: { type: Function, required: true },
  convertFreeCanvasReference: { type: Function, required: true },
  saveFreeCanvasNodeAsAsset: { type: Function, required: true },
  configureFreeCanvasNode: { type: Function, required: true },
  cancelFreeCanvasConfig: { type: Function, required: true },
  retryFreeCanvasConfig: { type: Function, required: true },
  generateFreeCanvasConfig: { type: Function, required: true },
  copyFreeCanvasSelection: { type: Function, required: true },
  deleteFreeCanvasSelection: { type: Function, required: true },
  closeFreeCanvasInspector: { type: Function, required: true },
})
</script>

<style scoped>
.free-canvas-inspector-dock {
  position: fixed;
  top: 150px;
  right: 20px;
  z-index: 1200;
  width: min(340px, calc(100vw - 32px));
  max-height: min(680px, calc(100vh - 174px));
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}

@media (max-width: 760px) {
  .free-canvas-inspector-dock {
    top: 104px;
    right: 16px;
    width: calc(100vw - 32px);
    max-height: min(620px, calc(100vh - 120px));
  }
}
</style>