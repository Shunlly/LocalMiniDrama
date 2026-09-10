import { describeServiceLoadError, isRequestCanceled, isRequestTimeout } from './requestError.js'

const UNSET = '\0'
const CHINESE_RE = /[\u4e00-\u9fff]/

function errorText(error) {
  if (typeof error === 'string') return error.trim()
  return String(error?.message || '').trim()
}

function hasChinese(text) {
  return CHINESE_RE.test(text)
}

/** 取消、关闭或中止请求都不算用户可见失败 */
export function isMediaLibraryUserAbort(error) {
  return error === 'cancel'
    || error === 'close'
    || error?.name === 'AbortError'
    || isRequestCanceled(error)
}

/** 把网络素材搜索/导入异常转成简体中文，英文技术信息不会直出 */
export function describeMediaLibraryUserError(error, options = {}) {
  const serviceLabel = options.serviceLabel || '网络素材服务'
  const fallback = options.fallback || '暂时无法完成操作，请稍后重试'
  if (isMediaLibraryUserAbort(error)) return ''
  const described = describeServiceLoadError(error, {
    serviceLabel,
    fallback: UNSET,
  })
  if (described && described !== UNSET && hasChinese(described)) return described
  const raw = errorText(error)
  if (raw && hasChinese(raw)) return raw
  const status = Number(error?.status || error?.response?.status)
  if (Number.isInteger(status) && status > 0) return `${serviceLabel}暂时不可用（HTTP ${status}）`
  if (isRequestTimeout(error)) return `连接${serviceLabel}超时，请稍后重试`
  return fallback
}
