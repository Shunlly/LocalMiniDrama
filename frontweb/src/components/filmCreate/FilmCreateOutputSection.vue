<template>
  <FilmCreateVideoSettingsPanel
    v-model:resolution="resolution"
    v-model:subtitle="subtitle"
    v-model:burn-dialogue="burnDialogue"
    v-model:watermark="watermark"
    v-model:watermark-text="watermarkText"
    :disabled="videoSettingsLocked"
    :disabled-reason="videoSettingsLockedReason"
    @open-ai-config="emit('open-ai-config')"
  />

  <FilmCreateDeliveryPanel
    :playable-storyboard-video-count="playableStoryboardVideoCount"
    :storyboard-count="storyboardCount"
    :delivery-composite-status-label="deliveryCompositeStatusLabel"
    :delivery-file-count="deliveryFileCount"
    :compose-action-disabled-reason="visibleComposeActionDisabledReason"
    :video-status="videoStatus"
    :video-progress="videoProgress"
    :current-episode-video-url="currentEpisodeVideoUrl"
    :video-download-status="videoDownloadStatus"
    :video-download-error="visibleVideoDownloadError"
    :current-episode-id="currentEpisodeId"
    :delivery-subtitle-available="deliverySubtitleAvailable"
    :drama-id="dramaId"
    :delivery-export-status="deliveryExportStatus"
    :video-error-msg="visibleVideoErrorMsg"
    :delivery-export-feedback="visibleDeliveryExportFeedback"
    :delivery-export-has-error="deliveryExportHasError"
    @generate-video="emit('generate-video')"
    @download-video="emit('download-video')"
    @download-subtitle="emit('download-subtitle')"
    @export-project="emit('export-project')"
  />

  <p
    v-if="failureNextStep"
    class="delivery-failure-next"
    role="status"
    aria-live="polite"
  >
    {{ failureNextStep }}
  </p>
</template>

<script setup>
import { computed } from 'vue'
import FilmCreateDeliveryPanel from '@/components/filmCreate/FilmCreateDeliveryPanel.vue'
import FilmCreateVideoSettingsPanel from '@/components/filmCreate/FilmCreateVideoSettingsPanel.vue'

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

function toOutputUserFacingText(value, fallback = '操作失败，请稍后重试') {
  const text = String(value || '').trim()
  const safeFallback = String(fallback || '操作失败，请稍后重试')
  const technicalEnglish = /network error|http\s*error|failed to fetch|fetch failed|internal server error|econnrefused|err_network|status code|axioserror/i
  if (!text) return safeFallback
  if (technicalEnglish.test(text) || !/[\u4e00-\u9fff]/.test(text)) return safeFallback
  return text
}

function toOutputDisabledReasonText(value, fallback = '当前不可用') {
  const text = String(value || '').trim()
  if (!text) return ''
  return toOutputUserFacingText(text, fallback)
}

function describeOutputVideoSettingsLock(input = {}) {
  const composeReason = String(input.composeActionDisabledReason || '').trim()
  const technicalEnglish = /network error|http\s*error|failed to fetch|fetch failed|internal server error|econnrefused|err_network|status code|axioserror/i
  const safeComposeReason = !composeReason
    ? ''
    : ((technicalEnglish.test(composeReason) || !/[\u4e00-\u9fff]/.test(composeReason))
      ? ''
      : composeReason)
  const busyLock = /正在|请等待|请先暂停|请先停止/.test(safeComposeReason)
    && !/^请先(?:创建|生成或添加|为全部)/.test(safeComposeReason)
  if (input.videoStatus === 'generating') {
    return busyLock ? safeComposeReason : '正在合成视频，请等待当前任务完成'
  }
  return busyLock ? safeComposeReason : ''
}

function describeDeliveryOutputNextStep(input = {}) {
  if (input.videoDownloadStatus === 'error') {
    return '成片下载失败后，可继续点「重试下载」，已合成的成片不会被覆盖。'
  }
  if (input.deliveryExportStatus?.subtitle === 'error') {
    return '字幕导出失败后，可继续点「重试字幕」。'
  }
  if (input.deliveryExportStatus?.project === 'error') {
    return '项目包导出失败后，可继续点「重试项目包」。'
  }
  if (input.videoStatus === 'error') {
    return '成片合成失败后，可检查分镜视频是否齐全，再点「合成成片」重试。'
  }
  return ''
}

function describeOutputDeliveryMessages(input = {}) {
  const composeActionDisabledReason = toOutputDisabledReasonText(
    input.composeActionDisabledReason,
    '当前不能合成成片',
  )
  const videoErrorMsg = input.videoStatus === 'error'
    ? toOutputUserFacingText(input.videoErrorMsg, '成片合成失败，请稍后重试')
    : (String(input.videoErrorMsg || '').trim()
      ? toOutputUserFacingText(input.videoErrorMsg, '成片合成失败，请稍后重试')
      : '')
  const videoDownloadError = input.videoDownloadStatus === 'error'
    ? toOutputUserFacingText(input.videoDownloadError, '成片下载失败，请稍后重试')
    : (String(input.videoDownloadError || '').trim()
      ? toOutputUserFacingText(input.videoDownloadError, '成片下载失败，请稍后重试')
      : '')
  const deliveryExportFeedback = input.deliveryExportHasError
    ? toOutputUserFacingText(input.deliveryExportFeedback, '导出失败，请稍后重试')
    : (String(input.deliveryExportFeedback || '').trim()
      ? toOutputUserFacingText(input.deliveryExportFeedback, '导出失败，请稍后重试')
      : '')
  return {
    composeActionDisabledReason,
    videoErrorMsg,
    videoDownloadError,
    deliveryExportFeedback,
    failureNextStep: describeDeliveryOutputNextStep(input),
  }
}

const resolution = defineModel('resolution', { type: String, default: '720p' })
const subtitle = defineModel('subtitle', { type: Boolean, default: false })
const burnDialogue = defineModel('burnDialogue', { type: Boolean, default: false })
const watermark = defineModel('watermark', { type: Boolean, default: false })
const watermarkText = defineModel('watermarkText', { type: String, default: '' })

const videoSettingsLockedReason = computed(() => describeOutputVideoSettingsLock(props))
const videoSettingsLocked = computed(() => Boolean(videoSettingsLockedReason.value))
const outputMessages = computed(() => describeOutputDeliveryMessages(props))
const visibleComposeActionDisabledReason = computed(() => outputMessages.value.composeActionDisabledReason)
const visibleVideoErrorMsg = computed(() => outputMessages.value.videoErrorMsg)
const visibleVideoDownloadError = computed(() => outputMessages.value.videoDownloadError)
const visibleDeliveryExportFeedback = computed(() => outputMessages.value.deliveryExportFeedback)
const failureNextStep = computed(() => outputMessages.value.failureNextStep)

const emit = defineEmits([
  'open-ai-config',
  'generate-video',
  'download-video',
  'download-subtitle',
  'export-project',
])
</script>

<style scoped>
.delivery-failure-next {
  margin: 10px 0 0;
  color: var(--el-color-danger);
  font-size: 0.875rem;
  line-height: 1.5;
}
</style>