/**
 * 画布焦点同步：选中切换、检查器守卫和空白处点击。只搬家，不改离开拦截语义。
 */
import { nextTick } from 'vue'
import { PANEL_NODE_TYPES } from '@/components/dramaCanvas/dramaCanvasDerivedState.js'
import { getStoryboardRefFromNode } from '@/utils/dramaCanvasAdapter'
import { storyboardIdFromNodeId } from '@/utils/canvasWorkflow'

export function createDramaCanvasFocusSync(ctx = {}) {
  let focusedNodeGuard = null
  let focusedNodeDirtyCheck = null

  function restoreFocusedNodeSelection() {
    const currentId = ctx.focusedNodeId.value ? String(ctx.focusedNodeId.value) : ''
    ctx.nodes.value = ctx.nodes.value.map((node) => ({
      ...node,
      selected: Boolean(currentId && String(node.id) === currentId),
    }))
    const storyboardId = storyboardIdFromNodeId(currentId)
    ctx.selectedStoryboardIds.value = storyboardId ? [storyboardId] : []
  }

  function hasFocusedNodePendingWork() {
    try {
      if (typeof focusedNodeDirtyCheck === 'function') return Boolean(focusedNodeDirtyCheck())
      return Boolean(focusedNodeDirtyCheck?.value)
    } catch (_) {
      return true
    }
  }

  async function confirmFocusedNodeLeave() {
    if (!ctx.focusedNodeId.value || !focusedNodeGuard) return true
    const canLeave = await focusedNodeGuard()
    if (!canLeave) restoreFocusedNodeSelection()
    return canLeave
  }

  async function focusCanvasNodeTrigger(nodeId) {
    if (!nodeId) return
    await nextTick()
    const nodeElement = [...document.querySelectorAll('.vue-flow__node')]
      .find((element) => element.dataset.id === String(nodeId))
    nodeElement
      ?.querySelector('.canvas-sb-node, .canvas-asset-node, .canvas-media-node, .canvas-script-node, .canvas-episode-node, .canvas-add-node, [role="button"]')
      ?.focus({ preventScroll: true })
  }

  async function setFocusedCanvasNode(nodeId, { force = false, restoreFocus = false } = {}) {
    const currentId = ctx.focusedNodeId.value || null
    const nextId = nodeId || null
    const isChanging = String(currentId || '') !== String(nextId || '')
    if (!isChanging) {
      if (nextId) await ctx.focusCanvasNode(nextId)
      return true
    }
    if (currentId && !force && !await ctx.ensureNodeGenerationFinished()) {
      restoreFocusedNodeSelection()
      return false
    }
    if (currentId && !force && focusedNodeGuard) {
      const canLeave = await focusedNodeGuard()
      if (!canLeave) {
        restoreFocusedNodeSelection()
        document.querySelector('.canvas-inspector-dock .canvas-node-panel')?.focus({ preventScroll: true })
        return false
      }
    }
    ctx.focusedNodeId.value = nextId
    if (nextId) await ctx.focusCanvasNode(nextId)
    else if (restoreFocus && currentId) await focusCanvasNodeTrigger(currentId)
    return true
  }

  function registerFocusGuard(guard, isDirty = null) {
    focusedNodeGuard = typeof guard === 'function' ? guard : null
    focusedNodeDirtyCheck = isDirty
    return () => {
      if (focusedNodeGuard === guard) {
        focusedNodeGuard = null
        focusedNodeDirtyCheck = null
      }
    }
  }

  return {
    restoreFocusedNodeSelection,
    hasFocusedNodePendingWork,
    confirmFocusedNodeLeave,
    focusCanvasNodeTrigger,
    setFocusedCanvasNode,
    registerFocusGuard,
  }
}

export function createDramaCanvasPaneEvents(ctx = {}) {
  async function onPaneClick(event) {
    if (ctx.paneClickSuppressed.value) return
    const target = event?.event?.target || event?.target
    if (target?.closest?.('.canvas-node-panel') || target?.closest?.('.canvas-inspector-dock') || target?.closest?.('.free-canvas-inspector-dock') || target?.closest?.('.el-popper') || target?.closest?.('.canvas-context-menu')) {
      return
    }
    ctx.closeFreeCanvasInspector({ restoreFocus: false })
    ctx.finishFreeCanvasNodeEditing()
    ctx.selectedFreeNodeIds.value = []
    ctx.selectedFreeEdgeIds.value = []
    const setFocusedCanvasNode = ctx.setFocusedCanvasNode
    await setFocusedCanvasNode(null, { restoreFocus: true })
    ctx.closeContextMenu()
  }

  async function onNodeClick({ node, event }) {
    if (ctx.isFreeCanvasNodeId(node.id)) {
      event?.stopPropagation?.()
      if (event?.ctrlKey || event?.metaKey || event?.shiftKey) return
      ctx.finishFreeCanvasNodeEditing(node.id)
      ctx.openFreeCanvasInspectorFor(node.id)
      return
    }
    if (ctx.canvasMode.value !== 'production') return
    if (node.type === 'canvasAddButton') {
      event?.stopPropagation?.()
      ctx.openCreateDialog(node.data?.assetType || 'storyboard')
      return
    }

    if (ctx.canvasMode.value === 'production' && PANEL_NODE_TYPES.has(node.type)) {
      const setFocusedCanvasNode = ctx.setFocusedCanvasNode
      const restoreFocusedNodeSelection = ctx.restoreFocusedNodeSelection
      const changed = await setFocusedCanvasNode(node.id)
      if (!changed) {
        restoreFocusedNodeSelection()
        return
      }
    }

    if (node.type === 'canvasAsset') {
      const prefix = node.data.kind === 'character' ? 'char' : node.data.kind === 'scene' ? 'scene' : 'prop'
      ctx.selectSidebarAsset(`${prefix}:${node.data.entity.id}`)
      return
    }
    const sbId = storyboardIdFromNodeId(node.id)
    if (sbId) ctx.activeGroupId.value = ctx.workflowGroups.value.find((g) => (g.storyboard_ids || []).includes(sbId))?.id || ctx.activeGroupId.value
  }

  function onNodeDoubleClick({ node }) {
    if (ctx.isFreeCanvasNodeId(node.id)) {
      ctx.openFreeCanvasInspectorFor(node.id)
      if (node.data?.freeNode?.type === 'text') ctx.startFreeCanvasNodeEditing(node.id)
      return
    }
    if (ctx.canvasMode.value !== 'production') return
    if (node.type === 'canvasStoryboard') {
      ctx.navigateToStoryboard(node.data.episodeId || node.data.storyboard?.episode_id, node.data.storyboard?.id)
      return
    }
    const ref = getStoryboardRefFromNode(node)
    if (ref?.storyboardId) ctx.navigateToStoryboard(ref.episodeId, ref.storyboardId)
  }

  return {
    onPaneClick,
    onNodeClick,
    onNodeDoubleClick,
  }
}
