<template>
  <div class="workflow-focus-head">
    <div class="stage-heading">
      <span class="stage-number">{{ inspectedFlowStep.number }}</span>
      <div>
        <strong>{{ inspectedFlowStep.label }}</strong>
        <span>{{ inspectedFlowStep.summary }}</span>
      </div>
      <el-tag size="small" :type="stageStatusTagType(inspectedFlowStep.status)">{{ inspectedFlowStep.statusLabel }}</el-tag>
    </div>
  </div>
</template>

<script setup>
defineProps({
  inspectedFlowStep: { type: Object, required: true },
})

function stageStatusTagType(status) {
  if (status === 'done') return 'success'
  if (status === 'partial' || status === 'active') return 'warning'
  if (status === 'error' || status === 'blocked') return 'danger'
  return 'info'
}
</script>

<style scoped>
.workflow-focus-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.stage-heading {
  display: flex;
  align-items: center;
  gap: 10px;
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
  color: var(--source-text-muted);
  font-size: 11px;
  line-height: 1.4;
}
.stage-number {
  width: 24px;
  height: 24px;
  flex: 0 0 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  color: var(--accent-text);
  background: rgba(139, 92, 246, 0.18);
  font-size: 11px;
  font-weight: 700;
}
html.light .stage-heading strong {
  color: #18181b;
}
</style>
