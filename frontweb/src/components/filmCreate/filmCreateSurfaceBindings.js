import { computed, isRef, unref } from 'vue'

import { createTemplateModelBindings } from '../../utils/filmCreateTemplateBindings.js'

/** 流水线设置项；不含 dramaId / episodeId */
export const FILM_CREATE_PIPELINE_PANEL_MODEL_KEYS = [
  'aspectRatio', 'clipDuration', 'scriptLanguage', 'generationStyle',
]

/** 交付区成片设置；currentEpisodeId / dramaId 只读，不进 v-model */
export const FILM_CREATE_OUTPUT_SECTION_MODEL_KEYS = [
  'resolution', 'subtitle', 'burnDialogue', 'watermark', 'watermarkText',
]

function setRefTrue(model) {
  return () => {
    if (isRef(model)) model.value = true
  }
}

/**
 * 把制作页已有状态按页头 / 流水线 / 交付区装配成绑定源。
 * 只搬家，不创建新状态，不改空剧本门闩和离开保护。
 * 不把道具列表写进这些绑定源。
 */
export function createFilmCreateSurfaceBindingSources(ctx = {}) {
  const {
    store, router, isDark, projectPageTitle, projectLoadState,
    dramaId, hasAnyEpisode, selectedEpisodeId, episodeSwitching,
    selectedEpisodeContextLabel, goList, onEpisodeSelect, onAddEpisode,
    goCanvasMode, toggleTheme, openAiConfig,
    projectAspectRatio, videoClipDuration, scriptLanguage, generationStyle,
    generationStyleOptions, productionPipelineActionDisabledReason, pipelineActionDisabledReason,
    productionReadinessReason, productionReadinessState, productionReadinessServiceType,
    pipelineStarting, pipelineStopping, pipelineAbortRequested, pipelineRunning,
    pipelinePaused, pipelineErrorLog, pipelineCurrentStep, pipelineStepIndex,
    pipelineStepTotal, pipelineCountdown, pipelineCountdownMsg, pipelineActiveTasks,
    saveProjectSettings, startOneClickPipeline, startTextFrameworkPipeline,
    openAiConfigFromPipeline, refreshProductionReadiness, onPipelineResume,
    cancelPipelineRun, skipPipelineCountdown,
    videoResolution, videoSubtitle, videoBurnDialogue, videoWatermark,
    videoWatermarkText, playableStoryboardVideoCount, storyboards,
    deliveryCompositeStatusLabel, deliveryFileCount, composeActionDisabledReason,
    videoStatus, videoProgress, currentEpisodeVideoUrl, videoDownloadStatus,
    videoDownloadError, currentEpisodeId, deliverySubtitleAvailable,
    deliveryExportStatus, videoErrorMsg, deliveryExportFeedback, deliveryExportHasError,
    onGenerateVideo, downloadCurrentEpisodeVideo, downloadCurrentEpisodeSubtitle,
    exportCurrentProjectPackage,
  } = ctx

  return {
    header: {
      projectPageTitle, projectLoadState, dramaId, hasAnyEpisode,
      selectedEpisodeId, episodeSwitching, selectedEpisodeContextLabel,
      episodes: computed(() => store.drama?.episodes || []),
      isDark, onGoList: goList, onEpisodeSelect, onAddEpisode,
      onGoToDrama: () => router.push('/drama/' + unref(dramaId)),
      onGoCanvasMode: goCanvasMode, onToggleTheme: toggleTheme, onOpenAiConfig: openAiConfig,
    },
    pipelinePanel: {
      aspectRatio: projectAspectRatio, clipDuration: videoClipDuration,
      scriptLanguage, generationStyle, generationStyleOptions,
      productionDisabledReason: productionPipelineActionDisabledReason,
      draftDisabledReason: pipelineActionDisabledReason,
      productionReadinessReason, productionReadinessState, productionReadinessServiceType,
      starting: pipelineStarting, stopping: pipelineStopping,
      stopRequired: computed(() => Boolean(unref(pipelineAbortRequested) && unref(pipelineRunning) && !unref(pipelineStopping))),
      running: pipelineRunning, paused: pipelinePaused, errorLog: pipelineErrorLog,
      currentStep: pipelineCurrentStep, stepIndex: pipelineStepIndex, stepTotal: pipelineStepTotal,
      countdown: pipelineCountdown, countdownMessage: pipelineCountdownMsg, activeTasks: pipelineActiveTasks,
      hasEpisode: hasAnyEpisode, onSaveSettings: saveProjectSettings,
      onStartOneClick: startOneClickPipeline, onStartTextFramework: startTextFrameworkPipeline,
      onOpenAiConfig: openAiConfigFromPipeline, onRetryReadiness: refreshProductionReadiness,
      onPause: setRefTrue(pipelinePaused), onResume: onPipelineResume, onCancel: cancelPipelineRun,
      onSkipCountdown: skipPipelineCountdown, onAddEpisode,
    },
    outputSection: {
      resolution: videoResolution, subtitle: videoSubtitle, burnDialogue: videoBurnDialogue,
      watermark: videoWatermark, watermarkText: videoWatermarkText, playableStoryboardVideoCount,
      storyboardCount: computed(() => (unref(storyboards) || []).length),
      deliveryCompositeStatusLabel, deliveryFileCount, composeActionDisabledReason,
      videoStatus, videoProgress, currentEpisodeVideoUrl, videoDownloadStatus,
      videoDownloadError, currentEpisodeId, deliverySubtitleAvailable, dramaId,
      deliveryExportStatus, videoErrorMsg, deliveryExportFeedback, deliveryExportHasError,
      onOpenAiConfig: openAiConfig, onGenerateVideo,
      onDownloadVideo: downloadCurrentEpisodeVideo, onDownloadSubtitle: downloadCurrentEpisodeSubtitle,
      onExportProject: exportCurrentProjectPackage,
    },
  }
}

/** 页头属性袋：selectedEpisodeId / dramaId 只读传入，不进入 v-model */
export function createHeaderBindings(values) {
  return createTemplateModelBindings(values, [])
}

/** 流水线属性袋：设置项可 v-model；不把 dramaId / episodeId 写进模型 */
export function createPipelinePanelBindings(values) {
  return createTemplateModelBindings(values, FILM_CREATE_PIPELINE_PANEL_MODEL_KEYS)
}

/** 交付区属性袋：成片设置可 v-model；currentEpisodeId / dramaId 只读 */
export function createOutputSectionBindings(values) {
  return createTemplateModelBindings(values, FILM_CREATE_OUTPUT_SECTION_MODEL_KEYS)
}

function isAssembledSurfaceSources(value) {
  return Boolean(value?.header && value?.pipelinePanel && value?.outputSection)
}

/**
 * 把页头 / 流水线 / 交付区装配成可 v-bind 的属性袋。
 * 可接收扁平制作页状态，或已装配的 header / pipelinePanel / outputSection 源。
 * 不创建新状态。
 */
export function createFilmCreateSurfaceBindings(ctx = {}) {
  const sources = isAssembledSurfaceSources(ctx)
    ? ctx
    : createFilmCreateSurfaceBindingSources(ctx)
  return {
    headerBindings: createHeaderBindings(sources.header || {}),
    pipelinePanelBindings: createPipelinePanelBindings(sources.pipelinePanel || {}),
    outputSectionBindings: createOutputSectionBindings(sources.outputSection || {}),
  }
}
