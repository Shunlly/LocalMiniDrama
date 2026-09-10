import { ElMessage, ElMessageBox } from 'element-plus'
import { hasActiveMediaGenerationWork } from './useFilmCreateBatchGeneration.js'

function hasActiveIdCollection(value) {
  if (value == null) return false
  const collection = typeof value === 'object' && 'value' in value ? value.value : value
  if (collection == null) return false
  if (typeof collection.size === 'number') return collection.size > 0
  if (typeof collection.length === 'number') return collection.length > 0
  return false
}

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
    batchImageStopping,
    batchVideoRunning,
    batchVideoStopping,
    generatingSbImageIds,
    generatingSbVideoIds,
    generatingSbFirstImageIds,
    generatingSbLastImageIds,
    generatingUniversalSegmentIds,
    ttsSbIds,
    ttsSbNarrationIds,
    upscalingSbIds,
  } = deps

  function hasActivePipelineWork() {
    return pipelineStarting.value
      || pipelineRunning.value
      || pipelineStopping.value
      || Boolean(activePipelineRunPromise.value)
      || pipelineOwnedTaskIds.size > 0
  }

  function hasActiveMediaWork() {
    return hasActiveMediaGenerationWork({
      batchImageRunning,
      batchImageStopping,
      batchVideoRunning,
      batchVideoStopping,
      generatingSbImageIds,
      generatingSbVideoIds,
      generatingSbFirstImageIds,
      generatingSbLastImageIds,
    })
      || hasActiveIdCollection(generatingUniversalSegmentIds)
      || hasActiveIdCollection(ttsSbIds)
      || hasActiveIdCollection(ttsSbNarrationIds)
      || hasActiveIdCollection(upscalingSbIds)
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

  async function confirmMediaGenerationNavigation() {
    if (!hasActiveMediaWork()) return true
    try {
      await ElMessageBox.confirm(
        '离开制作页面会停止当前页面对生成进度的等待；已提交的供应商任务和计费可能继续。',
        '生成任务仍在执行',
        {
          type: 'warning',
          confirmButtonText: '仍要离开',
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
    return confirmMediaGenerationNavigation()
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
    confirmMediaGenerationNavigation,
    allowNavigationAfterDraftFlush,
  }
}
