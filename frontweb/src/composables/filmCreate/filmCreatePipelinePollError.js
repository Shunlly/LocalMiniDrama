import { toUserFacingError } from '@/utils/userFacingError'

export function isCancelledPollStatus(status) {
  const value = String(status || '').toLowerCase()
  return value === 'cancelled' || value === 'canceled'
}

/**
 * 把流水线轮询结果收成中文用户错误。取消会抛 AbortError，超时/失败返回句子，成功返回空字符串。
 */
export function toPipelinePollUserFacingError(result, failedFallback, timeoutFallback) {
  if (!result) return ''
  const status = String(result.status || '').toLowerCase()
  if (isCancelledPollStatus(status)) {
    const error = new Error(toUserFacingError(result.error, '操作已取消'))
    error.name = 'AbortError'
    throw error
  }
  if (status === 'timeout') return toUserFacingError(result.error, timeoutFallback || '任务超时，请稍后重试')
  if (result.error) return toUserFacingError(result.error, failedFallback)
  return ''
}
