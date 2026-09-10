import { nextTick, watch } from 'vue'
import { ElMessage, ElMessageBox } from '@/utils/elementPlusFeedback.js'

import {
  alignFreeCanvasNodePositions,
  getFreeCanvasAlignDisabledReason,
  isFreeCanvasDeleteShortcutBlocked as isDeleteShortcutBlockedByUx,
  setFreeCanvasUxState,
} from '@/components/dramaCanvas/freeCanvasUx'

import { assetsAPI } from '@/api/assets'
import { characterAPI } from '@/api/characters'
import { propAPI } from '@/api/props'
import { sceneAPI } from '@/api/scenes'
import { storyboardsAPI } from '@/api/storyboards'
import { uploadAPI } from '@/api/upload'
import { canvasUserError, isCanvasUserAbort } from '@/composables/useCanvasUserError'
import {
  FREE_CANVAS_MEDIA_DRAG_TYPE,
  buildFreeCanvasAssetReferencePatch,
  buildFreeCanvasStoryboardMediaItems,
  freeCanvasMediaUrl,
  getFreeCanvasAssetSaveEligibility,
  normalizeFreeCanvasMediaPath,
  parseFreeCanvasMediaDragPayload,
  resolveFreeCanvasMediaPath,
} from '@/utils/freeCanvasMedia'
import {
  MEDIA_LIBRARY_MAX_FILE_SIZE_LABEL,
  partitionMediaLibraryUploads,
} from '@/utils/mediaUploadValidation'
import {
  cloneFreeSelection,
  createFreeEdge,
  createFreeNode,
  findFreeNodeSpawnPosition,
  normalizeFreeCanvas,
  removeFreeSelection,
  screenRectToFreeCanvasBounds,
  serializeFreeCanvas,
  synchronizeFreeCanvasSelection,
} from '@/utils/freeCanvasState'

/** 把自由画布异常转成可展示的简体中文 */
export function safeFreeCanvasError(error, fallback) {
  return canvasUserError(error, fallback || '操作失败，请重试')
}

/** 自由画布操作：创建/更新/删除/选择/键盘/粘贴/拖放/转换/保存为素材 */
export function useDramaCanvasFreeCanvas(deps) {
  const {
    canvasMode,
    setCanvasMode,
    freeCanvas,
    freeCanvasReadOnly,
    nodes,
    edges,
    selectedFreeNodeId,
    selectedFreeNodeIds,
    selectedFreeEdgeIds,
    editingFreeNodeId,
    canvasMainRef,
    currentViewport,
    freeCanvasConfigRuntimeById,
    openAiConfig,
    commitFreeCanvasState,
    refreshProductionReadiness,
    refreshFreeCanvasVideoCapability,
    projectAssets,
    projectAssetsById,
    storyboardsById,
    drama,
    dramaId,
    canvasInstanceActive,
    freeMediaPickerVisible,
    freeLibraryVisible,
    freeCanvasUploading,
    freeCanvasUploadStatus,
    filterEpisodeId,
    imagesBySbId,
    videosBySbId,
    mediaStatusBySbId,
    freeStoryboardMediaItems,
    loadProjectAssets,
    loadForDrama,
    persistCanvasState,
    loadCanvasProject,
    mergeActiveCanvasGraphs,
    cancelScheduledCanvasSave,
    normalizeFreeCanvasForProject,
    contextMenuVisible,
    closeContextMenu,
    closeFreeCanvasInspector,
    undoFreeCanvas,
    redoFreeCanvas,
    claimCanvasEntityFocus,
    ownsCanvasEntityFocus,
    waitForFreeCanvasInspectorFocus,
    screenToFlowPosition,
    freeInspectorBusy,
    freeInspectorAction,
  } = deps

  let ignoreEmptyFreeSelectionUntil = 0
  let freeClipboard = null
  let freePasteCount = 0

  function shouldIgnoreEmptyFreeSelection() {
    return Date.now() < ignoreEmptyFreeSelectionUntil
  }

  function resetFreeCanvasClipboard() {
    freeClipboard = null
    freePasteCount = 0
  }

  function isFreeCanvasNodeId(nodeId) {
    return freeCanvas.value.nodes.some((node) => String(node.id) === String(nodeId))
  }

  function freeCanvasSafeBounds() {
    const rect = canvasMainRef.value?.getBoundingClientRect?.()
    if (!rect) return undefined
    return screenRectToFreeCanvasBounds(rect, currentViewport.value, {
      insets: {
        left: 64,
        top: 24,
        right: 180 + (selectedFreeNodeId.value ? 0 : 380),
        bottom: 96,
      },
    })
  }

  function defaultFreeNodePosition(position = null) {
    const bounds = freeCanvasSafeBounds()
    const supplied = position && Number.isFinite(position.x) && Number.isFinite(position.y)
      ? { x: position.x, y: position.y }
      : null
    const preferred = supplied || (bounds
      ? {
        x: bounds.left + Math.max(0, bounds.right - bounds.left - 280) / 2,
        y: bounds.top + Math.max(0, bounds.bottom - bounds.top - 208) / 2,
      }
      : { x: 80, y: 80 })
    return findFreeNodeSpawnPosition(preferred, nodes.value, { bounds })
      || findFreeNodeSpawnPosition(preferred, nodes.value)
  }

  function freeNodeDefaults(type) {
    const labels = {
      text: '文本灵感',
      image: '图片参考',
      video: '视频参考',
      config: '生成配置',
      reference: '制作引用',
    }
    return {
      title: labels[type] || '自由节点',
      ...(type === 'text' || type === 'config' ? { content: '' } : {}),
      ...(type === 'config' ? { status: 'idle' } : {}),
    }
  }

  function freeCanvasConfigRuntime(node) {
    if (node?.type !== 'config') return undefined
    return freeCanvasConfigRuntimeById.value.get(String(node.id))
  }

  function configureFreeCanvasNode(nodeId) {
    if (!isFreeCanvasNodeId(nodeId)) return
    openAiConfig(freeCanvasConfigRuntimeById.value.get(String(nodeId))?.serviceType || 'video', nodeId)
  }

  function setFreeCanvasConfigOperationState(nodeId, status, metadata = {}) {
    if (!['idle', 'running', 'failed', 'cancelled'].includes(status)) return false
    const node = freeCanvas.value.nodes.find((item) => String(item.id) === String(nodeId))
    if (node?.type !== 'config') return false
    const nextNodes = freeCanvas.value.nodes.map((item) => (
      String(item.id) === String(nodeId)
        ? { ...item, status, metadata }
        : item
    ))
    commitFreeCanvasState({ ...freeCanvas.value, nodes: nextNodes }, `config:${status}:${nodeId}`)
    return true
  }

  function cancelFreeCanvasConfig(nodeId) {
    const runtime = freeCanvasConfigRuntimeById.value.get(String(nodeId))
    if (!runtime?.canCancel) return
    const node = freeCanvas.value.nodes.find((item) => String(item.id) === String(nodeId))
    setFreeCanvasConfigOperationState(nodeId, 'cancelled', {
      ...(node?.metadata?.operationId ? { operationId: node.metadata.operationId } : {}),
      updatedAt: new Date().toISOString(),
    })
    ElMessage.warning('已停止等待；已提交任务可能继续执行并产生供应商计费')
  }

  async function retryFreeCanvasConfig(nodeId) {
    const runtime = freeCanvasConfigRuntimeById.value.get(String(nodeId))
    if (!runtime?.canRetry) return
    if (['failed', 'cancelled'].includes(runtime.status)) {
      setFreeCanvasConfigOperationState(nodeId, 'idle', { updatedAt: new Date().toISOString() })
    }
    await Promise.all([refreshProductionReadiness(), refreshFreeCanvasVideoCapability()])
  }

  async function createFreeCanvasNode(type, position = null, overrides = {}) {
    if (!['text', 'image', 'video', 'config', 'reference'].includes(type)) return null
    if (canvasMode.value !== 'free') await setCanvasMode('free')
    if (canvasMode.value !== 'free') return null
    if (freeCanvas.value.nodes.length >= 500) {
      ElMessage.warning('自由画布已达到 500 个节点上限，请先整理后再添加')
      return null
    }
    if (freeCanvas.value.nodes.length >= 400) {
      ElMessage.warning(`自由画布节点较多（${freeCanvas.value.nodes.length}/500），继续添加可能影响操作流畅度`)
    }

    const spawnPosition = defaultFreeNodePosition(position)
    if (!spawnPosition) {
      ElMessage.warning('当前可见区域没有足够的空位，请移动或缩放画布后重试')
      return null
    }
    const node = createFreeNode(type, {
      ...freeNodeDefaults(type),
      ...overrides,
      position: spawnPosition,
    })
    selectedFreeNodeId.value = node.id
    selectedFreeNodeIds.value = [node.id]
    selectedFreeEdgeIds.value = []
    ignoreEmptyFreeSelectionUntil = Date.now() + 1500
    commitFreeCanvasState({
      ...freeCanvas.value,
      nodes: [...freeCanvas.value.nodes, node],
    }, `create:${type}`)
    return node
  }

  function updateFreeCanvasNode(payload = {}) {
    const nodeId = payload.id
    if (!isFreeCanvasNodeId(nodeId)) return
    const allowed = ['title', 'content', 'storyboard_ref']
    const patch = Object.fromEntries(
      allowed.filter((key) => Object.prototype.hasOwnProperty.call(payload, key)).map((key) => [key, payload[key]]),
    )
    const nextNodes = freeCanvas.value.nodes.map((node) => {
      if (String(node.id) !== String(nodeId)) return node
      const assetPatch = Object.prototype.hasOwnProperty.call(payload, 'asset_ref')
        ? buildFreeCanvasAssetReferencePatch(node, payload.asset_ref, projectAssetsById.value)
        : {}
      const nextNode = { ...node, ...patch, ...assetPatch }
      if ((node.type === 'image' || node.type === 'video') && !String(nextNode.content || '').trim()) {
        delete nextNode.content
      }
      return nextNode
    })
    commitFreeCanvasState({ ...freeCanvas.value, nodes: nextNodes }, `text:${nodeId}`)
  }

  function updateFreeNodeContent(payload = {}) {
    const nodeId = payload.id
    if (!isFreeCanvasNodeId(nodeId)) return
    const nextNodes = freeCanvas.value.nodes.map((node) => (
      String(node.id) === String(nodeId) ? { ...node, content: String(payload.content || '') } : node
    ))
    commitFreeCanvasState({ ...freeCanvas.value, nodes: nextNodes }, `text:${nodeId}`)
  }

  function activateFreeCanvasNode(nodeId, { focusInspector = true, ownership = null } = {}) {
    if (!isFreeCanvasNodeId(nodeId)) return
    const focusOwnership = ownership || (focusInspector ? claimCanvasEntityFocus(nodeId) : null)
    if (focusOwnership && !ownsCanvasEntityFocus(focusOwnership)) return
    const selection = synchronizeFreeCanvasSelection(nodes.value, nodeId)
    nodes.value = selection.nodes
    edges.value = edges.value.map((edge) => ({ ...edge, selected: false }))
    selectedFreeNodeIds.value = selection.nodeIds
    selectedFreeEdgeIds.value = selection.edgeIds
    selectedFreeNodeId.value = selection.focusedNodeId
    if (!focusInspector) return
    void waitForFreeCanvasInspectorFocus(focusOwnership)
  }

  function openFreeCanvasInspectorFor(nodeId) {
    activateFreeCanvasNode(nodeId)
  }

  function startFreeCanvasNodeEditing(nodeId) {
    const node = freeCanvas.value.nodes.find((item) => String(item.id) === String(nodeId))
    if (canvasMode.value !== 'free' || freeCanvasReadOnly.value || node?.type !== 'text') return
    editingFreeNodeId.value = node.id
    void nextTick(() => {
      const nodeElement = [...document.querySelectorAll('.vue-flow__node')]
        .find((element) => element.dataset.id === String(node.id))
      const textarea = nodeElement?.querySelector('.node-editor textarea')
      textarea?.focus({ preventScroll: true })
      textarea?.select?.()
    })
  }

  function finishFreeCanvasNodeEditing(exceptNodeId = null) {
    if (exceptNodeId != null && String(editingFreeNodeId.value) === String(exceptNodeId)) return
    editingFreeNodeId.value = null
  }

  async function focusFreeCanvasNodeTrigger(nodeId) {
    if (!nodeId) return
    await nextTick()
    const nodeElement = [...document.querySelectorAll('.vue-flow__node')]
      .find((element) => element.dataset.id === String(nodeId))
    nodeElement?.querySelector('.free-canvas-node')?.focus({ preventScroll: true })
  }

  function removeFreeCanvasItems(nodeIds = [], edgeIds = []) {
    const withoutNodes = removeFreeSelection(freeCanvas.value, nodeIds)
    const removedEdges = new Set(edgeIds.map(String))
    const nextState = normalizeFreeCanvasForProject({
      ...withoutNodes,
      edges: withoutNodes.edges.filter((edge) => !removedEdges.has(String(edge.id))),
    })
    if (
      nextState.nodes.length === freeCanvas.value.nodes.length
      && nextState.edges.length === freeCanvas.value.edges.length
    ) return false
    commitFreeCanvasState(nextState, 'delete')
    return true
  }

  /** 删除前弹出中文确认，避免快捷键或误点直接丢掉节点 */
  async function confirmFreeCanvasDeletion({ nodeIds = [], edgeIds = [] } = {}) {
    const nodeCount = (nodeIds || []).length
    const edgeCount = (edgeIds || []).length
    if (!nodeCount && !edgeCount) return false
    let subject = '所选内容'
    if (nodeCount && !edgeCount) {
      subject = nodeCount === 1 ? '该节点' : ('所选 ' + nodeCount + ' 个节点')
    } else if (!nodeCount && edgeCount) {
      subject = edgeCount === 1 ? '该连线' : ('所选 ' + edgeCount + ' 条连线')
    } else {
      subject = '所选 ' + nodeCount + ' 个节点和 ' + edgeCount + ' 条连线'
    }
    try {
      await ElMessageBox.confirm(
        '确定删除' + subject + '？此操作不可恢复。',
        '删除确认',
        { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
      )
      return true
    } catch {
      return false
    }
  }

  async function deleteFreeCanvasNode(nodeId) {
    if (!isFreeCanvasNodeId(nodeId)) return false
    if (!await confirmFreeCanvasDeletion({ nodeIds: [nodeId] })) return false
    return removeFreeCanvasItems([nodeId])
  }

  function readDomSelectedFreeNodeIds() {
    if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') return []
    return [...document.querySelectorAll('.vue-flow__node.selected [data-free-node-id], .free-canvas-node[data-free-node-id]')]
      .filter((element) => element.closest?.('.vue-flow__node.selected'))
      .map((element) => element.getAttribute('data-free-node-id'))
      .filter((id) => isFreeCanvasNodeId(id))
  }

  function currentVisualFreeCanvasSelection() {
    const nodeIds = nodes.value
      .filter((node) => node.selected && isFreeCanvasNodeId(node.id))
      .map((node) => node.id)
    const freeEdgeIds = new Set(freeCanvas.value.edges.map((edge) => String(edge.id)))
    const edgeIds = edges.value
      .filter((edge) => edge.selected && freeEdgeIds.has(String(edge.id)))
      .map((edge) => edge.id)
    if (nodeIds.length || edgeIds.length) return { nodeIds, edgeIds }
    const existingNodes = new Set(freeCanvas.value.nodes.map((node) => String(node.id)))
    const existingEdges = new Set(freeCanvas.value.edges.map((edge) => String(edge.id)))
    const internalNodeIds = selectedFreeNodeIds.value.filter((id) => existingNodes.has(String(id)))
    const internalEdgeIds = selectedFreeEdgeIds.value.filter((id) => existingEdges.has(String(id)))
    if (internalNodeIds.length || internalEdgeIds.length) {
      return { nodeIds: internalNodeIds, edgeIds: internalEdgeIds }
    }
    const domNodeIds = [...new Set(readDomSelectedFreeNodeIds())].filter((id) => existingNodes.has(String(id)))
    return {
      nodeIds: domNodeIds.map((id) => freeCanvas.value.nodes.find((node) => String(node.id) === String(id))?.id).filter(Boolean),
      edgeIds: [],
    }
  }

  function syncVisualFreeCanvasSelection() {
    const selection = currentVisualFreeCanvasSelection()
    selectedFreeNodeIds.value = selection.nodeIds
    selectedFreeEdgeIds.value = selection.edgeIds
    selectedFreeNodeId.value = selection.nodeIds.length === 1 ? selection.nodeIds[0] : null
    return selection
  }

  async function deleteFreeCanvasSelection() {
    const { nodeIds, edgeIds } = syncVisualFreeCanvasSelection()
    if (!await confirmFreeCanvasDeletion({ nodeIds, edgeIds })) return false
    const removed = removeFreeCanvasItems(nodeIds, edgeIds)
    if (removed) {
      cancelScheduledCanvasSave()
      void persistCanvasState({ freeOnly: true })
    }
    return removed
  }

  function retryFreeCanvasNode(nodeId) {
    if (!isFreeCanvasNodeId(nodeId)) return
    void loadProjectAssets(dramaId.value).then(() => {
      mergeActiveCanvasGraphs()
      ElMessage.success('节点引用已重新加载')
    })
  }

  function isValidFreeConnection(connection = {}) {
    return canvasMode.value === 'free'
      && connection.source !== connection.target
      && isFreeCanvasNodeId(connection.source)
      && isFreeCanvasNodeId(connection.target)
  }

  function onFreeCanvasConnect(connection) {
    if (!isValidFreeConnection(connection)) return
    const exists = freeCanvas.value.edges.some((edge) => (
      String(edge.source) === String(connection.source)
      && String(edge.target) === String(connection.target)
    ))
    if (exists) return
    if (freeCanvas.value.edges.length >= 1000) {
      ElMessage.warning('自由画布已达到 1000 条连线上限')
      return
    }
    const edge = createFreeEdge(String(connection.source), String(connection.target), {
      type: 'default',
    })
    commitFreeCanvasState({
      ...freeCanvas.value,
      edges: [...freeCanvas.value.edges, edge],
    }, 'connect')
  }

  function localMediaReference(nodeOrAsset) {
    const candidate = nodeOrAsset?.storageKey
      || nodeOrAsset?.local_path
      || ((nodeOrAsset?.type === 'image' || nodeOrAsset?.type === 'video') ? nodeOrAsset?.content : '')
      || ''
    return normalizeFreeCanvasMediaPath(candidate)
  }

  function resolveFreeCanvasNodeMediaUrl(node) {
    return freeCanvasMediaUrl(node, projectAssetsById.value)
  }

  function openFreeCanvasMediaPicker() {
    if (canvasMode.value !== 'free') return
    freeMediaPickerVisible.value = true
  }

  function toggleFreeCanvasLibrary() {
    if (canvasMode.value !== 'free') return
    freeLibraryVisible.value = !freeLibraryVisible.value
  }

  async function createFreeEntityReference({ kind, item } = {}) {
    if (canvasMode.value !== 'free' || !item || !['character', 'scene', 'prop'].includes(kind)) return
    const kindLabel = { character: '角色', scene: '场景', prop: '道具' }[kind]
    const title = item.name || item.location || `${kindLabel} ${item.id || ''}`.trim()
    const content = [item.description, item.appearance, item.personality, item.time]
      .map((value) => String(value || '').trim())
      .filter(Boolean)
      .join('\n')
    await createFreeCanvasNode('reference', null, {
      title: `${kindLabel} · ${title}`,
      content,
      ...(kind === 'scene' && item.id ? { sceneId: item.id } : {}),
    })
  }

  async function createFreeNodeFromLibraryItem(item, position = null) {
    const itemProjectId = item?.projectId ?? item?.project_id ?? item?.drama_id ?? item?.dramaId
    if (itemProjectId != null && Number(itemProjectId) !== Number(dramaId.value)) {
      ElMessage.warning('请选择当前项目的媒体素材')
      return
    }
    if (item?.storyboardId && item?.storageKey) {
      await createFreeCanvasNode(item.type === 'video' ? 'video' : 'image', position, {
        title: item.label || (item.type === 'video' ? '分镜视频' : '分镜图片'),
        storyboard_ref: item.storyboardId,
        storyboardId: item.storyboardId,
        storageKey: item.storageKey,
        content: item.storageKey,
      })
      return
    }
    await createFreeNodeFromAsset(item, position)
  }

  async function onFreeCanvasMediaPicked(asset) {
    const added = await createFreeNodeFromAsset(asset)
    if (added) freeMediaPickerVisible.value = false
  }

  async function createFreeNodeFromAsset(asset, position = null) {
    const sourceDramaId = asset?.drama_id
    if (sourceDramaId != null && Number(sourceDramaId) !== Number(dramaId.value)) {
      ElMessage.warning('请选择当前项目或全局素材，其他项目素材需要先复制到当前项目')
      return false
    }
    const assetType = asset?.type === 'video' ? 'video' : 'image'
    const storageKey = localMediaReference(asset)
    const current = projectAssets.value.filter((item) => Number(item.id) !== Number(asset.id))
    projectAssets.value = [asset, ...current]
    await createFreeCanvasNode(assetType, position, {
      title: asset?.name || (assetType === 'video' ? '视频素材' : '图片素材'),
      asset_ref: asset?.id,
      assetId: asset?.id,
      ...(storageKey ? { storageKey, content: storageKey } : {}),
    })
    return true
  }

  function isMediaFile(file) {
    return /^(?:image|video)\//i.test(String(file?.type || ''))
  }

  async function uploadFreeCanvasFiles(files, position = null) {
    if (canvasMode.value !== 'free' || freeCanvasUploading.value) return
    const requestedDramaId = dramaId.value
    const selectedFiles = Array.from(files || [])
    const supported = selectedFiles.filter(isMediaFile)
    const unsupportedCount = selectedFiles.length - supported.length
    const { accepted, oversized } = partitionMediaLibraryUploads(supported)
    if (unsupportedCount) ElMessage.warning(`已跳过 ${unsupportedCount} 个非图片或视频文件`)
    if (oversized.length) {
      ElMessage.warning(`${oversized.length} 个文件超过单文件 ${MEDIA_LIBRARY_MAX_FILE_SIZE_LABEL} 限制`)
    }
    if (!accepted.length) return

    freeCanvasUploading.value = true
    let succeeded = 0
    try {
      for (const [index, file] of accepted.entries()) {
        if (!canvasInstanceActive.value || requestedDramaId !== dramaId.value) break
        freeCanvasUploadStatus.value = `正在上传 ${index + 1}/${accepted.length}`
        try {
          const asset = await uploadAPI.uploadAsset(file, { dramaId: requestedDramaId })
          if (!canvasInstanceActive.value || requestedDramaId !== dramaId.value) break
          const existing = projectAssets.value.filter((item) => Number(item.id) !== Number(asset.id))
          projectAssets.value = [asset, ...existing]
          const nodePosition = position
            ? { x: position.x + index * 28, y: position.y + index * 28 }
            : null
          await createFreeNodeFromAsset(asset, nodePosition)
          succeeded += 1
        } catch (error) {
          if (isCanvasUserAbort(error)) continue
          ElMessage.warning(`${file.name || '素材'} 上传失败：${safeFreeCanvasError(error, '请稍后重试')}`)
        }
      }
    } finally {
      if (canvasInstanceActive.value && requestedDramaId === dramaId.value) {
        freeCanvasUploading.value = false
        freeCanvasUploadStatus.value = ''
      }
    }
    if (succeeded) ElMessage.success(`已添加 ${succeeded} 个素材到自由画布`)
  }

  function onFreeCanvasDragOver(event) {
    const types = Array.from(event?.dataTransfer?.types || [])
    if (
      canvasMode.value !== 'free'
      || (!types.includes('Files') && !types.includes(FREE_CANVAS_MEDIA_DRAG_TYPE))
    ) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }

  function onFreeCanvasDrop(event) {
    if (canvasMode.value !== 'free') return
    const files = Array.from(event?.dataTransfer?.files || [])
    if (files.length) {
      event.preventDefault()
      const position = screenToFlowPosition(event.clientX, event.clientY)
      void uploadFreeCanvasFiles(files, position)
      return
    }
    const types = Array.from(event?.dataTransfer?.types || [])
    if (!types.includes(FREE_CANVAS_MEDIA_DRAG_TYPE)) return
    event.preventDefault()
    const payload = parseFreeCanvasMediaDragPayload(
      event.dataTransfer.getData(FREE_CANVAS_MEDIA_DRAG_TYPE),
      dramaId.value,
    )
    if (!payload) return
    const item = payload.kind === 'storyboard-media'
      ? freeStoryboardMediaItems.value.find((candidate) => (
        String(candidate.id) === payload.mediaId
        && String(candidate.storyboardId) === payload.storyboardId
        && Number(candidate.projectId) === payload.projectId
      ))
      : projectAssets.value.find((candidate) => (
        String(candidate.id) === payload.mediaId
        && (candidate.drama_id == null || Number(candidate.drama_id) === payload.projectId)
      ))
    if (!item) return
    const position = screenToFlowPosition(event.clientX, event.clientY)
    if (!position) return
    void createFreeNodeFromLibraryItem(item, position)
  }

  function isTypingTarget(target) {
    return Boolean(target?.closest?.(
      'input, textarea, select, [contenteditable="true"], [contenteditable="plaintext-only"], [role="textbox"], .el-input, .el-textarea, .el-select',
    ))
  }

  function isEditableKeyTarget(target) {
    return isTypingTarget(target) || Boolean(target?.closest?.(
      'button, video, audio, .el-popper, .free-canvas-inspector-dock, .canvas-inspector-dock',
    ))
  }

  function isFreeCanvasDeleteShortcutBlocked(event) {
    const activeElement = (typeof document !== 'undefined' && document)
      ? document.activeElement
      : null
    return isDeleteShortcutBlockedByUx({
      target: event?.target,
      activeElement,
    })
  }

  function selectAllFreeCanvasNodes() {
    selectedFreeNodeIds.value = freeCanvas.value.nodes.map((node) => node.id)
    selectedFreeEdgeIds.value = []
    selectedFreeNodeId.value = selectedFreeNodeIds.value.length === 1 ? selectedFreeNodeIds.value[0] : null
    nodes.value = nodes.value.map((node) => ({
      ...node,
      selected: isFreeCanvasNodeId(node.id),
    }))
    edges.value = edges.value.map((edge) => ({ ...edge, selected: false }))
  }

  function copyFreeCanvasSelection() {
    const { nodeIds } = syncVisualFreeCanvasSelection()
    if (!nodeIds.length) return false
    freeClipboard = {
      projectId: Number(dramaId.value),
      state: serializeFreeCanvas(freeCanvas.value),
      nodeIds: nodeIds.map((id) => String(id)),
    }
    freePasteCount = 0
    return true
  }

  function pasteFreeCanvasSelection() {
    if (!freeClipboard || Number(freeClipboard.projectId) !== Number(dramaId.value)) return false
    const sourceState = normalizeFreeCanvas(freeClipboard.state)
    const offset = 24 * (freePasteCount + 1)
    const cloned = cloneFreeSelection(sourceState, freeClipboard.nodeIds, { x: offset, y: offset })
    const originalNodeIds = new Set(sourceState.nodes.map((node) => String(node.id)))
    const originalEdgeIds = new Set(sourceState.edges.map((edge) => String(edge.id)))
    const available = Math.max(0, 500 - freeCanvas.value.nodes.length)
    const copiedNodes = cloned.nodes
      .filter((node) => !originalNodeIds.has(String(node.id)))
    if (!copiedNodes.length) {
      ElMessage.warning(available ? '复制内容已不可用' : '自由画布已达到 500 个节点上限')
      return false
    }
    if (copiedNodes.length > available) {
      ElMessage.warning(`需要 ${copiedNodes.length} 个空位，当前只剩 ${available} 个；已保留原画布`)
      return false
    }
    const copiedNodeIds = new Set(copiedNodes.map((node) => String(node.id)))
    const remainingEdgeCapacity = Math.max(0, 1000 - freeCanvas.value.edges.length)
    const copiedEdges = cloned.edges
      .filter((edge) => !originalEdgeIds.has(String(edge.id)))
      .filter((edge) => copiedNodeIds.has(String(edge.source)) && copiedNodeIds.has(String(edge.target)))
    if (copiedEdges.length > remainingEdgeCapacity) {
      ElMessage.warning(`需要 ${copiedEdges.length} 条连线额度，当前只剩 ${remainingEdgeCapacity} 条；已保留原画布`)
      return false
    }
    freePasteCount += 1
    selectedFreeNodeIds.value = copiedNodes.map((node) => node.id)
    selectedFreeEdgeIds.value = copiedEdges.map((edge) => edge.id)
    selectedFreeNodeId.value = copiedNodes.length === 1 ? copiedNodes[0].id : null
    ignoreEmptyFreeSelectionUntil = Date.now() + 1500
    commitFreeCanvasState({
      ...freeCanvas.value,
      nodes: [...freeCanvas.value.nodes, ...copiedNodes],
      edges: [...freeCanvas.value.edges, ...copiedEdges],
    }, 'paste')
    const copiedIdSet = new Set(copiedNodes.map((node) => String(node.id)))
    const copiedEdgeSet = new Set(copiedEdges.map((edge) => String(edge.id)))
    nodes.value = nodes.value.map((node) => ({
      ...node,
      selected: copiedIdSet.has(String(node.id)),
    }))
    edges.value = edges.value.map((edge) => ({
      ...edge,
      selected: copiedEdgeSet.has(String(edge.id)),
    }))
    return true
  }

  async function handleFreeCanvasKeydown(event) {
    if (canvasMode.value !== 'free') return
    if (event.key === 'Escape') {
      if (isEditableKeyTarget(event.target)) return
      if (contextMenuVisible.value) {
        event.preventDefault()
        closeContextMenu()
        return
      }
      if (selectedFreeNodeId.value) {
        event.preventDefault()
        closeFreeCanvasInspector({ restoreFocus: true })
      }
      return
    }
    if (isTypingTarget(event.target)) return

    const modifier = event.ctrlKey || event.metaKey
    const key = String(event.key || '').toLowerCase()
    if (!modifier && (event.key === 'Enter' || event.key === ' ')) {
      if (isEditableKeyTarget(event.target)) return
      const nodeId = event.target?.closest?.('.vue-flow__node')?.dataset?.id
      if (isFreeCanvasNodeId(nodeId)) {
        event.preventDefault()
        event.stopPropagation()
        finishFreeCanvasNodeEditing(nodeId)
        activateFreeCanvasNode(nodeId, { focusInspector: false })
        return
      }
    }
    if (modifier && key === 'a') {
      event.preventDefault()
      selectAllFreeCanvasNodes()
      return
    }
    if (modifier && key === 'c') {
      if (copyFreeCanvasSelection()) event.preventDefault()
      return
    }
    if (modifier && key === 'v') {
      if (pasteFreeCanvasSelection()) event.preventDefault()
      return
    }
    if (modifier && key === 'z') {
      event.preventDefault()
      if (event.shiftKey) redoFreeCanvas()
      else undoFreeCanvas()
      return
    }
    if (modifier && key === 'y') {
      event.preventDefault()
      redoFreeCanvas()
      return
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      if (isFreeCanvasDeleteShortcutBlocked(event)) return
      const { nodeIds, edgeIds } = currentVisualFreeCanvasSelection()
      if (nodeIds.length || edgeIds.length) {
        event.preventDefault()
        event.stopPropagation()
        await deleteFreeCanvasSelection()
      }
    }
  }

  function freeNodeReferenceText(node) {
    const title = String(node?.title || node?.label || '').trim()
    const content = String(node?.content ?? node?.text ?? node?.description ?? '').trim()
    if (!title) return content
    if (!content || content === title) return title
    return `${title}\n${content}`
  }

  function appendFreeReference(existing, node) {
    const reference = freeNodeReferenceText(node)
    if (!reference) return String(existing || '')
    const block = `[自由画布参考]\n${reference}`
    const current = String(existing || '').trim()
    if (current.includes(block)) return current
    return current ? `${current}\n\n${block}` : block
  }

  function alignFreeCanvasSelection(mode = 'left') {
    const { nodeIds } = syncVisualFreeCanvasSelection()
    const reason = getFreeCanvasAlignDisabledReason({
      selectionCount: nodeIds.length,
      readonly: Boolean(freeCanvasReadOnly.value),
    })
    if (reason) {
      ElMessage.info(reason)
      return false
    }
    const nextNodes = alignFreeCanvasNodePositions(
      freeCanvas.value.nodes,
      nodeIds,
      mode,
    )
    commitFreeCanvasState({ ...freeCanvas.value, nodes: nextNodes }, `align:${mode}`)
    const labels = { left: '左对齐', top: '顶对齐', 'center-x': '水平居中' }
    ElMessage.success(`已将所选节点${labels[mode] || '对齐'}`)
    return true
  }

  watch(
    () => [
      freeCanvas.value.nodes.length,
      selectedFreeNodeIds.value.length,
      Boolean(freeCanvasReadOnly.value),
      canvasMode.value,
    ],
    ([nodeCount, selectionCount, readonly, mode]) => {
      setFreeCanvasUxState({
        nodeCount,
        selectionCount,
        readonly,
        canvasMode: mode,
        alignSelection: alignFreeCanvasSelection,
      })
    },
    { immediate: true },
  )

  function resolveFreeConversionTarget(value) {
    const match = /^(character|scene|prop|storyboard):(\d+)$/.exec(String(value || ''))
    if (!match) return null
    const [, type, rawId] = match
    const id = Number(rawId)
    if (type === 'storyboard') {
      const storyboard = storyboardsById.value.get(String(id))
      return storyboard ? { type, id, entity: storyboard, label: storyboard.title || `分镜 ${id}` } : null
    }
    const collection = type === 'character'
      ? drama.value?.characters
      : type === 'scene'
        ? drama.value?.scenes
        : drama.value?.props
    const entity = (collection || []).find((item) => Number(item.id) === id)
    if (!entity) return null
    const label = type === 'scene' ? entity.location : entity.name
    return { type, id, entity, label: label || String(id) }
  }

  function freeNodeMediaReference(node) {
    return resolveFreeCanvasMediaPath(node, projectAssetsById.value)
  }

  async function convertFreeCanvasReference(payload = {}) {
    if (freeInspectorBusy.value) return
    const node = freeCanvas.value.nodes.find((item) => String(item.id) === String(payload.id))
    const target = resolveFreeConversionTarget(payload.target)
    if (!node || !target) {
      ElMessage.warning('转换目标已不可用，请重新选择')
      return
    }

    const mediaReference = freeNodeMediaReference(node)
    const textReference = freeNodeReferenceText(node)
    const isVideoReference = node.type === 'video'
    if (!mediaReference && !textReference) {
      ElMessage.warning('当前节点没有可转换的文本或本地素材')
      return
    }
    if (isVideoReference && target.type !== 'storyboard' && mediaReference) {
      ElMessage.warning('角色、场景和道具参考只接受图片；请先将视频保存为素材')
      return
    }

    const operation = mediaReference
      ? (target.type === 'storyboard' ? '追加为分镜参考图' : '覆盖目标的参考图')
      : '追加到目标描述'
    freeInspectorBusy.value = true
    freeInspectorAction.value = 'convert'
    try {
      await ElMessageBox.confirm(
        `将“${node.title || '自由节点'}”${operation}：${target.label}。自由节点会保留。`,
        '确认转为制作参考',
        {
          type: 'warning',
          confirmButtonText: '确认转换',
          cancelButtonText: '取消',
        },
      )
    } catch (_) {
      freeInspectorBusy.value = false
      freeInspectorAction.value = ''
      return
    }

    try {
      if (target.type === 'character') {
        if (mediaReference) await characterAPI.putRefImage(target.id, mediaReference)
        else await characterAPI.update(target.id, { description: appendFreeReference(target.entity.description, node) })
      } else if (target.type === 'scene') {
        if (mediaReference) await sceneAPI.putRefImage(target.id, mediaReference)
        else await sceneAPI.update(target.id, { prompt: appendFreeReference(target.entity.prompt, node) })
      } else if (target.type === 'prop') {
        if (mediaReference) await propAPI.putRefImage(target.id, mediaReference)
        else await propAPI.update(target.id, { description: appendFreeReference(target.entity.description, node) })
      } else if (mediaReference) {
        if (isVideoReference) {
          throw new Error('分镜参考区域只接受图片素材')
        }
        const current = Array.isArray(target.entity.reference_images) ? target.entity.reference_images : []
        const nextReference = {
          name: node.title || '自由画布参考图',
          local_path: mediaReference,
          image_url: `/static/${mediaReference}`,
          source_drama_id: Number(dramaId.value),
          source_drama_title: drama.value?.title || '',
        }
        const deduped = current.filter((item) => String(item?.local_path || '') !== mediaReference)
        const nextReferences = [...deduped, nextReference]
        if (nextReferences.length > 10) nextReferences.splice(0, nextReferences.length - 10)
        await storyboardsAPI.update(target.id, { reference_images: nextReferences })
      } else {
        await storyboardsAPI.update(target.id, {
          description: appendFreeReference(target.entity.description, node),
        })
      }

      const nextNodes = freeCanvas.value.nodes.map((item) => {
        if (String(item.id) !== String(node.id)) return item
        if (target.type === 'storyboard') {
          return { ...item, storyboard_ref: target.id, storyboardId: target.id }
        }
        if (target.type === 'scene') return { ...item, sceneId: target.id }
        return item
      })
      commitFreeCanvasState({ ...freeCanvas.value, nodes: nextNodes }, `convert:${target.type}`)
      await loadCanvasProject({ blocking: false, preserveOnError: true, preserveFreeState: true })
      ElMessage.success('已转换为制作参考，自由节点仍保留在画布中')
    } catch (error) {
      if (isCanvasUserAbort(error)) return
      ElMessage.error(safeFreeCanvasError(error, '转换失败，请检查目标和素材后重试'))
    } finally {
      freeInspectorBusy.value = false
      freeInspectorAction.value = ''
    }
  }

  async function saveFreeCanvasNodeAsAsset(payload = {}) {
    if (freeInspectorBusy.value) return
    const requestedProjectId = Number(dramaId.value)
    let node = freeCanvas.value.nodes.find((item) => String(item.id) === String(payload.id))
    if (!node) return
    const currentEligibility = (candidate) => getFreeCanvasAssetSaveEligibility(candidate, {
      projectId: requestedProjectId,
      inventory: [
        ...buildFreeCanvasStoryboardMediaItems(drama.value, {
          imagesBySbId: imagesBySbId.value,
          videosBySbId: videosBySbId.value,
          mediaStatusBySbId: mediaStatusBySbId.value,
        }),
        ...projectAssets.value,
      ],
    })
    const initialEligibility = currentEligibility(node)
    if (!initialEligibility.eligible) {
      ElMessage.warning(initialEligibility.reason)
      return
    }

    freeInspectorBusy.value = true
    freeInspectorAction.value = 'save-asset'
    try {
      await Promise.all([
        loadProjectAssets(requestedProjectId),
        loadForDrama(drama.value, filterEpisodeId.value),
      ])
      if (!canvasInstanceActive.value || requestedProjectId !== Number(dramaId.value)) return
      node = freeCanvas.value.nodes.find((item) => String(item.id) === String(payload.id))
      if (!node) return
      const eligibility = currentEligibility(node)
      if (!eligibility.eligible) {
        ElMessage.warning(eligibility.reason)
        return
      }
      const mediaReference = eligibility.path
      const saved = await persistCanvasState({ freeOnly: true, reportError: false })
      if (!saved.ok) {
        ElMessage.error(safeFreeCanvasError(saved.error, '画布保存失败，暂时无法创建素材'))
        return
      }
      const asset = await assetsAPI.create({
        drama_id: Number(dramaId.value),
        name: node.title || (node.type === 'video' ? '自由画布视频' : '自由画布图片'),
        type: node.type,
        url: `/static/${mediaReference}`,
        local_path: mediaReference,
      })
      if (!asset?.id || Number(asset.drama_id) !== Number(dramaId.value)) {
        throw new Error('素材创建结果不属于当前项目')
      }
      projectAssets.value = [
        asset,
        ...projectAssets.value.filter((item) => Number(item.id) !== Number(asset.id)),
      ]
      const nextNodes = freeCanvas.value.nodes.map((item) => (
        String(item.id) === String(node.id)
          ? { ...item, asset_ref: asset.id, assetId: asset.id, storageKey: mediaReference }
          : item
      ))
      commitFreeCanvasState({ ...freeCanvas.value, nodes: nextNodes }, 'save-asset')
      ElMessage.success('已保存到当前项目素材库')
    } catch (error) {
      if (isCanvasUserAbort(error)) return
      ElMessage.error(safeFreeCanvasError(error, '素材保存失败，请重试'))
    } finally {
      freeInspectorBusy.value = false
      freeInspectorAction.value = ''
    }
  }

  return {
    isFreeCanvasNodeId,
    shouldIgnoreEmptyFreeSelection,
    resetFreeCanvasClipboard,
    freeCanvasSafeBounds,
    defaultFreeNodePosition,
    freeNodeDefaults,
    freeCanvasConfigRuntime,
    configureFreeCanvasNode,
    setFreeCanvasConfigOperationState,
    cancelFreeCanvasConfig,
    retryFreeCanvasConfig,
    createFreeCanvasNode,
    updateFreeCanvasNode,
    updateFreeNodeContent,
    activateFreeCanvasNode,
    openFreeCanvasInspectorFor,
    startFreeCanvasNodeEditing,
    finishFreeCanvasNodeEditing,
    focusFreeCanvasNodeTrigger,
    removeFreeCanvasItems,
    deleteFreeCanvasNode,
    readDomSelectedFreeNodeIds,
    currentVisualFreeCanvasSelection,
    syncVisualFreeCanvasSelection,
    deleteFreeCanvasSelection,
    retryFreeCanvasNode,
    isValidFreeConnection,
    onFreeCanvasConnect,
    resolveFreeCanvasNodeMediaUrl,
    openFreeCanvasMediaPicker,
    toggleFreeCanvasLibrary,
    createFreeEntityReference,
    createFreeNodeFromLibraryItem,
    onFreeCanvasMediaPicked,
    createFreeNodeFromAsset,
    uploadFreeCanvasFiles,
    onFreeCanvasDragOver,
    onFreeCanvasDrop,
    isTypingTarget,
    isEditableKeyTarget,
    selectAllFreeCanvasNodes,
    copyFreeCanvasSelection,
    pasteFreeCanvasSelection,
    handleFreeCanvasKeydown,
    alignFreeCanvasSelection,
    convertFreeCanvasReference,
    saveFreeCanvasNodeAsAsset,
  }
}
