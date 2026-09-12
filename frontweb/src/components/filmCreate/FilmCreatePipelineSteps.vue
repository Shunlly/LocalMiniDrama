<template>
  <div v-if="progressStatusText || currentStep" class="pipeline-current-step">
    <span v-if="stepIndex > 0" class="pipeline-step-badge">{{ stepIndex }}/{{ stepTotal }}</span>
    {{ progressStatusText || cleanCurrentStep }}
  </div>
</template>

<script setup>
defineProps({
  progressStatusText: { type: String, default: '' },
  currentStep: { type: String, default: '' },
  cleanCurrentStep: { type: String, default: '' },
  stepIndex: { type: Number, default: 0 },
  stepTotal: { type: Number, default: 0 },
})
</script>

<style scoped>
.pipeline-current-step {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
  color: var(--el-text-color-primary);
  font-weight: 500;
}

.pipeline-step-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 44px;
  padding: 1px 7px;
  border-radius: 10px;
  background: var(--el-color-primary);
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
}

</style>
