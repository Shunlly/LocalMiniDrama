<template>
  <CanvasEmptyState
    v-if="canvasMode === 'production' && !loading && canvasStartMode"
    :mode="canvasStartMode"
    :episodes="episodes"
    :selected-episode-id="selectedEpisodeId"
    @create-episode="emit('create-episode')"
    @confirm-episode="emit('confirm-episode', $event)"
    @go-list="emit('go-list')"
  />
  <FreeCanvasEmptyStart
    v-if="canvasMode === 'free' && !loading && !freeNodeCount"
    :create-free-canvas-node="createFreeCanvasNode"
    :open-free-canvas-media-picker="openFreeCanvasMediaPicker"
  />
</template>

<script setup>
import CanvasEmptyState from './CanvasEmptyState.vue'
import FreeCanvasEmptyStart from './FreeCanvasEmptyStart.vue'

/** 制作起步空态和自由画布空态按当前模式互斥显示 */
defineProps({
  canvasMode: { type: String, required: true },
  loading: { type: Boolean, default: false },
  canvasStartMode: { type: String, default: '' },
  episodes: { type: Array, default: () => [] },
  selectedEpisodeId: { type: [String, Number], default: null },
  freeNodeCount: { type: Number, default: 0 },
  createFreeCanvasNode: { type: Function, required: true },
  openFreeCanvasMediaPicker: { type: Function, required: true },
})

const emit = defineEmits([
  'create-episode',
  'confirm-episode',
  'go-list',
])
</script>
