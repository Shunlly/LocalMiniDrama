import { ElMessage, ElMessageBox } from '@/utils/elementPlusFeedback.js'
import { useGenerationTaskStore } from '@/stores/generationTaskStore'
import { hasActiveMediaGenerationWork } from './useFilmCreateBatchGeneration.js'

function asTaskList(value) {
  if (Array.isArray(value)) return value
  if (value && Array.isArray(value.value)) return value.value
  if (value && typeof value.length === 'number') return Array.from(value)
  return []
}

function stableRecord(value) {
  const record = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  return JSON.stringify(record, Object.keys(record).sort())
}

/** 同页只改 hash 时不算离开制作页，避免空态锚点把未保存确认弹出来 */
export function isSamePageHashOnlyNavigation(to, from) {
  if (!to || !from) return false
  const toName = to.name ?? ''
  const fromName = from.name ?? ''
  const toPath = to.path || ''
  const fromPath = from.path || ''
  const sameIdentity = (toName || fromName)
    ? toName === fromName
    : toPath === fromPath
  if (!sameIdentity) return false
  if (stableRecord(to.params) !== stableRecord(from.params)) return false
  if (stableRecord(to.query) !== stableRecord(from.query)) return false
  return (to.hash || '') !== (from.hash || '')
}

function readRunningGenerationTasks(deps = {}) {
  if (typeof deps.getRunningGenerationTasks === 'function') {
    return asTaskList(deps.getRunningGenerationTasks())
  }
  if (typeof deps.generationTaskStore?.getAllRunningTasks === 'function') {
    return asTaskList(deps.generationTaskStore.getAllRunningTasks())
  }
  try {
    return asTaskList(useGenerationTaskStore().getAllRunningTasks())
  } catch (_) {
    return []
  }
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
    generatingCharIds,
    generatingSceneIds,
    generatingPropIds,
    generatingPanoramaIds,
    confirmResourceEditorLeave,
    hasUnsavedResourceEditors,
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
      generatingUniversalSegmentIds,
      ttsSbIds,
      ttsSbNarrationIds,
      upscalingSbIds,
      generatingCharIds,
      generatingSceneIds,
      generatingPropIds,
      generatingPanoramaIds,
      runningGenerationTasks: readRunningGenerationTasks(deps),
    })
  }

  function hasActiveGenerationWork() {
    return hasActivePipelineWork() || hasActiveMediaWork()
  }

  function handleBeforeUnload(event) {
    const hasUnsavedAiConfig = showAiConfigDialog.value
      && aiConfigContentRef.value?.hasUnsavedChanges?.()
    const hasUnsavedResources = typeof hasUnsavedResourceEditors === 'function'
      && hasUnsavedResourceEditors()
    if (!scriptDraftController.hasPendingChanges() && !hasActiveGenerationWork() && !hasUnsavedAiConfig && !hasUnsavedResources) return
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
        '媒体生成仍在执行',
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

  async function allowNavigationAfterDraftFlush(to, from) {
    if (isSamePageHashOnlyNavigation(to, from)) return true
    if (!await requestAiConfigWorkspaceNavigation()) return false
    if (typeof confirmResourceEditorLeave === 'function' && !await confirmResourceEditorLeave()) return false
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
