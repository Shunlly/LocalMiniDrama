import { computed } from 'vue'
import {
  batchGenerationDisabledReason,
  composeVideoDisabledReason,
  episodeResourceDisabledReason,
  pipelineDisabledReason,
  projectResourceDisabledReason,
  storyboardDisabledReason,
} from '@/utils/filmCreateActionState'

export function useFilmCreateActionDisabledReasons(deps = {}) {
  const {
    dramaId,
    currentEpisodeId,
    charactersGenerating,
    propsExtracting,
    scenesExtracting,
    pipelineRunning,
    storyboardMediaActionReason,
    productionReadinessReason,
    storyboardGenerating,
    universalOmniPolishRunning,
    batchImageRunning,
    batchVideoRunning,
    videoCapabilityReason,
    storyboards,
    assetVideoUrl,
    getSbVideo,
    videoStatus,
  } = deps

  const projectActionDisabledReason = computed(() => projectResourceDisabledReason({
    hasProject: Boolean(dramaId.value),
  }))
  const episodeActionDisabledReason = computed(() => episodeResourceDisabledReason({
    hasEpisode: Boolean(currentEpisodeId.value),
  }))
  const characterGenerationDisabledReason = computed(() => projectResourceDisabledReason({
    hasProject: Boolean(dramaId.value),
    running: charactersGenerating.value,
    label: '角色',
  }))
  const propsExtractionDisabledReason = computed(() => episodeResourceDisabledReason({
    hasEpisode: Boolean(currentEpisodeId.value),
    running: propsExtracting.value,
    label: '道具',
  }))
  const scenesExtractionDisabledReason = computed(() => episodeResourceDisabledReason({
    hasEpisode: Boolean(currentEpisodeId.value),
    running: scenesExtracting.value,
    label: '场景',
  }))
  const pipelineActionDisabledReason = computed(() => pipelineDisabledReason({
    hasEpisode: Boolean(currentEpisodeId.value),
    pipelineRunning: pipelineRunning.value,
  }))
  const productionPipelineActionDisabledReason = computed(() => (
    pipelineActionDisabledReason.value
    || storyboardMediaActionReason.value
    || productionReadinessReason.value
  ))
  const storyboardActionDisabledReason = computed(() => storyboardDisabledReason({
    hasEpisode: Boolean(currentEpisodeId.value),
    storyboardGenerating: storyboardGenerating.value,
    omniPolishing: universalOmniPolishRunning.value,
  }))
  const batchActionDisabledReason = computed(() => (
    storyboardMediaActionReason.value || batchGenerationDisabledReason({
      hasEpisode: Boolean(currentEpisodeId.value),
      pipelineRunning: pipelineRunning.value,
      storyboardGenerating: storyboardGenerating.value,
      omniPolishing: universalOmniPolishRunning.value,
      batchImageRunning: batchImageRunning.value,
      batchVideoRunning: batchVideoRunning.value,
    })
  ))
  const batchVideoActionDisabledReason = computed(() => (
    batchActionDisabledReason.value || videoCapabilityReason.value
  ))
  const playableStoryboardVideoCount = computed(() => (
    (storyboards.value || []).filter((storyboard) => Boolean(assetVideoUrl(getSbVideo(storyboard.id)))).length
  ))
  const composeActionDisabledReason = computed(() => composeVideoDisabledReason({
    hasEpisode: Boolean(currentEpisodeId.value),
    storyboardCount: (storyboards.value || []).length,
    playableVideoCount: playableStoryboardVideoCount.value,
    videoGenerating: videoStatus.value === 'generating',
    pipelineRunning: pipelineRunning.value,
    storyboardGenerating: storyboardGenerating.value,
    omniPolishing: universalOmniPolishRunning.value,
    batchImageRunning: batchImageRunning.value,
    batchVideoRunning: batchVideoRunning.value,
  }))

  return {
    projectActionDisabledReason,
    episodeActionDisabledReason,
    characterGenerationDisabledReason,
    propsExtractionDisabledReason,
    scenesExtractionDisabledReason,
    pipelineActionDisabledReason,
    productionPipelineActionDisabledReason,
    storyboardActionDisabledReason,
    batchActionDisabledReason,
    batchVideoActionDisabledReason,
    playableStoryboardVideoCount,
    composeActionDisabledReason,
  }
}
