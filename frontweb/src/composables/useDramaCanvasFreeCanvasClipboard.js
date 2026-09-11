/**
 * 自由画布剪贴板与快捷键：复制粘贴、全选、对齐与转换。
 */
import { ElMessage, ElMessageBox } from '@/utils/elementPlusFeedback.js'

import {
  alignFreeCanvasNodePositions,
  getFreeCanvasAlignDisabledReason,
  isFreeCanvasDeleteShortcutBlocked as isDeleteShortcutBlockedByUx,
} from '@/components/dramaCanvas/freeCanvasUx'

import { characterAPI } from '@/api/characters'
import { propAPI } from '@/api/props'
import { sceneAPI } from '@/api/scenes'
import { storyboardsAPI } from '@/api/storyboards'
import { isCanvasUserAbort } from '@/composables/useCanvasUserError'
import { resolveFreeCanvasMediaPath } from '@/utils/freeCanvasMedia'
import {
  buildStoryboardPrimaryMediaPatch,
  describeFreeConversionOperation,
  parseFreeConversionTargetKey,
  validateFreeConversionMedia,
} from '@/utils/freeCanvasConversion.js'
import {
  cloneFreeSelection,
  normalizeFreeCanvas,
  serializeFreeCanvas,
} from '@/utils/freeCanvasState'

/** 注入 nodes/selection 状态，不复制画布数据。 */
export function useDramaCanvasFreeCanvasClipboard(deps = {}) {
  const {
    canvasMode,
    freeCanvas,
    freeCanvasReadOnly,
    nodes,
    edges,
    selectedFreeNodeId,
    selectedFreeNodeIds,
    selectedFreeEdgeIds,
    drama,
    dramaId,
    storyboardsById,
    projectAssetsById,
    contextMenuVisible,
    closeContextMenu,
    closeFreeCanvasInspector,
    finishFreeCanvasNodeEditing,
    activateFreeCanvasNode,
    isFreeCanvasNodeId,
    currentVisualFreeCanvasSelection,
    syncVisualFreeCanvasSelection,
    deleteFreeCanvasSelection,
    undoFreeCanvas,
    redoFreeCanvas,
    commitFreeCanvasState,
    loadCanvasProject,
    freeInspectorBusy,
    freeInspectorAction,
    markIgnoreEmptyFreeSelection,
    safeFreeCanvasError,
  } = deps

  let freeClipboard = null
  let freePasteCount = 0

  function resetFreeCanvasClipboard() {
    freeClipboard = null
    freePasteCount = 0
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
    markIgnoreEmptyFreeSelection()
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

  function resolveFreeConversionTarget(value) {
    const parsed = parseFreeConversionTargetKey(value)
    if (!parsed) return null
    const { type, id } = parsed
    if (type === 'storyboard' || type === 'storyboard-image' || type === 'storyboard-video') {
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
    const mediaError = validateFreeConversionMedia({
      mediaReference,
      isVideo: isVideoReference,
      targetType: target.type,
    })
    if (mediaError) {
      ElMessage.warning(mediaError)
      return
    }

    const operation = describeFreeConversionOperation({
      mediaReference,
      isVideo: isVideoReference,
      targetType: target.type,
    })
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
      } else if (target.type === 'storyboard-image') {
        const patch = buildStoryboardPrimaryMediaPatch(mediaReference, 'image')
        await storyboardsAPI.update(target.id, patch)
      } else if (target.type === 'storyboard-video') {
        const patch = buildStoryboardPrimaryMediaPatch(mediaReference, 'video')
        await storyboardsAPI.update(target.id, patch)
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
        if (target.type === 'storyboard' || target.type === 'storyboard-image' || target.type === 'storyboard-video') {
          return { ...item, storyboard_ref: target.id, storyboardId: target.id }
        }
        if (target.type === 'scene') return { ...item, sceneId: target.id }
        return item
      })
      commitFreeCanvasState({ ...freeCanvas.value, nodes: nextNodes }, `convert:${target.type}`)
      await loadCanvasProject({ blocking: false, preserveOnError: true, preserveFreeState: true })
      ElMessage.success(target.type === 'storyboard-image' ? '已设为分镜主图，自由节点仍保留在画布中' : (target.type === 'storyboard-video' ? '已设为分镜视频，自由节点仍保留在画布中' : '已转换为制作参考，自由节点仍保留在画布中'))
    } catch (error) {
      if (isCanvasUserAbort(error)) return
      ElMessage.error(safeFreeCanvasError(error, '转换失败，请检查目标和素材后重试'))
    } finally {
      freeInspectorBusy.value = false
      freeInspectorAction.value = ''
    }
  }

  return {
    resetFreeCanvasClipboard,
    isTypingTarget,
    isEditableKeyTarget,
    selectAllFreeCanvasNodes,
    copyFreeCanvasSelection,
    pasteFreeCanvasSelection,
    handleFreeCanvasKeydown,
    alignFreeCanvasSelection,
    convertFreeCanvasReference,
  }
}
