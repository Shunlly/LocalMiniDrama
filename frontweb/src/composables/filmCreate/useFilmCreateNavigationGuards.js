import { ElMessage, ElMessageBox } from 'element-plus'

export function useFilmCreateNavigationGuards(deps = {}) {
  const {
    pipelineStarting,
    pipelineRunning,
    pipelineStopping,
    activePipelineRunPromise,
    pipelineOwnedTaskIds,
    showAiConfigDialog,
    aiConfigContentRef,
    scriptDraftController,
    flushScriptDraft,
    cancelPipelineRun,
    batchImageRunning,
    batchVideoRunning,
    generatingSbImageIds,
    generatingSbFirstImageIds,
    generatingSbLastImageIds,
    generatingUniversalSegmentIds,
    ttsSbIds,
    ttsSbNarrationIds,
    upscalingSbIds,
  } = deps

  function collectionSize(value) {
    if (!value) return 0
    if (typeof value.size === 'number') return value.size
    if (typeof value.value?.size === 'number') return value.value.size
    return 0
  }

  function flagEnabled(value) {
    if (!value) return false
    if (typeof value === 'object' && 'value' in value) return Boolean(value.value)
    return Boolean(value)
  }

  function hasActivePipelineWork() {
    return pipelineStarting.value
      || pipelineRunning.value
      || pipelineStopping.value
      || Boolean(activePipelineRunPromise.value)
      || pipelineOwnedTaskIds.size > 0
  }

  function hasActiveMediaWork() {
    return flagEnabled(batchImageRunning)
      || flagEnabled(batchVideoRunning)
      || collectionSize(generatingSbImageIds) > 0
      || collectionSize(generatingSbFirstImageIds) > 0
      || collectionSize(generatingSbLastImageIds) > 0
      || collectionSize(generatingUniversalSegmentIds) > 0
      || collectionSize(ttsSbIds) > 0
      || collectionSize(ttsSbNarrationIds) > 0
      || collectionSize(upscalingSbIds) > 0
  }

  function hasActiveGenerationWork() {
    return hasActivePipelineWork() || hasActiveMediaWork()
  }

  function handleBeforeUnload(event) {
    const hasUnsavedAiConfig = showAiConfigDialog.value
      && aiConfigContentRef.value?.hasUnsavedChanges?.()
    if (!scriptDraftController.hasPendingChanges() && !hasActiveGenerationWork() && !hasUnsavedAiConfig) return
    event.preventDefault()
    event.returnValue = ''
  }

  async function requestAiConfigWorkspaceNavigation() {
    if (!showAiConfigDialog.value) return true
    return (await aiConfigContentRef.value?.requestClose?.()) !== false
  }

  async function flushDraftBeforeNavigation() {
    if (!scriptDraftController.hasPendingChanges()) return { allowed: true, discard: false }
    try {
      await flushScriptDraft()
      return { allowed: true, discard: false }
    } catch (_) {
      // The dialog is only reached after a real flush failure; successful autosaves leave silently.
    }

    try {
      await ElMessageBox.confirm(
        '自动保存失败。可先重试保存，或仍然离开并丢弃本次剧本修改。关闭此对话框将继续编辑。',
        '剧本尚未保存',
        {
          type: 'warning',
          confirmButtonText: '保存并离开',
          cancelButtonText: '仍然离开',
          distinguishCancelAndClose: true,
        },
      )
    } catch (reason) {
      if (reason === 'cancel') return { allowed: true, discard: true }
      return { allowed: false, discard: false }
    }

    try {
      await flushScriptDraft()
      if (!scriptDraftController.hasPendingChanges()) return { allowed: true, discard: false }
    } catch (_) {}
    ElMessage.error('自动保存仍未完成，请重试保存或选择仍然离开。')
    return { allowed: false, discard: false }
  }

  async function confirmMediaNavigation() {
    if (!hasActiveMediaWork()) return true
    try {
      await ElMessageBox.confirm(
        '离开制作页面不会停止已提交的生图、生视频或配音任务，供应商计费可能继续。',
        '生成任务仍在执行',
        {
          type: 'warning',
          confirmButtonText: '仍然离开',
          cancelButtonText: '继续制作',
        },
      )
    } catch (_) {
      return false
    }
    return true
  }

  async function confirmPipelineNavigation() {
    if (hasActivePipelineWork()) {
      if (pipelineStopping.value) {
        ElMessage.info('全流程仍在停止中，请等待停止完成后再离开')
        return false
      }
      try {
        await ElMessageBox.confirm(
          '离开制作页面会停止本地全流程和前端等待；已提交的供应商任务和计费可能继续。',
          '全流程仍在执行',
          {
            type: 'warning',
            confirmButtonText: '停止并离开',
            cancelButtonText: '继续制作',
          },
        )
      } catch (_) {
        return false
      }
      return cancelPipelineRun()
    }
    return confirmMediaNavigation()
  }

  async function allowNavigationAfterDraftFlush() {
    if (!await requestAiConfigWorkspaceNavigation()) return false
    const draftDecision = await flushDraftBeforeNavigation()
    if (!draftDecision.allowed) return false
    if (!await confirmPipelineNavigation()) return false
    if (draftDecision.discard) scriptDraftController.markSaved(null)
    return true
  }

  return {
    hasActivePipelineWork,
    hasActiveMediaWork,
    hasActiveGenerationWork,
    handleBeforeUnload,
    requestAiConfigWorkspaceNavigation,
    flushDraftBeforeNavigation,
    confirmPipelineNavigation,
    allowNavigationAfterDraftFlush,
  }
}
