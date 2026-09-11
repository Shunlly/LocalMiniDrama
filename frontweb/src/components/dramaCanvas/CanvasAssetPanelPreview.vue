<template>
  <div class="preview-col">
    <div class="preview-box">
      <img v-if="previewUrl && !generating" :src="previewUrl" :alt="`${displayName}${kindLabel}参考图`" />
      <div v-else-if="!generating" class="preview-empty">
        <span class="preview-empty-icon" aria-hidden="true">{{ kindIcon }}</span>
        <span>暂无参考图</span>
      </div>
      <div v-if="generating || nodeBusy" class="preview-loading">
        <span class="spinner" />
        <span>{{ nodeBusy?.message || '生成参考图…' }}</span>
      </div>
    </div>
    <div class="entity-status" :class="'st-' + (entityStatus || (previewUrl ? 'completed' : 'empty'))">{{ entityStatusLabel }}</div>
    <p class="preview-source">{{ previewSourceLabel }}</p>
    <p v-if="generateError" class="generate-error" role="alert">{{ generateError }}</p>
  </div>
</template>

<script setup>
defineProps({
  kindLabel: { type: String, required: true },
  kindIcon: { type: String, required: true },
  displayName: { type: String, required: true },
  previewUrl: { type: String, default: '' },
  generating: { type: Boolean, default: false },
  nodeBusy: { type: Object, default: null },
  entityStatus: { type: String, default: '' },
  entityStatusLabel: { type: String, required: true },
  previewSourceLabel: { type: String, required: true },
  generateError: { type: String, default: '' },
})
</script>

<style scoped>
.preview-col {
  flex-shrink: 0;
  width: 108px;
}
.preview-box {
  position: relative;
  width: 108px;
  height: 108px;
  border-radius: 10px;
  overflow: hidden;
  background: var(--canvas-media-well, #09090b);
  border: 1px solid var(--border-muted, #3f3f46);
}
.preview-box img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.preview-empty {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  font-size: 11px;
  color: var(--canvas-text-muted, #a1a1aa);
  text-align: center;
  padding: 8px;
}
.preview-empty-icon {
  font-size: 28px;
  opacity: 0.7;
}
.preview-loading {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  background: var(--canvas-loading-surface, rgba(9, 9, 11, 0.82));
  font-size: 10px;
  color: #d4d4d8;
  text-align: center;
  padding: 6px;
}
.spinner {
  width: 20px;
  height: 20px;
  border: 2px solid var(--canvas-spinner-track, rgba(255, 255, 255, 0.12));
  border-top-color: var(--asset-spinner-color, var(--canvas-success-text, #34d399));
  border-radius: 50%;
  animation: spin 0.75s linear infinite;
}
.entity-status {
  margin-top: 6px;
  font-size: 10px;
  text-align: center;
  color: var(--canvas-text-subtle, #71717a);
}
.entity-status.st-processing { color: var(--canvas-info-text, #60a5fa); }
.entity-status.st-completed { color: var(--canvas-success-text, #34d399); }
.entity-status.st-failed { color: var(--canvas-danger-text, #f87171); }
.entity-status.st-empty { color: var(--canvas-text-muted, #a1a1aa); }
.preview-source,
.generate-error {
  margin: 4px 0 0;
  font-size: 10px;
  line-height: 1.4;
  text-align: center;
  overflow-wrap: anywhere;
}
.preview-source {
  color: var(--canvas-text-subtle, #71717a);
}
.generate-error {
  color: var(--canvas-danger-text, #f87171);
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
