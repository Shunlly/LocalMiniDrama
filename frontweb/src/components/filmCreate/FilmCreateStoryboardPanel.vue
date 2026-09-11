<template>
  <div class="film-create-storyboard-root">
      <input
        ref="sbImageFileInput"
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp"
        style="display: none"
        tabindex="-1"
        aria-hidden="true"
        @change="onSbImageFileChange"
      />
      <!-- 分镜生成 -->
      <section id="anchor-storyboard" class="section card">
        <h2 class="section-title">
          <span>分镜生成</span>
          <span class="step-desc">根据剧本、角色、场景自动生成分镜头脚本</span>
        </h2>
        <FilmCreateStoryboardConfigBar
          v-model:storyboard-count="storyboardCount"
          v-model:video-duration="videoDuration"
          v-model:grid-mode="gridMode"
          v-model:storyboard-use-first-last-frame="storyboardUseFirstLastFrame"
          v-model:storyboard-universal-omni="storyboardUniversalOmni"
          v-model:storyboard-include-narration="storyboardIncludeNarration"
          v-model:video-frame-contiguity="videoFrameContiguity"
          v-model:batch-image-stopping="batchImageStopping"
          v-model:batch-video-stopping="batchVideoStopping"
          :storyboards="storyboards"
          :storyboard-generating="storyboardGenerating"
          :universal-omni-polish-running="universalOmniPolishRunning"
          :exporting-storyboard-sheet="exportingStoryboardSheet"
          :batch-image-running="batchImageRunning"
          :batch-video-running="batchVideoRunning"
          :storyboard-action-disabled-reason="storyboardActionDisabledReason"
          :episode-action-disabled-reason="episodeActionDisabledReason"
          :batch-action-disabled-reason="batchActionDisabledReason"
          :batch-video-action-disabled-reason="batchVideoActionDisabledReason"
          :video-capability-reason="videoCapabilityReason"
          :script-estimate-storyboard-hint="scriptEstimateStoryboardHint"
          :script-estimate-storyboard-title="scriptEstimateStoryboardTitle"
          :script-estimate-video-duration-hint="scriptEstimateVideoDurationHint"
          :script-estimate-video-duration-title="scriptEstimateVideoDurationTitle"
          :on-add-single-storyboard="onAddSingleStoryboard"
          :on-export-narration-srt="onExportNarrationSrt"
          :on-export-storyboard-sheet="onExportStoryboardSheet"
          :on-generate-storyboard="onGenerateStoryboard"
          :on-storyboard-use-first-last-frame-change="onStoryboardUseFirstLastFrameChange"
          :open-ai-config="openAiConfig"
          :start-batch-image-generation="startBatchImageGeneration"
          :start-batch-video-generation="startBatchVideoGeneration"
          @save-settings="emit('save-settings')"
        />
        <FilmCreateStoryboardStatusStrip
          v-model:sb-truncated-dismissed="sbTruncatedDismissed"
          :batch-image-running="batchImageRunning"
          :batch-video-running="batchVideoRunning"
          :batch-image-errors="batchImageErrors"
          :batch-video-errors="batchVideoErrors"
          :batch-image-progress="batchImageProgress"
          :batch-video-progress="batchVideoProgress"
          :batch-image-stopping="batchImageStopping"
          :batch-video-stopping="batchVideoStopping"
          :storyboard-generating="storyboardGenerating"
          :universal-omni-polish-running="universalOmniPolishRunning"
          :universal-omni-polish-progress="universalOmniPolishProgress"
          :sb-truncated-warning="sbTruncatedWarning"
          :storyboards="storyboards"
        />
        <FilmCreateStoryboardList
          v-if="storyboards.length > 0"
          v-bind="props"
          v-model:last-frame-use-first-layout-lock="lastFrameUseFirstLayoutLock"
          v-model:drag-over-sb-id="dragOverSbId"
          :grid-mode="gridMode"
          :storyboard-use-first-last-frame="storyboardUseFirstLastFrame"
          :storyboard-include-narration="storyboardIncludeNarration"
          :storyboard-reorder-busy="storyboardReorderBusy"
          :drop-target-storyboard-index="dropTargetStoryboardIndex"
          :storyboard-move-copies="storyboardMoveCopies"
          :on-upload-sb-image-click="onUploadSbImageClick"
          :on-move-storyboard-up="onMoveStoryboardUp"
          :on-move-storyboard-down="onMoveStoryboardDown"
          :on-reorder-drag-start="onReorderDragStart"
          :on-reorder-drag-over="onReorderDragOver"
          :on-reorder-drag-end="onReorderDragEnd"
          :on-reorder-drop="onReorderDrop"
          :reorder-handle-reason="reorderHandleReason"
        />
        <div v-if="storyboardGenerating || universalOmniPolishRunning" class="sb-generating-tip">
          <span class="sb-gen-dot" /><span class="sb-gen-dot" /><span class="sb-gen-dot" />
          <span v-if="universalOmniPolishRunning" class="sb-gen-text">
            全能片段润色中 {{ universalOmniPolishProgress.current }}/{{ universalOmniPolishProgress.total }}
            <template v-if="universalOmniPolishProgress.label"> · {{ universalOmniPolishProgress.label }}</template>
          </span>
          <span v-else class="sb-gen-text">分镜持续生成中，请稍候…</span>
        </div>
        <FilmCreateStoryboardEmptyState
          v-else-if="storyboards.length === 0"
          :has-any-episode="hasAnyEpisode"
          :storyboard-generating="storyboardGenerating"
          :universal-omni-polish-running="universalOmniPolishRunning"
          :storyboard-action-disabled-reason="storyboardActionDisabledReason"
          :episode-action-disabled-reason="episodeActionDisabledReason"
          :on-generate-storyboard="onGenerateStoryboard"
          :on-add-single-storyboard="onAddSingleStoryboard"
          :on-add-episode="onAddEpisode"
        />
      </section>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { storyboardsAPI } from '@/api/storyboards'
import { storyboardMoveButtonCopy, storyboardMoveDisabledReason, useFilmCreateStoryboardReorder } from '@/composables/filmCreate/useFilmCreateStoryboardReorder'
import FilmCreateStoryboardConfigBar from '@/components/filmCreate/FilmCreateStoryboardConfigBar.vue'
import FilmCreateStoryboardEmptyState from '@/components/filmCreate/FilmCreateStoryboardEmptyState.vue'
import FilmCreateStoryboardList from '@/components/filmCreate/FilmCreateStoryboardList.vue'
import FilmCreateStoryboardStatusStrip from '@/components/filmCreate/FilmCreateStoryboardStatusStrip.vue'

defineOptions({ inheritAttrs: false })

const props = defineProps({
  storyboards: { type: Array, default: () => [] },
  storyboardsAPI: { type: Object, default: null },
  characters: { type: Array, default: () => [] },
  scenes: { type: Array, default: () => [] },
  propItems: { type: Array, default: () => [] },
  sbSceneId: { type: Object, default: () => ({}) },
  sbNarration: { type: Object, default: () => ({}) },
  sbUniversalSegmentText: { type: Object, default: () => ({}) },
  batchImageErrors: { type: Array, default: () => [] },
  batchVideoErrors: { type: Array, default: () => [] },
  batchImageProgress: { type: Object, default: () => ({}) },
  batchVideoProgress: { type: Object, default: () => ({}) },
  generatingSbImageIds: { type: [Set, Object], default: () => new Set() },
  generatingSbFirstImageIds: { type: [Set, Object], default: () => new Set() },
  generatingSbLastImageIds: { type: [Set, Object], default: () => new Set() },
  generatingUniversalSegmentIds: { type: [Set, Object], default: () => new Set() },
  linkingTailFrameIds: { type: [Set, Object], default: () => new Set() },
  usingPrevTailAsFirstIds: { type: [Set, Object], default: () => new Set() },
  ttsSbIds: { type: [Set, Object], default: () => new Set() },
  ttsSbNarrationIds: { type: [Set, Object], default: () => new Set() },
  upscalingSbIds: { type: [Set, Object], default: () => new Set() },
  universalOmniPolishProgress: { type: Object, default: () => ({ current: 0, total: 0, label: '' }) },
  hasAnyEpisode: { type: Boolean, default: false },
  currentEpisodeId: { type: [Number, String, null], default: null },
  storyboardGenerating: { type: Boolean, default: false },
  universalOmniPolishRunning: { type: Boolean, default: false },
  exportingStoryboardSheet: { type: Boolean, default: false },
  batchImageRunning: { type: Boolean, default: false },
  batchVideoRunning: { type: Boolean, default: false },
  sbTruncatedWarning: { type: Boolean, default: false },
  uploadingSbImageId: { type: [Number, String, null], default: null },
  uploadingSbImageSlot: { type: Function, required: true },
  storyboardActionDisabledReason: { type: String, default: '' },
  episodeActionDisabledReason: { type: String, default: '' },
  batchActionDisabledReason: { type: String, default: '' },
  storyboardMediaActionReason: { type: String, default: '' },
  batchVideoActionDisabledReason: { type: String, default: '' },
  videoCapabilityReason: { type: String, default: '' },
  scriptEstimateStoryboardHint: { type: String, default: '' },
  scriptEstimateStoryboardTitle: { type: String, default: '' },
  scriptEstimateVideoDurationHint: { type: String, default: '' },
  scriptEstimateVideoDurationTitle: { type: String, default: '' },
  assetImageUrl: { type: Function, required: true },
  assetVideoUrl: { type: Function, required: true },
  canUsePrevTailAsFirst: { type: Function, required: true },
  charactersAvailableToAddToSb: { type: Function, required: true },
  getMovementLabel: { type: Function, required: true },
  getNextStoryboard: { type: Function, required: true },
  getSbCharacterIds: { type: Function, required: true },
  getSbFirstImage: { type: Function, required: true },
  getSbImage: { type: Function, required: true },
  getSbLastImage: { type: Function, required: true },
  getSbLocalImage: { type: Function, required: true },
  getSbPropIds: { type: Function, required: true },
  getSbSelectedCharacters: { type: Function, required: true },
  getSbSelectedProps: { type: Function, required: true },
  getSbSelectedScene: { type: Function, required: true },
  getSbUniversalOmniRefSlots: { type: Function, required: true },
  getSbVideo: { type: Function, required: true },
  getSbVideoError: { type: Function, required: true },
  getStripItems: { type: Function, required: true },
  getVideoStripItems: { type: Function, required: true },
  hasAssetImage: { type: Function, required: true },
  hasSbDraftImagePlaceholder: { type: Function, required: true },
  hasSbFirstLastPair: { type: Function, required: true },
  hasSbImage: { type: Function, required: true },
  historyImageLabel: { type: Function, required: true },
  isSbUniversalMode: { type: Function, required: true },
  isSbVideoGenerating: { type: Function, required: true },
  onAddEpisode: { type: Function, default: () => {} },
  onAddSingleStoryboard: { type: Function, required: true },
  onDeleteSingleStoryboard: { type: Function, required: true },
  onExportNarrationSrt: { type: Function, required: true },
  onExportStoryboardSheet: { type: Function, required: true },
  onGenerateSbFrameImage: { type: Function, required: true },
  onGenerateSbFramePair: { type: Function, required: true },
  onGenerateSbImage: { type: Function, required: true },
  onGenerateSbVideo: { type: Function, required: true },
  onGenerateStoryboard: { type: Function, required: true },
  onInsertStoryboardBefore: { type: Function, required: true },
  onLastFrameLayoutLockChange: { type: Function, required: true },
  onLinkTailFrameToNext: { type: Function, required: true },
  onOpenSbPromptDialog: { type: Function, required: true },
  onOpenVideoParamsDialog: { type: Function, required: true },
  onRemoveSbHistoryImage: { type: Function, required: true },
  onSaveSbNarrationField: { type: Function, required: true },
  onSaveUniversalSegmentField: { type: Function, required: true },
  onSbAddCharacterCommand: { type: Function, required: true },
  onSbImageDragLeave: { type: Function, required: true },
  onSbImageDragOver: { type: Function, required: true },
  onSbImageDrop: { type: Function, required: true },
  onSelectSbMainVideo: { type: Function, required: true },
  onSelectStripItem: { type: Function, required: true },
  onStoryboardSceneChange: { type: Function, required: true },
  onStoryboardUseFirstLastFrameChange: { type: Function, required: true },
  onStripItemClick: { type: Function, required: true },
  onToggleSbUniversalMode: { type: Function, required: true },
  onTtsSbDialogue: { type: Function, required: true },
  onTtsSbNarration: { type: Function, required: true },
  onUniversalSegmentPromptMenu: { type: Function, required: true },
  prepareSbImageUpload: { type: Function, required: true },
  onUpscaleSbImage: { type: Function, required: true },
  onUsePrevTailAsFirst: { type: Function, required: true },
  openAiConfig: { type: Function, required: true },
  openImagePreview: { type: Function, required: true },
  playSbDialogueTts: { type: Function, required: true },
  playSbNarrationTts: { type: Function, required: true },
  sbCanSubmitVideo: { type: Function, required: true },
  sbDialogueAudioRelPath: { type: Function, required: true },
  sbMainVideoPlayerKey: { type: Function, required: true },
  sbNarrationAudioRelPath: { type: Function, required: true },
  sbUniversalSegmentTrimmed: { type: Function, required: true },
  sbVideoGenerationDisabledReason: { type: Function, required: true },
  setSbCharacterIds: { type: Function, required: true },
  setSbPropIds: { type: Function, required: true },
  showSbFramePromptPreview: { type: Function, required: true },
  startBatchImageGeneration: { type: Function, required: true },
  startBatchVideoGeneration: { type: Function, required: true },
  storyboardImageUrl: { type: Function, required: true },
  stripItemTitle: { type: Function, required: true },
  ttsGenerationDisabledReason: { type: Function, required: true },
  getSbFreeReferenceItems: { type: Function, default: (sb) => [] },
  openGlobalMediaPicker: { type: Function, default: () => {} },
  onPromoteSbFreeReferenceImage: { type: Function, default: () => {} },
  onRemoveSbFreeReferenceImage: { type: Function, default: () => {} },
  getSbGridImages: { type: Function, default: undefined },
  getSbVideoReferenceGrid: { type: Function, default: undefined },
})

const storyboardCount = defineModel('storyboardCount', { type: Number, default: null })
const videoDuration = defineModel('videoDuration', { type: Number, default: null })
const gridMode = defineModel('gridMode', { type: String, default: 'single' })
const storyboardUseFirstLastFrame = defineModel('storyboardUseFirstLastFrame', { type: Boolean, default: false })
const storyboardUniversalOmni = defineModel('storyboardUniversalOmni', { type: Boolean, default: false })
const storyboardIncludeNarration = defineModel('storyboardIncludeNarration', { type: Boolean, default: false })
const lastFrameUseFirstLayoutLock = defineModel('lastFrameUseFirstLayoutLock', { type: Boolean, default: false })
const videoFrameContiguity = defineModel('videoFrameContiguity', { type: Boolean, default: false })
const sbTruncatedDismissed = defineModel('sbTruncatedDismissed', { type: Boolean, default: false })
const batchImageStopping = defineModel('batchImageStopping', { type: Boolean, default: false })
const batchVideoStopping = defineModel('batchVideoStopping', { type: Boolean, default: false })
const dragOverSbId = defineModel('dragOverSbId', { default: null })

const emit = defineEmits(['save-settings', 'upload-sb-image'])
const sbImageFileInput = ref(null)
const pendingSbUpload = ref(null)
const {
  storyboardReorderBusy,
  dropTargetStoryboardIndex,
  onMoveStoryboardUp,
  onMoveStoryboardDown,
  onReorderDragStart,
  onReorderDragOver,
  onReorderDragEnd,
  onReorderDrop,
} = useFilmCreateStoryboardReorder({
  getList: () => props.storyboards || [],
  getStoryboardsAPI: () => props.storyboardsAPI || storyboardsAPI,
  isBlocked: () => props.storyboardGenerating || props.universalOmniPolishRunning,
})

function moveReasonState() {
  return {
    length: (props.storyboards || []).length,
    generating: props.storyboardGenerating,
    polishing: props.universalOmniPolishRunning,
    busy: storyboardReorderBusy.value,
  }
}
function moveStoryboardUpReason(index) {
  return storyboardMoveDisabledReason({ ...moveReasonState(), index, offset: -1 })
}
function moveStoryboardDownReason(index) {
  return storyboardMoveDisabledReason({ ...moveReasonState(), index, offset: 1 })
}
function reorderHandleReason() {
  return storyboardMoveDisabledReason({ ...moveReasonState(), index: 1, offset: 0 })
}
const storyboardMoveCopies = computed(() =>
  (props.storyboards || []).map((_, index) => ({
    up: storyboardMoveButtonCopy({ actionLabel: '上移', index, reason: moveStoryboardUpReason(index) }),
    down: storyboardMoveButtonCopy({ actionLabel: '下移', index, reason: moveStoryboardDownReason(index) }),
  })),
)

function onUploadSbImageClick(sb, slot = 'first') {
  if (!sb?.id) return
  pendingSbUpload.value = { sbId: sb.id, slot }
  props.prepareSbImageUpload(sb, slot)
  if (sbImageFileInput.value) {
    sbImageFileInput.value.value = ''
    sbImageFileInput.value.click()
  }
}

function onSbImageFileChange(ev) {
  const file = ev.target?.files?.[0]
  const pending = pendingSbUpload.value
  ev.target.value = ''
  pendingSbUpload.value = null
  if (!file || !pending?.sbId) return
  emit('upload-sb-image', pending.sbId, file, pending.slot)
}
</script>

<style scoped src="./FilmCreateStoryboardPanel.css"></style>
