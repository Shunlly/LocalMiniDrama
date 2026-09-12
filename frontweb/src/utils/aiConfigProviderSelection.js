/**
 * 选择厂商时填充地址、协议、端点和中文名称。不发真实厂商请求。
 */
import {
  CUSTOM_PROVIDER_SENTINEL,
  getBaseUrlForProvider,
  getProviderEndpointDefaults,
  getProviderProtocol,
  providerConfigs,
} from '@/utils/aiProviderPresets.js'
import { serviceTypeLabel } from '@/utils/aiConfigLabels.js'

export function applyProviderSelection(form, providerId, options = {}) {
  const editingId = options.editingId
  if (providerId === CUSTOM_PROVIDER_SENTINEL) {
    form.provider = ''
    form.api_protocol = ''
    form.base_url = ''
    form.endpoint = ''
    form.query_endpoint = ''
    form.modelText = ''
    form.default_model = ''
    return form
  }
  form.provider = providerId
  const st = form.service_type || 'text'
  const p = (providerConfigs[st] || []).find((x) => x.id === providerId)
  if (!p) {
    form.base_url = ''
    form.endpoint = ''
    form.query_endpoint = ''
    form.modelText = ''
    form.default_model = ''
    return form
  }
  form.base_url = getBaseUrlForProvider(providerId, st)
  form.modelText = (p.models || []).join('\n')
  form.default_model = (p.models && p.models[0]) || ''
  if (providerId === 'deepseek') {
    form.deepseek_thinking = 'disabled'
    form.deepseek_reasoning_effort = 'high'
  }
  // 自动填充接口规范与默认端点；先清理旧厂商残留的端点，避免切换后继续调用上一个厂商。
  form.api_protocol = getProviderProtocol(providerId, st) || (st === 'text' ? '' : 'openai')
  const endpointDefaults = getProviderEndpointDefaults(providerId, st, form.api_protocol)
  form.endpoint = endpointDefaults.endpoint || ''
  form.query_endpoint = endpointDefaults.query_endpoint || ''
  if (st === 'video' && providerId === 'jimeng_ai_api') {
    form.endpoint = ''
    form.query_endpoint = ''
  }
  if (st === 'video' && (providerId === 'ffir' || providerId === 'klingai')) {
    if (providerId === 'ffir') {
      form.endpoint = '/kling/v1/videos/omni-video'
      form.query_endpoint = '/kling/v1/images/omni-image/{taskId}'
    } else {
      form.endpoint = '/v1/videos/omni-video'
      form.query_endpoint = '/v1/videos/omni-video/{taskId}'
    }
  }
  if (st === 'video' && providerId === 'agnes') {
    form.api_protocol = 'agnes'
    form.endpoint = '/videos'
    form.query_endpoint = '/videos/{taskId}'
  }
  if (!editingId) {
    form.name = (p.name || providerId) + ' ' + serviceTypeLabel(st)
  }
  return form
}
