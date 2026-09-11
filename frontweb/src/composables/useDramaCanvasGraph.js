import { nextTick } from 'vue'
import { ElMessage } from '@/utils/elementPlusFeedback.js'

import { assetsAPI } from '@/api/assets'
import { canvasUserError } from '@/composables/useCanvasUserError'
import { createCanvasHistory } from '@/utils/canvasHistory'
import {
  applyCanvasHighlight,
  buildDramaCanvasGraph,
  stampEdgeBaseStyles,
} from '@/utils/dramaCanvasAdapter'
import { parseFreeCanvas } from '@/utils/canvasLayout'
import { mergeCanvasGraphs } from '@/utils/freeCanvasAdapter'
import {
  createEmptyFreeCanvas,
  inspectFreeCanvasCompatibility,
  normalizeFreeCanvas,
} from '@/utils/freeCanvasState'
import { parseWorkflowGroups } from '@/utils/canvasWorkflow'

function safeFreeCanvasError(error, fallback) {
  return canvasUserError(error, fallback || '操作失败，请重试')
}

/** 制作图与自由画布状态的合并、重建、历史和模式切换 */
export function useDramaCanvasGraph(deps) {
  const {
    canvasProjectId,
    dramaId,
    drama,
    nodes,
    edges,
    productionGraph,
    freeCanvas,
    freeCanvasReadOnly,
    freeCanvasCompatibilityMessage,
    canvasMode,
    selectedFreeNodeId,
    selectedFreeNodeIds,
    selectedFreeEdgeIds,
    editingFreeNodeId,
    freeHistoryRevision,
    projectAssets,
    highlightAssetId,
    filterEpisodeId,
    savedLayout,
    workflowGroups,
    activeGroupId,
    imagesBySbId,
    videosBySbId,
    getStoryboardMediaQueryStatus,
    currentViewport,
    productionViewport,
    canvasFlowApi,
    freeGraph,
    focusedNodeId,
    setFocusedCanvasNode,
    isCanvasAbortError,
    scheduleLayoutSave,
    resetFreeCanvasClipboard,
    finishFreeCanvasNodeEditing,
    closeFreeCanvasInspector,
  } = deps

  let freeCanvasHistory = createCanvasHistory(freeCanvas.value)

  function freeCanvasUiMode(mode) {
    return mode === 'free' || mode === 'hybrid' ? 'free' : 'production'
  }

  function normalizeFreeCanvasForProject(input) {
    return normalizeFreeCanvas({
      ...input,
      projectId: Number.isFinite(canvasProjectId.value) && canvasProjectId.value > 0 ? canvasProjectId.value : undefined,
    })
  }

  function hydrateFreeCanvasState(metadata) {
    const persisted = parseFreeCanvas(metadata)
    const compatibility = inspectFreeCanvasCompatibility(persisted)
    freeCanvasReadOnly.value = !compatibility.compatible
    freeCanvasCompatibilityMessage.value = compatibility.message
    const normalized = compatibility.compatible
      ? normalizeFreeCanvasForProject(persisted)
      : createEmptyFreeCanvas({
        mode: 'production',
        projectId: Number.isFinite(canvasProjectId.value) && canvasProjectId.value > 0 ? canvasProjectId.value : undefined,
      })
    freeCanvas.value = normalized
    canvasMode.value = freeCanvasUiMode(normalized.mode)
    freeCanvasHistory = createCanvasHistory(normalized)
    freeHistoryRevision.value += 1
    selectedFreeNodeId.value = null
    selectedFreeNodeIds.value = []
    selectedFreeEdgeIds.value = []
    editingFreeNodeId.value = null
    resetFreeCanvasClipboard()
  }

  async function loadProjectAssets(projectId, requestOptions = {}) {
    try {
      const response = await assetsAPI.list({ drama_id: projectId, page_size: 100 }, requestOptions)
      if (Number(projectId) !== Number(dramaId.value)) return
      projectAssets.value = (response?.items || []).filter((asset) => (
        asset?.drama_id == null || Number(asset.drama_id) === Number(projectId)
      ))
    } catch (error) {
      if (isCanvasAbortError(error, requestOptions.signal)) throw error
      if (Number(projectId) === Number(dramaId.value)) projectAssets.value = []
    }
  }

  function modeScopedProductionGraph() {
    const freeMode = canvasMode.value === 'free'
    return {
      nodes: productionGraph.value.nodes.map((node) => ({
        ...node,
        connectable: false,
        deletable: false,
        draggable: freeMode ? false : node.draggable,
        selectable: freeMode ? false : node.selectable,
        focusable: freeMode ? false : node.focusable,
      })),
      edges: productionGraph.value.edges.map((edge) => ({
        ...edge,
        deletable: false,
        updatable: false,
      })),
    }
  }

  function mergeActiveCanvasGraphs() {
    const merged = mergeCanvasGraphs(modeScopedProductionGraph(), freeGraph.value, canvasMode.value, {
      hideProductionNodes: canvasMode.value === 'free' && Boolean(freeCanvas.value.hideProductionNodes),
    })
    nodes.value = merged.nodes
    edges.value = merged.edges
  }

  function pruneFreeCanvasSelection() {
    const nodeIds = new Set(freeCanvas.value.nodes.map((node) => String(node.id)))
    const edgeIds = new Set(freeCanvas.value.edges.map((edge) => String(edge.id)))
    selectedFreeNodeIds.value = selectedFreeNodeIds.value.filter((id) => nodeIds.has(String(id)))
    selectedFreeEdgeIds.value = selectedFreeEdgeIds.value.filter((id) => edgeIds.has(String(id)))
    if (!nodeIds.has(String(selectedFreeNodeId.value))) selectedFreeNodeId.value = null
    if (!nodeIds.has(String(editingFreeNodeId.value))) editingFreeNodeId.value = null
  }

  function commitFreeCanvasState(nextState, reason, { save = true } = {}) {
    if (freeCanvasReadOnly.value) {
      ElMessage.warning(freeCanvasCompatibilityMessage.value || '当前自由画布处于只读保护状态')
      return freeCanvas.value
    }
    let normalized
    try {
      normalized = normalizeFreeCanvasForProject(nextState)
    } catch (error) {
      ElMessage.warning(safeFreeCanvasError(error, '自由画布内容不符合保存要求'))
      return freeCanvas.value
    }
    freeCanvas.value = freeCanvasHistory.commit(normalized, reason)
    canvasMode.value = freeCanvasUiMode(freeCanvas.value.mode)
    pruneFreeCanvasSelection()
    freeHistoryRevision.value += 1
    mergeActiveCanvasGraphs()
    if (save) scheduleLayoutSave()
    return freeCanvas.value
  }

  async function applyFreeCanvasHistoryState(nextState) {
    const activeMode = canvasMode.value
    freeCanvas.value = normalizeFreeCanvasForProject({
      ...nextState,
      mode: activeMode,
    })
    pruneFreeCanvasSelection()
    freeHistoryRevision.value += 1
    mergeActiveCanvasGraphs()
    const targetViewport = canvasMode.value === 'free'
      ? freeCanvas.value.viewport
      : productionViewport.value
    currentViewport.value = { ...targetViewport }
    await nextTick()
    await canvasFlowApi.value?.setViewport?.(targetViewport, { duration: 180 })
    scheduleLayoutSave()
  }

  async function setCanvasMode(mode, { preserveRouteFocusOwnership = false } = {}) {
    const nextMode = mode === 'free' ? 'free' : 'production'
    if (nextMode === canvasMode.value) return
    if (nextMode === 'free' && freeCanvasReadOnly.value) {
      ElMessage.warning(freeCanvasCompatibilityMessage.value || '当前自由画布版本需要升级后编辑')
      return
    }
    if (focusedNodeId.value && !await setFocusedCanvasNode(null)) return

    let nextFreeCanvas = freeCanvas.value
    if (canvasMode.value === 'free') {
      nextFreeCanvas = normalizeFreeCanvasForProject({
        ...nextFreeCanvas,
        viewport: currentViewport.value,
      })
    } else {
      productionViewport.value = { ...currentViewport.value }
    }

    freeCanvas.value = normalizeFreeCanvasForProject({
      ...nextFreeCanvas,
      mode: nextMode,
    })
    canvasMode.value = nextMode
    if (nextMode === 'production') {
      finishFreeCanvasNodeEditing()
      closeFreeCanvasInspector({
        restoreFocus: false,
        invalidateFocus: !preserveRouteFocusOwnership,
      })
    }
    freeHistoryRevision.value += 1
    mergeActiveCanvasGraphs()

    const targetViewport = nextMode === 'free' ? freeCanvas.value.viewport : productionViewport.value
    currentViewport.value = { ...targetViewport }
    await nextTick()
    await canvasFlowApi.value?.setViewport?.(targetViewport, { duration: 180 })
    scheduleLayoutSave()
  }

  function undoFreeCanvas() {
    if (canvasMode.value !== 'free' || freeCanvasReadOnly.value) return
    if (!freeCanvasHistory.canUndo()) return
    void applyFreeCanvasHistoryState(freeCanvasHistory.undo())
  }

  function redoFreeCanvas() {
    if (canvasMode.value !== 'free' || freeCanvasReadOnly.value) return
    if (!freeCanvasHistory.canRedo()) return
    void applyFreeCanvasHistoryState(freeCanvasHistory.redo())
  }

  function setFreeCanvasBackground(background) {
    if (canvasMode.value !== 'free' || !['dots', 'lines', 'none'].includes(background)) return
    commitFreeCanvasState({ ...freeCanvas.value, background }, 'background')
  }

  function setHideProductionNodes(hidden) {
    if (canvasMode.value !== 'free') return
    const hideProductionNodes = Boolean(hidden)
    if (Boolean(freeCanvas.value.hideProductionNodes) === hideProductionNodes) return
    commitFreeCanvasState({ ...freeCanvas.value, hideProductionNodes }, 'hide-production')
  }

  function syncWorkflowFromDrama() {
    workflowGroups.value = parseWorkflowGroups(drama.value?.metadata)
    if (activeGroupId.value && !workflowGroups.value.some((g) => g.id === activeGroupId.value)) {
      activeGroupId.value = null
    }
  }

  function rebuildGraph() {
    if (!drama.value) {
      productionGraph.value = { nodes: [], edges: [] }
      nodes.value = []
      edges.value = []
      return
    }
    const graph = buildDramaCanvasGraph(drama.value, {
      episodeId: filterEpisodeId.value,
      savedLayout: savedLayout.value,
      workflowGroups: workflowGroups.value,
      imagesBySbId: imagesBySbId.value,
      videosBySbId: videosBySbId.value,
    })
    let nextNodes = graph.nodes.map((node) => {
      if (node.type !== 'canvasStoryboard') return node
      const storyboardId = node.data?.storyboard?.id
      return {
        ...node,
        data: {
          ...node.data,
          mediaQueryStatus: storyboardId != null ? getStoryboardMediaQueryStatus(storyboardId) : null,
        },
      }
    })
    let nextEdges = stampEdgeBaseStyles(graph.edges)
    if (highlightAssetId.value) {
      const highlighted = applyCanvasHighlight(nextNodes, nextEdges, highlightAssetId.value, drama.value)
      nextNodes = highlighted.nodes
      nextEdges = highlighted.edges
    }
    productionGraph.value = { nodes: nextNodes, edges: nextEdges }
    mergeActiveCanvasGraphs()
  }

  function applyHighlight() {
    if (!productionGraph.value.nodes.length) return
    const highlighted = applyCanvasHighlight(
      productionGraph.value.nodes.map((n) => ({
        ...n,
        class: undefined,
        data: { ...n.data, highlighted: false, dimmed: false },
      })),
      productionGraph.value.edges,
      highlightAssetId.value,
      drama.value
    )
    productionGraph.value = highlighted
    mergeActiveCanvasGraphs()
  }

  function selectSidebarAsset(assetNodeId) {
    highlightAssetId.value = highlightAssetId.value === assetNodeId ? null : assetNodeId
    applyHighlight()
  }

  function setHighlightAsset(assetNodeId) {
    highlightAssetId.value = assetNodeId
    applyHighlight()
  }

  function clearAssetHighlight() {
    highlightAssetId.value = null
    applyHighlight()
  }

  function canUndoFreeCanvasHistory() {
    return freeCanvasHistory.canUndo()
  }

  function canRedoFreeCanvasHistory() {
    return freeCanvasHistory.canRedo()
  }

  return {
    freeCanvasUiMode,
    normalizeFreeCanvasForProject,
    hydrateFreeCanvasState,
    loadProjectAssets,
    modeScopedProductionGraph,
    mergeActiveCanvasGraphs,
    pruneFreeCanvasSelection,
    commitFreeCanvasState,
    applyFreeCanvasHistoryState,
    setCanvasMode,
    undoFreeCanvas,
    redoFreeCanvas,
    setFreeCanvasBackground,
    setHideProductionNodes,
    syncWorkflowFromDrama,
    rebuildGraph,
    applyHighlight,
    selectSidebarAsset,
    setHighlightAsset,
    clearAssetHighlight,
    canUndoFreeCanvasHistory,
    canRedoFreeCanvasHistory,
  }
}
