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

export function providerModelEmptyHint(serviceType, provider, models = [], currentModels) {
  if (serviceType === 'jimeng2_character_auth') return ''
  const current = currentModels === undefined ? models : currentModels
  if (Array.isArray(current) && current.some((item) => String(item || '').trim())) return ''
  if (!String(provider || '').trim()) return '下一步：先选择厂商自动填入，或直接输入模型名。'
  if (!models.length) return '下一步：直接输入模型名；填好接口地址和密钥后也可点「从服务读取模型」。'
  return '下一步：从上方追加预设模型，或直接输入模型名。'
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
