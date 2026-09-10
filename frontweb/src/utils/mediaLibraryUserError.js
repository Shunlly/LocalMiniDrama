import { toUserFacingError, isUserFacingAbort } from './userFacingError.js'

/** 取消、关闭或中止请求都不算用户可见失败 */
export function isMediaLibraryUserAbort(error) {
  return error === 'close' || isUserFacingAbort(error)
}

/** 把网络素材搜索/导入异常转成简体中文，英文技术信息不会直出 */
export function describeMediaLibraryUserError(error, options = {}) {
  if (isMediaLibraryUserAbort(error)) return ''
  return toUserFacingError(error, options.fallback || '暂时无法完成操作，请稍后重试', {
    serviceLabel: options.serviceLabel || '网络素材服务',
  })
}

/** 素材中心禁用按钮时展示给用户的中文原因 */
export const MEDIA_LIBRARY_DISABLE_REASON = {
  loading: '素材列表正在加载，请稍候',
  staleWrite: '素材列表刷新失败，成功重试前不能上传、选择或删除',
  loadFailedWrite: '素材数据加载失败，成功重试前不能上传、选择或删除',
  notReady: '素材列表尚未就绪',
  uploading: '正在上传素材，请稍候',
  retryLoading: '正在重新加载素材列表，请稍候',
  searching: '正在搜索网络素材，请稍候',
  importing: '正在导入该网络素材，请稍候',
  keywordRequired: '请先输入搜索关键词',
  batchEmpty: '请先选择当前列表中要删除的素材',
}

/** 写锁：加载中、加载失败或列表尚未就绪 */
export function describeMediaLibraryWriteLockReason({
  loading = false,
  loadError = '',
  isStale = false,
  hasSuccessfulLoad = false,
} = {}) {
  if (loading) return MEDIA_LIBRARY_DISABLE_REASON.loading
  if (loadError) {
    return isStale
      ? MEDIA_LIBRARY_DISABLE_REASON.staleWrite
      : MEDIA_LIBRARY_DISABLE_REASON.loadFailedWrite
  }
  if (!hasSuccessfulLoad) return MEDIA_LIBRARY_DISABLE_REASON.notReady
  return ''
}

/** 上传按钮：写锁优先，其次是正在上传 */
export function describeMediaLibraryUploadDisableReason({
  writeLocked = false,
  writeLockReason = '',
  uploading = false,
} = {}) {
  if (writeLocked) return writeLockReason || MEDIA_LIBRARY_DISABLE_REASON.notReady
  if (uploading) return MEDIA_LIBRARY_DISABLE_REASON.uploading
  return ''
}

/** 网络搜索：没有关键词，或正在搜索 */
export function describeMediaLibraryNetworkSearchDisableReason({
  keyword = '',
  searching = false,
} = {}) {
  if (!String(keyword || '').trim()) return MEDIA_LIBRARY_DISABLE_REASON.keywordRequired
  if (searching) return MEDIA_LIBRARY_DISABLE_REASON.searching
  return ''
}

/** 批量删除：写锁优先，当前列表没有可删选中项时说明未选 */
export function describeMediaLibraryBatchDeleteDisableReason({
  writeLocked = false,
  writeLockReason = '',
  visibleSelectedCount = 0,
} = {}) {
  if (writeLocked) return writeLockReason || MEDIA_LIBRARY_DISABLE_REASON.notReady
  if (!(Number(visibleSelectedCount) > 0)) return MEDIA_LIBRARY_DISABLE_REASON.batchEmpty
  return ''
}

/** 网页导入入口：写锁优先，其次是上传导致的导航锁 */
export function describeMediaLibrarySourceImportDisableReason({
  writeLocked = false,
  writeLockReason = '',
  navigationLocked = false,
  navigationLockReason = '',
} = {}) {
  if (writeLocked) return writeLockReason || MEDIA_LIBRARY_DISABLE_REASON.notReady
  if (navigationLocked) return navigationLockReason || MEDIA_LIBRARY_DISABLE_REASON.uploading
  return ''
}
