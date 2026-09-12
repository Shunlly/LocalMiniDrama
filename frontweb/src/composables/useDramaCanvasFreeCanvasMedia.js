/**
 * 自由画布媒体：本地引用、素材库、上传与拖放。
 */
import { ElMessage } from '@/utils/elementPlusFeedback.js'

import { uploadAPI } from '@/api/upload'
import { isCanvasUserAbort } from '@/composables/useCanvasUserError'
import {
  FREE_CANVAS_MEDIA_DRAG_TYPE,
  describeFreeCanvasAssetAddBlockReason,
  freeCanvasMediaUrl,
  normalizeFreeCanvasMediaPath,
  parseFreeCanvasMediaDragPayload,
  positiveFreeCanvasEntityId,
} from '@/utils/freeCanvasMedia'
import {
  MEDIA_LIBRARY_MAX_FILE_SIZE_LABEL,
  partitionMediaLibraryUploads,
} from '@/utils/mediaUploadValidation'

/** 注入画布与素材状态，不复制 nodes/selection。 */
export function useDramaCanvasFreeCanvasMedia(deps = {}) {
  const {
    canvasMode,
    dramaId,
    canvasInstanceActive,
    freeMediaPickerVisible,
    freeLibraryVisible,
    freeCanvasUploading,
    freeCanvasUploadStatus,
    projectAssets,
    projectAssetsById,
    freeStoryboardMediaItems,
    createFreeCanvasNode,
    screenToFlowPosition,
    safeFreeCanvasError,
  } = deps

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
    const blockReason = describeFreeCanvasAssetAddBlockReason(asset, dramaId.value)
    if (blockReason) {
      ElMessage.warning(blockReason)
      return false
    }
    const assetId = positiveFreeCanvasEntityId(asset.id)
    const assetType = asset.type === 'video' ? 'video' : 'image'
    const storageKey = localMediaReference(asset)
    const current = projectAssets.value.filter((item) => Number(item.id) !== assetId)
    projectAssets.value = [{ ...asset, id: assetId }, ...current]
    await createFreeCanvasNode(assetType, position, {
      title: asset?.name || (assetType === 'video' ? '视频素材' : '图片素材'),
      asset_ref: assetId,
      assetId,
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

  return {
    localMediaReference,
    resolveFreeCanvasNodeMediaUrl,
    openFreeCanvasMediaPicker,
    toggleFreeCanvasLibrary,
    createFreeEntityReference,
    createFreeNodeFromLibraryItem,
    onFreeCanvasMediaPicked,
    createFreeNodeFromAsset,
    isMediaFile,
    uploadFreeCanvasFiles,
    onFreeCanvasDragOver,
    onFreeCanvasDrop,
  }
}
