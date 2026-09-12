import { ref } from 'vue'

/** AI 配置弹窗接线状态。loadList / 连接测试仍留在页面组件里。 */
export function useFilmCreateAiConfigDialogState() {
  const showAiConfigDialog = ref(false)
  const aiConfigContentRef = ref(null)
  const pipelinePanelRef = ref(null)
  const aiConfigInitialServiceType = ref('')
  const aiConfigChanged = ref(false)
  const aiConfigOpenedFromPipelineAction = ref(false)

  return {
    showAiConfigDialog,
    aiConfigContentRef,
    pipelinePanelRef,
    aiConfigInitialServiceType,
    aiConfigChanged,
    aiConfigOpenedFromPipelineAction,
  }
}
