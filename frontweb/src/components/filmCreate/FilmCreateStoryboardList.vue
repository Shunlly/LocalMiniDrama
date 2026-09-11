<template>
  <template v-for="(sb, i) in storyboards" :key="sb.id">
    <div
      v-if="sb.segment_title && (i === 0 || sb.segment_index !== storyboards[i - 1].segment_index)"
      class="segment-header"
    >
      <div class="segment-header-inner">
        <span class="segment-index-badge">第 {{ (sb.segment_index ?? 0) + 1 }} 幕</span>
        <span class="segment-title-text">{{ sb.segment_title }}</span>
        <span class="segment-shot-range">
          镜头 {{ i + 1 }}–{{ segmentShotEnd(i) }}
        </span>
      </div>
    </div>
    <FilmCreateStoryboardToolbar
      :sb="sb"
      :i="i"
      :storyboards="storyboards"
      :storyboard-generating="storyboardGenerating"
      :universal-omni-polish-running="universalOmniPolishRunning"
      :storyboard-reorder-busy="storyboardReorderBusy"
      :drop-target-storyboard-index="dropTargetStoryboardIndex"
      :storyboard-move-copies="storyboardMoveCopies"
      :get-movement-label="getMovementLabel"
      :is-sb-universal-mode="isSbUniversalMode"
      :reorder-handle-reason="reorderHandleReason"
      :on-move-storyboard-up="onMoveStoryboardUp"
      :on-move-storyboard-down="onMoveStoryboardDown"
      :on-reorder-drag-start="onReorderDragStart"
      :on-reorder-drag-over="onReorderDragOver"
      :on-reorder-drag-end="onReorderDragEnd"
      :on-reorder-drop="onReorderDrop"
      :on-open-video-params-dialog="onOpenVideoParamsDialog"
      :on-toggle-sb-universal-mode="onToggleSbUniversalMode"
      :on-insert-storyboard-before="onInsertStoryboardBefore"
      :on-delete-single-storyboard="onDeleteSingleStoryboard"
    />
    <div :id="'sb-' + sb.id" class="storyboard-row">
      <FilmCreateStoryboardScriptColumn
        :sb="sb"
        :i="i"
        :characters="characters"
        :scenes="scenes"
        :prop-items="propItems"
        :sb-scene-id="sbSceneId"
        :sb-narration="sbNarration"
        :storyboard-use-first-last-frame="storyboardUseFirstLastFrame"
        :storyboard-include-narration="storyboardIncludeNarration"
        :tts-sb-narration-ids="ttsSbNarrationIds"
        :asset-image-url="assetImageUrl"
        :characters-available-to-add-to-sb="charactersAvailableToAddToSb"
        :get-sb-character-ids="getSbCharacterIds"
        :get-sb-prop-ids="getSbPropIds"
        :get-sb-selected-characters="getSbSelectedCharacters"
        :get-sb-selected-props="getSbSelectedProps"
        :get-sb-selected-scene="getSbSelectedScene"
        :has-asset-image="hasAssetImage"
        :on-open-sb-prompt-dialog="onOpenSbPromptDialog"
        :on-save-sb-narration-field="onSaveSbNarrationField"
        :on-sb-add-character-command="onSbAddCharacterCommand"
        :on-storyboard-scene-change="onStoryboardSceneChange"
        :on-tts-sb-narration="onTtsSbNarration"
        :open-image-preview="openImagePreview"
        :play-sb-narration-tts="playSbNarrationTts"
        :sb-narration-audio-rel-path="sbNarrationAudioRelPath"
        :set-sb-character-ids="setSbCharacterIds"
        :set-sb-prop-ids="setSbPropIds"
        :tts-generation-disabled-reason="ttsGenerationDisabledReason"
      />
      <FilmCreateStoryboardImageColumn
        :sb="sb"
        :i="i"
        v-model:last-frame-use-first-layout-lock="lastFrameUseFirstLayoutLock"
        v-model:drag-over-sb-id="dragOverSbId"
        :sb-universal-segment-text="sbUniversalSegmentText"
        :storyboard-use-first-last-frame="storyboardUseFirstLastFrame"
        :generating-sb-image-ids="generatingSbImageIds"
        :generating-sb-first-image-ids="generatingSbFirstImageIds"
        :generating-sb-last-image-ids="generatingSbLastImageIds"
        :generating-universal-segment-ids="generatingUniversalSegmentIds"
        :using-prev-tail-as-first-ids="usingPrevTailAsFirstIds"
        :upscaling-sb-ids="upscalingSbIds"
        :uploading-sb-image-id="uploadingSbImageId"
        :uploading-sb-image-slot="uploadingSbImageSlot"
        :asset-image-url="assetImageUrl"
        :can-use-prev-tail-as-first="canUsePrevTailAsFirst"
        :get-sb-first-image="getSbFirstImage"
        :get-sb-image="getSbImage"
        :get-sb-last-image="getSbLastImage"
        :get-sb-local-image="getSbLocalImage"
        :get-sb-universal-omni-ref-slots="getSbUniversalOmniRefSlots"
        :get-strip-items="getStripItems"
        :has-sb-draft-image-placeholder="hasSbDraftImagePlaceholder"
        :has-sb-first-last-pair="hasSbFirstLastPair"
        :has-sb-image="hasSbImage"
        :history-image-label="historyImageLabel"
        :is-sb-universal-mode="isSbUniversalMode"
        :storyboard-media-action-reason="storyboardMediaActionReason"
        :on-generate-sb-frame-image="onGenerateSbFrameImage"
        :on-generate-sb-frame-pair="onGenerateSbFramePair"
        :on-generate-sb-image="onGenerateSbImage"
        :on-last-frame-layout-lock-change="onLastFrameLayoutLockChange"
        :on-remove-sb-history-image="onRemoveSbHistoryImage"
        :on-save-universal-segment-field="onSaveUniversalSegmentField"
        :on-sb-image-drag-leave="onSbImageDragLeave"
        :on-sb-image-drag-over="onSbImageDragOver"
        :on-sb-image-drop="onSbImageDrop"
        :on-select-strip-item="onSelectStripItem"
        :on-strip-item-click="onStripItemClick"
        :on-universal-segment-prompt-menu="onUniversalSegmentPromptMenu"
        :on-upload-sb-image-click="onUploadSbImageClick"
        :on-upscale-sb-image="onUpscaleSbImage"
        :on-use-prev-tail-as-first="onUsePrevTailAsFirst"
        :open-image-preview="openImagePreview"
        :sb-universal-segment-trimmed="sbUniversalSegmentTrimmed"
        :show-sb-frame-prompt-preview="showSbFramePromptPreview"
        :storyboard-image-url="storyboardImageUrl"
        :strip-item-title="stripItemTitle"
        :get-sb-free-reference-items="getSbFreeReferenceItems"
        :open-global-media-picker="openGlobalMediaPicker"
        :on-promote-sb-free-reference-image="onPromoteSbFreeReferenceImage"
        :on-remove-sb-free-reference-image="onRemoveSbFreeReferenceImage"
      />
      <FilmCreateStoryboardVideoColumn
        :sb="sb"
        :i="i"
        :linking-tail-frame-ids="linkingTailFrameIds"
        :tts-sb-ids="ttsSbIds"
        :asset-video-url="assetVideoUrl"
        :get-next-storyboard="getNextStoryboard"
        :get-sb-video="getSbVideo"
        :get-sb-video-error="getSbVideoError"
        :get-video-strip-items="getVideoStripItems"
        :is-sb-video-generating="isSbVideoGenerating"
        :on-generate-sb-video="onGenerateSbVideo"
        :on-link-tail-frame-to-next="onLinkTailFrameToNext"
        :on-open-sb-prompt-dialog="onOpenSbPromptDialog"
        :on-select-sb-main-video="onSelectSbMainVideo"
        :on-tts-sb-dialogue="onTtsSbDialogue"
        :play-sb-dialogue-tts="playSbDialogueTts"
        :sb-can-submit-video="sbCanSubmitVideo"
        :sb-dialogue-audio-rel-path="sbDialogueAudioRelPath"
        :sb-main-video-player-key="sbMainVideoPlayerKey"
        :sb-video-generation-disabled-reason="sbVideoGenerationDisabledReason"
        :tts-generation-disabled-reason="ttsGenerationDisabledReason"
        :get-sb-grid-images="getSbGridImages"
        :get-sb-video-reference-grid="getSbVideoReferenceGrid"
        :on-open-video-params="onOpenVideoParamsDialog"
      />
    </div>
  </template>
</template>

<script setup>
import FilmCreateStoryboardImageColumn from '@/components/filmCreate/FilmCreateStoryboardImageColumn.vue'
import FilmCreateStoryboardScriptColumn from '@/components/filmCreate/FilmCreateStoryboardScriptColumn.vue'
import FilmCreateStoryboardToolbar from '@/components/filmCreate/FilmCreateStoryboardToolbar.vue'
import FilmCreateStoryboardVideoColumn from '@/components/filmCreate/FilmCreateStoryboardVideoColumn.vue'

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

  storyboardUseFirstLastFrame: { type: Boolean, default: false },
  storyboardIncludeNarration: { type: Boolean, default: false },
  storyboardReorderBusy: { type: Boolean, default: false },
  dropTargetStoryboardIndex: { type: Number, default: null },
  storyboardMoveCopies: { type: Array, default: () => [] },
  onUploadSbImageClick: { type: Function, required: true },
  onMoveStoryboardUp: { type: Function, required: true },
  onMoveStoryboardDown: { type: Function, required: true },
  onReorderDragStart: { type: Function, required: true },
  onReorderDragOver: { type: Function, required: true },
  onReorderDragEnd: { type: Function, required: true },
  onReorderDrop: { type: Function, required: true },
  reorderHandleReason: { type: Function, required: true },
})

const lastFrameUseFirstLayoutLock = defineModel('lastFrameUseFirstLayoutLock', { type: Boolean, default: false })
const dragOverSbId = defineModel('dragOverSbId', { default: null })

function segmentShotEnd(startIndex) {
  const list = props.storyboards || []
  const segmentIndex = list[startIndex]?.segment_index
  let end = startIndex
  while (end + 1 < list.length && list[end + 1].segment_index === segmentIndex) end++
  return end + 1
}
</script>

<style scoped src="./FilmCreateStoryboardList.css"></style>
