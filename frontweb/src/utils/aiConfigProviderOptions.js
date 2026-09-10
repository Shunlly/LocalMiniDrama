/**
 * AI 配置厂商/模型下拉与编辑跳转。不发真实厂商请求。
 */
import { CUSTOM_PROVIDER_SENTINEL, providerConfigs } from '@/utils/aiProviderPresets.js'

export function buildAvailableProviderOptions(serviceType, provider, options = {}) {
  const st = serviceType || 'text'
  const listByType = providerConfigs[st] || []
  const current = provider
  let result = [...listByType]
  if (options.editingId && current && current !== CUSTOM_PROVIDER_SENTINEL && !listByType.some((p) => p.id === current)) {
    result = [{ id: current, name: current + '（当前）', models: [] }, ...result]
  }
  result.push({ id: CUSTOM_PROVIDER_SENTINEL, name: '✏️ 自定义（直接输入厂商名）', models: [] })
  return result
}

export function buildAvailableModels(serviceType, provider) {
  if (!serviceType || !provider) return []
  const p = (providerConfigs[serviceType] || []).find((x) => x.id === provider)
  return p?.models || []
}

export function providerModelEmptyHint(serviceType, provider, models = []) {
  if (serviceType === 'jimeng2_character_auth') return ''
  if (!String(provider || '').trim()) return '请先选择厂商，或直接输入模型名。'
  if (!models.length) return '当前厂商没有预设模型，可直接输入模型名。'
  return ''
}

export function describeConfigEditTarget(row) {
  if (row?.service_type === 'model_ark_asset') {
    return {
      tab: 'sd2_assets',
      message: '请在「认证资产管理」标签页编辑此配置',
    }
  }
  return { openEdit: true }
}
