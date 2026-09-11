<template>
  <section
    class="free-canvas-empty-state"
    aria-labelledby="free-canvas-empty-title"
    aria-describedby="free-canvas-empty-desc"
  >
    <h2 id="free-canvas-empty-title">开始自由创作</h2>
    <p id="free-canvas-empty-desc">还没有自由节点。可以新建文本、配置，或导入媒体开始编排。</p>
    <div class="free-canvas-empty-actions">
      <el-button type="primary" aria-label="新建文本节点" @click="createFreeCanvasNode('text')">
        <el-icon><Document /></el-icon>
        新建文本
      </el-button>
      <el-button aria-label="新建配置节点" @click="createFreeCanvasNode('config')">
        <el-icon><Setting /></el-icon>
        新建配置
      </el-button>
      <el-button aria-label="导入媒体" @click="openFreeCanvasMediaPicker">
        <el-icon><FolderOpened /></el-icon>
        导入媒体
      </el-button>
    </div>
  </section>
</template>

<script setup>
import { Document, FolderOpened, Setting } from '@element-plus/icons-vue'

defineProps({
  createFreeCanvasNode: { type: Function, required: true },
  openFreeCanvasMediaPicker: { type: Function, required: true },
})
</script>

<style scoped>
.free-canvas-empty-state {
  position: absolute;
  inset: 22% 24px auto;
  z-index: 1050;
  display: grid;
  justify-items: center;
  gap: 14px;
  color: var(--canvas-text-primary);
  text-align: center;
  pointer-events: none;
}

.free-canvas-empty-state h2 {
  margin: 0;
  font-size: 18px;
  line-height: 24px;
}

.free-canvas-empty-state p {
  margin: 0;
  max-width: 420px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--canvas-text-muted, #a1a1aa);
}

.free-canvas-empty-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
  pointer-events: auto;
}
</style>
