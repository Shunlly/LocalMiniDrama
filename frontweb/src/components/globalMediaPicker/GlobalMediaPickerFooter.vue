<template>
  <div class="picker-footer">
    <span class="picker-footer__status">{{ status }}</span>
    <div class="picker-footer__actions">
      <el-button @click="emit('cancel')">取消</el-button>
      <el-button
        type="primary"
        :disabled="confirmDisabled"
        :title="confirmDisabledReason || undefined"
        :aria-label="confirmDisabledReason ? `选择素材不可用：${confirmDisabledReason}` : '选择素材'"
        @click="emit('confirm')"
      >
        选择素材
      </el-button>
    </div>
  </div>
</template>

<script setup>
defineProps({
  status: { type: String, default: '' },
  confirmDisabled: { type: Boolean, default: false },
  confirmDisabledReason: { type: String, default: '' },
})

const emit = defineEmits(['cancel', 'confirm'])
</script>

<style scoped>
.picker-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.picker-footer__status {
  font-size: 12px;
  color: var(--text-muted);
}

.picker-footer__actions {
  display: flex;
  gap: 8px;
}

@media (max-width: 768px) {
  .picker-footer {
    flex-direction: column;
    align-items: stretch;
  }

  .picker-footer__actions {
    justify-content: flex-end;
  }
}
</style>
