/** 输出区锁定原因、失败下一步和用户可见文案 */

import {
  toFilmCreateDisabledReasonText,
  toFilmCreateUserFacingText,
} from './filmCreateActionCopy.js'

export function toOutputUserFacingText(value, fallback = '操作失败，请稍后重试') {
  return toFilmCreateUserFacingText(value, fallback)
}

export function toOutputDisabledReasonText(value, fallback = '当前不可用') {
  return toFilmCreateDisabledReasonText(value, fallback)
}

export function describeOutputVideoSettingsLock(input = {}) {
  const composeReason = String(input.composeActionDisabledReason || '').trim()
  const safeComposeReason = toFilmCreateDisabledReasonText(composeReason, '')
  const busyLock = /正在|请等待|请先暂停|请先停止/.test(safeComposeReason)
    && !/^请先(?:创建|生成或添加|为全部)/.test(safeComposeReason)
  if (input.videoStatus === 'generating') {
    return busyLock ? safeComposeReason : '正在合成视频，请等待当前任务完成'
  }
  return busyLock ? safeComposeReason : ''
}

export function describeDeliveryOutputNextStep(input = {}) {
  if (input.videoDownloadStatus === 'error') {
    return '成片下载失败后，可继续点「重试下载」，已合成的成片不会被覆盖。'
  }
  if (input.deliveryExportStatus?.subtitle === 'error') {
    return '字幕导出失败后，可继续点「重试字幕」。'
  }
  if (input.deliveryExportStatus?.project === 'error') {
    return '项目包导出失败后，可继续点「重试项目包」。'
  }
  if (input.videoStatus === 'error') {
    return '成片合成失败后，可检查分镜视频是否齐全，再点「合成成片」重试。'
  }
  return ''
}

export function describeOutputDeliveryMessages(input = {}) {
  const composeActionDisabledReason = toOutputDisabledReasonText(
    input.composeActionDisabledReason,
    '当前不能合成成片',
  )
  const videoErrorMsg = input.videoStatus === 'error'
    ? toOutputUserFacingText(input.videoErrorMsg, '成片合成失败，请稍后重试')
    : (String(input.videoErrorMsg || '').trim()
      ? toOutputUserFacingText(input.videoErrorMsg, '成片合成失败，请稍后重试')
      : '')
  const videoDownloadError = input.videoDownloadStatus === 'error'
    ? toOutputUserFacingText(input.videoDownloadError, '成片下载失败，请稍后重试')
    : (String(input.videoDownloadError || '').trim()
      ? toOutputUserFacingText(input.videoDownloadError, '成片下载失败，请稍后重试')
      : '')
  const deliveryExportFeedback = input.deliveryExportHasError
    ? toOutputUserFacingText(input.deliveryExportFeedback, '导出失败，请稍后重试')
    : (String(input.deliveryExportFeedback || '').trim()
      ? toOutputUserFacingText(input.deliveryExportFeedback, '导出失败，请稍后重试')
      : '')
  return {
    composeActionDisabledReason,
    videoErrorMsg,
    videoDownloadError,
    deliveryExportFeedback,
    failureNextStep: describeDeliveryOutputNextStep(input),
  }
}
