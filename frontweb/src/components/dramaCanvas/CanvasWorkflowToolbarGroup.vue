<template>
  <CanvasToolbarGroup title="工作流" aria-label="工作流工具" :helper="helperText">
    <template #meta>
      <span v-if="selectedStoryboardCount > 0" class="selection-count">已选 {{ selectedStoryboardCount }} 镜</span>
      <span v-else-if="workflowGroups.length" class="workflow-count">{{ workflowGroups.length }} 组</span>
    </template>

    <el-checkbox-group
      v-if="showCreateControls"
      :model-value="pipelineSteps"
      size="small"
      class="workflow-steps"
      @update:model-value="emit('update:pipelineSteps', $event)"
    >
      <el-checkbox value="image">生图</el-checkbox>
      <CanvasActionGate
        :reason="videoStepGateReason"
        label="选择生视频步骤"
        description-id="canvas-reason-workflow-video-step"
        config-service-type="video"
      >
        <el-checkbox value="video" :disabled="Boolean(videoStepGateReason)">生视频</el-checkbox>
      </CanvasActionGate>
      <CanvasActionGate
        :reason="audioStepGateReason"
        label="选择配音步骤"
        description-id="canvas-reason-workflow-audio-step"
        config-service-type="tts"
      >
        <el-checkbox value="audio" :disabled="Boolean(audioStepGateReason)">配音</el-checkbox>
      </CanvasActionGate>
    </el-checkbox-group>

    <CanvasActionGate
      v-if="showCreateControls"
      :reason="actionReasons.createWorkflow"
      label="创建工作流分组"
      description-id="canvas-reason-create-workflow"
      :config-service-type="actionConfigServices.createWorkflow"
    >
      <el-button
        size="small"
        :disabled="Boolean(actionReasons.createWorkflow)"
        @click="emit('create-workflow')"
      >
        <el-icon><Plus /></el-icon>
        创建分组
      </el-button>
    </CanvasActionGate>

    <template v-if="showManagementControls">
      <el-select
        :model-value="activeGroupId"
        size="small"
        placeholder="选择工作流"
        clearable
        class="workflow-select"
        @update:model-value="emit('update:activeGroupId', $event)"
      >
        <el-option
          v-for="group in workflowGroups"
          :key="group.id"
          :label="`${group.title} (${(group.storyboard_ids || []).length}镜)`"
          :value="group.id"
        />
      </el-select>

      <CanvasActionGate
        :reason="actionReasons.runWorkflow"
        label="执行工作流分组"
        description-id="canvas-reason-run-workflow"
        :config-service-type="actionConfigServices.runWorkflow"
      >
        <el-button
          size="small"
          type="primary"
          :loading="workflowRunning"
          :disabled="Boolean(actionReasons.runWorkflow)"
          @click="emit('run-workflow')"
        >
          <el-icon><Refresh /></el-icon>
          执行分组
        </el-button>
      </CanvasActionGate>

      <CanvasActionGate :reason="actionReasons.deleteWorkflow" label="删除工作流分组" description-id="canvas-reason-delete-workflow">
        <el-button
          size="small"
          type="danger"
          plain
          :disabled="Boolean(actionReasons.deleteWorkflow)"
          @click="emit('delete-workflow')"
        >
          <el-icon><Delete /></el-icon>
          删除
        </el-button>
      </CanvasActionGate>
    </template>
  </CanvasToolbarGroup>
</template>

<script setup>
import { computed } from 'vue'
import { Delete, Plus, Refresh } from '@element-plus/icons-vue'

import CanvasToolbarGroup from './CanvasToolbarGroup.vue'
import CanvasActionGate from './CanvasActionGate.vue'
import { getCanvasWorkflowUiState } from '@/utils/canvasUiState'

const props = defineProps({
  selectedStoryboardCount: { type: Number, default: 0 },
  workflowGroups: { type: Array, default: () => [] },
  activeGroupId: { type: [String, Number], default: null },
  pipelineSteps: { type: Array, default: () => [] },
  workflowRunning: { type: Boolean, default: false },
  actionReasons: { type: Object, default: () => ({}) },
  actionConfigServices: { type: Object, default: () => ({}) },
})

const emit = defineEmits([
  'update:pipelineSteps',
  'update:activeGroupId',
  'create-workflow',
  'run-workflow',
  'delete-workflow',
])

const workflowUiState = computed(() => getCanvasWorkflowUiState({
  selectedStoryboardCount: props.selectedStoryboardCount,
  workflowGroupCount: props.workflowGroups.length,
  actionReasons: props.actionReasons,
}))

const showCreateControls = computed(() => workflowUiState.value.showCreateControls)
const showManagementControls = computed(() => workflowUiState.value.showManagementControls)
const helperText = computed(() => workflowUiState.value.helperText)
const videoStepGateReason = computed(() => (
  props.actionReasons.video && !props.pipelineSteps.includes('video')
    ? props.actionReasons.video
    : ''
))
const audioStepGateReason = computed(() => (
  props.actionReasons.tts && !props.pipelineSteps.includes('audio')
    ? props.actionReasons.tts
    : ''
))
</script>

<style scoped>
.selection-count,
.workflow-count {
  font-size: 12px;
  font-weight: 600;
}

.selection-count {
  color: var(--canvas-success-text, #34d399);
}

.workflow-count {
  color: var(--text-muted, #a1a1aa);
}

.workflow-steps {
  display: flex;
  gap: 2px;
  flex-wrap: wrap;
}

.workflow-select {
  width: 180px;
  max-width: 100%;
}

</style>
