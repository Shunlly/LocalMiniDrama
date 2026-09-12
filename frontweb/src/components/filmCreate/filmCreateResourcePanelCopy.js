/** 素材栏缺图禁用原因与认证资产帮助文案 */

import { toUserFacingError } from '@/utils/userFacingError'

export function describeResourceMissingAssetImageReason(item, kind, hasImage) {
  if (hasImage) return ''
  if (kind === 'prop') return '请先为该道具生成或上传主图'
  if (kind === 'scene') return '请先为该场景生成或上传主图'
  return '请先为该角色生成或上传主图'
}

export function describeSd2CertActionTitle(char) {
  const status = String(char?.seedance2_asset?.status || '').toLowerCase()
  if (status === 'active') return '查看认证资产详情'
  if (status === 'processing') return '刷新认证资产状态'
  if (status === 'failed') return '重新提交认证资产'
  return '将角色主图登记为认证资产'
}

export function describeResourceAssetErrorText(asset) {
  return toUserFacingError(asset?.error_msg || asset?.errorMsg, '生成失败')
}

export function describeMissingScenePanoramaReason(hasImage) {
  return hasImage ? '' : '请先为该场景生成或上传主图'
}
