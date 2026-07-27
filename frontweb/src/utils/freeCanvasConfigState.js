const STATUS_LABELS = Object.freeze({
  blocked: '需要配置',
  checking: '检查中',
  error: '检查失败',
  mock: 'Mock 预演',
  ready: '配置就绪',
  running: '生成中',
  failed: '生成失败',
  cancelled: '已取消',
})

function cleanText(value, maxLength = 500) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, maxLength)
}

function nodeTitle(node, fallback) {
  return cleanText(node?.title || node?.label || node?.name || fallback, 120)
}

function nodeContent(node) {
  return cleanText(
    node?.content ?? node?.text ?? node?.description ?? node?.prompt ?? '',
    600,
  )
}

function summarizeInput(node) {
  if (!node || typeof node !== 'object') return ''
  if (node.type === 'image') return `图片：${nodeTitle(node, '未命名图片')}`
  if (node.type === 'video') return `视频：${nodeTitle(node, '未命名视频')}`
  if (node.type === 'reference') return `引用：${nodeTitle(node, '未命名引用')}`
  const content = nodeContent(node)
  if (!content) return ''
  return `${nodeTitle(node, '文本')}：${content}`
}

function upstreamNodes(nodeId, canvas) {
  const nodes = Array.isArray(canvas?.nodes) ? canvas.nodes : []
  const incomingIds = new Set(
    (Array.isArray(canvas?.edges) ? canvas.edges : [])
      .filter((edge) => String(edge?.target) === String(nodeId))
      .map((edge) => String(edge?.source)),
  )
  return nodes.filter((node) => incomingIds.has(String(node?.id)))
}

function isMockCapability(capability) {
  const config = capability?.config || {}
  return [config.provider, config.name, config.model]
    .some((value) => /(?:^|[-_\s])(?:mock|placeholder)(?:$|[-_\s])/i.test(String(value || '')))
}

function operationStatus(node) {
  const status = cleanText(node?.status, 32).toLowerCase()
  return ['running', 'failed', 'cancelled'].includes(status) ? status : ''
}

function providerLabel(capability) {
  const config = capability?.config || {}
  return cleanText(config.name || config.provider || '', 120)
}

function operationReason(status, node) {
  if (status === 'running') return '生成任务正在运行，可随时取消。'
  if (status === 'failed') {
    return cleanText(node?.metadata?.lastError, 300) || '上次生成失败，请检查输入与 AI 配置后重试。'
  }
  if (status === 'cancelled') return '上次生成已取消，可在确认输入后重试。'
  return ''
}

export function buildFreeCanvasConfigRuntime(nodeId, canvas, options = {}) {
  const nodes = Array.isArray(canvas?.nodes) ? canvas.nodes : []
  const node = nodes.find((item) => String(item?.id) === String(nodeId)) || null
  const gate = options?.gate && typeof options.gate === 'object' ? options.gate : {}
  const capability = options?.capability && typeof options.capability === 'object'
    ? options.capability
    : {}
  const activeStatus = operationStatus(node)
  const capabilityBlocked = capability.ready === false
  const gateStatus = gate.ready && capabilityBlocked ? capability.status : gate.status
  const gateReason = gate.ready && capabilityBlocked ? capability.reason : gate.reason
  const gateReady = Boolean(gate.ready) && !capabilityBlocked
  const gatedStatus = gateStatus === 'checking'
    ? 'checking'
    : (gateStatus === 'error' ? 'error' : 'blocked')
  const status = activeStatus
    || (!gateReady ? gatedStatus : (isMockCapability(capability) ? 'mock' : 'ready'))
  const label = providerLabel(capability)
  const serviceType = cleanText(gate.serviceType || 'video', 32) || 'video'
  const inputSummary = upstreamNodes(nodeId, canvas)
    .map(summarizeInput)
    .filter(Boolean)
    .join('\n') || '尚未连接文本、图片、视频或制作引用'

  let reason = operationReason(status, node)
  if (['blocked', 'checking', 'error'].includes(status)) {
    reason = cleanText(gateReason, 300) || '视频生成未就绪，请前往 AI 配置完成配置。'
  } else if (status === 'mock') {
    reason = `${label || '当前 Mock Provider'}仅用于流程预演，不会产生正式视频。`
  } else if (status === 'ready') {
    reason = label ? `当前使用 ${label}，生成前请确认上游输入。` : '视频生成配置已就绪。'
  }

  return {
    status,
    statusLabel: STATUS_LABELS[status] || STATUS_LABELS.ready,
    serviceType,
    providerLabel: label,
    modelLabel: cleanText(capability?.model || capability?.config?.model || '', 160),
    inputSummary,
    reason,
    canConfigure: true,
    canCancel: status === 'running',
    canRetry: status === 'failed' || status === 'cancelled' || status === 'error',
  }
}
