<template>
  <div class="source-intake-run-records">
    <el-progress :percentage="runState.progress" :status="runProgressStatus" />
    <div class="run-meta">
      <span>{{ workflowTypeLabel(selectedRun.type) }}</span>
      <span>{{ runState.modeLabel }}</span>
      <span>{{ formatTime(selectedRun.created_at) || '未知时间' }}</span>
      <span v-if="runState.activeStep">当前：{{ workflowStepLabel(runState.activeStep, selectedRun) }}</span>
      <span v-if="runState.costLabel">{{ runState.costLabel }}</span>
      <span v-if="runState.costSummary.unknownCount" class="cost-unconfigured">
        {{ runState.costSummary.unknownCount }} 项未配置价格
      </span>
    </div>
    <slot name="status" />
    <div
      v-if="runState.mediaNotice"
      class="placeholder-note"
      :class="{ 'is-error': runState.productionPlaceholder }"
      :role="runState.productionPlaceholder ? 'alert' : 'status'"
      :aria-live="runState.productionPlaceholder ? 'assertive' : 'polite'"
    >
      {{ runState.mediaNotice }}
    </div>
    <details class="run-detail" open>
      <summary>步骤明细</summary>
      <div class="step-list">
        <div
          v-for="step in selectedRun.steps || []"
          :key="step.id"
          class="step-item"
          :class="'step-' + step.status"
        >
          <span class="step-dot" />
          <span class="step-name">{{ workflowStepLabel(step, selectedRun) }}</span>
          <span class="step-status">{{ workflowStepStatusLabel(step.status) }}</span>
          <span class="step-attempts">#{{ step.attempts || 0 }}</span>
        </div>
      </div>
    </details>
    <div
      v-if="runState.failedStep && displayedRunError"
      id="source-intake-run-error"
      class="run-error"
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
    >
      <span>{{ displayedRunError }}</span>
      <div v-if="extractionNextStep" class="source-extraction-next-step">
        <span class="next-step-kicker">下一步</span>
        <el-button
          size="small"
          type="primary"
          plain
          :aria-label="extractionNextStep.actionLabel"
          @click="$emit('open-extraction-ai-config', extractionNextStep.serviceType)"
        >
          {{ extractionNextStep.actionLabel }}
        </el-button>
        <span v-if="extractionNextStep.extraHint">{{ extractionNextStep.extraHint }}</span>
      </div>
    </div>
    <slot name="actions" />
  </div>
</template>

<script setup>
import {
  workflowStepLabel,
  workflowStepStatusLabel,
  workflowTypeLabel,
} from '@/utils/workflowRunStatus'

defineProps({
  selectedRun: { type: Object, required: true },
  runState: { type: Object, required: true },
  runProgressStatus: { type: String, default: '' },
  displayedRunError: { type: String, default: '' },
  extractionNextStep: { type: Object, default: null },
  formatTime: { type: Function, required: true },
})

defineEmits(['open-extraction-ai-config'])
</script>

<style scoped>
.run-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
  margin: 8px 0 10px;
  color: var(--source-text-secondary, #d4d4d8);
  font-size: 12px;
}
.run-meta .cost-unconfigured {
  color: #fbbf24;
}
.placeholder-note {
  margin: 8px 0 10px;
  padding: 8px 10px;
  border-radius: 8px;
  color: #fde68a;
  background: rgba(245, 158, 11, 0.12);
  font-size: 12px;
  line-height: 1.45;
}
.placeholder-note.is-error {
  color: #fecaca;
  background: rgba(239, 68, 68, 0.12);
}
.run-detail {
  color: var(--source-text-secondary, #d4d4d8);
  font-size: 12px;
}
.run-detail summary {
  cursor: pointer;
  color: #93c5fd;
  margin-bottom: 8px;
}
.step-list {
  display: grid;
  gap: 6px;
}
.step-item {
  display: grid;
  grid-template-columns: 10px 1fr auto auto;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--source-text-secondary, #d4d4d8);
}
.step-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #52525b;
}
.step-completed .step-dot {
  background: #22c55e;
}
.step-processing .step-dot {
  background: #60a5fa;
}
.step-failed .step-dot {
  background: #ef4444;
}
.step-cancelled .step-dot {
  background: #71717a;
}
.step-name {
  color: #e4e4e7;
}
.step-status,
.step-attempts {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: var(--source-text-muted, #a1a1aa);
}
.run-error {
  margin-top: 10px;
  padding: 8px 10px;
  border-radius: 8px;
  color: #fecaca;
  background: rgba(239, 68, 68, 0.12);
  font-size: 12px;
  display: grid;
  gap: 8px;
}
.source-extraction-next-step {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  color: #e4e4e7;
}
.next-step-kicker {
  padding: 2px 6px;
  border-radius: 4px;
  color: var(--accent-text, #a78bfa);
  background: rgba(139, 92, 246, 0.2);
  font-size: 11px;
}
.run-error :deep(.el-button:focus-visible),
.source-extraction-next-step :deep(.el-button:focus-visible) {
  outline: 2px solid #818cf8;
  outline-offset: 2px;
}
html.light .step-name {
  color: #18181b;
}
</style>
