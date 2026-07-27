<template>
  <section class="free-canvas-toolbar nodrag nopan" aria-label="自由画布工具">
    <div class="mode-switch" role="group" aria-label="画布模式">
      <el-button
        size="small"
        :type="mode === 'production' ? 'primary' : 'default'"
        :aria-pressed="mode === 'production'"
        @click="emit('set-mode', 'production')"
      >
        制作
      </el-button>
      <el-button
        size="small"
        :type="mode === 'free' ? 'primary' : 'default'"
        :aria-pressed="mode === 'free'"
        @click="emit('set-mode', 'free')"
      >
        自由
      </el-button>
    </div>

    <div class="toolbar-divider" aria-hidden="true" />

    <el-dropdown trigger="click" @command="createNode">
      <el-tooltip content="新建自由节点" placement="bottom">
        <el-button size="small" circle aria-label="新建自由节点" title="新建自由节点">
          <el-icon><Plus /></el-icon>
        </el-button>
      </el-tooltip>
      <template #dropdown>
        <el-dropdown-menu>
          <el-dropdown-item command="text"><el-icon><Document /></el-icon>文本</el-dropdown-item>
          <el-dropdown-item command="image"><el-icon><Picture /></el-icon>图片</el-dropdown-item>
          <el-dropdown-item command="video"><el-icon><VideoPlay /></el-icon>视频</el-dropdown-item>
          <el-dropdown-item command="config"><el-icon><Setting /></el-icon>配置</el-dropdown-item>
          <el-dropdown-item command="reference"><el-icon><Link /></el-icon>引用</el-dropdown-item>
        </el-dropdown-menu>
      </template>
    </el-dropdown>

    <el-tooltip content="撤销" placement="bottom">
      <el-button size="small" circle :disabled="!canUndo" aria-label="撤销" title="撤销" @click="emit('undo')">
        <el-icon><RefreshLeft /></el-icon>
      </el-button>
    </el-tooltip>
    <el-tooltip content="重做" placement="bottom">
      <el-button size="small" circle :disabled="!canRedo" aria-label="重做" title="重做" @click="emit('redo')">
        <el-icon><RefreshRight /></el-icon>
      </el-button>
    </el-tooltip>
    <el-tooltip content="适配视图" placement="bottom">
      <el-button size="small" circle aria-label="适配视图" title="适配视图" @click="emit('fit-view')">
        <el-icon><FullScreen /></el-icon>
      </el-button>
    </el-tooltip>
    <el-tooltip content="切换背景" placement="bottom">
      <el-button size="small" circle aria-label="切换背景" title="切换背景" @click="cycleBackground">
        <el-icon><Picture /></el-icon>
      </el-button>
    </el-tooltip>
    <el-tooltip content="打开素材库" placement="bottom">
      <el-button size="small" circle aria-label="打开素材库" title="打开素材库" @click="emit('toggle-library')">
        <el-icon><FolderOpened /></el-icon>
      </el-button>
    </el-tooltip>
  </section>
</template>

<script setup>
import {
  Document,
  FolderOpened,
  FullScreen,
  Link,
  Picture,
  Plus,
  RefreshLeft,
  RefreshRight,
  Setting,
  VideoPlay,
} from '@element-plus/icons-vue'

const props = defineProps({
  mode: { type: String, default: 'production' },
  canUndo: { type: Boolean, default: false },
  canRedo: { type: Boolean, default: false },
  backgroundMode: { type: String, default: 'dots' },
})

const emit = defineEmits([
  'create-node',
  'undo',
  'redo',
  'fit-view',
  'set-background',
  'toggle-library',
  'set-mode',
])

const backgroundModes = ['dots', 'lines', 'none']

function createNode(type) {
  emit('create-node', type)
}

function cycleBackground() {
  const current = backgroundModes.indexOf(props.backgroundMode)
  emit('set-background', backgroundModes[(current + 1) % backgroundModes.length])
}
</script>

<style scoped>
.free-canvas-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  min-height: 40px;
  padding: 6px 8px;
  border: 1px solid var(--border-color, #3f3f46);
  border-radius: 6px;
  background: var(--canvas-panel-surface, var(--bg-card, #18181b));
}

.mode-switch {
  display: inline-flex;
  flex: 0 0 auto;
  gap: 2px;
}

.mode-switch :deep(.el-button + .el-button) {
  margin-left: 0;
}

.toolbar-divider {
  width: 1px;
  height: 24px;
  flex: 0 0 1px;
  background: var(--border-color, #3f3f46);
}

.free-canvas-toolbar :deep(.el-button:focus-visible) {
  outline: 2px solid var(--canvas-focus-ring, #818cf8);
  outline-offset: 2px;
}
</style>
