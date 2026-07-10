<template>
  <el-tooltip
    v-if="reason"
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
.action-gate {
  display: inline-flex;
  max-width: 100%;
  cursor: not-allowed;
}

.action-gate :deep(.el-button) {
  margin-left: 0;
}
</style>
