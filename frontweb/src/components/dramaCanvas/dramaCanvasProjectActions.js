/**
 * 画布项目刷新、创建提交和返回路径。只搬家，不改焦点保留和 returnTo 拼法。
 */
function ctxFn(ctx, key) {
  return (...args) => ctx[key](...args)
}

export function createDramaCanvasProjectActions(ctx = {}) {
  const focusedNodeId = ctx.focusedNodeId
  const loadCanvasProject = ctxFn(ctx, 'loadCanvasProject')
  const route = ctx.route
  const router = ctx.router
  const dramaId = ctx.dramaId
  const canvasMode = ctx.canvasMode
  const selectedFreeNodeId = ctx.selectedFreeNodeId
  const routeEpisodeId = ctxFn(ctx, 'routeEpisodeId')
  const routeFocusNodeId = ctxFn(ctx, 'routeFocusNodeId')
  const isCanvasUserAbort = ctxFn(ctx, 'isCanvasUserAbort')
  const ElMessage = ctx.ElMessage
  const safeFreeCanvasError = ctxFn(ctx, 'safeFreeCanvasError')
  const submitCreate = ctxFn(ctx, 'submitCreate')
  const String = ctx.String ?? globalThis.String

  async function refreshDrama(preserveFocus = true) {
    const keepId = preserveFocus ? focusedNodeId.value : null
    const loaded = await loadCanvasProject({ blocking: false, preserveOnError: true })
    if (!loaded) return false
    if (keepId) focusedNodeId.value = keepId
    return true
  }

  async function refreshCanvas(preserveFocus = true) {
    await refreshDrama(preserveFocus)
  }

  async function onCreateSubmit(form) {
    try {
      await submitCreate(form)
    } catch (e) {
      if (isCanvasUserAbort(e)) return
      ElMessage.error(safeFreeCanvasError(e, '创建失败'))
    }
  }

  function buildCanvasReturnTo(focusNodeId = '') {
    const returnQuery = { ...route.query }
    const returnEpisodeId = routeEpisodeId()
    if (returnEpisodeId != null) returnQuery.episode = String(returnEpisodeId)
    else delete returnQuery.episode
    const selectedFocusId = focusNodeId
      || (canvasMode.value === 'free' ? selectedFreeNodeId.value : focusedNodeId.value)
      || routeFocusNodeId()
    const returnFocusId = routeFocusNodeId({ query: { focus: selectedFocusId } })
    if (returnFocusId) returnQuery.focus = returnFocusId
    else delete returnQuery.focus
    return router.resolve({
      name: 'film-canvas',
      params: { id: String(dramaId.value) },
      query: returnQuery,
    }).fullPath
  }

  return {
    refreshDrama,
    refreshCanvas,
    onCreateSubmit,
    buildCanvasReturnTo,
  }
}
