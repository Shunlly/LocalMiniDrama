import { ref } from 'vue'

/** 分镜提示词弹窗和行内编辑状态，不按 dramaId / episodeId 索引 */
export function useFilmCreatePromptDialogState() {
  const editingSbVideoPromptId = ref(null)
  const editingSbVideoPromptText = ref('')
  const editingSbImagePromptId = ref(null)
  const editingSbImagePromptText = ref('')
  const showSbPromptDialog = ref(false)
  const sbPromptTarget = ref(null)
  const sbPromptImageText = ref('')
  const sbPromptPolishedText = ref('')
  const sbPromptVideoText = ref('')
  const sbPromptSaving = ref(false)
  const sbPromptPolishing = ref(false)
  const showFramePromptEditor = ref(false)
  const editingFramePromptSb = ref(null)
  const editingFramePromptSlot = ref('first')
  const editingFramePromptText = ref('')
  const editingFramePromptSaving = ref(false)
  const editingFramePromptRegenerating = ref(false)

  return {
    editingSbVideoPromptId,
    editingSbVideoPromptText,
    editingSbImagePromptId,
    editingSbImagePromptText,
    showSbPromptDialog,
    sbPromptTarget,
    sbPromptImageText,
    sbPromptPolishedText,
    sbPromptVideoText,
    sbPromptSaving,
    sbPromptPolishing,
    showFramePromptEditor,
    editingFramePromptSb,
    editingFramePromptSlot,
    editingFramePromptText,
    editingFramePromptSaving,
    editingFramePromptRegenerating,
  }
}
