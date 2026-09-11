<template>
  <div class="free-create-page">
    <FreeCreateHeader @go-back="goBack" />

    <div class="create-layout">
      <FreeCreateInputPanel
        ref="inputPanelRef"
        v-model:mode="mode"
        v-model:prompt="prompt"
        v-model:style="style"
        v-model:aspect-ratio="aspectRatio"
        v-model:duration="duration"
        :generation-capability="generationCapability"
        :active-service-label="activeServiceLabel"
        :aspect-ratio-options="aspectRatioOptions"
        :ref-image-upload-status="refImageUploadStatus"
        :ref-image-data-url="refImageDataUrl"
        :ref-image-file-name="refImageFileName"
        :ref-image-trigger-label="refImageTriggerLabel"
        :ref-image-upload-message="refImageUploadMessage"
        :generating="generating"
        :generate-disabled="generateDisabled"
        :generate-disabled-reason="generateDisabledReason"
        :result-busy-disabled-reason="resultBusyDisabledReason"
        @load-service-configs="loadServiceConfigs"
        @open-ai-config="openAiConfig"
        @generate="generate"
        @trigger-ref-image-upload="triggerRefImageUpload"
        @ref-image-drop="onRefImageDrop"
        @ref-image-change="onRefImageChange"
        @retry-ref-image-upload="retryRefImageUpload"
        @clear-ref-image="clearRefImage"
      />

      <FreeCreateResultPanel
        :results="results"
        :generating="generating"
        :cancelling="cancelling"
        :mode="mode"
        :empty-result-copy="emptyResultCopy"
        :generation-capability="generationCapability"
        :result-busy-disabled-reason="resultBusyDisabledReason"
        :result-image-alt="resultImageAlt"
        :can-retry-item="canRetryItem"
        :save-item-disabled-reason="saveItemDisabledReason"
        :save-item-aria-label="saveItemAriaLabel"
        @clear-results="clearResults"
        @load-service-configs="loadServiceConfigs"
        @open-ai-config="openAiConfig"
        @cancel-generation="cancelGeneration"
        @retry-generation="retryGeneration"
        @download-item="downloadItem"
        @preview-image="openImagePreview"
        @save-item="saveItemToAssets"
      />
    </div>

    <ImagePreviewDialog
      v-model="showImagePreview"
      :src="previewImage.src"
      :alt="previewImage.alt"
    />
  </div>
</template>

<script setup>
import { inject, onBeforeUnmount, onMounted, ref } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import ImagePreviewDialog from '@/components/ImagePreviewDialog.vue'
import FreeCreateHeader from '@/components/freeCreate/FreeCreateHeader.vue'
import FreeCreateInputPanel from '@/components/freeCreate/FreeCreateInputPanel.vue'
import FreeCreateResultPanel from '@/components/freeCreate/FreeCreateResultPanel.vue'
import { useFreeCreateWorkspace } from '@/composables/useFreeCreateWorkspace.js'

const router = useRouter()
const route = useRoute()
const inputPanelRef = ref(null)
const leaveProtection = inject('appRouteLeaveProtection', null)

const {
  mode,
  prompt,
  style,
  aspectRatio,
  duration,
  generating,
  cancelling,
  results,
  showImagePreview,
  previewImage,
  refImageDataUrl,
  refImageFileName,
  refImageUploadStatus,
  generationCapability,
  activeServiceLabel,
  aspectRatioOptions,
  refImageTriggerLabel,
  refImageUploadMessage,
  generateDisabled,
  generateDisabledReason,
  resultBusyDisabledReason,
  emptyResultCopy,
  goBack,
  loadServiceConfigs,
  openAiConfig,
  generate,
  triggerRefImageUpload,
  onRefImageDrop,
  onRefImageChange,
  retryRefImageUpload,
  clearRefImage,
  clearResults,
  cancelGeneration,
  retryGeneration,
  downloadItem,
  resultImageAlt,
  canRetryItem,
  openImagePreview,
  saveItemDisabledReason,
  saveItemAriaLabel,
  saveItemToAssets,
  confirmFreeCreateLeave,
  handleBeforeUnload,
  mount,
  unmount,
} = useFreeCreateWorkspace({
  router,
  route,
  getRefImageInput: () => inputPanelRef.value?.refImageInput ?? null,
  getRefImageUploadStatusEl: () => inputPanelRef.value?.refImageUploadStatusRef ?? null,
})

onMounted(() => {
  window.addEventListener('beforeunload', handleBeforeUnload)
  return mount(leaveProtection)
})

onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', handleBeforeUnload)
  unmount()
})

onBeforeRouteLeave(async () => {
  if (refImageUploadStatus.value === 'uploading') {
    return confirmFreeCreateLeave()
  }
  return confirmFreeCreateLeave()
})

</script>

<style scoped>
.free-create-page {
  min-height: 100vh;
  background: var(--bg-page);
  color: var(--text-primary);
  padding: 20px;
}

.create-layout {
  display: flex;
  gap: 20px;
  align-items: flex-start;
}

@media (max-width: 900px) {
  .create-layout {
    flex-direction: column;
  }
}
</style>