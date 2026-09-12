/**
 * AI 配置对话框的空白表单和编辑回填。不发真实厂商请求。
 */
import { readProviderPricingForm } from '@/utils/providerPricing.js'
import { parseSettings, resolveDeepSeekFormSettings } from '@/utils/aiConfigFormSettings.js'

export function createBlankAiConfigForm() {
  return {
    service_type: 'text',
    name: '',
    provider: '',
    api_protocol: '',
    base_url: '',
    api_key: '',
    endpoint: '',
    query_endpoint: '',
    modelText: '',
    default_model: '',
    deepseek_thinking: 'disabled',
    deepseek_reasoning_effort: 'high',
    priority: 0,
    is_default: true,  // 新增时默认勾选「设为默认」，便于理解当前会使用哪条配置
    voice_id: '',
    group_id: '',
    kling_access_key: '',
    kling_secret_key: '',
    kling_secret_key_base64: false,
    comfy_workflow_json: '',
    ...readProviderPricingForm(null),
  }
}

export function hydrateAiConfigForm(row = {}) {
  const model = Array.isArray(row.model) ? row.model : (row.model ? [row.model] : [])
  const modelList = model.map((m) => String(m).trim()).filter(Boolean)
  const defaultModel = row.default_model == null ? '' : String(row.default_model).trim()
  let voice_id = row.voice_id || ''
  let group_id = row.group_id || ''
  let kling_access_key = ''
  let kling_secret_key = ''
  let kling_secret_key_base64 = false
  let comfy_workflow_json = ''
  const deepseekSettings = resolveDeepSeekFormSettings(row)
  const pricingForm = readProviderPricingForm(row.settings)
  const s = parseSettings(row.settings)
  if (row.service_type === 'tts') {
    voice_id = s.voice_id || voice_id
    group_id = s.group_id || group_id
  }
  if (row.service_type === 'video' && row.api_protocol === 'kling_omni') {
    kling_access_key = s.kling_access_key || ''
    kling_secret_key = s.kling_secret_key || ''
    kling_secret_key_base64 = !!s.kling_secret_key_base64
  }
  const comfyWorkflow = s.workflow ?? s.workflow_json ?? s.workflow_template ?? s.comfyui?.workflow
  if (comfyWorkflow && typeof comfyWorkflow === 'object' && !Array.isArray(comfyWorkflow)) {
    comfy_workflow_json = JSON.stringify(comfyWorkflow, null, 2)
  }
  return {
    service_type: row.service_type,
    name: row.name,
    provider: row.provider,
    api_protocol: row.api_protocol || '',
    base_url: row.base_url,
    api_key: row.api_key,
    endpoint: row.endpoint || '',
    query_endpoint: row.query_endpoint || '',
    modelText: modelList.join('\n'),
    default_model: defaultModel,
    deepseek_thinking: deepseekSettings.thinking,
    deepseek_reasoning_effort: deepseekSettings.effort,
    priority: row.priority ?? 0,
    is_default: !!row.is_default,
    voice_id,
    group_id,
    kling_access_key,
    kling_secret_key,
    kling_secret_key_base64,
    comfy_workflow_json,
    ...pricingForm,
  }
}
