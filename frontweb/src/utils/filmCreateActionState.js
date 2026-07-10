function firstBusyReason(state) {
  if (state.pipelineRunning) return '全流程任务正在执行，请先暂停或等待完成'
  if (state.storyboardGenerating) return '正在生成分镜，请等待当前任务完成'
  if (state.omniPolishing) return '正在润色全能分镜提示词，请等待完成'
  if (state.batchImageRunning) return '正在批量生成分镜图，请先停止或等待完成'
  if (state.batchVideoRunning) return '正在批量生成分镜视频，请先停止或等待完成'
  return ''
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
  videoGenerating,
  pipelineRunning,
  storyboardGenerating,
  omniPolishing,
  batchImageRunning,
  batchVideoRunning,
}) {
  if (!hasEpisode) return '请先创建或选择剧集'
  if (!storyboardCount) return '请先生成或添加分镜'
  if (videoGenerating) return '正在合成视频，请等待当前任务完成'
  return firstBusyReason({
    pipelineRunning,
    storyboardGenerating,
    omniPolishing,
    batchImageRunning,
    batchVideoRunning,
  })
}
