<template>
  <aside
    v-if="model.visible"
    class="free-canvas-context-bar nodrag nopan"
    role="toolbar"
    :aria-label="'节点操作：' + model.title"
  >
    <span class="context-title" :title="model.title">{{ model.title }}</span>
    <el-button
      v-for="action in model.actions"
      :key="action.id"
      size="small"
      :type="action.danger ? 'danger' : (action.primary ? 'primary' : 'default')"
      :plain="!action.primary"
      :disabled="action.disabled"
      :aria-label="action.ariaLabel"
      :title="action.disabled ? action.reason : action.ariaLabel"
      @click="emitAction(action)"
    >
      {{ action.label }}
    </el-button>
  </aside>
</template>

<script setup>
import { computed } from 'vue'
import { getFreeCanvasContextBarModel } from '@/utils/freeCanvasContextBar.js'

const props = defineProps({
  node: { type: Object, default: null },
  readonly: { type: Boolean, default: false },
  busy: { type: Boolean, default: false },
  configRuntime: { type: Object, default: null },
  saveAssetEligibility: { type: Object, default: null },
})

const emit = defineEmits(['copy', 'delete', 'generate', 'configure', 'cancel', 'save-asset'])

const model = computed(() => getFreeCanvasContextBarModel({
  node: props.node,
  readonly: props.readonly,
  busy: props.busy,
  configRuntime: props.configRuntime,
  saveAssetEligibility: props.saveAssetEligibility,
}))

function emitAction(action) {
  if (!action || action.disabled || !props.node) return
  if (action.id === 'copy') emit('copy')
  else if (action.id === 'delete') emit('delete')
  else if (action.id === 'generate') emit('generate', props.node.id)
  else if (action.id === 'configure') emit('configure', props.node.id)
  else if (action.id === 'cancel') emit('cancel', props.node.id)
  else if (action.id === 'save-asset') emit('save-asset', { id: props.node.id })
}
</script>

<style scoped>
.free-canvas-context-bar {
  /* 选中节点时检查器常开，条要高于检查器，并让出右侧检查器占用的空间 */
  position: fixed;
  left: calc((100vw - 380px) / 2);
  bottom: 88px;
  z-index: 1300;
  box-sizing: border-box;
  display: inline-flex;
  max-width: min(720px, calc(100vw - 420px));
  min-width: 0;
  min-height: 40px;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  padding: 6px 8px;
  border: 1px solid var(--border-color, #3f3f46);
  border-radius: 6px;
  background: var(--canvas-panel-surface, var(--bg-card, #18181b));
  box-shadow: var(--canvas-raised-shadow, var(--shadow, 0 12px 32px rgba(0, 0, 0, 0.45)));
  transform: translateX(-50%);
}

.context-title {
  max-width: 12em;
  overflow: hidden;
  color: var(--canvas-text-secondary, #d4d4d8);
  font-size: 12px;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.free-canvas-context-bar :deep(.el-button:focus-visible) {
  outline: 2px solid var(--canvas-focus-ring, #818cf8);
  outline-offset: 2px;
}

@media (max-width: 1100px) {
  .free-canvas-context-bar {
    left: 50%;
    max-width: min(720px, calc(100vw - 48px));
  }
}

@media (max-width: 769px) {
  .free-canvas-context-bar {
    bottom: 72px;
    max-width: calc(100vw - 32px);
  }
}
</style>
