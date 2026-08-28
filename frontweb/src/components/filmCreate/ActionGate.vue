<template>
  <span v-if="reason" class="action-gate-wrap">
    <el-tooltip
      :content="reason"
      placement="top"
      :show-after="180"
    >
      <span
        class="action-gate"
        role="group"
        tabindex="0"
        aria-disabled="true"
        :aria-label="accessibleLabel"
      >
        <slot />
      </span>
    </el-tooltip>
    <span class="action-gate-reason" data-testid="action-gate-reason">{{ reason }}</span>
  </span>
  <slot v-else />
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  reason: { type: String, default: '' },
  label: { type: String, default: '此操作' },
})

const accessibleLabel = computed(() => `${props.label}不可用：${props.reason}`)
</script>

<style scoped>
.action-gate-wrap {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 8px;
  max-width: 100%;
}
.action-gate {
  display: inline-flex;
  max-width: 100%;
  cursor: not-allowed;
}
.action-gate:focus-visible {
  outline: 2px solid #818cf8;
  outline-offset: 2px;
}
.action-gate :deep(.el-button) {
  margin-left: 0;
}
.action-gate-reason {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.4;
  max-width: 28em;
}
</style>
