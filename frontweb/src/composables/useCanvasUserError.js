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
  return Boolean(text)
    && hasChinese(text)
    && !SECRET_RE.test(text)
    && !/https?:\/\//i.test(text)
    && !/(Internal Server Error|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|TypeError|ReferenceError)/i.test(text)
}

/** 把画布操作的异常转成可展示的简体中文 */
export function canvasUserError(error, fallback = '操作失败，请稍后重试') {
  if (error === 'cancel' || isRequestCanceled(error)) return '操作已取消'
  const described = describeServiceLoadError(error, {
    serviceLabel: '画布服务',
    fallback: UNSET,
  })
  if (described && described !== UNSET && isSafeChinese(described)) return described
  const raw = errorText(error)
  if (raw && isSafeChinese(raw)) return raw
  if (isRequestTimeout(error)) return '连接画布服务超时，请稍后重试'
  return fallback
}

export function isCanvasUserAbort(error) {
  return error === 'cancel' || error?.name === 'AbortError' || isRequestCanceled(error)
}
