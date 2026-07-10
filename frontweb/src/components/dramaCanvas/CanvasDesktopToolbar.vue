<template>
  <div class="canvas-desktop-toolbar">
    <div class="toolbar-main-row">
      <CanvasToolbarGroup title="创建内容" aria-label="创建内容" :helper="contentHelper">
        <el-tooltip :disabled="!actionReasons.editScript" :content="actionReasons.editScript" placement="bottom">
          <span class="tooltip-anchor">
            <el-button
              size="small"
              type="warning"
              plain
              :disabled="Boolean(actionReasons.editScript)"
              @click="emit('edit-script')"
            >
              <el-icon><Document /></el-icon>
              剧本
            </el-button>
          </span>
        </el-tooltip>
        <el-tooltip :disabled="!actionReasons.createStoryboard" :content="actionReasons.createStoryboard" placement="bottom">
          <span class="tooltip-anchor">
            <el-button
              size="small"
              :disabled="Boolean(actionReasons.createStoryboard)"
              @click="emit('create', 'storyboard')"
            >
              <el-icon><Plus /></el-icon>
              分镜
            </el-button>
          </span>
        </el-tooltip>
        <el-button size="small" @click="emit('create', 'episode')">
          <el-icon><Tickets /></el-icon>
          剧集
        </el-button>
        <el-tooltip :disabled="!actionReasons.createAsset" :content="actionReasons.createAsset" placement="bottom">
          <span class="tooltip-anchor">
            <el-dropdown trigger="click" :disabled="Boolean(actionReasons.createAsset)" @command="emit('create', $event)">
              <el-button size="small" :disabled="Boolean(actionReasons.createAsset)">
                <el-icon><Box /></el-icon>
                素材
                <el-icon class="dropdown-arrow"><ArrowDown /></el-icon>
              </el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="character">新建角色</el-dropdown-item>
                  <el-dropdown-item command="scene">新建场景</el-dropdown-item>
                  <el-dropdown-item command="prop">新建道具</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </span>
        </el-tooltip>
      </CanvasToolbarGroup>

      <CanvasWorkflowToolbarGroup
        class="workflow-group"
        :selected-storyboard-count="selectedStoryboardCount"
        :workflow-groups="workflowGroups"
        :active-group-id="activeGroupId"
        :pipeline-steps="pipelineSteps"
        :workflow-running="workflowRunning"
        :action-reasons="actionReasons"
        @update:pipeline-steps="emit('update:pipelineSteps', $event)"
        @update:active-group-id="emit('update:activeGroupId', $event)"
        @create-workflow="emit('create-workflow')"
        @run-workflow="emit('run-workflow')"
        @delete-workflow="emit('delete-workflow')"
      />

      <CanvasToolbarGroup title="批量生成" aria-label="本集批量生成" :helper="batchHelper">
        <el-tooltip :disabled="!actionReasons.generateStoryboards" :content="actionReasons.generateStoryboards" placement="bottom">
          <span class="tooltip-anchor">
            <el-button
              size="small"
              type="primary"
              :loading="episodeGenerating"
              :disabled="Boolean(actionReasons.generateStoryboards)"
              @click="emit('generate-storyboards')"
            >
              <el-icon><MagicStick /></el-icon>
              AI 分镜
            </el-button>
          </span>
        </el-tooltip>
        <el-tooltip :disabled="!actionReasons.batchImages" :content="actionReasons.batchImages" placement="bottom">
          <span class="tooltip-anchor">
            <el-button
              size="small"
              :loading="episodeGenerating"
              :disabled="Boolean(actionReasons.batchImages)"
              @click="emit('batch-images')"
            >
              <el-icon><Picture /></el-icon>
              批量生图
            </el-button>
          </span>
        </el-tooltip>
        <el-tooltip :disabled="!actionReasons.batchVideos" :content="actionReasons.batchVideos" placement="bottom">
          <span class="tooltip-anchor">
            <el-button
              size="small"
              :loading="episodeGenerating"
              :disabled="Boolean(actionReasons.batchVideos)"
              @click="emit('batch-videos')"
            >
              <el-icon><VideoPlay /></el-icon>
              批量生视频
            </el-button>
          </span>
        </el-tooltip>
      </CanvasToolbarGroup>

      <div class="toolbar-utilities" aria-label="画布工具">
        <el-tooltip content="自动对齐并适配全部节点" placement="bottom">
          <el-button size="small" :loading="aligningNodes" aria-label="对齐节点" @click="emit('align')">
            <el-icon><Grid /></el-icon>
          </el-button>
        </el-tooltip>
        <el-button size="small" type="primary" plain @click="emit('list-mode')">
          <el-icon><List /></el-icon>
          列表模式
        </el-button>
        <el-tooltip :content="isDark ? '切换到浅色主题' : '切换到暗色主题'" placement="bottom">
          <el-button size="small" class="theme-button" :aria-label="isDark ? '浅色主题' : '暗色主题'" @click="emit('toggle-theme')">
            <el-icon><Sunny v-if="isDark" /><Moon v-else /></el-icon>
          </el-button>
        </el-tooltip>
      </div>
    </div>

    <div v-if="workflowProgress || episodeGenProgress" class="toolbar-progress" aria-live="polite">
      <span v-if="workflowProgress">{{ workflowProgress }}</span>
      <span v-if="episodeGenProgress" class="episode-progress">{{ episodeGenProgress }}</span>
    </div>
  </div>
</template>

<script setup>
import {
  ArrowDown,
  Box,
  Document,
  Grid,
  List,
  MagicStick,
  Moon,
  Picture,
  Plus,
  Sunny,
  Tickets,
  VideoPlay,
} from '@element-plus/icons-vue'
import { computed } from 'vue'

import CanvasToolbarGroup from './CanvasToolbarGroup.vue'
import CanvasWorkflowToolbarGroup from './CanvasWorkflowToolbarGroup.vue'

const props = defineProps({
  selectedStoryboardCount: { type: Number, default: 0 },
  workflowGroups: { type: Array, default: () => [] },
  activeGroupId: { type: [String, Number], default: null },
  pipelineSteps: { type: Array, default: () => [] },
  workflowRunning: { type: Boolean, default: false },
  workflowProgress: { type: String, default: '' },
  episodeGenerating: { type: Boolean, default: false },
  episodeGenProgress: { type: String, default: '' },
  actionReasons: { type: Object, default: () => ({}) },
  aligningNodes: { type: Boolean, default: false },
  isDark: { type: Boolean, default: false },
})

const emit = defineEmits([
  'edit-script',
  'create',
  'align',
  'list-mode',
  'toggle-theme',
  'update:pipelineSteps',
  'update:activeGroupId',
  'create-workflow',
  'run-workflow',
  'delete-workflow',
  'generate-storyboards',
  'batch-images',
  'batch-videos',
])

const contentHelper = computed(() => (
  props.actionReasons.editScript
  || props.actionReasons.createStoryboard
  || props.actionReasons.createAsset
  || ''
))

const batchHelper = computed(() => (
  props.actionReasons.generateStoryboards
  || props.actionReasons.batchImages
  || props.actionReasons.batchVideos
  || ''
))
</script>

<style scoped>
.canvas-desktop-toolbar {
  padding: 0 20px 12px;
  box-sizing: border-box;
  min-width: 0;
  max-width: 100%;
}

.toolbar-main-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  flex-wrap: wrap;
  min-width: 0;
}

.toolbar-main-row > * {
  max-width: 100%;
}

.workflow-group {
  flex: 1 1 340px;
}

.tooltip-anchor {
  display: inline-flex;
}

.dropdown-arrow {
  margin-left: 4px;
  font-size: 10px;
}

.toolbar-utilities {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
  flex-wrap: wrap;
}

.theme-button {
  width: 32px;
  padding-inline: 0;
}

.toolbar-progress {
  display: flex;
  align-items: center;
  gap: 16px;
  padding-top: 8px;
  font-size: 12px;
  color: var(--canvas-info-text, #60a5fa);
}

.episode-progress {
  color: var(--canvas-success-text, #34d399);
}

.canvas-desktop-toolbar :deep(.el-button:focus-visible) {
  outline: 2px solid var(--canvas-focus-ring, #818cf8);
  outline-offset: 2px;
}

.canvas-desktop-toolbar :deep(.el-select__wrapper.is-focused) {
  box-shadow: 0 0 0 2px var(--canvas-focus-ring, #818cf8) !important;
}

.canvas-desktop-toolbar :deep(.el-checkbox__input.is-focus .el-checkbox__inner) {
  outline: 2px solid var(--canvas-focus-ring, #818cf8);
  outline-offset: 2px;
}
</style>
