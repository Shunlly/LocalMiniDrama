/**
 * AI 配置「从服务读取模型」的纯解析与去重，不发真实厂商请求。
 */
import { getProviderProtocol, isApiKeyOptionalProvider } from '@/utils/aiProviderPresets.js'

export function parseModelText(text) {
  if (!text || !String(text).trim()) return []
  return String(text)
    .split(/[\n,，]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

export function extractDiscoveredModelIds(payload) {
  if (payload == null) return []
  const list = Array.isArray(payload.models)
    ? payload.models
    : Array.isArray(payload.data)
      ? payload.data
      : Array.isArray(payload)
        ? payload
        : []
  const ids = []
  for (const item of list) {
    if (item == null) continue
    if (typeof item === 'string' || typeof item === 'number') {
      const id = String(item).trim()
      if (id) ids.push(id)
      continue
    }
    const id = String(item.id || item.model || item.name || '').trim()
    if (id) ids.push(id)
  }
  return ids
}

export function mergeModelTextWithDiscovered(existingText, discoveredIds) {
  const existing = parseModelText(existingText)
  const extra = []
  for (const raw of discoveredIds || []) {
    const id = String(raw || '').trim()
    if (!id || existing.includes(id) || extra.includes(id)) continue
    extra.push(id)
  }
  if (!extra.length) {
    return { text: existingText || '', merged: existing, appended: extra }
  }
  const prefix = String(existingText || '').trim()
  return {
    text: prefix ? (prefix + '\n' + extra.join('\n')) : extra.join('\n'),
    merged: existing.concat(extra),
    appended: extra,
  }
}

export function isOpenAiCompatibleConfig(config) {
  const protocol = String(config?.api_protocol || getProviderProtocol(config?.provider, config?.service_type) || '')
    .toLowerCase()
    .replace(/-/g, '_')
  return protocol === 'openai' || protocol === 'openai_compatible'
}

export function hasDiscoverableCredential(form = {}) {
  if (String(form.api_key || '').trim()) return true
  if (isApiKeyOptionalProvider(form.provider, form.api_protocol)) return true
  const proto = String(form.api_protocol || '').toLowerCase()
  if (form.service_type === 'video' && proto === 'kling_omni') {
    return Boolean(String(form.kling_access_key || '').trim() && String(form.kling_secret_key || '').trim())
  }
  return false
}
