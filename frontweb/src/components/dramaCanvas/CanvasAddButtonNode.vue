<template>
  <button
    type="button"
    class="canvas-add-node"
    :class="'kind-' + data.assetType"
    :aria-label="data.label || defaultLabel"
    @click.stop="onClick"
  >
    <span class="add-icon">+</span>
    <span class="add-label">{{ data.label || defaultLabel }}</span>
  </button>
</template>

<script setup>
import { computed } from 'vue'
import { useCanvasContext } from '@/composables/useCanvasContext'

const props = defineProps({
  data: { type: Object, required: true },
})

const ctx = useCanvasContext()

const defaultLabel = computed(() => {
  const map = { character: '新建角色', scene: '新建场景', prop: '新建道具', storyboard: '新建分镜' }
  return map[props.data.assetType] || '新建'
})

function onClick() {
  ctx?.openCreateDialog?.(props.data.assetType)
}
</script>

<style scoped>
.canvas-add-node {
  appearance: none;
  width: 176px;
  padding: 14px 12px;
  border-radius: 10px;
  border: 1px dashed var(--canvas-indigo-border, rgba(129, 140, 248, 0.45));
  background: var(--canvas-add-surface, rgba(24, 24, 27, 0.65));
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  transition: border-color 0.15s, background 0.15s;
  color: inherit;
  font: inherit;
  text-align: left;
}
.canvas-add-node:hover {
  border-color: var(--canvas-indigo-strong, #818cf8);
  background: rgba(129, 140, 248, 0.12);
}
.add-icon {
  width: 22px;
  height: 22px;
  border-radius: 6px;
  background: rgba(129, 140, 248, 0.2);
  color: var(--canvas-indigo-text, #a5b4fc);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  font-weight: 700;
  flex-shrink: 0;
}
.add-label {
  font-size: 12px;
  color: var(--canvas-text-muted, #a1a1aa);
}
.canvas-add-node:focus-visible {
  outline: 2px solid var(--canvas-focus-ring, #818cf8);
  outline-offset: 3px;
}
.kind-character {
  border-color: var(--canvas-emerald-border, rgba(52, 211, 153, 0.4));
  background: var(--canvas-add-character-surface, var(--canvas-add-surface));
}
.kind-character .add-icon { background: rgba(52, 211, 153, 0.18); color: var(--canvas-emerald-text, #6ee7b7); }
.kind-scene {
  border-color: var(--canvas-blue-border, rgba(96, 165, 250, 0.4));
  background: var(--canvas-add-scene-surface, var(--canvas-add-surface));
}
.kind-scene .add-icon { background: rgba(96, 165, 250, 0.18); color: var(--canvas-blue-text, #93c5fd); }
.kind-prop {
  border-color: var(--canvas-amber-border, rgba(251, 191, 36, 0.4));
  background: var(--canvas-add-prop-surface, var(--canvas-add-surface));
}
.kind-prop .add-icon { background: rgba(251, 191, 36, 0.18); color: var(--canvas-amber-text, #fcd34d); }
.kind-storyboard {
  width: 200px;
  border-color: var(--canvas-violet-border, rgba(167, 139, 250, 0.45));
  background: var(--canvas-add-storyboard-surface, var(--canvas-add-surface));
}
</style>
