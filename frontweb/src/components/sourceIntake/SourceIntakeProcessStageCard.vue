<template>
  <div class="status-block">
    <div class="stage-heading stage-heading--compact">
      <div>
        <strong>处理进度</strong>
        <span>监控改编、资产、分镜和媒体步骤。</span>
      </div>
      <el-tag v-if="runState.id" size="small" :type="runTagType">{{ runState.label }}</el-tag>
    </div>

    <template v-if="selectedRun">
      <SourceIntakeRunRecordsPanel
        :selected-run="selectedRun"
        :run-state="runState"
        :run-progress-status="runProgressStatus"
        :displayed-run-error="displayedRunError"
        :extraction-next-step="extractionNextStepForRecords"
        :format-time="formatTime"
        @open-extraction-ai-config="$emit('open-extraction-ai-config', $event)"
      >
        <template #status>
          <slot name="status" />
        </template>
        <template #actions>
          <div class="action-row compact">
            <ActionGate label="重试失败步骤" :reason="controlActionReasons.retry">
              <el-button size="small" :disabled="Boolean(controlActionReasons.retry)" :loading="retrying" :aria-label="retrying ? '正在提交重试' : (controlActionReasons.retry || '重试失败步骤')" :aria-describedby="runState.failedStep && displayedRunError ? 'source-intake-run-error' : undefined" @click="$emit('retry')">
                {{ retrying ? '正在提交重试' : '重试失败步骤' }}
              </el-button>
            </ActionGate>
            <ActionGate label="暂停处理" :reason="controlActionReasons.pause">
              <el-button size="small" :disabled="Boolean(controlActionReasons.pause)" :loading="pausing" :aria-label="pausing ? '正在暂停' : (controlActionReasons.pause || '暂停处理')" @click="$emit('pause')">
                {{ pausing ? '正在暂停' : '暂停' }}
              </el-button>
            </ActionGate>
            <ActionGate label="恢复处理" :reason="controlActionReasons.resume">
              <el-button size="small" type="primary" plain :disabled="Boolean(controlActionReasons.resume)" :loading="resuming" :aria-label="resuming ? '正在恢复' : (controlActionReasons.resume || '恢复处理')" @click="$emit('resume')">
                {{ resuming ? '正在恢复' : '恢复' }}
              </el-button>
            </ActionGate>
            <ActionGate label="取消处理" :reason="controlActionReasons.cancel">
              <el-button size="small" type="danger" plain :disabled="Boolean(controlActionReasons.cancel)" :loading="cancelling" :aria-label="cancelling ? '正在取消' : (controlActionReasons.cancel || '取消处理')" @click="$emit('cancel')">
                {{ cancelling ? '正在取消' : '取消' }}
              </el-button>
            </ActionGate>
          </div>
          <div v-if="canRestartFromLatestSource" class="action-row compact">
            <ActionGate :label="`重新启动${workflowModeShortLabel}`" :reason="existingSourceLaunchReason">
              <el-button
                type="primary"
                :loading="startingSourceId === sources[0].id"
                :disabled="Boolean(existingSourceLaunchReason)"
                :aria-label="startingSourceId === sources[0].id ? '正在重新启动' : (existingSourceLaunchReason || `重新启动${workflowModeShortLabel}`)" @click="$emit('restart-latest', sources[0])"
              >
                {{ startingSourceId === sources[0].id ? '正在重新启动' : `重新启动${workflowModeShortLabel}` }}
              </el-button>
            </ActionGate>
          </div>
        </template>
      </SourceIntakeRunRecordsPanel>
    </template>

    <div v-else-if="sources.length > 0" class="stage-empty stage-empty--actionable">
      <span>已有 {{ sources.length }} 份素材，选择最近导入的素材开始处理。</span>
      <ActionGate :label="`以 ${workflowModeShortLabel} 启动`" :reason="existingSourceLaunchReason">
        <el-button type="primary" :loading="startingSourceId === sources[0].id" :disabled="Boolean(existingSourceLaunchReason)" :aria-label="startingSourceId === sources[0].id ? '正在启动' : (existingSourceLaunchReason || `以${workflowModeShortLabel}启动`)" @click="$emit('start-existing', sources[0])">
          以 {{ workflowModeShortLabel }} 启动
        </el-button>
      </ActionGate>
    </div>
    <div v-else class="stage-empty stage-empty--actionable">
      <span>还没有可处理的故事素材。请先在「导入素材」步骤添加网页、文件或文本。</span>
      <el-button type="primary" plain aria-label="去导入素材" @click="$emit('select-step', 'intake')">去导入素材</el-button>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import ActionGate from '@/components/filmCreate/ActionGate.vue'
import SourceIntakeRunRecordsPanel from '@/components/sourceIntake/SourceIntakeRunRecordsPanel.vue'

const props = defineProps({
  selectedRun: { default: null },
  runState: { type: Object, required: true },
  runTagType: { type: String, default: 'warning' },
  runProgressStatus: { type: String, default: '' },
  displayedRunError: { type: String, default: '' },
  extractionNextStep: { type: Object, default: null },
  formatTime: { type: Function, required: true },
  controlActionReasons: { type: Object, required: true },
  retrying: { type: Boolean, default: false },
  pausing: { type: Boolean, default: false },
  resuming: { type: Boolean, default: false },
  cancelling: { type: Boolean, default: false },
  canRestartFromLatestSource: { type: Boolean, default: false },
  sources: { type: Array, default: () => [] },
  startingSourceId: { default: null },
  workflowModeShortLabel: { type: String, required: true },
  existingSourceLaunchReason: { type: String, default: '' },
})

const extractionNextStepForRecords = computed(() => props.extractionNextStep)

defineEmits(['retry', 'pause', 'resume', 'cancel', 'restart-latest', 'start-existing', 'select-step', 'open-extraction-ai-config'])
</script>

<style scoped>
.status-block {
  border: 1px solid rgba(63, 63, 70, 0.7);
  border-radius: 8px;
  padding: 14px;
  background: rgba(18, 18, 22, 0.58);
}
.stage-heading {
  display: flex;
  align-items: center;
  gap: 10px;
}
.stage-heading--compact {
  margin-bottom: 12px;
}
.stage-heading > div {
  min-width: 0;
  flex: 1;
  display: grid;
  gap: 2px;
}
.stage-heading strong {
  color: #f4f4f5;
  font-size: 14px;
  font-weight: 600;
}
.stage-heading div span {
  color: var(--source-text-muted, #a1a1aa);
  font-size: 11px;
  line-height: 1.4;
}
.action-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.compact {
  margin-top: 12px;
}
.stage-empty {
  padding: 10px 0;
  color: var(--source-text-muted, #a1a1aa);
  font-size: 12px;
  line-height: 1.5;
}
.stage-empty--actionable {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 12px;
}
html.light .status-block {
  background: #f8fafc;
  border-color: #e5e7eb;
}
html.light .stage-heading strong {
  color: #18181b;
}
.status-block :deep(.el-button:focus-visible) {
  outline: 2px solid #818cf8;
  outline-offset: 2px;
}
</style>
