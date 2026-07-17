import { isApiKeyOptionalProvider } from './aiProviderPresets.js'

export const MODEL_OPTIONAL_SERVICE_PROTOCOLS = Object.freeze([
  'image:comfyui',
  'storyboard_image:comfyui',
])

const MODEL_OPTIONAL_SET = new Set(MODEL_OPTIONAL_SERVICE_PROTOCOLS)

function normalizeToken(value) {
  return String(value || '').trim().toLowerCase().replace(/-/g, '_')
}

function parseObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value
  if (!value) return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch (_) {
    return {}
  }
}

function hasComfyWorkflow(config) {
  const settings = parseObject(config?.settings)
  const nested = parseObject(settings.comfyui)
  const workflow = nested.workflow
    ?? nested.workflow_json
    ?? nested.workflow_template
    ?? settings.workflow
    ?? settings.workflow_json
    ?? settings.workflow_template
    ?? config?.workflow
  const parsed = parseObject(workflow)
  return Object.keys(parsed).length > 0
}

export function isComfyUiImageConfig(config) {
  if (!config) return false
  const serviceType = normalizeToken(config.service_type)
  const protocol = normalizeToken(config.api_protocol) || normalizeToken(config.provider)
  return ['image', 'storyboard_image'].includes(serviceType)
    && ['comfyui', 'comfy_ui'].includes(protocol)
}

function hasCredentialValue(value) {
  const normalized = String(value || '').trim()
  return normalized !== '' && normalized !== '********'
}

export function hasServiceCredentials(config) {
  if (!config) return false
  if (config.credential_set === true || config.api_key_set === true) return true
  if (hasCredentialValue(config.api_key)) return true
  const settings = parseObject(config.settings)
  const credentialPairs = [
    ['kling_access_key', 'kling_secret_key'],
    ['access_key', 'secret_key'],
    ['access_key_id', 'secret_access_key'],
  ]
  return credentialPairs.some(([accessKey, secretKey]) => (
    hasCredentialValue(settings[accessKey]) && hasCredentialValue(settings[secretKey])
  ))
}

export function configuredModels(config) {
  const values = []
  if (config?.default_model != null) values.push(config.default_model)
  if (Array.isArray(config?.model)) {
    values.push(...config.model)
  } else if (config?.model != null) {
    try {
      const parsed = JSON.parse(config.model)
      if (Array.isArray(parsed)) values.push(...parsed)
      else values.push(config.model)
    } catch (_) {
      values.push(...String(config.model).split(/[\n,]/))
    }
  }
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))]
}

export function isModelOptionalServiceConfig(config) {
  if (!config) return false
  const serviceType = normalizeToken(config.service_type)
  const protocol = normalizeToken(config.api_protocol) || normalizeToken(config.provider)
  return MODEL_OPTIONAL_SET.has(`${serviceType}:${protocol}`) && hasComfyWorkflow(config)
}

export function getServiceConfigReadiness(config) {
  if (!config) {
    return {
      ready: false,
      issue: 'missing_config',
      model: '',
      modelOptional: false,
      credentialOptional: false,
      credentialSet: false,
    }
  }
  const models = configuredModels(config)
  const modelOptional = isModelOptionalServiceConfig(config)
  const credentialOptional = isApiKeyOptionalProvider(config.provider, config.api_protocol)
  const credentialSet = hasServiceCredentials(config)
  const protocolReady = !isComfyUiImageConfig(config) || hasComfyWorkflow(config)
  const modelReady = models.length > 0 || modelOptional
  const credentialReady = credentialOptional || credentialSet
  return {
    ready: protocolReady && modelReady && credentialReady,
    issue: !protocolReady
      ? 'missing_workflow'
      : (!modelReady ? 'missing_model' : (!credentialReady ? 'missing_credentials' : '')),
    model: models[0] || '',
    modelOptional,
    credentialOptional,
    credentialSet,
  }
}
