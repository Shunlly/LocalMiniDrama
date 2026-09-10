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
      <a
        v-if="panelState.guidanceHref"
        class="delivery-guidance-link"
        :href="panelState.guidanceHref"
        :aria-label="panelState.guidanceActionLabel"
        data-testid="delivery-empty-action"
      >{{ panelState.guidanceActionLabel }}</a>
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
    <div v-if="videoStatus === 'generating'" class="video-progress">
      <el-progress :percentage="videoProgress" :status="videoProgress >= 100 ? 'success' : undefined" />
      <p>视频生成中...</p>
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
          ? '正在验证并下载成片...'
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

function describeDeliveryPanelState(input = {}) {
  const technicalEnglish = /network error|http\s*error|failed to fetch|fetch failed|internal server error|econnrefused|err_network|status code|axioserror/i
  function hasChinese(text) {
    return /[\u4e00-\u9fff]/.test(String(text || ''))
  }
  function toUserFacingText(value, fallback) {
    const text = String(value || '').trim()
    const safeFallback = String(fallback || '操作失败，请稍后重试')
    if (!text) return safeFallback
    if (technicalEnglish.test(text) || !hasChinese(text)) return safeFallback
    return text
  }
  function toOptionalUserFacingText(value, fallback) {
    if (!String(value || '').trim()) return ''
    return toUserFacingText(value, fallback)
  }
  function toDisabledReason(value, fallback) {
    const text = String(value || '').trim()
    if (!text) return ''
    if (technicalEnglish.test(text) || !hasChinese(text)) return String(fallback || '当前不可用')
    return text
  }
  function buttonAriaLabel({ actionLabel, loading, loadingLabel, disabledReason }) {
    const label = String(actionLabel || '').trim() || '此操作'
    if (loading) return String(loadingLabel || `正在${label}`).trim()
    const reason = String(disabledReason || '').trim()
    if (reason) return `${label}不可用：${reason}`
    return label
  }
  function buttonTitle({ loading, loadingLabel, disabledReason }) {
    if (loading) {
      const text = String(loadingLabel || '').trim()
      return text ? `${text}，请稍候` : '正在处理，请稍候'
    }
    const reason = String(disabledReason || '').trim()
    return reason || undefined
  }

  const playable = Math.max(0, Math.floor(Number(input.playableStoryboardVideoCount) || 0))
  const total = Math.max(0, Math.floor(Number(input.storyboardCount) || 0))
  const composeDisabledReason = toDisabledReason(input.composeActionDisabledReason, '当前不能合成成片')
  const downloadVideoDisabledReason = input.currentEpisodeVideoUrl ? '' : '请先合成成片后再下载'
  const downloadSubtitleDisabledReason = !input.currentEpisodeId
    ? '请先选择剧集'
    : (input.deliverySubtitleAvailable ? '' : '当前集还没有可下载的字幕')
  const exportProjectDisabledReason = input.dramaId ? '' : '请先打开制作项目'

  let guidanceKind = ''
  let guidanceText = ''
  let guidanceHref = ''
  let guidanceActionLabel = ''
  if (/请先创建或选择剧集|请先打开制作项目/.test(composeDisabledReason)) {
    guidanceKind = 'disabled'
    guidanceText = composeDisabledReason
  } else if (playable <= 0) {
    guidanceKind = 'empty'
    if (total > 0) {
      guidanceText = `还没有可播放的分镜视频（已完成 0/${total}）。请先到「分镜」面板为每个镜头生成视频，全部完成后再回来合成成片。`
      guidanceHref = '#anchor-storyboard-images'
      guidanceActionLabel = '去分镜面板生成视频'
    } else {
      guidanceText = '还没有可播放的分镜视频。请先到「分镜」面板生成或添加分镜，再为每个镜头生成视频。'
      guidanceHref = '#anchor-storyboard'
      guidanceActionLabel = '去分镜面板添加分镜'
    }
  } else if (composeDisabledReason) {
    guidanceKind = 'disabled'
    guidanceText = composeDisabledReason
  }

  const composeActionLabel = input.currentEpisodeVideoUrl ? '重新合成' : '合成成片'
  const downloadVideoActionLabel = input.videoDownloadStatus === 'error' ? '重试下载' : '下载成片'
  const downloadSubtitleActionLabel = input.deliveryExportStatus?.subtitle === 'error' ? '重试字幕' : '下载字幕'
  const exportProjectActionLabel = input.deliveryExportStatus?.project === 'error' ? '重试项目包' : '导出项目包'

  return {
    composeDisabledReason,
    downloadVideoDisabledReason,
    downloadSubtitleDisabledReason,
    exportProjectDisabledReason,
    guidanceKind,
    guidanceText,
    guidanceHref,
    guidanceActionLabel,
    composeActionLabel,
    downloadVideoActionLabel,
    downloadSubtitleActionLabel,
    exportProjectActionLabel,
    composeButtonAriaLabel: buttonAriaLabel({
      actionLabel: composeActionLabel,
      loading: input.videoStatus === 'generating',
      loadingLabel: '正在合成成片',
      disabledReason: composeDisabledReason,
    }),
    composeButtonTitle: buttonTitle({
      loading: input.videoStatus === 'generating',
      loadingLabel: '正在合成成片',
      disabledReason: composeDisabledReason,
    }),
    downloadVideoButtonAriaLabel: buttonAriaLabel({
      actionLabel: downloadVideoActionLabel,
      loading: input.videoDownloadStatus === 'downloading',
      loadingLabel: '正在下载成片',
      disabledReason: downloadVideoDisabledReason,
    }),
    downloadVideoButtonTitle: buttonTitle({
      loading: input.videoDownloadStatus === 'downloading',
      loadingLabel: '正在下载成片',
      disabledReason: downloadVideoDisabledReason,
    }),
    downloadSubtitleButtonAriaLabel: buttonAriaLabel({
      actionLabel: downloadSubtitleActionLabel,
      loading: input.deliveryExportStatus?.subtitle === 'downloading',
      loadingLabel: '正在下载字幕',
      disabledReason: downloadSubtitleDisabledReason,
    }),
    downloadSubtitleButtonTitle: buttonTitle({
      loading: input.deliveryExportStatus?.subtitle === 'downloading',
      loadingLabel: '正在下载字幕',
      disabledReason: downloadSubtitleDisabledReason,
    }),
    exportProjectButtonAriaLabel: buttonAriaLabel({
      actionLabel: exportProjectActionLabel,
      loading: input.deliveryExportStatus?.project === 'downloading',
      loadingLabel: '正在导出项目包',
      disabledReason: exportProjectDisabledReason,
    }),
    exportProjectButtonTitle: buttonTitle({
      loading: input.deliveryExportStatus?.project === 'downloading',
      loadingLabel: '正在导出项目包',
      disabledReason: exportProjectDisabledReason,
    }),
    videoErrorMsg: input.videoStatus === 'error'
      ? toUserFacingText(input.videoErrorMsg, '成片合成失败，请稍后重试')
      : toOptionalUserFacingText(input.videoErrorMsg, '成片合成失败，请稍后重试'),
    videoDownloadError: input.videoDownloadStatus === 'error'
      ? toUserFacingText(input.videoDownloadError, '成片下载失败，请稍后重试')
      : toOptionalUserFacingText(input.videoDownloadError, '成片下载失败，请稍后重试'),
    deliveryExportFeedback: input.deliveryExportHasError
      ? toUserFacingText(input.deliveryExportFeedback, '导出失败，请稍后重试')
      : toOptionalUserFacingText(input.deliveryExportFeedback, '导出失败，请稍后重试'),
  }
}

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

defineEmits(['generate-video', 'download-video', 'download-subtitle', 'export-project'])

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
  min-height: 58px;
  padding: 9px 12px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.delivery-stat + .delivery-stat {
  border-left: 1px solid var(--el-border-color-lighter);
}
.delivery-stat strong {
  color: var(--el-text-color-primary);
  font-size: 14px;
}
.delivery-guidance {
  margin: 0 0 12px;
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(99, 102, 241, 0.08);
  color: var(--el-text-color-regular);
  font-size: 0.875rem;
  line-height: 1.55;
}
.delivery-guidance p {
  margin: 0;
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
  margin-top: 6px;
  color: var(--el-color-primary);
  text-decoration: underline;
}
.delivery-guidance-link:focus-visible {
  outline: 2px solid #818cf8;
  outline-offset: 2px;
}
.delivery-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
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