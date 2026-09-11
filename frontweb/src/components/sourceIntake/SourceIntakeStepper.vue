<template>
  <nav class="flow-stepper" aria-label="素材处理步骤">
    <button
      v-for="step in flowState.steps"
      :key="step.id"
      type="button"
      class="flow-step"
      :class="[
        `is-${step.status}`,
        { 'is-current': flowState.activeStepId === step.id },
        { 'is-selected': inspectedFlowStep.id === step.id },
      ]"
      :aria-current="flowState.activeStepId === step.id ? 'step' : undefined"
      :aria-pressed="inspectedFlowStep.id === step.id"
      @click="$emit('select', step.id)"
    >
      <span class="flow-step-number">{{ step.status === 'done' ? '✓' : step.number }}</span>
      <span class="flow-step-copy">
        <strong>{{ step.label }}</strong>
        <small>{{ step.statusLabel }}</small>
        <small class="flow-step-summary">{{ step.summary }}</small>
      </span>
    </button>
  </nav>
</template>

<script setup>
defineProps({
  flowState: { type: Object, required: true },
  inspectedFlowStep: { type: Object, required: true },
})

defineEmits(['select'])
</script>

<style scoped>
.flow-stepper {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 10px;
  margin: 0 0 18px;
}
.flow-step {
  appearance: none;
  min-width: 0;
  min-height: 88px;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px;
  border: 1px solid rgba(63, 63, 70, 0.7);
  background: rgba(18, 18, 22, 0.48);
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.flow-step:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 2px;
}
.flow-step.is-selected {
  border-color: var(--el-text-color-secondary);
  outline: 1px solid var(--el-text-color-secondary);
  outline-offset: -2px;
}

.flow-step.is-selected:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 2px;
}
.flow-step.is-current {
  background: rgba(139, 92, 246, 0.12);
  box-shadow: inset 3px 0 0 var(--el-color-primary);
}
.flow-step-number {
  width: 24px;
  height: 24px;
  flex: 0 0 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid #52525b;
  border-radius: 50%;
  color: var(--source-text-muted);
  font-size: 11px;
  font-weight: 700;
}
.flow-step-copy {
  min-width: 0;
  display: grid;
  gap: 2px;
}
.flow-step-copy strong {
  color: #e4e4e7;
  font-size: 12px;
  font-weight: 600;
}
.flow-step-copy small {
  color: var(--source-text-muted);
  font-size: 10px;
  line-height: 1.35;
}
.flow-step-summary {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
.flow-step.is-done .flow-step-number {
  border-color: #22c55e;
  color: var(--status-success);
  background: rgba(34, 197, 94, 0.12);
}
.flow-step.is-active .flow-step-number,
.flow-step.is-ready .flow-step-number {
  border-color: #8b5cf6;
  color: #c4b5fd;
  background: rgba(139, 92, 246, 0.14);
}
.flow-step.is-error .flow-step-number,
.flow-step.is-blocked .flow-step-number {
  border-color: #ef4444;
  color: #fca5a5;
  background: rgba(239, 68, 68, 0.12);
}
html.light .flow-step {
  background: #f8fafc;
  border-color: #e5e7eb;
}
html.light .flow-step.is-selected {
  border-color: #94a3b8;
  outline-color: #94a3b8;
}
html.light .flow-step.is-current {
  background: rgba(99, 102, 241, 0.08);
}
html.light .flow-step-copy strong {
  color: #18181b;
}
@media (max-width: 900px) {
  .flow-stepper {
    grid-template-columns: 1fr;
  }
}
</style>