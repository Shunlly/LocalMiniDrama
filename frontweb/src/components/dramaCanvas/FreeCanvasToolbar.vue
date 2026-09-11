<template>
  <section class="free-canvas-toolbar nodrag nopan" aria-label="自由画布工具">
    <div v-if="showModeSwitch" class="mode-switch" role="group" aria-label="画布模式">
      <el-button
        size="small"
        :type="mode === 'production' ? 'primary' : 'default'"
        :aria-pressed="mode === 'production'"
        aria-label="剧集画布"
        title="剧集画布"
        @click="emit('set-mode', 'production')"
      >
        制作
      </el-button>
      <el-button
        size="small"
        :type="mode === 'free' ? 'primary' : 'default'"
        :aria-pressed="mode === 'free'"
        aria-label="自由画布"
        title="自由画布不跑本集生成"
        @click="emit('set-mode', 'free')"
      >
        自由
      </el-button>
    </div>

    <div v-if="showModeSwitch && isFreeMode" class="toolbar-divider" aria-hidden="true" />

    <template v-if="isFreeMode">
      <el-tooltip content="新建自由节点" placement="bottom">
        <el-dropdown trigger="click" @command="createNode">
          <el-button size="small" circle aria-label="新建自由节点" title="新建自由节点">
            <el-icon><Plus /></el-icon>
          </el-button>
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
      </el-tooltip>

      <el-tooltip :content="canUndo ? '撤销（Ctrl+Z）' : '没有可撤销的操作'" placement="bottom">
        <el-button size="small" circle :disabled="!canUndo" :aria-label="canUndo ? '撤销' : '撤销不可用：没有可撤销的操作'" :title="canUndo ? '撤销（Ctrl+Z）' : '没有可撤销的操作'" @click="emit('undo')">
          <el-icon><RefreshLeft /></el-icon>
        </el-button>
      </el-tooltip>
      <el-tooltip :content="canRedo ? '重做（Ctrl+Y）' : '没有可重做的操作'" placement="bottom">
        <el-button size="small" circle :disabled="!canRedo" :aria-label="canRedo ? '重做' : '重做不可用：没有可重做的操作'" :title="canRedo ? '重做（Ctrl+Y）' : '没有可重做的操作'" @click="emit('redo')">
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
      <el-tooltip :content="libraryActionLabel" placement="bottom">
        <el-button size="small" circle :aria-label="libraryActionLabel" :title="libraryActionLabel" @click="emit('toggle-library')">
          <el-icon><FolderOpened /></el-icon>
        </el-button>
      </el-tooltip>
      <el-tooltip :content="hideProductionActionLabel" placement="bottom">
        <el-button
          size="small"
          :circle="!hideProductionNodes"
          :aria-label="hideProductionActionLabel"
          :title="hideProductionActionLabel"
          :aria-pressed="hideProductionNodes"
          @click="emit('toggle-hide-production', !hideProductionNodes)"
        >
          <el-icon><View v-if="hideProductionNodes" /><Hide v-else /></el-icon>
          <span v-if="hideProductionNodes">显示制作节点</span>
        </el-button>
      </el-tooltip>

      <CanvasActionGate
        :reason="alignDisabledReason"
        label="对齐所选节点"
        description-id="free-canvas-reason-align"
      >
        <el-dropdown trigger="click" :disabled="Boolean(alignDisabledReason)" @command="alignSelection">
          <el-button
            size="small"
            :disabled="Boolean(alignDisabledReason)"
            aria-label="对齐所选节点"
            :title="alignDisabledReason || '对齐所选节点'"
          >
            对齐
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="left">左对齐</el-dropdown-item>
              <el-dropdown-item command="top">顶对齐</el-dropdown-item>
              <el-dropdown-item command="center-x">水平居中</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </CanvasActionGate>

      <div v-if="isEmptyCanvas" class="empty-next-steps" aria-label="空画布下一步">
        <span class="empty-next-copy" role="status">{{ emptyNextCopy }}</span>
        <el-button
          v-if="hideProductionNodes"
          size="small"
          aria-label="显示制作节点"
          @click="emit('toggle-hide-production', false)"
        >显示制作节点</el-button>
        <el-button size="small" type="primary" aria-label="新建文本" @click="emit('create-node', 'text')">新建文本</el-button>
        <el-button size="small" aria-label="新建配置" @click="emit('create-node', 'config')">新建配置</el-button>
        <el-button size="small" aria-label="打开素材栏" @click="emit('toggle-library')">打开素材栏</el-button>
      </div>

      <p v-if="densityHint" class="density-hint" role="status">{{ densityHint }}</p>

      <div v-if="selectionCount >= 1" class="multi-selection-actions" aria-label="多选操作">
        <span class="selection-summary" role="status">已选 {{ selectionCount }} 项</span>
        <template v-if="selectionCount >= 2">
          <el-tooltip content="复制所选节点（Ctrl+C）" placement="bottom">
            <el-button size="small" circle aria-label="复制所选节点" title="复制所选节点（Ctrl+C）" @click="emit('copy-selection')">
              <el-icon><CopyDocument /></el-icon>
            </el-button>
          </el-tooltip>
          <el-tooltip content="删除所选节点（Delete）" placement="bottom">
            <el-button size="small" circle type="danger" aria-label="删除所选节点" title="删除所选节点（Delete）" @click="emit('delete-selection')">
              <el-icon><Delete /></el-icon>
            </el-button>
          </el-tooltip>
        </template>
      </div>
    </template>
  </section>
</template>

<script setup>
import {
  CopyDocument,
  Delete,
  Document,
  FolderOpened,
  Hide,
  FullScreen,
  View,
  Link,
  Picture,
  Plus,
  RefreshLeft,
  RefreshRight,
  Setting,
  VideoPlay,
} from '@element-plus/icons-vue'
import { computed } from 'vue'

import CanvasActionGate from './CanvasActionGate.vue'
import {
  freeCanvasUxState,
  getFreeCanvasAlignDisabledReason,
  getFreeCanvasNodeCapacityHint,
} from './freeCanvasUx.js'

const props = defineProps({
  mode: { type: String, default: 'production' },
  canUndo: { type: Boolean, default: false },
  canRedo: { type: Boolean, default: false },
  backgroundMode: { type: String, default: 'dots' },
  showModeSwitch: { type: Boolean, default: true },
  libraryVisible: { type: Boolean, default: false },
  selectionCount: { type: Number, default: 0 },
  hideProductionNodes: { type: Boolean, default: false },
})

const emit = defineEmits([
  'create-node',
  'undo',
  'redo',
  'fit-view',
  'set-background',
  'toggle-library',
  'set-mode',
  'copy-selection',
  'delete-selection',
  'toggle-hide-production',
])

const backgroundModes = ['dots', 'lines', 'none']
const isFreeMode = computed(() => props.mode === 'free')
const libraryActionLabel = computed(() => props.libraryVisible ? '收起素材栏' : '展开素材栏')
const hideProductionActionLabel = computed(() => props.hideProductionNodes ? '显示制作节点' : '隐藏制作节点')
const effectiveNodeCount = computed(() => freeCanvasUxState.nodeCount)
const isEmptyCanvas = computed(() => isFreeMode.value && effectiveNodeCount.value === 0)
const emptyNextCopy = computed(() => (
  props.hideProductionNodes
    ? '制作节点已隐藏，下一步可显示回来或新建自由节点'
    : '画布是空的，下一步可直接开始'
))
const densityHint = computed(() => getFreeCanvasNodeCapacityHint(effectiveNodeCount.value))
const alignDisabledReason = computed(() => getFreeCanvasAlignDisabledReason({
  selectionCount: props.selectionCount,
  readonly: Boolean(freeCanvasUxState.readonly),
}))

function alignSelection(mode) {
  if (alignDisabledReason.value) return
  freeCanvasUxState.alignSelection?.(mode)
}

function createNode(type) {
  if (!isFreeMode.value) return
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

.multi-selection-actions {
  display: inline-flex;
  min-height: 28px;
  align-items: center;
  gap: 6px;
  padding-left: 8px;
  border-left: 1px solid var(--border-color, #3f3f46);
}

.selection-summary,
.empty-next-copy,
.density-hint {
  color: var(--canvas-text-secondary, #d4d4d8);
  font-size: 12px;
  white-space: nowrap;
}

.selection-summary {
  min-width: 64px;
}

.empty-next-steps,
.density-hint {
  display: inline-flex;
  min-height: 28px;
  align-items: center;
  gap: 6px;
  padding-left: 8px;
  border-left: 1px solid var(--border-color, #3f3f46);
}

.density-hint {
  max-width: 280px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.free-canvas-toolbar :deep(.el-button:focus-visible) {
  outline: 2px solid var(--canvas-focus-ring, #818cf8);
  outline-offset: 2px;
}
</style>
