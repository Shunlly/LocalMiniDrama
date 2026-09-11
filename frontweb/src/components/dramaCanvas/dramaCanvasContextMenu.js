/**
 * 画布右键菜单。只搬家，不改生产模式创建和自由节点入口。
 */
export function createDramaCanvasContextMenu(ctx = {}) {
  let paneClickSuppressTimer = null

  function suppressPaneClick(ms = 350) {
    ctx.paneClickSuppressed.value = true
    if (paneClickSuppressTimer) clearTimeout(paneClickSuppressTimer)
    paneClickSuppressTimer = setTimeout(() => {
      ctx.paneClickSuppressed.value = false
      paneClickSuppressTimer = null
    }, ms)
  }

  function clearPaneClickSuppress() {
    if (paneClickSuppressTimer) clearTimeout(paneClickSuppressTimer)
    paneClickSuppressTimer = null
    ctx.paneClickSuppressed.value = false
  }

  function onPaneContextMenu(payload) {
    const event = payload?.event || payload
    if (event?.preventDefault) event.preventDefault()
    const flowPos = payload?.flowPosition || ctx.screenToFlowPosition(event.clientX, event.clientY)
    ctx.contextMenuFlowPos.value = flowPos
    ctx.contextMenuX.value = event.clientX
    ctx.contextMenuY.value = event.clientY
    ctx.contextMenuVisible.value = true
  }

  function closeContextMenu() {
    ctx.contextMenuVisible.value = false
    ctx.contextMenuFlowPos.value = null
  }

  function onContextMenuSelect(type) {
    if (ctx.canvasMode.value !== 'production') {
      closeContextMenu()
      return
    }
    ctx.pendingFlowPosition.value = ctx.contextMenuFlowPos.value
    ctx.openCreateDialog(type, ctx.contextMenuFlowPos.value)
    closeContextMenu()
  }

  function onContextMenuFreeNode(type) {
    const position = ctx.contextMenuFlowPos.value
    closeContextMenu()
    void ctx.createFreeCanvasNode(type, position)
  }

  return {
    suppressPaneClick,
    clearPaneClickSuppress,
    onPaneContextMenu,
    closeContextMenu,
    onContextMenuSelect,
    onContextMenuFreeNode,
  }
}
