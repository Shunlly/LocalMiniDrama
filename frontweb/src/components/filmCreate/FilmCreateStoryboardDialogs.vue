<template>
  <div class="film-create-storyboard-dialogs">
    <FilmCreateStoryboardPromptDialog
      v-model:show-sb-prompt-dialog="showSbPromptDialog"
      v-model:sb-prompt-target="sbPromptTarget"
      v-model:sb-prompt-image-text="sbPromptImageText"
      v-model:sb-prompt-polished-text="sbPromptPolishedText"
      v-model:sb-prompt-video-text="sbPromptVideoText"
      :sb-prompt-polishing="sbPromptPolishing"
      :sb-prompt-saving="sbPromptSaving"
      :on-polish-sb-prompt="onPolishSbPrompt"
      :on-save-sb-prompt-dialog="onSaveSbPromptDialog"
    />
    <FilmCreateStoryboardFramePromptDialog
      v-model:show-frame-prompt-editor="showFramePromptEditor"
      v-model:editing-frame-prompt-text="editingFramePromptText"
      :editing-frame-prompt-regenerating="editingFramePromptRegenerating"
      :editing-frame-prompt-saving="editingFramePromptSaving"
      :editing-frame-prompt-sb="editingFramePromptSb"
      :editing-frame-prompt-slot="editingFramePromptSlot"
      :regenerate-editing-frame-prompt="regenerateEditingFramePrompt"
      :save-editing-frame-prompt="saveEditingFramePrompt"
    />
    <FilmCreateStoryboardVideoParamsDialog
      v-model:show-video-params-dialog="showVideoParamsDialog"
      :regenerating-layout-sb-ids="regeneratingLayoutSbIds"
      :sb-action="sbAction"
      :sb-angle-h="sbAngleH"
      :sb-angle-s="sbAngleS"
      :sb-angle-v="sbAngleV"
      :sb-atmosphere="sbAtmosphere"
      :sb-creation-mode="sbCreationMode"
      :sb-dialogue="sbDialogue"
      :sb-dof="sbDof"
      :sb-duration="sbDuration"
      :sb-layout-description="sbLayoutDescription"
      :sb-lighting="sbLighting"
      :sb-location="sbLocation"
      :sb-movement="sbMovement"
      :sb-narration="sbNarration"
      :sb-result="sbResult"
      :sb-shot-type="sbShotType"
      :sb-time="sbTime"
      :sb-title="sbTitle"
      :sb-video-reference-image-id="sbVideoReferenceImageId"
      :split-by-audio-loading="splitByAudioLoading"
      :video-params-saving="videoParamsSaving"
      :video-params-target="videoParamsTarget"
      :angle-to-prompt-fragment="angleToPromptFragment"
      :asset-image-url="assetImageUrl"
      :can-split-sb-by-audio="canSplitSbByAudio"
      :get-sb-free-reference-items="getSbFreeReferenceItems"
      :get-sb-grid-images="getSbGridImages"
      :on-promote-sb-free-reference-image="onPromoteSbFreeReferenceImage"
      :on-regenerate-layout-description="onRegenerateLayoutDescription"
      :on-remove-sb-free-reference-image="onRemoveSbFreeReferenceImage"
      :on-save-video-params="onSaveVideoParams"
      :on-split-sb-by-audio="onSplitSbByAudio"
      :on-video-params-dialog-closed="onVideoParamsDialogClosed"
      :open-global-media-picker="openGlobalMediaPicker"
      :open-image-preview="openImagePreview"
      :set-sb-creation-mode-id="setSbCreationModeId"
    />
  </div>
</template>

<script setup>
import FilmCreateStoryboardFramePromptDialog from './FilmCreateStoryboardFramePromptDialog.vue'
import FilmCreateStoryboardPromptDialog from './FilmCreateStoryboardPromptDialog.vue'
import FilmCreateStoryboardVideoParamsDialog from './FilmCreateStoryboardVideoParamsDialog.vue'

defineOptions({ inheritAttrs: false })

defineProps({
  editingFramePromptRegenerating: { type: Boolean, default: false },
  editingFramePromptSaving: { type: Boolean, default: false },
  editingFramePromptSb: { type: Object, default: null },
  editingFramePromptSlot: { type: String, default: 'first' },
  regeneratingLayoutSbIds: { type: [Set, Object], default: () => new Set() },
  sbAction: { type: Object, default: () => ({}) },
  sbAngleH: { type: Object, default: () => ({}) },
  sbAngleS: { type: Object, default: () => ({}) },
  sbAngleV: { type: Object, default: () => ({}) },
  sbAtmosphere: { type: Object, default: () => ({}) },
  sbCreationMode: { type: Object, default: () => ({}) },
  sbDialogue: { type: Object, default: () => ({}) },
  sbDof: { type: Object, default: () => ({}) },
  sbDuration: { type: Object, default: () => ({}) },
  sbLayoutDescription: { type: Object, default: () => ({}) },
  sbLighting: { type: Object, default: () => ({}) },
  sbLocation: { type: Object, default: () => ({}) },
  sbMovement: { type: Object, default: () => ({}) },
  sbNarration: { type: Object, default: () => ({}) },
  sbPromptPolishing: { type: Boolean, default: false },
  sbPromptSaving: { type: Boolean, default: false },
  sbResult: { type: Object, default: () => ({}) },
  sbShotType: { type: Object, default: () => ({}) },
  sbTime: { type: Object, default: () => ({}) },
  sbTitle: { type: Object, default: () => ({}) },
  sbVideoReferenceImageId: { type: Object, default: () => ({}) },
  splitByAudioLoading: { type: Boolean, default: false },
  videoParamsSaving: { type: Boolean, default: false },
  videoParamsTarget: { type: Object, default: null },
  angleToPromptFragment: { type: Function, required: true },
  assetImageUrl: { type: Function, required: true },
  canSplitSbByAudio: { type: Function, required: true },
  getSbFreeReferenceItems: { type: Function, required: true },
  getSbGridImages: { type: Function, required: true },
  onPolishSbPrompt: { type: Function, required: true },
  onPromoteSbFreeReferenceImage: { type: Function, required: true },
  onRegenerateLayoutDescription: { type: Function, required: true },
  onRemoveSbFreeReferenceImage: { type: Function, required: true },
  onSaveSbPromptDialog: { type: Function, required: true },
  onSaveVideoParams: { type: Function, required: true },
  onSplitSbByAudio: { type: Function, required: true },
  onVideoParamsDialogClosed: { type: Function, required: true },
  openGlobalMediaPicker: { type: Function, required: true },
  openImagePreview: { type: Function, required: true },
  regenerateEditingFramePrompt: { type: Function, required: true },
  saveEditingFramePrompt: { type: Function, required: true },
  setSbCreationModeId: { type: Function, required: true },
})

const sbPromptTarget = defineModel('sbPromptTarget', { type: Object, default: null })
const showSbPromptDialog = defineModel('showSbPromptDialog', { type: Boolean, default: false })
const showFramePromptEditor = defineModel('showFramePromptEditor', { type: Boolean, default: false })
const showVideoParamsDialog = defineModel('showVideoParamsDialog', { type: Boolean, default: false })
const editingFramePromptText = defineModel('editingFramePromptText', { type: String, default: '' })
const sbPromptImageText = defineModel('sbPromptImageText', { type: String, default: '' })
const sbPromptPolishedText = defineModel('sbPromptPolishedText', { type: String, default: '' })
const sbPromptVideoText = defineModel('sbPromptVideoText', { type: String, default: '' })
</script>
