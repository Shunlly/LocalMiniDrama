import { getServiceConfigReadiness } from './aiServiceReadiness.js'
import { isPlaceholderMediaUrl } from './mediaUrl.js'

function firstBusyReason(state) {
  if (state.pipelineRunning) return '全流程任务正在执行，请先暂停或等待完成'
  if (state.storyboardGenerating) return '正在生成分镜，请等待当前任务完成'
  if (state.omniPolishing) return '正在润色全能分镜提示词，请等待完成'
  if (state.batchImageRunning) return '正在批量生成分镜图，请先停止或等待完成'
  if (state.batchVideoRunning) return '正在批量生成分镜视频，请先停止或等待完成'
  return ''
}

const SERVICE_LABELS = {
  text: '文本模型',
  image: '素材图片模型',
  storyboard_image: '分镜图片模型',
  video: '视频模型',
  tts: '配音服务',
}

export function getGenerationServiceCapability(configs, serviceType, { loading = false, failed = false } = {}) {
  const label = SERVICE_LABELS[serviceType] || 'AI 模型'
  if (loading) {
    return {
      ready: false,
      status: 'checking',
      reason: `正在检查${label}配置，请稍候。`,
      config: null,
    }
  }
  if (failed) {
    return {
      ready: false,
      status: 'error',
      reason: `无法确认${label}配置，请刷新后重试或前往 AI 配置检查。`,
      config: null,
    }
  }

  const active = (Array.isArray(configs) ? configs : []).filter((config) => (
    config?.service_type === serviceType
    && config?.is_active !== false
    && config?.is_active !== 0
    && config?.is_active !== '0'
  ))
  const config = active.find((item) => item?.is_default) || active[0] || null
  if (!config) {
    return {
      ready: false,
      status: 'missing',
      reason: `缺少已启用的${label}配置。`,
      config: null,
    }
  }
  const readiness = getServiceConfigReadiness(config)
  if (!readiness.ready) {
    return {
      ready: false,
      status: 'missing-model',
      reason: `${label}配置尚未选择可用模型。`,
      config,
    }
  }
  return {
    ready: true,
    status: 'ready',
    reason: '',
    config,
    model: readiness.model,
    modelOptional: readiness.modelOptional,
  }
}

export function getVideoGenerationCapability(configs, options = {}) {
  const capability = getGenerationServiceCapability(configs, 'video', options)
  if (capability.status === 'missing') {
    return {
      ...capability,
      reason: '缺少已启用的视频模型，完整成片和批量视频暂不可用。',
    }
  }
  if (capability.status === 'missing-model') {
    return {
      ...capability,
      reason: '当前视频配置尚未选择可用模型，请先在 AI 配置中补充视频模型。',
    }
  }
  return capability
}

export function userFacingVideoGenerationError(value, fallback = '视频生成失败，请稍后重试。') {
  const message = String(value || '').trim()
  if (!message) return fallback
  if (isPlaceholderMediaUrl(message)) return '草稿占位视频，尚未生成可播放片段。'
  if (/^(?:internal server error|server error)$/i.test(message)) {
    return '视频生成服务暂时不可用，请检查视频模型配置后重试。'
  }
  if (/^(?:failed to fetch|fetch failed|network error)$/i.test(message)) {
    return '无法连接视频生成服务，请检查网络与模型配置后重试。'
  }
  return message.slice(0, 300)
}

export function projectResourceDisabledReason({ hasProject, running = false, label = '资源' }) {
  if (!hasProject) return '请先创建或打开项目'
  if (running) return `正在处理${label}，请等待完成`
  return ''
}

export function episodeResourceDisabledReason({ hasEpisode, running = false, label = '资源' }) {
  if (!hasEpisode) return '请先创建或选择剧集'
  if (running) return `正在处理${label}，请等待完成`
  return ''
}

export function pipelineDisabledReason({ hasEpisode, pipelineRunning }) {
  if (!hasEpisode) return '请先创建或选择剧集'
  if (pipelineRunning) return '全流程任务正在执行，可暂停后再调整操作'
  return ''
}

export function storyboardDisabledReason({ hasEpisode, storyboardGenerating, omniPolishing }) {
  if (!hasEpisode) return '请先创建或选择剧集'
  return firstBusyReason({ storyboardGenerating, omniPolishing })
}

export function batchGenerationDisabledReason({
  hasEpisode,
  pipelineRunning,
  storyboardGenerating,
  omniPolishing,
  batchImageRunning,
  batchVideoRunning,
}) {
  if (!hasEpisode) return '请先创建或选择剧集'
  return firstBusyReason({
    pipelineRunning,
    storyboardGenerating,
    omniPolishing,
    batchImageRunning,
    batchVideoRunning,
  })
}

export function composeVideoDisabledReason({
  hasEpisode,
  storyboardCount,
  playableVideoCount,
  videoGenerating,
  pipelineRunning,
  storyboardGenerating,
  omniPolishing,
  batchImageRunning,
  batchVideoRunning,
}) {
  if (!hasEpisode) return '请先创建或选择剧集'
  if (!storyboardCount) return '请先生成或添加分镜'
  if (Number.isFinite(Number(playableVideoCount)) && Number(playableVideoCount) < storyboardCount) {
    const completed = Math.max(0, Math.floor(Number(playableVideoCount)))
    return `请先为全部分镜生成可播放视频（已完成 ${completed}/${storyboardCount}）`
  }
  if (videoGenerating) return '正在合成视频，请等待当前任务完成'
  return firstBusyReason({
    pipelineRunning,
    storyboardGenerating,
    omniPolishing,
    batchImageRunning,
    batchVideoRunning,
  })
}

export function saveCurrentEpisodeDisabledReason({ dramaId, hasAnyEpisode, currentEpisodeId }) {
  if (dramaId && hasAnyEpisode && !currentEpisodeId) return '请先选择要保存的剧集'
  return ''
}

export function missingAssetImageReason(hasImage) {
  return hasImage ? '' : '请先生成或上传图片'
}
