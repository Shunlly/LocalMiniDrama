<template>
  <FilmCreateResourceDialogs ref="resourceDialogsRef" v-bind="resourceDialogs" />
  <FilmCreateStoryboardDialogs v-bind="storyboardDialogs" />
  <FilmCreateNovelImportDialog
    v-model:visible="visible"
    v-model:mode="mode"
    v-model:text="text"
    v-model:max-chapters="maxChapters"
    v-model:ai-summarize="aiSummarize"
    :file-name="fileName"
    :importing="importing"
    @reset="emit('reset')"
    @file-change="emit('file-change', $event)"
    @import="emit('import')"
  />

  <FilmCreateAiConfigDialog
    ref="aiConfigDialogRef"
    v-model="showAiConfigDialog"
    :initial-service-type="initialServiceType"
    :before-close="beforeClose"
    @back="emit('back')"
    @configuration-changed="emit('configuration-changed')"
  />

  <ImagePreviewDialog
    :model-value="Boolean(previewImageUrl)"
    :src="previewImageUrl || ''"
    title="制作资源图片预览"
    @update:model-value="(visible) => { if (!visible) emit('close-image-preview') }"
  />
  <GlobalMediaPickerDialog
    v-model="showGlobalMediaPicker"
    :title="globalMediaPickerTitle"
    :accept="globalMediaPickerAccept"
    :context="globalMediaPickerContext"
    @select="emit('select', $event)"
    @open-library="emit('open-library')"
  />
</template>

<script setup>
import { ref } from 'vue'
import FilmCreateAiConfigDialog from '@/components/filmCreate/FilmCreateAiConfigDialog.vue'
import FilmCreateNovelImportDialog from '@/components/filmCreate/FilmCreateNovelImportDialog.vue'
import FilmCreateResourceDialogs from '@/components/filmCreate/FilmCreateResourceDialogs.vue'
import FilmCreateStoryboardDialogs from '@/components/filmCreate/FilmCreateStoryboardDialogs.vue'
import GlobalMediaPickerDialog from '@/components/GlobalMediaPickerDialog.vue'
import ImagePreviewDialog from '@/components/ImagePreviewDialog.vue'

defineProps({
  resourceDialogs: { type: Object, required: true },
  storyboardDialogs: { type: Object, required: true },
  fileName: { type: String, default: '' },
  importing: { type: Boolean, default: false },
  initialServiceType: { type: String, default: '' },
  beforeClose: { type: Function, default: undefined },
  previewImageUrl: { type: String, default: '' },
  globalMediaPickerTitle: { type: String, default: '' },
  globalMediaPickerAccept: { type: String, default: '' },
  globalMediaPickerContext: { type: Object, default: null },
})

const visible = defineModel('visible', { type: Boolean, default: false })
const mode = defineModel('mode', { type: String, default: 'text' })
const text = defineModel('text', { type: String, default: '' })
const maxChapters = defineModel('maxChapters', { type: Number, default: 10 })
const aiSummarize = defineModel('aiSummarize', { type: Boolean, default: false })
const showAiConfigDialog = defineModel({ type: Boolean, default: false })
const showGlobalMediaPicker = defineModel('showGlobalMediaPicker', { type: Boolean, default: false })

const emit = defineEmits([
  'reset',
  'file-change',
  'import',
  'back',
  'configuration-changed',
  'close-image-preview',
  'select',
  'open-library',
])

const aiConfigDialogRef = ref(null)
const resourceDialogsRef = ref(null)

defineExpose({
  requestClose: (...args) => aiConfigDialogRef.value?.requestClose?.(...args),
  hasUnsavedChanges: (...args) => aiConfigDialogRef.value?.hasUnsavedChanges?.(...args),
  hasUnsavedResourceEditors: () => Boolean(resourceDialogsRef.value?.hasUnsaved?.()),
  confirmResourceEditorLeave: (...args) => resourceDialogsRef.value?.confirmLeave?.(...args),
})
</script>
