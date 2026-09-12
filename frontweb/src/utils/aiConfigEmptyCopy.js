/**
 * AI 配置列表空态标题与下一步。不发真实厂商请求。
 */
import { serviceTypeLabel } from './aiConfigLabels.js'

function withPeriod(text) {
  const value = String(text || '').trim()
  if (!value) return ''
  return /[。！？]$/.test(value) ? value : `${value}。`
}

export function describeConfigEmptyTitle({
  failed = false,
  pending = false,
  serviceFilter = '',
} = {}) {
  if (failed) return '暂时无法读取配置列表'
  if (pending) return '正在读取配置列表'
  if (serviceFilter) return `暂无${serviceTypeLabel(serviceFilter)}配置`
  return '还没有 AI 服务配置'
}

export function describeConfigEmptyDescription({
  failed = false,
  pending = false,
  loadError = '',
  serviceFilter = '',
  vendorLockEnabled = false,
} = {}) {
  if (failed) {
    const prefix = withPeriod(String(loadError || '').trim() || '请点击重试后再查看或添加配置。')
    if (/下一步/.test(prefix)) return prefix
    return `${prefix}下一步：点击下方「重试」后再查看或添加配置。`
  }
  if (pending) return '正在从本地服务读取已保存的厂商配置。'
  if (vendorLockEnabled) {
    if (serviceFilter) {
      return `下一步：当前为厂商锁定模式，请联系管理员添加${serviceTypeLabel(serviceFilter)}配置。`
    }
    return '下一步：当前由管理员统一配置，请返回项目列表或联系管理员。'
  }
  if (serviceFilter === 'ocr') return '下一步：添加一个配置并设为默认，即可用于 PDF/图片识别。'
  if (serviceFilter === 'transcription') return '下一步：添加一个配置并设为默认，即可用于音频/视频转写。'
  if (serviceFilter) return '下一步：添加一个配置并设为默认，即可用于对应生成环节。'
  return '下一步：点击下方「添加第一个配置」，先加文本、图片或视频厂商并设为默认。'
}
