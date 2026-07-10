<template>
  <section class="canvas-toolbar-group" :aria-label="ariaLabel || title">
    <div class="group-header">
      <span class="group-label">{{ title }}</span>
      <slot name="meta" />
    </div>
    <div class="group-body">
      <slot />
    </div>
    <div v-if="helper" class="group-helper">{{ helper }}</div>
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
  gap: 6px;
  min-width: 0;
  padding: 10px 12px;
  border: 1px solid var(--border-color, #3f3f46);
  border-radius: 8px;
  background: color-mix(in srgb, var(--bg-card, #18181b) 92%, transparent);
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
  gap: 8px;
  flex-wrap: wrap;
  min-width: 0;
}

.group-helper {
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-muted, #a1a1aa);
}
</style>
