/** 分镜图列禁用原因与失败文案 */

import { toUserFacingError } from '@/utils/userFacingError'



export function describeImageGenerateDisabledReason(reason) {

  return String(reason || '').trim()

}



export function describeUpscaleDisabledReason(hasLocalImage) {

  return hasLocalImage ? '' : '当前分镜没有可超分的本地图片'

}



export function describeUniversalSegmentActionDisabledReason(hasSegment) {

  return hasSegment ? '' : '请先生成全能提示词'

}



export function describeStoryboardImageError(sb) {

  return toUserFacingError(sb?.error_msg || sb?.errorMsg, '生成失败')

}


export function describeDraftImagePlaceholderCopy() {
  return {
    title: '草稿占位',
    nextStep: '尚未生成可预览的分镜图，点下方生成分镜参考图，或手动上传。',
  }
}
