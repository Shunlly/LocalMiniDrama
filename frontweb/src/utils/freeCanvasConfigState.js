const STATUS_LABELS = Object.freeze({
  blocked: '需要配置',
  checking: '检查中',
  error: '检查失败',
  mock: '预演配置',
  ready: '配置就绪',
  running: '生成中',
  failed: '生成失败',
  cancelled: '已取消',
})

function cleanText(value, maxLength = 500) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, maxLength)
}

const TECHNICAL_ENGLISH_RE = /internal server error|econnrefused|enotfound|etimedout|typeerror|referenceerror|network error|failed to fetch|request failed/i

function reasonText(value) {
  if (value && typeof value === 'object') {
    return cleanText(value.message || value.error || value.reason, 300)
  }
  return cleanText(value, 300)
}

/** 配置节点失败原因只展示简体中文，英文技术异常回落到明确下一步。 */
export function toFreeCanvasConfigUserReason(value, fallback) {
  const text = reasonText(value)
  if (
    text
    && /[\u4e00-\u9fff]/.test(text)
    && !/https?:\/\//i.test(text)
    && !TECHNICAL_ENGLISH_RE.test(text)
  ) return text
  return cleanText(fallback, 300)
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

export function isFreeCanvasMockCapability(capability) {
  return isMockCapability(capability)
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
    return toFreeCanvasConfigUserReason(
      node?.metadata?.lastError,
      '上次生成失败，请检查输入与 AI 配置后重试。',
    )
  }
  if (status === 'cancelled') return '上次生成已取消，可在确认输入后重试。'
  return ''
}

function serviceLabel(serviceType) {
  return serviceType === 'video' ? '视频' : '图片'
}

function capabilityServiceType(capability = {}) {
  return cleanText(
    capability.serviceType
    || capability.service_type
    || capability.config?.service_type
    || capability.key,
    32,
  ).toLowerCase()
}

function defaultMediaPath(node) {
  if (!node || typeof node !== 'object') return ''
  const raw = node.storageKey || node.local_path || ((node.type === 'image' || node.type === 'video') ? node.content : '')
  return cleanText(raw, 2048).replace(/^\/static\//, '')
}

/** 有上游图片则走视频生成，否则走图片生成，不再写死 video。 */
export function resolveFreeCanvasConfigServiceType(nodeId, canvas) {
  return upstreamNodes(nodeId, canvas).some((node) => node?.type === 'image') ? 'video' : 'image'
}

export function collectFreeCanvasConfigGenerationInput(nodeId, canvas, options = {}) {
  const upstream = upstreamNodes(nodeId, canvas)
  const serviceType = resolveFreeCanvasConfigServiceType(nodeId, canvas)
  const prompt = upstream
    .filter((node) => node?.type === 'text' || node?.type === 'reference')
    .map(nodeContent)
    .filter(Boolean)
    .join('\n')
  const imageNode = upstream.find((node) => node?.type === 'image') || null
  const resolveMediaPath = typeof options.resolveMediaPath === 'function'
    ? options.resolveMediaPath
    : defaultMediaPath
  const referenceImagePath = imageNode ? cleanText(resolveMediaPath(imageNode), 2048).replace(/^\/static\//, '') : ''
  let blockedReason = ''
  if (!prompt) {
    blockedReason = serviceType === 'video' ? '请先连接文本节点填写视频提示词' : '请先连接文本节点填写图片提示词'
  } else if (serviceType === 'video' && !imageNode) {
    blockedReason = '请先连接图片节点作为视频参考图'
  } else if (serviceType === 'video' && !referenceImagePath) {
    blockedReason = '上游图片还没有可用的本地文件，请先添加可预览的图片'
  }
  return {
    serviceType,
    prompt,
    referenceImagePath,
    hasImage: Boolean(imageNode),
    blockedReason,
  }
}

function unmatchedServiceGate(serviceType) {
  return {
    ready: false,
    status: 'missing',
    reason: serviceLabel(serviceType) + '生成未就绪，请前往 AI 配置完成配置。',
    serviceType,
  }
}

function resolveEffectiveGateAndCapability(serviceType, options = {}) {
  const typedGate = options.gates && typeof options.gates === 'object'
    ? options.gates[serviceType]
    : undefined
  const typedCapability = options.capabilities && typeof options.capabilities === 'object'
    ? options.capabilities[serviceType]
    : undefined
  if (typedGate || typedCapability) {
    return {
      gate: typedGate && typeof typedGate === 'object' ? typedGate : unmatchedServiceGate(serviceType),
      capability: typedCapability && typeof typedCapability === 'object' ? typedCapability : {},
    }
  }
  const gate = options.gate && typeof options.gate === 'object' ? options.gate : {}
  const capability = options.capability && typeof options.capability === 'object' ? options.capability : {}
  const gateType = cleanText(gate.serviceType, 32).toLowerCase()
  const capType = capabilityServiceType(capability)
  if (gateType && gateType !== serviceType) {
    return {
      gate: unmatchedServiceGate(serviceType),
      capability: capType === serviceType ? capability : {},
    }
  }
  if (capType && capType !== serviceType) {
    return {
      gate: gateType === serviceType || !gateType ? gate : unmatchedServiceGate(serviceType),
      capability: {},
    }
  }
  return { gate, capability }
}

export function buildFreeCanvasConfigRuntime(nodeId, canvas, options = {}) {
  const nodes = Array.isArray(canvas?.nodes) ? canvas.nodes : []
  const node = nodes.find((item) => String(item?.id) === String(nodeId)) || null
  const input = collectFreeCanvasConfigGenerationInput(nodeId, canvas, options)
  const serviceType = input.serviceType
  const { gate, capability } = resolveEffectiveGateAndCapability(serviceType, options)
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
  const inputSummary = upstreamNodes(nodeId, canvas)
    .map(summarizeInput)
    .filter(Boolean)
    .join('\n') || '尚未连接文本、图片、视频或制作引用'
  const labelName = serviceLabel(serviceType)

  let reason = operationReason(status, node)
  if (['blocked', 'checking', 'error'].includes(status)) {
    reason = toFreeCanvasConfigUserReason(
      gateReason,
      `${labelName}生成未就绪，请前往 AI 配置完成配置。`,
    )
  } else if (status === 'mock') {
    reason = `${label || '当前预演配置'}仅用于流程预演，不会产生正式${labelName}。`
  } else if (status === 'ready') {
    reason = label ? `当前使用 ${label}，生成前请确认上游输入。` : `${labelName}生成配置已就绪。`
  }

  const generateDisabledReason = status === 'running'
    ? ''
    : (['blocked', 'checking', 'error', 'mock'].includes(status) ? reason : input.blockedReason)
  const canGenerate = status === 'ready' && !generateDisabledReason

  return {
    status,
    statusLabel: STATUS_LABELS[status] || STATUS_LABELS.ready,
    serviceType,
    providerLabel: label,
    modelLabel: cleanText(capability?.model || capability?.config?.model || '', 160),
    inputSummary,
    reason,
    generateDisabledReason,
    generateAriaLabel: canGenerate ? '生成' : (generateDisabledReason || reason || '当前不能生成'),
    canGenerate,
    canConfigure: true,
    canCancel: status === 'running',
    canRetry: status === 'failed' || status === 'cancelled' || status === 'error',
  }
}

/** 取消优先于完成，刷新或停止等待后不得把结果标成成功。 */
export function resolveFreeCanvasConfigGenerationOutcome({
  cancelRequested = false,
  cancelConfirmed = false,
  nodeStatus = '',
  itemStatus = '',
  resultPath = '',
  resultUrl = '',
  error = '',
} = {}) {
  const cancelled = Boolean(
    cancelRequested
    || cancelConfirmed
    || nodeStatus === 'cancelled'
    || ['cancelled', 'canceled'].includes(String(itemStatus || '').toLowerCase()),
  )
  if (cancelled) {
    return { status: 'cancelled', createResult: false, lastError: '', localPath: '' }
  }
  if (String(itemStatus || '').toLowerCase() === 'failed' || error) {
    return {
      status: 'failed',
      createResult: false,
      lastError: toFreeCanvasConfigUserReason(error, '生成失败，请稍后重试'),
      localPath: '',
    }
  }
  const localPath = cleanText(resultPath, 2048).replace(/^\/static\//, '')
  if (String(itemStatus || '').toLowerCase() === 'completed' && localPath) {
    return {
      status: 'idle',
      createResult: true,
      lastError: '',
      localPath,
      mediaUrl: cleanText(resultUrl, 2048),
    }
  }
  if (String(itemStatus || '').toLowerCase() === 'completed') {
    return {
      status: 'failed',
      createResult: false,
      lastError: '任务完成但未返回可保存的本地文件',
      localPath: '',
    }
  }
  return {
    status: 'failed',
    createResult: false,
    lastError: '生成未完成，请重试',
    localPath: '',
  }
}

export function restoreFreeCanvasConfigOperationAfterReload(node) {
  if (node?.type !== 'config' || operationStatus(node) !== 'running') {
    return { resume: false, status: operationStatus(node) || 'idle', operationId: '' }
  }
  const operationId = cleanText(node?.metadata?.operationId, 256)
  if (!operationId) {
    return {
      resume: false,
      status: 'failed',
      operationId: '',
      lastError: '生成任务已中断，请重新生成',
    }
  }
  return { resume: true, status: 'running', operationId }
}

export function buildFreeCanvasConfigResultDraft({ configNode, serviceType, localPath } = {}) {
  const type = serviceType === 'video' ? 'video' : 'image'
  return {
    type,
    title: type === 'video' ? '生成视频' : '生成图片',
    storageKey: localPath,
    content: localPath,
    position: {
      x: (Number(configNode?.position?.x) || 0) + 304,
      y: Number(configNode?.position?.y) || 0,
    },
  }
}

export function applyFreeCanvasConfigGenerationResult(canvas, {
  nodeId,
  outcome,
  resultNode = null,
  resultEdge = null,
} = {}) {
  const nodes = Array.isArray(canvas?.nodes) ? canvas.nodes : []
  const edges = Array.isArray(canvas?.edges) ? canvas.edges : []
  const nextStatus = outcome?.status || 'failed'
  const nextNodes = nodes.map((node) => {
    if (String(node?.id) !== String(nodeId) || node?.type !== 'config') return node
    const metadata = {
      ...(node.metadata && typeof node.metadata === 'object' ? node.metadata : {}),
      updatedAt: new Date().toISOString(),
    }
    if (outcome?.lastError) metadata.lastError = toFreeCanvasConfigUserReason(outcome.lastError, '生成失败，请稍后重试')
    if (nextStatus === 'idle' || nextStatus === 'cancelled') delete metadata.lastError
    if (nextStatus === 'idle') delete metadata.operationId
    return { ...node, status: nextStatus, metadata }
  })
  if (!outcome?.createResult || nextStatus !== 'idle' || !resultNode) {
    return { ...canvas, nodes: nextNodes, edges }
  }
  return {
    ...canvas,
    nodes: [...nextNodes, resultNode],
    edges: resultEdge ? [...edges, resultEdge] : edges,
  }
}
