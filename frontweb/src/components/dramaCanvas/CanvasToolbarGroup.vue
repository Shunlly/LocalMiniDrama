<template>
  <section class="canvas-toolbar-group" :aria-label="ariaLabel || title">
    <div class="group-header">
      <span class="group-label">{{ title }}</span>
      <slot name="meta" />
    </div>
    <div class="group-body">
      <slot />
    </div>
    <div v-if="helper" class="group-helper" :title="helper">{{ helper }}</div>
  </section>
</template>

<script setup>
defineProps({
  title: { type: String, required: true },
  ariaLabel: { type: String, default: '' },
  helper: { type: String, default: '' },
})
</script>

<style scoped>
.canvas-toolbar-group {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 4px;
  min-width: 0;
  min-height: 68px;
  padding: 8px 10px;
  border: 0;
  border-radius: 0;
  background: transparent;
}

.group-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
}

.group-label {
  font-size: 11px;
  font-weight: 700;
  color: var(--text-subtle, #71717a);
  letter-spacing: 0;
}

.group-body {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  min-width: 0;
}

.group-helper {
  max-width: 360px;
  overflow: hidden;
  font-size: 11px;
  line-height: 1.35;
  color: var(--text-muted, #a1a1aa);
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
