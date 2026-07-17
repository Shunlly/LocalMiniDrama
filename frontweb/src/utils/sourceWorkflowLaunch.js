export const DEFAULT_WORKFLOW_MODE = 'draft'

const WORKFLOW_MODES = new Set(['draft', 'production'])
const AI_CONFIG_SERVICE_TYPES = new Set(['text', 'image', 'storyboard_image', 'video', 'tts'])

export function isValidHttpSourceUrl(value) {
  const text = String(value || '').trim()
  if (!text) return false
  try {
    const parsed = new URL(text)
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:')
      && !parsed.username
      && !parsed.password
      && Boolean(parsed.hostname)
  } catch (_) {
    return false
  }
}

export function normalizeWorkflowMode(value) {
  const mode = String(value || '').trim().toLowerCase()
  return WORKFLOW_MODES.has(mode) ? mode : DEFAULT_WORKFLOW_MODE
}

export function buildWorkflowLaunchPayload(payload, mode) {
  return {
    ...(payload || {}),
    qa_mode: normalizeWorkflowMode(mode),
  }
}

export function normalizeProductionReadiness(value) {
  if (!value || typeof value !== 'object' || typeof value.ready !== 'boolean') {
    throw new Error('正式制作能力响应无效，请刷新后重试。')
  }
  const capabilities = Array.isArray(value.capabilities) ? value.capabilities : []
  const missing = Array.isArray(value.missing_capabilities)
    ? value.missing_capabilities
    : capabilities.filter((item) => item?.required && !item?.ready)
  return {
    ...value,
    qa_mode: normalizeWorkflowMode(value.qa_mode || 'production'),
    ready: value.ready === true && missing.length === 0,
    capabilities,
    missing_capabilities: missing,
  }
}

export class ProductionReadinessError extends Error {
  constructor(readiness) {
    const labels = readiness.missing_capabilities
      .map((item) => item?.label)
      .filter(Boolean)
    super(labels.length
      ? `正式制作条件未满足：${labels.join('、')}`
      : '正式制作条件未满足，请检查制作能力配置。')
    this.name = 'ProductionReadinessError'
    this.code = 'WORKFLOW_NOT_READY'
    this.readiness = readiness
  }
}

export async function launchSourceWorkflow({ mode, payload, checkReadiness, start }) {
  const launchPayload = buildWorkflowLaunchPayload(payload, mode)
  let readiness = null

  if (launchPayload.qa_mode === 'production') {
    if (typeof checkReadiness !== 'function') {
      throw new Error('正式制作启动前缺少能力检查。')
    }
    readiness = normalizeProductionReadiness(await checkReadiness(launchPayload))
    if (!readiness.ready) throw new ProductionReadinessError(readiness)
  }

  if (typeof start !== 'function') throw new Error('工作流启动方法不可用。')
  const run = await start(launchPayload)
  if (!run?.id) throw new Error('启动接口未返回有效的流程记录。')
  return { run, readiness, payload: launchPayload }
}

export function buildAiConfigLocation({ dramaId, readiness, serviceType, returnTo } = {}) {
  const missingType = readiness?.missing_capabilities
    ?.map((item) => String(item?.service_type || '').trim())
    .find((type) => AI_CONFIG_SERVICE_TYPES.has(type))
  const requestedType = String(serviceType || missingType || '').trim()
  const query = {}
  if (AI_CONFIG_SERVICE_TYPES.has(requestedType)) query.service_type = requestedType

  const explicitReturnTo = typeof returnTo === 'string' ? returnTo.trim() : ''
  if (
    explicitReturnTo.length <= 2048
    && explicitReturnTo.startsWith('/')
    && !explicitReturnTo.startsWith('//')
    && !/[\u0000-\u001f\u007f]/.test(explicitReturnTo)
  ) {
    query.returnTo = explicitReturnTo
  } else {
    const numericDramaId = Number(dramaId)
    if (Number.isSafeInteger(numericDramaId) && numericDramaId > 0) {
    query.returnTo = `/drama/${numericDramaId}#source-intake-workflow`
    }
  }

  return { name: 'ai-config', query }
}
