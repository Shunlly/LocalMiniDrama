<template>
  <Background
    v-if="backgroundMode !== 'none'"
    :variant="backgroundMode"
    pattern-color="#3f3f46"
    :gap="20"
  />
  <Controls :show-zoom="true" :show-fit-view="true" :show-interactive="true">
    <template #control-zoom-in>
      <button type="button" class="vue-flow__controls-button" aria-label="放大画布" title="放大画布" @click="zoomCanvasIn">
        <el-icon><ZoomIn /></el-icon>
      </button>
    </template>
    <template #control-zoom-out>
      <button type="button" class="vue-flow__controls-button" aria-label="缩小画布" title="缩小画布" @click="zoomCanvasOut">
        <el-icon><ZoomOut /></el-icon>
      </button>
    </template>
    <template #control-fit-view>
      <button type="button" class="vue-flow__controls-button" aria-label="适配可读视图" title="适配可读视图" @click="fitCanvasView">
        <el-icon><FullScreen /></el-icon>
      </button>
    </template>
    <template #control-interactive>
      <button
        type="button"
        class="vue-flow__controls-button"
        :aria-label="canvasInteractive ? '锁定画布' : '解锁画布'"
        :title="canvasInteractive ? '锁定画布' : '解锁画布'"
        :aria-pressed="!canvasInteractive"
        @click="toggleCanvasInteractive"
      >
        <el-icon><Unlock v-if="canvasInteractive" /><Lock v-else /></el-icon>
      </button>
    </template>
  </Controls>
  <MiniMap pannable zoomable />
</template>

<script setup>
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import { MiniMap } from '@vue-flow/minimap'
import { FullScreen, Lock, Unlock, ZoomIn, ZoomOut } from '@element-plus/icons-vue'

/** Vue Flow 背景、缩放控件和小地图，必须挂在 VueFlow 默认槽里才能拿到画布上下文 */
defineProps({
  backgroundMode: { type: String, default: 'dots' },
  canvasInteractive: { type: Boolean, default: true },
  zoomCanvasIn: { type: Function, required: true },
  zoomCanvasOut: { type: Function, required: true },
  fitCanvasView: { type: Function, required: true },
  toggleCanvasInteractive: { type: Function, required: true },
})
</script>
