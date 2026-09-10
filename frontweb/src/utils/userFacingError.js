import { describeServiceLoadError, isRequestCanceled, isRequestTimeout } from '@/utils/requestError'

const SECRET_RE = /password\s*=|client_secret|cookie\s*:|authorization\s*:|api[_-]?key\s*[:=]/i
const UNSET = '\0'

function errorText(error) {
  if (typeof error === 'string') return error.trim()
  return String(error?.message || '').trim()
}

function hasChinese(text) {
  return /[\u4e00-\u9fff]/.test(text)
}

function isSafeChinese(text) {
  return Boolean(text) && hasChinese(text) && !SECRET_RE.test(text) && !/https?:\/\//i.test(text)
}

/** 把操作异常转成可展示的简体中文 */
export function toUserFacingError(error, fallback = '操作失败，请稍后重试', options = {}) {
  if (error === 'cancel' || isRequestCanceled(error, options.signal)) return '操作已取消'
  const described = describeServiceLoadError(error, {
    serviceLabel: options.serviceLabel || '服务',
    fallback: UNSET,
    signal: options.signal,
  })
  if (described && described !== UNSET && isSafeChinese(described)) return described
  const raw = errorText(error)
  if (raw && isSafeChinese(raw)) return raw
  if (isRequestTimeout(error, options.signal)) return '连接超时，请稍后重试'
  return fallback
}

export function isUserFacingAbort(error, signal) {
  return error === 'cancel' || error?.name === 'AbortError' || isRequestCanceled(error, signal)
}
