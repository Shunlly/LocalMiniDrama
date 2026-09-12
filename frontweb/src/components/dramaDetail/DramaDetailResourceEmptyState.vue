<template>
  <div class="library-empty resource-empty-state" role="status" aria-live="polite" aria-label="空资源下一步">
    <div class="empty-state-title">{{ title }}</div>
    <div class="empty-state-copy">{{ copy }}</div>
    <slot />
  </div>
</template>

<script setup>
// 资源空状态只负责展示标题、说明和操作槽，具体文案由父级传入
defineProps({
  title: { type: String, default: '' },
  copy: { type: String, default: '' },
})
</script>

<style scoped>
.empty-state-title { color: var(--text-primary); font-size: 15px; font-weight: 600; }
.empty-state-copy { max-width: 620px; color: var(--text-subtle); font-size: 12px; line-height: 1.6; }
.library-empty { text-align: center; color: #71717a; padding: 40px 20px; }
.resource-empty-state { display: grid; justify-items: center; gap: 12px; width: 100%; max-width: 100%; box-sizing: border-box; }
</style>
