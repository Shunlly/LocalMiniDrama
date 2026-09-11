/**
 * 画布离开保护：刷新拦截、工作流确认、保存冲刷和路由屏障。只搬家，不改确认文案和放行顺序。
 */
function ctxFn(ctx, key) {
  return (...args) => ctx[key](...args)
}

export function createDramaCanvasLeaveProtection(ctx = {}) {
  const hasFocusedNodePendingWork = ctxFn(ctx, 'hasFocusedNodePendingWork')
  const layoutDirty = ctx.layoutDirty
  const failedCanvasSaveOperation = ctx.failedCanvasSaveOperation
  const hasPendingCanvasSaves = ctxFn(ctx, 'hasPendingCanvasSaves')
  const canvasProjectId = ctx.canvasProjectId
  const freeCanvasUploading = ctx.freeCanvasUploading
  const workflowRunning = ctx.workflowRunning
  const episodeGenerating = ctx.episodeGenerating
  const nodeGenerationCoordinator = ctx.nodeGenerationCoordinator
  const ElMessageBox = ctx.ElMessageBox
  const activeWorkflowRun = ctx.activeWorkflowRun
  const workflowProgress = ctx.workflowProgress
  const cancelScheduledCanvasSave = ctxFn(ctx, 'cancelScheduledCanvasSave')
  const waitForCanvasSaveSettlement = ctxFn(ctx, 'waitForCanvasSaveSettlement')
  const retryCanvasSave = ctxFn(ctx, 'retryCanvasSave')
  const persistCanvasState = ctxFn(ctx, 'persistCanvasState')
  const layoutSaveState = ctx.layoutSaveState
  const layoutSaveError = ctx.layoutSaveError
  const canvasSaveCoordinator = ctx.canvasSaveCoordinator
  const Number = ctx.Number ?? globalThis.Number
  const ensureNodeGenerationFinished = ctxFn(ctx, 'ensureNodeGenerationFinished')
  const ensureEpisodeGenerationFinished = ctxFn(ctx, 'ensureEpisodeGenerationFinished')
  const ensureFreeCanvasUploadFinished = ctxFn(ctx, 'ensureFreeCanvasUploadFinished')
  const confirmFocusedNodeLeave = ctxFn(ctx, 'confirmFocusedNodeLeave')
  const canvasRouteContext = ctxFn(ctx, 'canvasRouteContext')
  const route = ctx.route

  function handleCanvasBeforeUnload(event) {
    if (
      !hasFocusedNodePendingWork()
      && !layoutDirty.value
      && !failedCanvasSaveOperation.value
      && !hasPendingCanvasSaves(canvasProjectId.value)
      && !freeCanvasUploading.value
      && !workflowRunning.value
      && !episodeGenerating.value
      && !nodeGenerationCoordinator.hasActive()
    ) return
    event.preventDefault()
    event.returnValue = ''
  }

  async function ensureWorkflowFinished() {
    if (!workflowRunning.value) return true
    try {
      await ElMessageBox.confirm(
        '离开会停止当前页面继续等待和显示进度，但已提交的后台任务及供应商计费可能继续。是否仍要离开？',
        '工作流仍在执行',
        { type: 'warning', confirmButtonText: '停止等待并离开', cancelButtonText: '继续等待' },
      )
    } catch (_) {
      return false
    }
    activeWorkflowRun.value?.controller?.abort()
    activeWorkflowRun.value = null
    workflowRunning.value = false
    workflowProgress.value = ''
    return true
  }

  async function flushCanvasSaveBeforeLeave(targetProjectId = canvasProjectId.value) {
    if (
      !layoutDirty.value
      && !failedCanvasSaveOperation.value
      && !hasPendingCanvasSaves(targetProjectId)
    ) return true
    cancelScheduledCanvasSave()
    await waitForCanvasSaveSettlement(targetProjectId)
    if (!layoutDirty.value && !failedCanvasSaveOperation.value) return true
    let result = failedCanvasSaveOperation.value
      ? await retryCanvasSave()
      : { ok: true }
    if (result.ok && layoutDirty.value) {
      result = await persistCanvasState({ layoutOnly: true, reportError: false })
    }
    if (result.ok) return true
    if (result.cancelled && !layoutDirty.value && !failedCanvasSaveOperation.value) return true
    try {
      await ElMessageBox.confirm(
        '最近的画布修改还没有保存成功，继续离开会丢失这些修改。',
        '保存失败',
        { type: 'warning', confirmButtonText: '仍要离开', cancelButtonText: '留在页面' },
      )
      layoutDirty.value = false
      failedCanvasSaveOperation.value = null
      layoutSaveState.value = 'idle'
      layoutSaveError.value = ''
      return true
    } catch (_) {
      return false
    }
  }

  function runCanvasNavigationBarrier() {
    const projectId = canvasProjectId.value
    return canvasSaveCoordinator.runNavigationBarrier(
      Number(projectId),
      async () => {
        if (!await ensureNodeGenerationFinished()) return false
        if (!await ensureEpisodeGenerationFinished()) return false
        if (!await ensureWorkflowFinished()) return false
        if (!ensureFreeCanvasUploadFinished()) return false
        if (!await confirmFocusedNodeLeave()) return false
        return flushCanvasSaveBeforeLeave(projectId)
      },
    )
  }

  async function guardCanvasRouteUpdate(to) {
    const currentContext = canvasRouteContext(route)
    const nextContext = canvasRouteContext(to)
    if (currentContext.projectId !== nextContext.projectId) {
      return runCanvasNavigationBarrier()
    }
    if (
      currentContext.focusNodeId !== nextContext.focusNodeId
      || currentContext.episodeId !== nextContext.episodeId
    ) {
      return runCanvasNavigationBarrier()
    }
    return true
  }

  return {
    handleCanvasBeforeUnload,
    ensureWorkflowFinished,
    flushCanvasSaveBeforeLeave,
    runCanvasNavigationBarrier,
    guardCanvasRouteUpdate,
  }
}
