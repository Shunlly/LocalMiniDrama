import { watch, nextTick } from 'vue'

export function useFilmCreateAiConfigWorkspace(deps = {}) {
  const {
    ElMessage,
    showAiConfigDialog,
    aiConfigContentRef,
    pipelinePanelRef,
    aiConfigInitialServiceType,
    aiConfigChanged,
    aiConfigOpenedFromPipelineAction,
    invalidateActiveVideoAiConfigCache,
    refreshVideoGenerationCapability,
    refreshProductionReadiness,
  } = deps
  function openAiConfig(serviceType = '') {
    aiConfigOpenedFromPipelineAction.value = false
    aiConfigInitialServiceType.value = ['text', 'image', 'storyboard_image', 'video', 'tts'].includes(serviceType)
      ? serviceType
      : ''
    showAiConfigDialog.value = true
  }

  function openAiConfigFromPipeline(serviceType = '', context = {}) {
    aiConfigOpenedFromPipelineAction.value = context.source === 'compact-action'
    aiConfigInitialServiceType.value = ['text', 'image', 'storyboard_image', 'video', 'tts'].includes(serviceType)
      ? serviceType
      : ''
    showAiConfigDialog.value = true
  }

  function onAiConfigurationChanged() {
    aiConfigChanged.value = true
  }

  async function confirmAiConfigWorkspaceClose(done) {
    const canClose = (await aiConfigContentRef.value?.requestClose?.()) !== false
    if (canClose) done()
  }

  async function requestAiConfigWorkspaceClose() {
    const canClose = (await aiConfigContentRef.value?.requestClose?.()) !== false
    if (canClose) showAiConfigDialog.value = false
  }

  watch(showAiConfigDialog, async (open) => {
    if (open) {
      aiConfigChanged.value = false
      return
    }
    const changed = aiConfigChanged.value
    const restorePipelineSummaryFocus = aiConfigOpenedFromPipelineAction.value
    aiConfigChanged.value = false
    aiConfigOpenedFromPipelineAction.value = false
    invalidateActiveVideoAiConfigCache()
    if (changed) ElMessage.info('配置已更新，正在重新检查')
    const refreshPromise = Promise.allSettled([
      refreshVideoGenerationCapability(),
      refreshProductionReadiness(),
    ])
    await refreshPromise
    if (restorePipelineSummaryFocus) {
      await nextTick()
      pipelinePanelRef.value?.focusSummary()
    }
  })
  return {
    openAiConfig,
    openAiConfigFromPipeline,
    onAiConfigurationChanged,
    confirmAiConfigWorkspaceClose,
    requestAiConfigWorkspaceClose,
  }
}
