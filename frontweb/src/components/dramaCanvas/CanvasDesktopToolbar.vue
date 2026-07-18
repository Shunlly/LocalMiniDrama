<template>
  <div class="canvas-desktop-toolbar">
    <div class="toolbar-main-row">
      <CanvasToolbarGroup title="创建内容" aria-label="创建内容" :helper="contentHelper">
        <CanvasActionGate :reason="actionReasons.editScript" label="编辑剧本" description-id="canvas-reason-edit-script">
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
        </CanvasActionGate>
        <CanvasActionGate :reason="actionReasons.createStoryboard" label="新建分镜" description-id="canvas-reason-create-storyboard">
          <el-button
            size="small"
            :disabled="Boolean(actionReasons.createStoryboard)"
            @click="emit('create', 'storyboard')"
          >
            <el-icon><Plus /></el-icon>
            分镜
          </el-button>
        </CanvasActionGate>
        <el-button size="small" @click="emit('create', 'episode')">
          <el-icon><Tickets /></el-icon>
          剧集
        </el-button>
        <CanvasActionGate :reason="actionReasons.createAsset" label="新建素材" description-id="canvas-reason-create-asset">
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
        </CanvasActionGate>
      </CanvasToolbarGroup>

      <CanvasWorkflowToolbarGroup
        class="workflow-group"
        :selected-storyboard-count="selectedStoryboardCount"
        :workflow-groups="workflowGroups"
        :active-group-id="activeGroupId"
        :pipeline-steps="pipelineSteps"
        :workflow-running="workflowRunning"
        :action-reasons="actionReasons"
        :action-config-services="actionConfigServices"
        @update:pipeline-steps="emit('update:pipelineSteps', $event)"
        @update:active-group-id="emit('update:activeGroupId', $event)"
        @create-workflow="emit('create-workflow')"
        @run-workflow="emit('run-workflow')"
        @delete-workflow="emit('delete-workflow')"
      />

      <CanvasToolbarGroup title="批量生成" aria-label="本集批量生成" :helper="batchHelper">
        <CanvasActionGate :reason="actionReasons.generateStoryboards" label="AI 生成分镜" description-id="canvas-reason-generate-storyboards">
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
        </CanvasActionGate>
        <CanvasActionGate :reason="actionReasons.batchImages" label="批量生成图片" description-id="canvas-reason-batch-images">
          <el-button
            size="small"
            :loading="episodeGenerating"
            :disabled="Boolean(actionReasons.batchImages)"
            @click="emit('batch-images')"
          >
            <el-icon><Picture /></el-icon>
            批量生图
          </el-button>
        </CanvasActionGate>
        <CanvasActionGate
          :reason="actionReasons.batchVideos"
          label="批量生成视频"
          description-id="canvas-reason-batch-videos"
          :config-service-type="actionConfigServices.batchVideos"
        >
          <el-button
            size="small"
            :loading="episodeGenerating"
            :disabled="Boolean(actionReasons.batchVideos)"
            @click="emit('batch-videos')"
          >
            <el-icon><VideoPlay /></el-icon>
            批量生视频
          </el-button>
        </CanvasActionGate>
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
import CanvasActionGate from './CanvasActionGate.vue'

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
  actionConfigServices: { type: Object, default: () => ({}) },
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
  padding: 0 20px 8px;
  box-sizing: border-box;
  min-width: 0;
  max-width: 100%;
}

.toolbar-main-row {
  display: flex;
  align-items: stretch;
  gap: 0;
  flex-wrap: nowrap;
  min-width: 0;
  border: 1px solid var(--border-color, #3f3f46);
  border-radius: 6px;
  background: color-mix(in srgb, var(--bg-card, #18181b) 92%, transparent);
}

.toolbar-main-row > * {
  max-width: 100%;
  border-right: 1px solid var(--border-color, #3f3f46);
}

.toolbar-main-row > :last-child {
  border-right: 0;
}

.workflow-group {
  min-width: 240px;
  flex: 1 1 260px;
}

.dropdown-arrow {
  margin-left: 4px;
  font-size: 10px;
}

.toolbar-utilities {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 0;
  flex: 0 0 auto;
  flex-wrap: nowrap;
  padding: 8px 10px;
  background: color-mix(in srgb, var(--bg-page, #0f0f12) 48%, transparent);
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

@media (max-width: 1120px) {
  .toolbar-main-row {
    flex-wrap: wrap;
  }

  .toolbar-main-row > * {
    border-right: 0;
    border-bottom: 1px solid var(--border-color, #3f3f46);
  }

  .toolbar-main-row > :last-child {
    border-bottom: 0;
  }

  .toolbar-utilities {
    margin-left: auto;
  }
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
