/**
 * 切换服务类型和追加模型列表。不发真实厂商请求。
 */
import { CUSTOM_PROVIDER_SENTINEL, getBaseUrlForProvider, providerConfigs } from '@/utils/aiProviderPresets.js'
import { parseModelText } from '@/utils/aiConfigDiscoverModels.js'

export function applyServiceTypeChange(form, options = {}) {
  const editingId = options.editingId
  const st = form.service_type || 'text'
  if (st === 'jimeng2_character_auth') {
    if (!form.provider || form.provider === CUSTOM_PROVIDER_SENTINEL) {
      form.provider = 'jimeng_material_api'
    }
    const p = form.provider
    const pcfg = (providerConfigs.jimeng2_character_auth || []).find((x) => x.id === p)
    if (pcfg) {
      if (!form.base_url?.trim()) form.base_url = getBaseUrlForProvider(p, st)
      form.modelText = '-'
      form.default_model = '-'
      form.endpoint = ''
      form.query_endpoint = ''
      form.api_protocol = ''
    }
    if (!editingId && !form.name?.trim()) {
      form.name = '即梦2角色认证'
    }
    return form
  }
  const listByType = providerConfigs[st] || []
  const current = form.provider
  if (!current || !listByType.some((p) => p.id === current)) {
    form.provider = ''
    form.api_protocol = ''
    form.base_url = ''
    form.endpoint = ''
    form.query_endpoint = ''
    form.modelText = ''
    form.default_model = ''
  }
  return form
}

export function appendModelToList(form, modelName) {
  const value = String(modelName || '').trim()
  if (!value) return form
  const listParsed = parseModelText(form.modelText)
  if (listParsed.includes(value)) return form
  form.modelText = listParsed.length
    ? `${String(form.modelText || '').trim()}\n${value}`
    : value
  return form
}

export function applyPresetModelSelect(form, value) {
  if (!value) return form
  appendModelToList(form, value)
  if (!String(form.default_model || '').trim()) {
    form.default_model = String(value).trim()
  }
  return form
}
