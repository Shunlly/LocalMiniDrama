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
import {
  describeOutputDeliveryMessages,
  describeOutputVideoSettingsLock,
} from '@/components/filmCreate/filmCreateOutputSectionCopy.js'

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