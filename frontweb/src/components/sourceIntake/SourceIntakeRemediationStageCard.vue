<template>
  <div class="status-block">
    <div class="stage-heading stage-heading--compact">
      <div>
        <strong>修复建议</strong>
        <span>自动重跑可修复步骤，其余问题保留人工建议。</span>
      </div>
    </div>
    <div class="stage-action-row">
      <ActionGate label="一键修复" :reason="remediateReason">
        <el-button
          size="small"
          type="warning"
          plain
          :disabled="Boolean(remediateReason)"
          :loading="remediating"
          :aria-label="remediating ? '正在一键修复' : (remediateReason || '一键修复')" @click="$emit('remediate')"
        >
          一键修复
        </el-button>
      </ActionGate>
      <span v-if="remediateReason" class="action-reason action-reason--inline">{{ remediateReason }}</span>
    </div>
    <div v-if="remediationStatus" class="remediation-status">{{ remediationStatus }}</div>
    <div v-if="latestQa.remediationActions.length" class="remediation-actions">
      <div v-for="action in latestQa.remediationActions" :key="action.code" class="qa-issue">
        {{ action.label }}：{{ action.automated ? '可自动执行' : '需要人工处理' }}
      </div>
    </div>
    <div v-else-if="latestQa.passed" class="stage-success">QA 已通过，不需要修复。</div>
    <div v-else class="stage-empty stage-empty--actionable">
      <span>还没有可自动修复的建议。请先执行 QA 审计。</span>
      <el-button type="primary" plain aria-label="去执行 QA" @click="$emit('select-step', 'qa')">去执行 QA</el-button>
    </div>
  </div>
</template>

<script setup>
import ActionGate from '@/components/filmCreate/ActionGate.vue'

defineProps({
  latestQa: { type: Object, required: true },
  remediateReason: { type: String, default: '' },
  remediating: { type: Boolean, default: false },
  remediationStatus: { type: String, default: '' },
})

defineEmits(['remediate', 'select-step'])
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
.stage-action-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 32px;
  margin-bottom: 10px;
}
.action-reason {
  margin-top: 7px;
  color: var(--status-warning, #fbbf24);
  font-size: 11px;
  line-height: 1.45;
}
.action-reason--inline {
  margin-top: 0;
}
.remediation-status {
  margin-top: 10px;
  margin-bottom: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  color: #bfdbfe;
  background: rgba(96, 165, 250, 0.12);
  font-size: 12px;
}
.remediation-actions {
  display: grid;
  gap: 6px;
}
.qa-issue,
.stage-empty {
  font-size: 12px;
  color: var(--source-text-muted, #a1a1aa);
  line-height: 1.45;
}
.stage-empty {
  padding: 10px 0;
  line-height: 1.5;
}
.stage-empty--actionable {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 12px;
}
.stage-success {
  padding: 10px 0;
  color: var(--status-success, #4ade80);
  font-size: 12px;
  line-height: 1.5;
}
html.light .status-block {
  background: #f8fafc;
  border-color: #e5e7eb;
}
html.light .stage-heading strong {
  color: #18181b;
}
</style>
