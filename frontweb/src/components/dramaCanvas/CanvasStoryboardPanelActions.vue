<template>
  <div class="panel-actions">
    <el-button size="small" :loading="saving" @click.stop="saveFields">保存</el-button>
    <el-button v-if="!isUniversal" size="small" :loading="busyStep === 'polish'" @click.stop="polishPrompt">润色</el-button>
    <el-button
      v-if="isUniversal"
      size="small"
      :icon="MagicStick"
      :loading="busyStep === 'universal-generate'"
      @click.stop="runUniversalPrompt('generate')"
    >生成全能词</el-button>
    <el-button
      v-if="isUniversal && universalSegmentText.trim()"
      size="small"
      :icon="Refresh"
      :loading="busyStep === 'universal-polish'"
      @click.stop="runUniversalPrompt('polish')"
    >流式润色</el-button>
    <el-button v-if="!isUniversal && !useFirstLast" size="small" type="primary" :loading="busyStep === 'image'" @click.stop="runStep('image')">生图</el-button>
    <el-button v-if="!isUniversal && useFirstLast" size="small" type="primary" :loading="busyStep === 'first-frame'" @click.stop="runStep('first-frame')">生成首帧</el-button>
    <el-button v-if="!isUniversal && useFirstLast" size="small" type="primary" :loading="busyStep === 'last-frame'" @click.stop="runStep('last-frame')">生成尾帧</el-button>
    <CanvasActionGate
      :reason="videoAction.reason"
      label="生成单镜视频"
      :description-id="videoReasonId"
      :config-service-type="videoAction.serviceType"
    >
      <el-button
        size="small"
        type="primary"
        :loading="busyStep === 'video'"
        :disabled="Boolean(videoAction.reason)"
        :title="videoAction.reason || undefined"
        @click.stop="runStep('video')"
      >生视频</el-button>
    </CanvasActionGate>
    <CanvasActionGate
      :reason="ttsAction.reason"
      label="生成单镜配音"
      :description-id="ttsReasonId"
      :config-service-type="ttsAction.serviceType"
    >
      <el-button
        size="small"
        type="warning"
        :loading="busyStep === 'audio'"
        :disabled="Boolean(audioActionDisabledReason)"
        :title="audioActionDisabledReason || undefined"
        @click.stop="runStep('audio')"
      >配音</el-button>
    </CanvasActionGate>
    <el-button size="small" type="danger" plain @click.stop="deleteStoryboard">删除</el-button>
  </div>
</template>

<script setup>
import { MagicStick, Refresh } from '@element-plus/icons-vue'
import CanvasActionGate from './CanvasActionGate.vue'

defineProps({
  saving: { type: Boolean, default: false },
  busyStep: { type: String, default: '' },
  isUniversal: { type: Boolean, default: false },
  useFirstLast: { type: Boolean, default: false },
  universalSegmentText: { type: String, default: '' },
  videoAction: { type: Object, required: true },
  ttsAction: { type: Object, required: true },
  videoReasonId: { type: String, required: true },
  ttsReasonId: { type: String, required: true },
  audioActionDisabledReason: { type: String, default: '' },
  saveFields: { type: Function, required: true },
  polishPrompt: { type: Function, required: true },
  runUniversalPrompt: { type: Function, required: true },
  runStep: { type: Function, required: true },
  deleteStoryboard: { type: Function, required: true },
})
</script>

<style scoped>
.panel-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--canvas-divider-strong, rgba(63, 63, 70, 0.8));
}
.panel-actions :deep(.el-button) {
  margin: 0;
}
</style>
