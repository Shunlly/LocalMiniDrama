/** 制作页按钮读屏名称、悬停说明和用户可见失败文案 */

const TECHNICAL_ENGLISH_RE = /network error|http\s*error|failed to fetch|fetch failed|internal server error|econnrefused|err_network|status code|axioserror/i
const HTTP_STATUS_RE = /\bHTTP\s*\d{3}\b/i

export function hasChineseText(text) {
  return /[一-鿿]/.test(String(text || ''))
}

export function toFilmCreateUserFacingText(value, fallback = '操作失败，请稍后重试') {
  const text = String(value || '').trim()
  const safeFallback = String(fallback || '操作失败，请稍后重试')
  if (!text) return safeFallback
  if (TECHNICAL_ENGLISH_RE.test(text) || HTTP_STATUS_RE.test(text) || !hasChineseText(text)) return safeFallback
  return text
}

export function toFilmCreateOptionalUserFacingText(value, fallback = '操作失败，请稍后重试') {
  if (!String(value || '').trim()) return ''
  return toFilmCreateUserFacingText(value, fallback)
}

export function toFilmCreateDisabledReasonText(value, fallback = '当前不可用') {
  const text = String(value || '').trim()
  if (!text) return ''
  return toFilmCreateUserFacingText(text, fallback)
}

export function describeActionAriaLabel(actionLabel, { loading, loadingLabel, disabledReason } = {}) {
  const label = String(actionLabel || '').trim() || '此操作'
  if (loading) return String(loadingLabel || `正在${label}`).trim()
  const reason = toFilmCreateDisabledReasonText(disabledReason)
  if (reason) return `${label}不可用：${reason}`
  return label
}

export function describeActionTitle({ loading, loadingLabel, disabledReason } = {}) {
  if (loading) {
    const text = String(loadingLabel || '').trim()
    return text ? `${text}，请稍候` : '正在处理，请稍候'
  }
  const reason = String(disabledReason || '').trim()
  return reason || undefined
}
