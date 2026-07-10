function toCount(value) {
  return Math.max(0, Number(value) || 0)
}

function isPresent(value) {
  return value !== null && value !== undefined && value !== ''
}

function episodeOptions(episodes) {
  if (!Array.isArray(episodes)) return []
  return episodes.filter((episode) => episode && isPresent(episode.id))
}

export function resolveCanvasEpisodeId(episodes, episodeId) {
  if (!isPresent(episodeId)) return null
  const episode = episodeOptions(episodes)
    .find((item) => String(item.id) === String(episodeId))
  return episode?.id ?? null
}

export function createCanvasEpisodeDraft(episodes, selectedEpisodeId = null) {
  const options = episodeOptions(episodes)
  const selectedId = resolveCanvasEpisodeId(options, selectedEpisodeId)
  if (selectedId !== null) return selectedId
  return options.length === 1 ? options[0].id : null
}

export function reconcileCanvasEpisodeDraft(
  episodes,
  draftEpisodeId,
  selectedEpisodeId = null
) {
  const draftId = resolveCanvasEpisodeId(episodes, draftEpisodeId)
  if (draftId !== null) return draftId
  return createCanvasEpisodeDraft(episodes, selectedEpisodeId)
}

export function getCanvasWorkflowUiState(state = {}) {
  const selectedStoryboardCount = toCount(state.selectedStoryboardCount)
  const workflowGroupCount = toCount(state.workflowGroupCount)
  const actionReasons = state.actionReasons || {}
  const showCreateControls = selectedStoryboardCount > 0
  const showManagementControls = workflowGroupCount > 0

  let helperText = '框选分镜后，可把生图、生视频、配音组合成可复用分组。'
  if (showCreateControls && actionReasons.createWorkflow) {
    helperText = actionReasons.createWorkflow
  } else if (showManagementControls && actionReasons.runWorkflow) {
    helperText = actionReasons.runWorkflow
  } else if (showManagementControls && !showCreateControls) {
    helperText = '框选分镜后可按当前流程创建新的工作流分组。'
  }

  return {
    showCreateControls,
    showManagementControls,
    showAnyControls: showCreateControls || showManagementControls,
    helperText,
  }
}

export function getCanvasEmptyStateActions(mode, episodeCount = null) {
  if (mode === 'create-episode') {
    return {
      primaryAction: 'create-episode',
      secondaryAction: 'go-list',
    }
  }
  if (mode === 'select-episode') {
    if (episodeCount !== null && toCount(episodeCount) === 0) {
      return {
        primaryAction: 'create-episode',
        secondaryAction: 'go-list',
      }
    }
    return {
      primaryAction: 'confirm-episode',
      secondaryAction: 'go-list',
    }
  }
  return {
    primaryAction: '',
    secondaryAction: 'go-list',
  }
}
