import { ElMessage } from '@/utils/elementPlusFeedback.js'
import { localizeSourceIntakeFailure } from '@/utils/sourceWorkflowState'
import { isUserFacingAbort, toUserFacingError } from '@/utils/userFacingError.js'

export function qaIssueDisplayMessage(message) {
  return toUserFacingError(message, '该项检查未通过')
}

export function formatTime(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('zh-CN', { hour12: false })
}

export function createSourceIntakeMessageHelpers({
  lifecycle,
  emit,
  getFailureContext,
} = {}) {
  function showWorkflowMessage(type, message) {
    const text = String(message || '').trim()
    if (!text) return
    return lifecycle.run(() => ElMessage[type](text))
  }

  function sourceIntakeFailureMessage(error, fallback = '导入失败') {
    if (isUserFacingAbort(error)) return ''
    const localized = localizeSourceIntakeFailure(error, getFailureContext?.() || {})
    const raw = String(error?.message || error || '').trim()
    if (localized && localized !== raw) return toUserFacingError(localized, fallback)
    return toUserFacingError(error, fallback)
  }

  function emitRefresh() {
    return lifecycle.run(() => emit('refresh'))
  }

  return { showWorkflowMessage, sourceIntakeFailureMessage, emitRefresh }
}
