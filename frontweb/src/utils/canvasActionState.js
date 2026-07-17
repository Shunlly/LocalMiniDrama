function isPresent(value) {
  return value !== null && value !== undefined && value !== ''
}

const PRODUCTION_CAPABILITIES = Object.freeze({
  video: Object.freeze({ key: 'video', label: '视频生成', serviceType: 'video' }),
  tts: Object.freeze({ key: 'tts', label: '语音合成', serviceType: 'tts' }),
  ffmpeg: Object.freeze({ key: 'ffmpeg', label: '本地成片合成', serviceType: '' }),
})

function cleanDetail(value) {
  return String(value || '').trim().replace(/[。；;]+$/, '')
}

function unresolvedCapability(definition, status) {
  const checking = status === 'loading'
  return {
    key: definition.key,
    ready: false,
    status: checking ? 'checking' : 'error',
    reason: checking
      ? `正在检查${definition.label}正式制作能力，请稍候。`
      : `无法确认${definition.label}正式制作能力，请刷新后重试或前往 AI 配置检查。`,
    serviceType: definition.serviceType,
  }
}

function capabilityState(readiness, definition) {
  const capability = readiness.capabilities.find((item) => (
    item?.key === definition.key
    || (definition.serviceType && item?.service_type === definition.serviceType)
  ))
  const missingCapability = readiness.missing_capabilities.find((item) => (
    item?.key === definition.key
    || (definition.serviceType && item?.service_type === definition.serviceType)
  ))
  if (!capability || typeof capability.ready !== 'boolean') {
    return unresolvedCapability(definition, 'error')
  }
  if (capability.ready && !missingCapability) {
    return {
      key: definition.key,
      ready: true,
      status: 'ready',
      reason: '',
      serviceType: definition.serviceType,
    }
  }

  const detail = cleanDetail(missingCapability?.detail || capability.detail)
  const remediation = definition.serviceType ? '请前往 AI 配置完成配置。' : '请检查本机媒体合成工具。'
  return {
    key: definition.key,
    ready: false,
    status: 'missing',
    reason: `${definition.label}未就绪${detail ? `：${detail}` : ''}。${remediation}`,
    serviceType: definition.serviceType,
  }
}

export function normalizeCanvasProductionReadiness(value) {
  if (
    !value
    || typeof value !== 'object'
    || value.qa_mode !== 'production'
    || typeof value.ready !== 'boolean'
    || !Array.isArray(value.capabilities)
    || !Array.isArray(value.missing_capabilities)
  ) {
    throw new Error('正式制作能力响应无效')
  }

  for (const definition of Object.values(PRODUCTION_CAPABILITIES)) {
    const capability = value.capabilities.find((item) => (
      item?.key === definition.key
      || (definition.serviceType && item?.service_type === definition.serviceType)
    ))
    if (!capability || typeof capability.ready !== 'boolean') {
      throw new Error(`正式制作能力响应缺少 ${definition.key} 状态`)
    }
  }

  return {
    ...value,
    capabilities: [...value.capabilities],
    missing_capabilities: [...value.missing_capabilities],
  }
}

export function getCanvasProductionActionState(readinessState = {}) {
  const status = readinessState.status || 'loading'
  let readiness = null
  if (status === 'loaded') {
    try {
      readiness = normalizeCanvasProductionReadiness(readinessState.data)
    } catch (_) {
      readiness = null
    }
  }

  const video = readiness
    ? capabilityState(readiness, PRODUCTION_CAPABILITIES.video)
    : unresolvedCapability(PRODUCTION_CAPABILITIES.video, status)
  const tts = readiness
    ? capabilityState(readiness, PRODUCTION_CAPABILITIES.tts)
    : unresolvedCapability(PRODUCTION_CAPABILITIES.tts, status)
  const ffmpeg = readiness
    ? capabilityState(readiness, PRODUCTION_CAPABILITIES.ffmpeg)
    : unresolvedCapability(PRODUCTION_CAPABILITIES.ffmpeg, status)
  const compositeGap = [video, tts, ffmpeg].find((capability) => !capability.ready)
  const composite = compositeGap
    ? {
        key: 'composite',
        ready: false,
        status: compositeGap.status,
        reason: `完整成片暂不可用：${compositeGap.reason}`,
        serviceType: compositeGap.serviceType,
      }
    : { key: 'composite', ready: true, status: 'ready', reason: '', serviceType: '' }

  return { video, tts, ffmpeg, composite }
}

export function getCanvasProductionStepGate(step, productionActions) {
  if (step === 'video') return productionActions?.video || unresolvedCapability(PRODUCTION_CAPABILITIES.video, 'error')
  if (step === 'audio') return productionActions?.tts || unresolvedCapability(PRODUCTION_CAPABILITIES.tts, 'error')
  if (step === 'composite') {
    return productionActions?.composite || {
      key: 'composite',
      ready: false,
      status: 'error',
      reason: '无法确认完整成片能力，请刷新后重试。',
      serviceType: '',
    }
  }
  return { key: step || '', ready: true, status: 'ready', reason: '', serviceType: '' }
}

export function getCanvasPipelineProductionGate(steps, productionActions) {
  for (const step of (Array.isArray(steps) ? steps : [])) {
    const gate = getCanvasProductionStepGate(step, productionActions)
    if (!gate.ready) return gate
  }
  return { key: '', ready: true, status: 'ready', reason: '', serviceType: '' }
}

export function getCanvasActionDisabledReasons(state = {}) {
  const selectedStoryboardCount = Math.max(0, Number(state.selectedStoryboardCount) || 0)
  const pipelineSteps = Array.isArray(state.pipelineSteps) ? state.pipelineSteps : []
  const storyboardCount = Math.max(0, Number(state.storyboardCount) || 0)
  const episodeCount = Math.max(0, Number(state.episodeCount) || 0)
  const hasEpisode = isPresent(state.episodeId)
  const hasActiveWorkflow = isPresent(state.activeGroupId)
  const hasEpisodeContext = hasEpisode || episodeCount === 1
  const productionActions = state.productionActions || getCanvasProductionActionState()
  const createWorkflowProductionGate = getCanvasPipelineProductionGate(pipelineSteps, productionActions)
  const activeWorkflowSteps = Array.isArray(state.activeWorkflowSteps)
    ? state.activeWorkflowSteps
    : pipelineSteps
  const runWorkflowProductionGate = getCanvasPipelineProductionGate(activeWorkflowSteps, productionActions)

  const workflowBusyReason = state.workflowRunning ? '工作流正在执行，请等待完成' : ''
  const episodeBusyReason = state.episodeGenerating ? '本集生成任务正在执行，请等待完成' : ''
  const generationBusyReason = workflowBusyReason || episodeBusyReason
  const contentEpisodeReason = hasEpisodeContext
    ? ''
    : (episodeCount > 0 ? '请先选择一集，再创建剧本、分镜或素材' : '请先新建一集，再创建剧本、分镜或素材')

  return {
    editScript: contentEpisodeReason,
    createStoryboard: contentEpisodeReason,
    createAsset: contentEpisodeReason,
    createWorkflow: workflowBusyReason
      || (selectedStoryboardCount === 0 ? '请先在画布中框选或按住 Ctrl 选择分镜' : '')
      || (pipelineSteps.length === 0 ? '请至少选择一个工作流步骤' : '')
      || createWorkflowProductionGate.reason,
    runWorkflow: generationBusyReason
      || (!hasActiveWorkflow ? '请先选择一个工作流' : '')
      || runWorkflowProductionGate.reason,
    deleteWorkflow: workflowBusyReason
      || (!hasActiveWorkflow ? '请先选择一个工作流' : ''),
    generateStoryboards: generationBusyReason
      || (!hasEpisode ? '请先选择一集' : '')
      || (!state.episodeHasScript ? '当前集还没有剧本，请先编写或导入剧本' : ''),
    batchImages: generationBusyReason
      || (!hasEpisode ? '请先选择一集' : '')
      || (storyboardCount === 0 ? '当前集还没有分镜，请先生成或新建分镜' : ''),
    batchVideos: generationBusyReason
      || (!hasEpisode ? '请先选择一集' : '')
      || (storyboardCount === 0 ? '当前集还没有分镜，请先生成或新建分镜' : '')
      || productionActions.video.reason,
    video: productionActions.video.reason,
    tts: productionActions.tts.reason,
    composite: productionActions.composite.reason,
  }
}

export function episodeHasProductionContent(episode) {
  if (!episode) return false
  return Boolean(String(episode.script_content || '').trim())
    || (Array.isArray(episode.storyboards) && episode.storyboards.length > 0)
}

export function getCanvasStartMode(drama, episodeId = null) {
  if (!drama) return 'unavailable'

  const episodes = Array.isArray(drama.episodes) ? drama.episodes : []
  if (!episodes.length) return 'create-episode'

  const selectedEpisode = isPresent(episodeId)
    ? episodes.find((episode) => String(episode.id) === String(episodeId))
    : null
  if (isPresent(episodeId) && !selectedEpisode) return 'select-episode'

  const scopedEpisodes = selectedEpisode ? [selectedEpisode] : episodes
  if (scopedEpisodes.some(episodeHasProductionContent)) return ''

  if (!selectedEpisode) return 'select-episode'
  return ''
}
