<template>
  <section id="anchor-video" class="section card delivery-section">
    <h2 class="section-title">交付与导出</h2>
    <div class="delivery-overview" role="status" aria-live="polite">
      <div class="delivery-stat">
        <span>分镜视频</span>
        <strong>{{ playableStoryboardVideoCount }} / {{ storyboardCount }}</strong>
      </div>
      <div class="delivery-stat">
        <span>整集合成</span>
        <strong>{{ deliveryCompositeStatusLabel }}</strong>
      </div>
      <div class="delivery-stat">
        <span>可交付文件</span>
        <strong>{{ deliveryFileCount }} 项</strong>
        <small class="delivery-package-hint">{{ panelState.deliveryPackageHint }}</small>
      </div>
    </div>
    <div
      v-if="panelState.guidanceText"
      class="delivery-guidance"
      :class="{
        'is-empty': panelState.guidanceKind === 'empty',
        'is-disabled': panelState.guidanceKind === 'disabled',
      }"
      role="status"
      aria-live="polite"
      data-testid="delivery-guidance"
    >
      <p>{{ panelState.guidanceText }}</p>
      <button
        v-if="panelState.guidanceAnchor"
        type="button"
        class="delivery-guidance-link"
        :aria-label="panelState.guidanceActionLabel"
        data-testid="delivery-empty-action"
        @click="$emit('scroll-to-anchor', panelState.guidanceAnchor, panelState.guidanceAnchor)"
      >{{ panelState.guidanceActionLabel }}</button>
    </div>
    <div class="delivery-actions">
      <ActionGate :reason="visibleComposeDisabledReason" label="合成成片">
        <el-button
          type="primary"
          :loading="videoStatus === 'generating'"
          :disabled="Boolean(visibleComposeDisabledReason)"
          :title="panelState.composeButtonTitle"
          :aria-label="panelState.composeButtonAriaLabel"
          @click="$emit('generate-video')"
        >
          <el-icon><VideoPlay /></el-icon>
          {{ currentEpisodeVideoUrl ? '重新合成' : '合成成片' }}
        </el-button>
      </ActionGate>
      <ActionGate :reason="downloadVideoDisabledReason" label="下载成片">
        <el-button
          type="primary"
          plain
          :loading="videoDownloadStatus === 'downloading'"
          :disabled="Boolean(downloadVideoDisabledReason)"
          :title="panelState.downloadVideoButtonTitle"
          :aria-label="panelState.downloadVideoButtonAriaLabel"
          @click="$emit('download-video')"
        >
          <el-icon><Download /></el-icon>
          {{ videoDownloadStatus === 'error' ? '重试下载' : '下载成片' }}
        </el-button>
      </ActionGate>
      <ActionGate :reason="downloadSubtitleDisabledReason" label="下载字幕">
        <el-button
          plain
          :loading="deliveryExportStatus.subtitle === 'downloading'"
          :disabled="Boolean(downloadSubtitleDisabledReason)"
          :title="panelState.downloadSubtitleButtonTitle"
          :aria-label="panelState.downloadSubtitleButtonAriaLabel"
          @click="$emit('download-subtitle')"
        >
          <el-icon><Document /></el-icon>
          {{ deliveryExportStatus.subtitle === 'error' ? '重试字幕' : '下载字幕' }}
        </el-button>
      </ActionGate>
      <ActionGate :reason="exportProjectDisabledReason" label="导出项目包">
        <el-button
          plain
          :loading="deliveryExportStatus.project === 'downloading'"
          :disabled="Boolean(exportProjectDisabledReason)"
          :title="panelState.exportProjectButtonTitle"
          :aria-label="panelState.exportProjectButtonAriaLabel"
          @click="$emit('export-project')"
        >
          <el-icon><Box /></el-icon>
          {{ deliveryExportStatus.project === 'error' ? '重试项目包' : '导出项目包' }}
        </el-button>
      </ActionGate>
    </div>
    <div v-if="videoStatus === 'generating'" class="video-progress" role="status" aria-live="polite">
      <el-progress :percentage="videoProgress" :status="videoProgress >= 100 ? 'success' : undefined" />
      <p>视频正在生成，请稍候</p>
    </div>
    <div v-if="videoStatus === 'done'" class="video-done">
      <el-alert type="success" title="视频生成完成" show-icon />
    </div>
    <div v-else-if="videoStatus === 'error'" class="video-error">
      <el-alert type="error" :title="panelState.videoErrorMsg" show-icon />
    </div>
    <div v-if="currentEpisodeVideoUrl" class="video-preview-wrap">
      <div class="video-preview-header">
        <p class="video-preview-label">本集合成视频预览</p>
      </div>
      <video
        :src="currentEpisodeVideoUrl"
        controls
        aria-label="本集合成视频预览"
        class="video-preview-player"
        preload="metadata"
      />
      <p
        v-if="videoDownloadStatus !== 'idle'"
        class="video-download-status"
        :class="{ 'is-error': videoDownloadStatus === 'error' }"
        :role="videoDownloadStatus === 'error' ? 'alert' : 'status'"
        aria-live="polite"
      >
        {{ videoDownloadStatus === 'downloading'
          ? '正在验证并下载成片，请稍候'
          : videoDownloadStatus === 'success'
            ? '成片下载已完成。'
            : panelState.videoDownloadError }}
      </p>
    </div>
    <p
      v-if="panelState.deliveryExportFeedback"
      class="delivery-export-feedback"
      :class="{ 'is-error': deliveryExportHasError }"
      :role="deliveryExportHasError ? 'alert' : 'status'"
      aria-live="polite"
    >
      {{ panelState.deliveryExportFeedback }}
    </p>
  </section>
</template>

<script setup>
import { computed } from 'vue'
import { Box, Document, Download, VideoPlay } from '@element-plus/icons-vue'
import ActionGate from '@/components/filmCreate/ActionGate.vue'
import { describeDeliveryPanelState } from '@/components/filmCreate/filmCreateDeliveryPanelCopy.js'

const props = defineProps({
  playableStoryboardVideoCount: { type: Number, default: 0 },
  storyboardCount: { type: Number, default: 0 },
  deliveryCompositeStatusLabel: { type: String, default: '' },
  deliveryFileCount: { type: Number, default: 0 },
  composeActionDisabledReason: { type: String, default: '' },
  videoStatus: { type: String, default: '' },
  videoProgress: { type: Number, default: 0 },
  currentEpisodeVideoUrl: { type: String, default: '' },
  videoDownloadStatus: { type: String, default: 'idle' },
  videoDownloadError: { type: String, default: '' },
  currentEpisodeId: { type: [String, Number], default: null },
  deliverySubtitleAvailable: { type: Boolean, default: false },
  dramaId: { type: [String, Number], default: null },
  deliveryExportStatus: {
    type: Object,
    default: () => ({ subtitle: 'idle', project: 'idle' }),
  },
  videoErrorMsg: { type: String, default: '' },
  deliveryExportFeedback: { type: String, default: '' },
  deliveryExportHasError: { type: Boolean, default: false },
})

defineEmits(['generate-video', 'download-video', 'download-subtitle', 'export-project', 'scroll-to-anchor'])

const panelState = computed(() => describeDeliveryPanelState(props))
const visibleComposeDisabledReason = computed(() => panelState.value.composeDisabledReason)
const downloadVideoDisabledReason = computed(() => panelState.value.downloadVideoDisabledReason)
const downloadSubtitleDisabledReason = computed(() => panelState.value.downloadSubtitleDisabledReason)
const exportProjectDisabledReason = computed(() => panelState.value.exportProjectDisabledReason)
</script>

<style scoped>
.section {
  margin-bottom: 24px;
}
.card {
  background: #1e1f28;
  border-radius: 14px;
  padding: 22px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15);
  transition: border-color 0.3s ease, box-shadow 0.3s ease, transform 0.3s ease;
}
.card:hover {
  border-color: rgba(255, 255, 255, 0.1);
  box-shadow: 0 6px 28px rgba(0, 0, 0, 0.25);
}
html.light .card {
  background: rgba(255, 255, 255, 0.75);
  backdrop-filter: blur(16px) saturate(1.3);
  -webkit-backdrop-filter: blur(16px) saturate(1.3);
  border-color: rgba(139, 92, 246, 0.08);
  box-shadow: 0 1px 0 rgba(255,255,255,0.8) inset, 0 4px 20px rgba(99, 102, 241, 0.05);
}
html.light .card:hover {
  border-color: rgba(139, 92, 246, 0.18);
  box-shadow: 0 1px 0 rgba(255,255,255,0.8) inset, 0 8px 36px rgba(99, 102, 241, 0.08);
}
.section-title {
  font-size: 1.05rem;
  margin: 0 0 4px;
  color: #f4f4f5;
  font-weight: 600;
  letter-spacing: -0.01em;
}
html.light .section-title { color: #1e1b4b; }
.video-progress, .video-done, .video-error {
  margin-top: 16px;
}
.delivery-section,
.delivery-overview,
.delivery-stat,
.delivery-guidance,
.delivery-actions {
  min-width: 0;
  max-width: 100%;
}
.delivery-overview {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0;
  margin-bottom: 12px;
  border-top: 1px solid var(--el-border-color-lighter);
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.delivery-stat {
  display: grid;
  gap: 4px;
  min-width: 0;
  min-height: 58px;
  padding: 9px 12px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.delivery-stat + .delivery-stat {
  border-left: 1px solid var(--el-border-color-lighter);
}
.delivery-stat span,
.delivery-stat strong,
.delivery-package-hint,
.delivery-guidance p {
  overflow-wrap: anywhere;
  word-break: break-word;
}
.delivery-stat strong {
  color: var(--el-text-color-primary);
  font-size: 14px;
}
.delivery-package-hint {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  font-style: normal;
  line-height: 1.4;
}
@media (max-width: 769px) {
  .delivery-overview {
    grid-template-columns: minmax(0, 1fr);
  }
  .delivery-stat + .delivery-stat {
    border-left: 0;
    border-top: 1px solid var(--el-border-color-lighter);
  }
}
.delivery-guidance {
  display: grid;
  gap: 8px;
  justify-items: start;
  margin: 0 0 12px;
  padding: 12px 14px;
  border-radius: 8px;
  background: rgba(99, 102, 241, 0.08);
  color: var(--el-text-color-regular);
  font-size: 0.875rem;
  line-height: 1.55;
}
.delivery-guidance p {
  margin: 0;
  max-width: 42em;
}
.delivery-guidance.is-empty {
  color: var(--film-empty-copy, var(--el-text-color-regular));
}
.delivery-guidance.is-disabled {
  background: rgba(245, 158, 11, 0.12);
  color: #fbbf24;
}
html.light .delivery-guidance.is-disabled {
  color: #b45309;
}
.delivery-guidance-link {
  display: inline-block;
  margin-top: 0;
  padding: 0;
  border: 0;
  background: none;
  color: var(--el-color-primary);
  font: inherit;
  text-decoration: underline;
  cursor: pointer;
}
.delivery-guidance-link:focus-visible {
  outline: 2px solid #818cf8;
  outline-offset: 2px;
}
.delivery-actions {
  display: flex;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: 8px;
}
.delivery-actions :deep(.action-gate-wrap) {
  min-width: 0;
  max-width: 100%;
}
.delivery-export-feedback {
  margin: 12px 0 0;
  color: var(--el-color-success);
  font-size: 0.875rem;
  line-height: 1.5;
}
.delivery-export-feedback.is-error {
  color: var(--el-color-danger);
}
.video-preview-wrap {
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}
.video-preview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 10px;
}
.video-preview-label {
  margin: 0;
  font-size: 0.95rem;
  color: #a1a1aa;
}
.video-preview-player {
  display: block;
  max-width: 100%;
  max-height: 360px;
  border-radius: 8px;
  background: #1a1b24;
}
.video-download-status {
  margin: 10px 0 0;
  color: #a1a1aa;
  font-size: 0.875rem;
  line-height: 1.5;
}
.video-download-status.is-error { color: #f87171; }
</style>