function isPresent(value) {
  return value !== null && value !== undefined && value !== ''
}

export function getCanvasActionDisabledReasons(state = {}) {
  const selectedStoryboardCount = Math.max(0, Number(state.selectedStoryboardCount) || 0)
  const pipelineSteps = Array.isArray(state.pipelineSteps) ? state.pipelineSteps : []
  const storyboardCount = Math.max(0, Number(state.storyboardCount) || 0)
  const episodeCount = Math.max(0, Number(state.episodeCount) || 0)
  const hasEpisode = isPresent(state.episodeId)
  const hasActiveWorkflow = isPresent(state.activeGroupId)
  const hasEpisodeContext = hasEpisode || episodeCount === 1

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
      || (pipelineSteps.length === 0 ? '请至少选择一个工作流步骤' : ''),
    runWorkflow: generationBusyReason
      || (!hasActiveWorkflow ? '请先选择一个工作流' : ''),
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
      || (storyboardCount === 0 ? '当前集还没有分镜，请先生成或新建分镜' : ''),
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
