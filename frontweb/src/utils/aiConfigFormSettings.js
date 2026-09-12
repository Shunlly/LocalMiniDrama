/**
 * AI 配置表单里的 settings / Comfy / DeepSeek 解析。不发真实厂商请求。
 */
export function parseSettings(settings) {
  if (!settings) return {}
  if (typeof settings === 'object') return settings
  try {
    const parsed = JSON.parse(settings)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch (_) {
    return {}
  }
}

export function parseComfyWorkflowJson(value) {
  let parsed
  try {
    parsed = typeof value === 'string' ? JSON.parse(value) : value
  } catch (_) {
    throw new Error('工作流 JSON 格式无效')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.keys(parsed).length === 0) {
    throw new Error('工作流 JSON 必须是非空对象')
  }
  return parsed
}

export function isDeepSeekOfficial(provider, baseUrl) {
  const p = String(provider || '').trim().toLowerCase()
  const base = String(baseUrl || '').trim().toLowerCase()
  return p === 'deepseek' || base.includes('api.deepseek.com')
}

export function resolveDeepSeekFormSettings(row) {
  const s = parseSettings(row?.settings)
  const nested = s.deepseek && typeof s.deepseek === 'object' ? s.deepseek : {}
  let thinking = s.deepseek_thinking || s.thinking || nested.thinking || nested.type || ''
  const model = String(row?.default_model || '').toLowerCase()
  if (!thinking && model === 'deepseek-chat') thinking = 'disabled'
  if (!thinking && model === 'deepseek-reasoner') thinking = 'enabled'
  if (thinking !== 'enabled' && thinking !== 'disabled') thinking = 'disabled'

  let effort = s.deepseek_reasoning_effort || s.reasoning_effort || nested.reasoning_effort || nested.effort || 'high'
  effort = String(effort).toLowerCase() === 'max' ? 'max' : 'high'
  return { thinking, effort }
}
