/** 批量生图/生视频轮询失败收口为中文，取消不当成超时或成功。 */

import { toUserFacingError } from '@/utils/userFacingError'
import { isCancelledPollStatus } from './filmCreatePipelinePollError.js'

export function recordBatchPollFailure(errorsRef, progressRef, sb, pollRes, stoppingRef) {
  const status = String(pollRes?.status || '').toLowerCase()
  if (!status || status === 'completed') return false
  if (isCancelledPollStatus(status) && stoppingRef?.value) return false
  let message = toUserFacingError(pollRes.error, '生成未完成')
  if (status === 'failed') message = toUserFacingError(pollRes.error, '生成失败')
  else if (status === 'timeout') message = toUserFacingError(pollRes.error, '生成超时，请稍后重试')
  else if (isCancelledPollStatus(status)) message = toUserFacingError(pollRes.error, '操作已取消')
  errorsRef.value.push(`#${sb.storyboard_number ?? sb.id}: ${message}`)
  progressRef.value = { ...progressRef.value, failed: progressRef.value.failed + 1 }
  return true
}
