<template>
  <section class="panorama-section" aria-label="场景全景图" aria-live="polite">
    <div class="panorama-head">
      <span>360° 全景图</span>
      <CanvasActionGate
        :reason="panoramaDisabledReason"
        :label="panoramaPreviewUrl ? '重新生成场景全景图' : '生成场景全景图'"
        description-id="canvas-reason-generate-panorama"
      >
        <el-button
          size="small"
          type="primary"
          plain
          :icon="panoramaPreviewUrl ? Refresh : Picture"
          :loading="panoramaGenerating"
          :disabled="Boolean(panoramaDisabledReason)"
          :title="panoramaDisabledReason || undefined"
          :aria-label="panoramaPreviewUrl ? '重新生成场景全景图' : '生成场景全景图'"
          @click.stop="generatePanorama"
        >
          {{ panoramaPreviewUrl ? '重新生成' : '生成全景图' }}
        </el-button>
      </CanvasActionGate>
    </div>
    <div class="panorama-preview">
      <img v-if="panoramaPreviewUrl" :src="panoramaPreviewUrl" alt="场景全景图" />
      <div v-else class="panorama-empty">暂无全景图</div>
      <div v-if="panoramaGenerating" class="panorama-loading">
        <span class="spinner" />
        <span>生成全景图…</span>
      </div>
    </div>
    <p v-if="panoramaError" class="panorama-error" role="alert">{{ panoramaError }}</p>
  </section>
</template>

<script setup>
import { Picture, Refresh } from '@element-plus/icons-vue'
import CanvasActionGate from './CanvasActionGate.vue'

defineProps({
  panoramaPreviewUrl: { type: String, default: '' },
  panoramaDisabledReason: { type: String, default: '' },
  panoramaGenerating: { type: Boolean, default: false },
  panoramaError: { type: String, default: '' },
  generatePanorama: { type: Function, required: true },
})
</script>

<style scoped>
.panorama-section {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--canvas-divider, rgba(63, 63, 70, 0.6));
}
.panorama-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 6px;
  color: var(--canvas-text-muted, #a1a1aa);
  font-size: 11px;
  font-weight: 600;
}
.panorama-preview {
  position: relative;
  width: 100%;
  aspect-ratio: 2 / 1;
  overflow: hidden;
  border: 1px solid var(--border-muted, #3f3f46);
  border-radius: 6px;
  background: var(--canvas-media-well, #09090b);
}
.panorama-preview img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.panorama-empty,
.panorama-loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--canvas-text-subtle, #71717a);
  font-size: 11px;
}
.panorama-loading {
  flex-direction: column;
  gap: 6px;
  color: #d4d4d8;
  background: var(--canvas-loading-surface, rgba(9, 9, 11, 0.82));
}
.panorama-error {
  margin: 6px 0 0;
  color: var(--canvas-danger-text, #f87171);
  font-size: 10px;
  line-height: 1.4;
  overflow-wrap: anywhere;
}
.spinner {
  width: 20px;
  height: 20px;
  border: 2px solid var(--canvas-spinner-track, rgba(255, 255, 255, 0.12));
  border-top-color: var(--asset-spinner-color, var(--canvas-blue-text, #93c5fd));
  border-radius: 50%;
  animation: spin 0.75s linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
