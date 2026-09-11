import { toUserFacingError } from '@/utils/userFacingError'

/**
 * 剧集详情资源标签与错误文案辅助。
 * 只放纯函数，不持有弹窗 ref，也不把 open/save 抽走。
 */

export function hasChinese(text) {
  return /[\u4e00-\u9fff]/.test(text)
}

/** 把剧集详情操作的异常转成可展示的简体中文 */
export function dramaDetailUserError(error, fallback = '操作失败，请稍后重试', serviceLabel = '项目服务') {
  return toUserFacingError(error, fallback, { serviceLabel })
}

export function characterRoleLabel(role) {
  const map = { main: '主角', supporting: '配角', extra: '群演', minor: '次要' }
  const key = String(role || '').trim()
  if (!key) return ''
  if (map[key]) return map[key]
  return hasChinese(key) ? key : '其他'
}

export function propTypeLabel(type) {
  const map = { key: '关键道具', background: '背景物件', handheld: '手持道具', costume: '服饰' }
  const key = String(type || '').trim()
  if (!key) return ''
  if (map[key]) return map[key]
  return hasChinese(key) ? key : key
}
