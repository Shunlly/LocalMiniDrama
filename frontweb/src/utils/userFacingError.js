import { appendRequestIdHint, describeServiceLoadError, isRequestCanceled, isRequestTimeout, isSafeUserFacingMessage } from '@/utils/requestError'

const UNSET = '\0'

function errorText(error) {
  if (typeof error === 'string') return error.trim()
  return String(error?.message || '').trim()
}

function resolveUserFacingError(error, fallback = '操作失败，请稍后重试', options = {}) {
  if (error === 'cancel' || isRequestCanceled(error, options.signal)) return '操作已取消'
  const described = describeServiceLoadError(error, {
    serviceLabel: options.serviceLabel || '服务',
    fallback: UNSET,
    signal: options.signal,
  })
  if (described && described !== UNSET && isSafeUserFacingMessage(described)) return described
  const raw = errorText(error)
  if (raw && isSafeUserFacingMessage(raw)) return raw
  if (isRequestTimeout(error, options.signal)) return '连接超时，请稍后重试'
  const fallbackText = fallback == null ? '' : String(fallback)
  if (fallbackText === '') return ''
  if (isSafeUserFacingMessage(fallbackText)) return fallbackText
  return '操作失败，请稍后重试'
}

/** 把操作异常转成可展示的简体中文；失败文案在确有 requestId 时附带请求编号 */
export function toUserFacingError(error, fallback = '操作失败，请稍后重试', options = {}) {
  const message = resolveUserFacingError(error, fallback, options)
  if (error === 'cancel' || isRequestCanceled(error, options.signal)) return message
  return appendRequestIdHint(message, error)
}

export function isUserFacingAbort(error, signal) {
  // 超时 abort 仍是超时，不能当成用户取消后静默成功。
  if (isRequestTimeout(error, signal)) return false
  return error === 'cancel' || error?.name === 'AbortError' || isRequestCanceled(error, signal)
}
