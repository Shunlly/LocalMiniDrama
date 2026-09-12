<template>
  <div
    class="empty-stage-state"
    :role="recoveryMessage ? 'alert' : 'status'"
    :aria-live="recoveryMessage ? 'assertive' : 'polite'"
  >
    <strong>{{ title }}</strong>
    <p>{{ description }}</p>
    <p class="empty-stage-hint">{{ hint }}</p>
    <p v-if="recoveryMessage" class="empty-stage-recovery">{{ recoveryMessage }}</p>
    <div class="empty-stage-actions">
      <el-button size="small" :type="extractionNextStep ? 'default' : 'primary'" plain :aria-label="focusActionLabel" @click="$emit('focus-form')">
        {{ focusActionLabel }}
      </el-button>
      <el-button
        v-if="extractionNextStep"
        size="small"
        type="primary"
        :aria-label="extractionNextStep.actionLabel"
        @click="$emit('open-extraction-ai-config', extractionNextStep.serviceType)"
      >
        {{ extractionNextStep.actionLabel }}
      </el-button>
    </div>
    <p v-if="extractionNextStep?.extraHint" class="empty-stage-hint">{{ extractionNextStep.extraHint }}</p>
  </div>
</template>

<script setup>
defineProps({
  title: { type: String, required: true },
  description: { type: String, default: '' },
  hint: { type: String, required: true },
  recoveryMessage: { type: String, default: '' },
  extractionNextStep: { type: Object, default: null },
  focusActionLabel: { type: String, required: true },
})

defineEmits(['focus-form', 'open-extraction-ai-config'])
</script>

<style scoped>
.empty-stage-state {
  display: grid;
  gap: 10px;
}
.empty-stage-state strong {
  color: #e4e4e7;
  font-size: 13px;
}
.empty-stage-state p {
  margin: 0;
  color: var(--source-text-muted, #a1a1aa);
  font-size: 12px;
  line-height: 1.5;
}
.empty-stage-hint {
  margin: 0;
  color: var(--source-text-muted, #a1a1aa);
  font-size: 12px;
  line-height: 1.5;
}
.empty-stage-recovery {
  margin: 0;
  color: var(--el-color-danger);
  font-size: 12px;
  line-height: 1.5;
}
.empty-stage-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.empty-stage-actions :deep(.el-button:focus-visible) {
  outline: 2px solid #818cf8;
  outline-offset: 2px;
}
html.light .empty-stage-state strong {
  color: #18181b;
}
</style>
