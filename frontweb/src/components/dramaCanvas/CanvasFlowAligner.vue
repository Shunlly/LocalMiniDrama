<template>
  <span class="canvas-flow-aligner" aria-hidden="true" />
</template>

<script setup>
import { onMounted, onUnmounted } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import { useCanvasContext } from '@/composables/useCanvasContext'

const {
  fitView,
  getViewport,
  setInteractive,
  setViewport,
  screenToFlowCoordinate,
  zoomIn,
  zoomOut,
} = useVueFlow()
const ctx = useCanvasContext()

onMounted(() => {
  ctx?.registerCanvasFlowApi?.({
    fitView,
    getViewport,
    setInteractive,
    setViewport,
    screenToFlowCoordinate,
    zoomIn,
    zoomOut,
  })
})

onUnmounted(() => {
  ctx?.registerCanvasFlowApi?.(null)
})
</script>

<style scoped>
.canvas-flow-aligner {
  display: none;
}
</style>
