<template>
  <div v-if="status" class="node-status-overlay" :class="'step-' + status.step">
    <span class="spinner" />
    <span class="msg">{{ status.message }}</span>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useCanvasContext } from '@/composables/useCanvasContext'

const props = defineProps({
  nodeId: { type: String, required: true },
})

const ctx = useCanvasContext()

const status = computed(() => {
  const map = ctx?.nodeStatus?.map
  if (!map || !props.nodeId) return null
  return map[props.nodeId] || null
})
</script>

<style scoped>
.node-status-overlay {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  background: var(--canvas-overlay-surface, rgba(9, 9, 11, 0.72));
  border-radius: inherit;
  pointer-events: none;
}
.spinner {
  width: 22px;
  height: 22px;
  border: 2px solid var(--canvas-spinner-track, rgba(255, 255, 255, 0.15));
  border-top-color: var(--canvas-indigo-strong, #818cf8);
  border-radius: 50%;
  animation: spin 0.75s linear infinite;
}
.step-ref_image .spinner { border-top-color: var(--canvas-success-text, #34d399); }
.step-extract_chars .spinner,
.step-extract_scenes .spinner,
.step-extract_props .spinner,
.step-extract_all .spinner,
.step-save_script .spinner { border-top-color: var(--canvas-amber-strong, #fbbf24); }
.step-video .spinner { border-top-color: var(--canvas-pink-text, #f472b6); }
.step-audio .spinner { border-top-color: var(--canvas-amber-strong, #fbbf24); }
.msg {
  font-size: 10px;
  color: var(--canvas-overlay-text, #e4e4e7);
  text-align: center;
  padding: 0 8px;
  line-height: 1.3;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
