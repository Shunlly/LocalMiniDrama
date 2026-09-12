/**
 * 素材中心选择删除与离开保护。批量删除只处理当前可见选中项。
 */
import { ElMessage, ElMessageBox } from '@/utils/elementPlusFeedback.js'
import request from '@/utils/request'
import {
  describeMediaLibraryUserError,
  isMediaLibraryUserAbort,
} from '@/utils/mediaLibraryUserError'
import {
  getVisibleSelectedMediaIds,
  hasPendingMediaLibraryOperations,
  describeMediaDeleteImpact,
  describeMediaBatchDeleteImpact,
  isMediaInUseError,
} from '@/utils/mediaLibrary'

export function createMediaLibrarySelection(ctx = {}) {
  const mediaWriteLocked = ctx.mediaWriteLocked
  const selectedIds = ctx.selectedIds
  const mediaItems = ctx.mediaItems
  const uploading = ctx.uploading
  const networkImportingKeys = ctx.networkImportingKeys
  const loadMedia = ctx.loadMedia

  async function deleteItem(item) {
    if (mediaWriteLocked.value) return
    try {
      await ElMessageBox.confirm(`${describeMediaDeleteImpact(item)}确定删除？`, '删除确认', {
        type: 'warning',
        confirmButtonText: '删除',
        cancelButtonText: '取消',
      })
    } catch (_) {
      return
    }
    try {
      await request.delete(`/assets/${item.id}`, { suppressErrorToast: true })
      ElMessage.success('已删除')
      loadMedia()
    } catch (err) {
      if (isMediaLibraryUserAbort(err)) return
      ElMessage.error(describeMediaLibraryUserError(err, { serviceLabel: '素材服务', fallback: '删除失败' }))
    }
  }

  async function batchDelete() {
    if (mediaWriteLocked.value) return
    const idsToDelete = getVisibleSelectedMediaIds(selectedIds, mediaItems.value)
    const count = idsToDelete.length
    if (count <= 0) {
      selectedIds.clear()
      return
    }
    try {
      await ElMessageBox.confirm(`${describeMediaBatchDeleteImpact(count)}确定继续？`, '批量删除', {
        type: 'warning',
        confirmButtonText: '删除',
        cancelButtonText: '取消',
      })
    } catch (_) {
      return
    }
    let failed = 0
    let inUse = 0
    for (const id of idsToDelete) {
      try {
        await request.delete(`/assets/${id}`, { suppressErrorToast: true })
      } catch (err) {
        failed += 1
        if (isMediaInUseError(err)) inUse += 1
      }
    }
    selectedIds.clear()
    if (failed > 0) {
      const inUseHint = inUse ? `，其中 ${inUse} 个仍被分镜或画布引用` : ''
      ElMessage.warning(`${count - failed} 个删除成功，${failed} 个失败${inUseHint}`)
    }
    else ElMessage.success(`${count} 个素材已删除`)
    loadMedia()
  }

  let pendingMediaLibraryLeaveConfirm = null

  async function confirmMediaLibraryLeave() {
    if (!hasPendingMediaLibraryOperations(uploading.value, networkImportingKeys)) return true
    if (pendingMediaLibraryLeaveConfirm) return pendingMediaLibraryLeaveConfirm
    const message = uploading.value
      ? '素材正在上传，请完成后再离开。'
      : '网络素材正在导入，请完成后再离开。'
    pendingMediaLibraryLeaveConfirm = (async () => {
      try {
        await ElMessageBox.confirm(message, '确认离开？', {
          type: 'warning',
          confirmButtonText: '离开',
          cancelButtonText: '继续留在本页',
          distinguishCancelAndClose: true,
        })
        return true
      } catch (_) {
        return false
      }
    })()
    try {
      return await pendingMediaLibraryLeaveConfirm
    } finally {
      pendingMediaLibraryLeaveConfirm = null
    }
  }

  function handleBeforeUnload(event) {
    if (!hasPendingMediaLibraryOperations(uploading.value, networkImportingKeys)) return
    event.preventDefault()
    event.returnValue = ''
  }

  return {
    deleteItem,
    batchDelete,
    confirmMediaLibraryLeave,
    handleBeforeUnload,
  }
}
