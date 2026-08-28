import { describeServiceLoadError, isRequestCanceled, isRequestTimeout } from '@/utils/requestError'

const TECHNICAL_ENGLISH_RE = /network error|timeout of \d+ms|request failed with status code|project_load_failed|err_network|econnaborted|etimedout|failed to fetch|load failed|internal server error/i
const UNSET = '\0'

function errorText(error) {
  if (typeof error === 'string') return error.trim()
  return String(error?.message || '').trim()
}

function hasChinese(text) {
  return /[\u4e00-\u9fff]/.test(text)
}

/** 把画布操作的异常转成可展示的简体中文 */
export function canvasUserError(error, fallback = '操作失败，请稍后重试') {
  if (error === 'cancel' || isRequestCanceled(error)) return '操作已取消'
  const described = describeServiceLoadError(error, {
    serviceLabel: '画布服务',
    fallback: UNSET,
  })
  if (described && described !== UNSET && hasChinese(described)) return described
  const raw = errorText(error)
  if (raw && hasChinese(raw)) return raw
  if (isRequestTimeout(error)) return '连接画布服务超时，请稍后重试'
  if (described && described !== UNSET && !TECHNICAL_ENGLISH_RE.test(described)) return described
  if (raw && !TECHNICAL_ENGLISH_RE.test(raw)) return raw
  return fallback
}

export function isCanvasUserAbort(error) {
  return error === 'cancel' || error?.name === 'AbortError' || isRequestCanceled(error)
}
