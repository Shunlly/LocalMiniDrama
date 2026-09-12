import { focusSourceUrlInput, revealSourceImportIntent } from '@/utils/sourceImportIntent'
import {
  buildSourceIntakePayload,
  buildSourceUploadFormData,
  buildWebSourceIntakePayload,
} from '@/utils/sourceIntakeAdapter'

export function createSourceIntakeImportActions({
  rawSourceUrl,
  sourceUrlValidationMessage,
  sourceFile,
  sourceIntakeAPI,
  getDramaId,
  form,
  getDrama,
  hasWebSourceUrl,
  clearSelectedFile,
  getImportController,
  sourceSaving,
  isWorkflowLaunchBusy,
  getSelectedFilename,
  sourceListRefreshing,
  sourceFileReading,
  workflowHistoryExpanded,
  selectedFlowStepId,
  sourceUrlInput,
  nextTickFn,
  persistInspectedFlowStep,
  sourceDetailVisible,
  sourceDetailLoading,
  sourceDetail,
  isLifecycleActive,
  showWorkflowMessage,
  isUserFacingAbort,
  toUserFacingError,
} = {}) {
  function syncDefaults() {
    const drama = getDrama()
    form.target_episode_count = Math.max(1, Number(drama?.episodes?.length) || Number(drama?.total_episodes) || 1)
    if (!form.title) form.title = drama?.title ? `${drama.title} 素材` : ''
  }

  function resetSourceInput() {
    form.text = ''
    form.source_url = ''
    clearSelectedFile()
  }

  async function createSourceFromForm() {
    if (rawSourceUrl.value && sourceUrlValidationMessage.value) {
      throw new Error(sourceUrlValidationMessage.value)
    }
    if (sourceFile.value) {
      return sourceIntakeAPI.uploadForDrama(getDramaId(), buildSourceUploadFormData(form, getDrama(), sourceFile.value))
    }
    if (hasWebSourceUrl()) {
      return sourceIntakeAPI.importUrlForDrama(
        getDramaId(),
        buildWebSourceIntakePayload(form, getDrama()),
      )
    }
    return sourceIntakeAPI.createForDrama(getDramaId(), buildSourceIntakePayload(form, getDrama()))
  }

  async function importSourceOnly() {
    if (sourceSaving.value || isWorkflowLaunchBusy()) return
    const uploadedFilename = getSelectedFilename()
    sourceSaving.value = true
    try {
      const sourceImportController = getImportController()
      await sourceImportController.importSource({ uploadedFilename })
    } finally {
      sourceSaving.value = false
    }
  }

  async function refreshImportedSources() {
    if (sourceListRefreshing.value || sourceSaving.value || sourceFileReading.value || isWorkflowLaunchBusy()) return
    sourceListRefreshing.value = true
    try {
      const sourceImportController = getImportController()
      await sourceImportController.refreshSources()
    } finally {
      sourceListRefreshing.value = false
    }
  }

  async function focusSourceIntakeForm() {
    await nextTickFn()
    focusSourceUrlInput(sourceUrlInput)
  }

  async function openSourceImportIntent() {
    await revealSourceImportIntent({
      historyExpanded: workflowHistoryExpanded,
      selectedStepId: selectedFlowStepId,
      sourceUrlInput,
      nextTickFn,
    })
    persistInspectedFlowStep(selectedFlowStepId.value)
    await nextTickFn()
    sourceUrlInput.value?.focus?.()
  }

  async function openSourceDetail(source) {
    sourceDetailVisible.value = true
    sourceDetailLoading.value = true
    sourceDetail.value = null
    try {
      const detail = await sourceIntakeAPI.get(source.id)
      if (!isLifecycleActive()) return
      sourceDetail.value = detail
    } catch (e) {
      if (!isLifecycleActive()) return
      if (isUserFacingAbort(e)) return
      showWorkflowMessage('error', toUserFacingError(e, '加载素材详情失败'))
    } finally {
      sourceDetailLoading.value = false
    }
  }

  return {
    syncDefaults,
    resetSourceInput,
    createSourceFromForm,
    importSourceOnly,
    refreshImportedSources,
    openSourceImportIntent,
    focusSourceIntakeForm,
    openSourceDetail,
  }
}
