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
