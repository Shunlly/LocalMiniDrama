<template>
  <div class="panel-actions">
    <el-button size="small" :loading="saving" :aria-label="saving ? '正在保存分镜，请稍候' : '保存分镜'" @click.stop="saveFields">保存</el-button>
    <el-button v-if="!isUniversal" size="small" :loading="busyStep === 'polish'" :aria-label="busyStep === 'polish' ? '正在润色提示词，请稍候' : '润色分镜提示词'" @click.stop="polishPrompt">润色</el-button>
    <el-button
      v-if="isUniversal"
      size="small"
      :icon="MagicStick"
      :loading="busyStep === 'universal-generate'"
      :aria-label="busyStep === 'universal-generate' ? '正在生成全能词，请稍候' : '生成全能词'" @click.stop="runUniversalPrompt('generate')"
    >生成全能词</el-button>
    <el-button
      v-if="isUniversal && universalSegmentText.trim()"
      size="small"
      :icon="Refresh"
      :loading="busyStep === 'universal-polish'"
      :aria-label="busyStep === 'universal-polish' ? '正在流式润色，请稍候' : '流式润色'" @click.stop="runUniversalPrompt('polish')"
    >流式润色</el-button>
    <el-button v-if="!isUniversal && !useFirstLast" size="small" type="primary" :loading="busyStep === 'image'" :aria-label="busyStep === 'image' ? '正在生图，请稍候' : '生成分镜图'" @click.stop="runStep('image')">生图</el-button>
    <el-button v-if="!isUniversal && useFirstLast" size="small" type="primary" :loading="busyStep === 'first-frame'" :aria-label="busyStep === 'first-frame' ? '正在生成首帧，请稍候' : '生成首帧'" @click.stop="runStep('first-frame')">生成首帧</el-button>
    <el-button v-if="!isUniversal && useFirstLast" size="small" type="primary" :loading="busyStep === 'last-frame'" :aria-label="busyStep === 'last-frame' ? '正在生成尾帧，请稍候' : '生成尾帧'" @click.stop="runStep('last-frame')">生成尾帧</el-button>
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
        :aria-label="busyStep === 'video' ? '正在生成视频，请稍候' : (videoAction.reason || '生成分镜视频')" @click.stop="runStep('video')"
      >生视频</el-button>
    </CanvasActionGate>
    <CanvasActionGate
      :reason="audioActionDisabledReason"
      label="生成对白配音"
      :description-id="ttsReasonId"
      :config-service-type="ttsAction.serviceType"
    >
      <el-button
        size="small"
        type="warning"
        :loading="busyStep === 'audio'"
        :disabled="Boolean(audioActionDisabledReason)"
        :title="audioActionDisabledReason || undefined"
        :aria-label="busyStep === 'audio' ? '正在生成对白配音，请稍候' : (audioActionDisabledReason || '生成对白配音')" @click.stop="runStep('audio')"
      >配音</el-button>
    </CanvasActionGate>
    <CanvasActionGate
      :reason="narrationActionDisabledReason"
      label="生成旁白配音"
      :description-id="ttsNarrationReasonId"
      :config-service-type="ttsAction.serviceType"
    >
      <el-button
        size="small"
        type="warning"
        :loading="busyStep === 'narration-audio'"
        :disabled="Boolean(narrationActionDisabledReason)"
        :title="narrationActionDisabledReason || undefined"
        :aria-label="busyStep === 'narration-audio' ? '正在生成旁白配音，请稍候' : (narrationActionDisabledReason || '生成旁白配音')" @click.stop="runStep('narration-audio')"
      >旁白</el-button>
    </CanvasActionGate>
    <el-dropdown trigger="click" placement="bottom-start" @visible-change="onStructureMenuVisible">
      <el-button
        size="small"
        :loading="reorderBusy"
        aria-label="分镜结构：上移、下移、前插、后插、追加"
        :aria-expanded="structureMenuOpen ? 'true' : 'false'"
        aria-haspopup="true"
        @click.stop="openStructureMenu"
      >分镜结构</el-button>
      <template #dropdown>
        <el-dropdown-menu v-if="structureMenuOpen">
          <el-dropdown-item
            :disabled="!canMoveUp || Boolean(reorderDisabledReason)"
            :title="moveUpTitle"
            :aria-label="moveUpTitle"
            @click.stop="moveStoryboardUp"
          >上移</el-dropdown-item>
          <el-dropdown-item
            :disabled="!canMoveDown || Boolean(reorderDisabledReason)"
            :title="moveDownTitle"
            :aria-label="moveDownTitle"
            @click.stop="moveStoryboardDown"
          >下移</el-dropdown-item>
          <el-dropdown-item
            :disabled="Boolean(reorderDisabledReason)"
            :title="insertTitle"
            :aria-label="insertTitle"
            @click.stop="insertStoryboardBefore"
          >前插</el-dropdown-item>
          <el-dropdown-item
            :disabled="Boolean(reorderDisabledReason)"
            :title="insertAfterTitle"
            :aria-label="insertAfterTitle"
            @click.stop="insertStoryboardAfter"
          >后插</el-dropdown-item>
          <el-dropdown-item
            :disabled="Boolean(reorderDisabledReason)"
            :title="appendTitle"
            :aria-label="appendTitle"
            @click.stop="appendStoryboard"
          >追加</el-dropdown-item>
        </el-dropdown-menu>
      </template>
    </el-dropdown>
    <el-button size="small" type="danger" plain aria-label="删除分镜" @click.stop="deleteStoryboard">删除</el-button>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { MagicStick, Refresh } from '@element-plus/icons-vue'
import CanvasActionGate from './CanvasActionGate.vue'

const props = defineProps({
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
  narrationActionDisabledReason: { type: String, default: '' },
  ttsNarrationReasonId: { type: String, default: '' },
  saveFields: { type: Function, required: true },
  polishPrompt: { type: Function, required: true },
  runUniversalPrompt: { type: Function, required: true },
  runStep: { type: Function, required: true },
  deleteStoryboard: { type: Function, required: true },
  canMoveUp: { type: Boolean, default: false },
  canMoveDown: { type: Boolean, default: false },
  reorderBusy: { type: Boolean, default: false },
  reorderDisabledReason: { type: String, default: '' },
  moveStoryboardUp: { type: Function, default: () => {} },
  moveStoryboardDown: { type: Function, default: () => {} },
  insertStoryboardBefore: { type: Function, default: () => {} },
  insertStoryboardAfter: { type: Function, default: () => {} },
  appendStoryboard: { type: Function, default: () => {} },
})

const moveUpTitle = computed(() => {
  if (props.reorderDisabledReason) return props.reorderDisabledReason
  if (!props.canMoveUp) return '已经是本集第一条分镜'
  return '上移分镜'
})
const moveDownTitle = computed(() => {
  if (props.reorderDisabledReason) return props.reorderDisabledReason
  if (!props.canMoveDown) return '已经是本集最后一条分镜'
  return '下移分镜'
})
const insertTitle = computed(() => props.reorderDisabledReason || '在此分镜前插入空白分镜')
const insertAfterTitle = computed(() => props.reorderDisabledReason || '在此分镜后插入空白分镜')
const appendTitle = computed(() => props.reorderDisabledReason || '在本集末尾追加空白分镜')

const structureMenuOpen = ref(false)
function openStructureMenu() {
  structureMenuOpen.value = true
}
function onStructureMenuVisible(visible) {
  structureMenuOpen.value = Boolean(visible)
}
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
