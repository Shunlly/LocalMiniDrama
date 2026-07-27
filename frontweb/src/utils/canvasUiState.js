import { hasRealMediaValue } from './storyboardMedia.js'

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

const STORYBOARD_SHOT_TYPE_LABELS = Object.freeze({
  extreme_long_shot: '大远景',
  extreme_wide: '大远景',
  long_shot: '远景',
  wide: '远景',
  full_shot: '全景',
  full: '全景',
  medium_long_shot: '中全景',
  medium_long: '中全景',
  medium_shot: '中景',
  medium: '中景',
  medium_close_up: '近景',
  close_up: '特写',
  extreme_close_up: '大特写',
})

export function storyboardShotTypeLabel(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  if (/\p{Script=Han}/u.test(raw)) return raw
  const normalized = raw.toLowerCase().replace(/[\s-]+/g, '_')
  return STORYBOARD_SHOT_TYPE_LABELS[normalized] || '其他景别'
}

export function getStoryboardInspectorNavigation(episodes, episodeId, storyboardId) {
  const episode = episodeOptions(episodes)
    .find((item) => String(item.id) === String(episodeId))
  const storyboards = Array.isArray(episode?.storyboards) ? episode.storyboards : []
  const currentIndex = storyboards.findIndex((item) => String(item?.id) === String(storyboardId))

  return {
    index: currentIndex >= 0 ? currentIndex + 1 : 0,
    total: storyboards.length,
    previousId: currentIndex > 0 ? storyboards[currentIndex - 1]?.id ?? null : null,
    nextId: currentIndex >= 0 && currentIndex < storyboards.length - 1
      ? storyboards[currentIndex + 1]?.id ?? null
      : null,
  }
}

export function getStoryboardInspectorMediaSummary(state = {}) {
  const imageRecords = Array.isArray(state.imageRecords) ? state.imageRecords : []
  const videoRecords = Array.isArray(state.videoRecords) ? state.videoRecords : []
  const audioRecords = Array.isArray(state.audioRecords) ? state.audioRecords : []
  const imageCount = imageRecords.filter((record) => (
    record?.status === 'completed'
    && (hasRealMediaValue(record?.image_url) || hasRealMediaValue(record?.local_path))
  )).length
  const videoCount = videoRecords.filter((record) => (
    record?.status === 'completed'
    && (hasRealMediaValue(record?.video_url) || hasRealMediaValue(record?.local_path))
  )).length
  return {
    imageCount: state.imageReady ? Math.max(1, imageCount) : 0,
    videoCount: state.videoReady ? Math.max(1, videoCount) : 0,
    audioReady: audioRecords.some(hasRealMediaValue),
  }
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
