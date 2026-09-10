/**
 * AI 配置保存载荷和替换默认配置确认文案。不发真实厂商请求。
 */
import { parseModelText } from '@/utils/aiConfigDiscoverModels.js'
import { parseComfyWorkflowJson } from '@/utils/aiConfigFormSettings.js'
import { serviceTypeLabel } from '@/utils/aiConfigLabels.js'
import { buildProviderPricing, parseSettingsObject } from '@/utils/providerPricing.js'

export function findExistingDefaultConfig(list, serviceType, currentId) {
  return (list || []).find((row) => (
    row.service_type === serviceType
    && row.is_default
    && String(row.id) !== String(currentId || '')
  )) || null
}

export function buildReplaceDefaultConfirmCopy(form, existing) {
  const nextName = String(form?.name || '').trim() || '未命名配置'
  const previousName = String(existing?.name || '').trim() || '未命名配置'
  const typeLabel = serviceTypeLabel(form?.service_type)
  return {
    message: `确定将「${nextName}」设为${typeLabel}的默认配置？当前默认「${previousName}」会被替换。`,
    title: '保存确认',
    confirmButtonText: '确认保存',
    cancelButtonText: '取消',
  }
}

export function buildAiConfigSubmitPayload(form, options = {}) {
  const {
    editingId = null,
    editingUpdatedAt = '',
    previous = null,
    isComfyUi = false,
    isDeepSeekOfficial = false,
  } = options
  let modelList = parseModelText(form.modelText)
  if (form.service_type === 'jimeng2_character_auth' && modelList.length === 0) {
    modelList = ['-']
  }
  const defaultModel = form.default_model || null
  const settingsObject = parseSettingsObject(previous?.settings)
  if (isComfyUi) settingsObject.workflow = parseComfyWorkflowJson(form.comfy_workflow_json)
  else {
    delete settingsObject.workflow
    delete settingsObject.workflow_json
    delete settingsObject.workflow_template
  }
  if (form.service_type === 'tts') {
    if (form.voice_id) settingsObject.voice_id = form.voice_id
    else delete settingsObject.voice_id
    if (form.group_id) settingsObject.group_id = form.group_id
    else delete settingsObject.group_id
  } else if (form.service_type === 'video' && form.api_protocol === 'kling_omni') {
    if ((form.kling_access_key || '').trim()) settingsObject.kling_access_key = form.kling_access_key.trim()
    else delete settingsObject.kling_access_key
    if ((form.kling_secret_key || '').trim()) settingsObject.kling_secret_key = form.kling_secret_key.trim()
    else delete settingsObject.kling_secret_key
    if (form.kling_secret_key_base64) settingsObject.kling_secret_key_base64 = true
    else delete settingsObject.kling_secret_key_base64
  } else if (isDeepSeekOfficial) {
    settingsObject.deepseek_thinking = form.deepseek_thinking === 'enabled' ? 'enabled' : 'disabled'
    if (settingsObject.deepseek_thinking === 'enabled') {
      settingsObject.deepseek_reasoning_effort = form.deepseek_reasoning_effort === 'max' ? 'max' : 'high'
    } else {
      delete settingsObject.deepseek_reasoning_effort
    }
  }
  const pricing = buildProviderPricing(form.service_type, form)
  if (pricing) settingsObject.pricing = pricing
  else delete settingsObject.pricing
  const settings = Object.keys(settingsObject).length ? JSON.stringify(settingsObject) : null
  return {
    service_type: form.service_type,
    name: form.name,
    provider: form.provider,
    api_protocol: form.api_protocol || '',
    base_url: form.base_url,
    api_key: form.api_key,
    endpoint: form.endpoint || '',
    query_endpoint: form.query_endpoint || '',
    model: modelList,
    default_model: defaultModel,
    priority: form.priority,
    is_default: form.is_default,
    settings,
    ...(editingId && editingUpdatedAt
      ? { expected_updated_at: editingUpdatedAt }
      : {}),
  }
}
