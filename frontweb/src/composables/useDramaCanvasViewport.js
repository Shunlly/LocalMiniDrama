import { nextTick } from 'vue'
import { ElMessage } from '@/utils/elementPlusFeedback.js'

import { isCanvasUserAbort } from '@/composables/useCanvasUserError'
import { computeAutoLayoutPositions } from '@/utils/dramaCanvasAdapter'
import {
  alignFreeCanvasNodePositions,
  freeCanvasUxState,
  getFreeCanvasAlignDisabledReason,
} from '@/components/dramaCanvas/freeCanvasUx'

/** 画布视口、选择、拖拽落点和自动对齐 */
export function useDramaCanvasViewport(deps) {
  const {
    canvasFlowApi,
    canvasMode,
    canvasInteractive,
    currentViewport,
    productionViewport,
    productionGraph,
    nodes,
    freeCanvas,
    selectedStoryboardIds,
    selectedFreeNodeId,
    selectedFreeNodeIds,
    selectedFreeEdgeIds,
    editingFreeNodeId,
    initialFitDone,
    hasSavedViewport,
    aligningNodes,
    drama,
    filterEpisodeId,
    workflowGroups,
    imagesBySbId,
    videosBySbId,
    layoutCache,
    MIN_READABLE_CANVAS_ZOOM,
    shouldIgnoreEmptyFreeSelection,
    isFreeCanvasNodeId,
    scheduleLayoutSave,
    commitFreeCanvasState,
    persistCanvasState,
    setFocusedCanvasNode,
    currentCanvasProjectId,
    isCanvasProjectCurrent,
    routeFocusNodeId,
    synchronizeRouteFocusedEntity,
    claimRouteEntityFocus,
    safeFreeCanvasError,
  } = deps

  async function fitCanvasView() {
    const flowApi = canvasFlowApi.value
    if (!flowApi?.fitView) return
    const duration = 250
    await flowApi.fitView({
      padding: canvasMode.value === 'free' ? 0.28 : 0.12,
      minZoom: canvasMode.value === 'free' ? 0.25 : MIN_READABLE_CANVAS_ZOOM,
      maxZoom: canvasMode.value === 'free' ? 1.2 : 1,
      duration,
      includeHiddenNodes: false,
    })
    await new Promise((resolve) => setTimeout(resolve, duration + 50))
    await nextTick()
    const viewport = flowApi.getViewport?.()
    if (viewport) {
      onViewportChange(viewport)
      onCanvasMoveEnd()
    }
  }

  function zoomCanvasIn() {
    canvasFlowApi.value?.zoomIn?.({ duration: 150 })
  }

  function zoomCanvasOut() {
    canvasFlowApi.value?.zoomOut?.({ duration: 150 })
  }

  function toggleCanvasInteractive() {
    canvasInteractive.value = !canvasInteractive.value
    canvasFlowApi.value?.setInteractive?.(canvasInteractive.value)
  }

  async function onCanvasNodesInitialized() {
    const requestedFocus = routeFocusNodeId()
    if (requestedFocus && nodes.value.some((node) => String(node.id) === requestedFocus)) {
      initialFitDone.value = true
      await synchronizeRouteFocusedEntity(claimRouteEntityFocus())
      return
    }
    if (hasSavedViewport.value || initialFitDone.value) return
    initialFitDone.value = true
    await nextTick()
    await fitCanvasView()
  }

  function onSelectionChange({ nodes: selectedNodes = [], edges: selectedEdges = [] }) {
    if (!selectedNodes.length && shouldIgnoreEmptyFreeSelection()) return
    selectedStoryboardIds.value = canvasMode.value === 'production'
      ? selectedNodes
        .filter((node) => node.type === 'canvasStoryboard' && node.data?.storyboard?.id)
        .map((node) => node.data.storyboard.id)
      : []
    selectedFreeNodeIds.value = selectedNodes
      .filter((node) => node.type === 'freeCanvas' || isFreeCanvasNodeId(node.id))
      .map((node) => node.id)
    selectedFreeEdgeIds.value = selectedEdges
      .filter((edge) => freeCanvas.value.edges.some((item) => String(item.id) === String(edge.id)))
      .map((edge) => edge.id)
    if (selectedFreeNodeIds.value.length === 1) selectedFreeNodeId.value = selectedFreeNodeIds.value[0]
    else if (selectedFreeNodeIds.value.length > 1) selectedFreeNodeId.value = null
    else selectedFreeNodeId.value = null
    if (!selectedFreeNodeIds.value.includes(editingFreeNodeId.value)) editingFreeNodeId.value = null
  }

  function onViewportChange(viewport) {
    currentViewport.value = { x: viewport.x, y: viewport.y, zoom: viewport.zoom }
    if (canvasMode.value === 'production') productionViewport.value = { ...currentViewport.value }
    scheduleLayoutSave()
  }

  function syncProductionGraphPositions() {
    const positions = new Map(
      nodes.value
        .filter((node) => node.type !== 'freeCanvas' && !String(node.id).startsWith('free:'))
        .map((node) => [String(node.id), node.position]),
    )
    productionGraph.value = {
      ...productionGraph.value,
      nodes: productionGraph.value.nodes.map((node) => (
        positions.has(String(node.id))
          ? { ...node, position: { ...positions.get(String(node.id)) } }
          : node
      )),
    }
  }

  function onCanvasNodeDragStop(payload = {}) {
    const changedNodes = Array.isArray(payload.nodes)
      ? payload.nodes
      : (payload.node ? [payload.node] : [])
    const freePositions = new Map(
      changedNodes
        .filter((node) => isFreeCanvasNodeId(node.id))
        .map((node) => [String(node.id), node.position]),
    )
    if (freePositions.size) {
      const nextNodes = freeCanvas.value.nodes.map((node) => (
        freePositions.has(String(node.id))
          ? { ...node, position: { ...freePositions.get(String(node.id)) } }
          : node
      ))
      commitFreeCanvasState({ ...freeCanvas.value, nodes: nextNodes }, 'move')
      return
    }
    syncProductionGraphPositions()
    scheduleLayoutSave()
  }

  function onCanvasMoveEnd() {
    if (canvasMode.value === 'free') {
      commitFreeCanvasState({
        ...freeCanvas.value,
        viewport: currentViewport.value,
      }, 'viewport')
      return
    }
    productionViewport.value = { ...currentViewport.value }
    scheduleLayoutSave()
  }

  async function onAlignNodes() {
    if (!drama.value || !nodes.value.length || aligningNodes.value) return
    const requestedProjectId = currentCanvasProjectId()
    if (!requestedProjectId) return
    if (canvasMode.value === 'free') {
      const selectedIds = selectedFreeNodeIds.value || []
      const reason = getFreeCanvasAlignDisabledReason({
        selectionCount: selectedIds.length,
        readonly: Boolean(freeCanvasUxState?.readonly),
      })
      if (reason) {
        ElMessage.info(reason)
        return
      }
      const nextNodes = alignFreeCanvasNodePositions(freeCanvas.value.nodes, selectedIds, 'left')
      commitFreeCanvasState({ ...freeCanvas.value, nodes: nextNodes }, 'align')
      ElMessage.success('已将所选节点左对齐')
      return
    }
    if (canvasMode.value !== 'production') {
      ElMessage.info('自动对齐用于制作流程节点，请先切换到制作模式')
      return
    }
    if (!await setFocusedCanvasNode(null)) return
    if (!isCanvasProjectCurrent(requestedProjectId)) return
    aligningNodes.value = true
    try {
      const { positions } = computeAutoLayoutPositions(drama.value, {
        episodeId: filterEpisodeId.value,
        workflowGroups: workflowGroups.value,
        imagesBySbId: imagesBySbId.value,
        videosBySbId: videosBySbId.value,
      })
      nodes.value = nodes.value.map((n) => {
        const pos = positions[n.id]
        return pos ? { ...n, position: { x: pos.x, y: pos.y } } : n
      })
      syncProductionGraphPositions()
      layoutCache.value = {
        version: 1,
        nodes: { ...positions },
        viewport: layoutCache.value?.viewport,
      }
      await nextTick()
      if (!isCanvasProjectCurrent(requestedProjectId)) return
      const flowApi = canvasFlowApi.value
      if (flowApi?.fitView) {
        await flowApi.fitView({
          padding: 0.14,
          minZoom: MIN_READABLE_CANVAS_ZOOM,
          maxZoom: 1,
          duration: 380,
          includeHiddenNodes: false,
        })
        if (!isCanvasProjectCurrent(requestedProjectId)) return
        await new Promise((r) => setTimeout(r, 400))
        if (!isCanvasProjectCurrent(requestedProjectId)) return
        const vp = flowApi.getViewport?.()
        if (vp) {
          onViewportChange(vp)
        }
      }
      const saved = await persistCanvasState({ layoutOnly: true })
      if (!saved.ok || !isCanvasProjectCurrent(requestedProjectId)) return
      ElMessage.success('节点已按规则对齐并适配当前视图')
    } catch (e) {
      if (isCanvasUserAbort(e)) return
      ElMessage.error(safeFreeCanvasError(e, '对齐失败'))
    } finally {
      aligningNodes.value = false
    }
  }

  return {
    fitCanvasView,
    zoomCanvasIn,
    zoomCanvasOut,
    toggleCanvasInteractive,
    onCanvasNodesInitialized,
    onSelectionChange,
    onViewportChange,
    syncProductionGraphPositions,
    onCanvasNodeDragStop,
    onCanvasMoveEnd,
    onAlignNodes,
  }
}
