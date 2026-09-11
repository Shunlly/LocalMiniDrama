import { computed, unref } from 'vue'

import { createTemplateModelBindings } from '../../utils/filmCreateTemplateBindings.js'

/** 侧栏分镜列表展开；不含 dramaId / episodeId */
export const FILM_CREATE_QUICK_NAV_MODEL_KEYS = [
  'storyboardMenuExpanded',
]

/** 工作台弹窗层双向绑定；不含 dramaId / episodeId */
export const FILM_CREATE_WORKSPACE_LAYER_MODEL_KEYS = [
  'visible', 'mode', 'text', 'maxChapters', 'aiSummarize',
  'modelValue', 'showGlobalMediaPicker',
]

/**
 * 把制作页已有状态按侧栏 / 加载面 / 依赖警告 / 弹窗层装配成绑定源。
 * 只搬家，不创建新状态，不改空剧本门闩和离开保护。
 * 不把道具列表或 episodeId 写进这些绑定源。
 */
export function createFilmCreateShellBindingSources(ctx = {}) {
  const {
    navCollapsed, navSteps, activeNavAnchor, storyboardMenuExpanded,
    storyboards, allActiveTaskItems, allActiveTaskLabels, pipelineStopping,
    toggleNav, scrollToAnchor, cancelActiveTask,
    projectLoadState, projectLoadError, projectLoadNotFound, projectLoadPending,
    retryFilmProjectLoad, goList,
    storyboardMediaLoadError, projectDependencyWarning, projectDependencyLoading,
    retryProjectDependencies,
    resourceDialogsBindings, storyboardDialogsBindings,
    showNovelImport, novelImportMode, novelText, novelMaxChapters, novelAiSummarize,
    novelFileName, novelImporting, novelImportReset, onNovelFileChange, onImportNovel,
    showAiConfigDialog, aiConfigInitialServiceType, confirmAiConfigWorkspaceClose,
    requestAiConfigWorkspaceClose, onAiConfigurationChanged, previewImageUrl,
    closeImagePreview, showGlobalMediaPicker, globalMediaPickerTitle,
    globalMediaPickerAccept, globalMediaPickerContext, onGlobalMediaAssetSelected,
    openMediaLibraryFromPicker,
  } = ctx

  return {
    quickNav: {
      navCollapsed, navSteps, activeNavAnchor, storyboardMenuExpanded,
      storyboards, allActiveTaskItems, allActiveTaskLabels, pipelineStopping,
      onToggleNav: toggleNav, onScrollToAnchor: scrollToAnchor, onCancelActiveTask: cancelActiveTask,
    },
    projectLoadState: {
      state: projectLoadState, errorText: projectLoadError,
      notFound: projectLoadNotFound, pending: projectLoadPending,
      onRetry: retryFilmProjectLoad, onGoList: goList,
    },
    projectDependencyWarning: {
      mediaError: storyboardMediaLoadError, dependencyWarning: projectDependencyWarning,
      loading: projectDependencyLoading, onRetry: retryProjectDependencies,
    },
    workspaceDialogsLayer: {
      resourceDialogs: resourceDialogsBindings, storyboardDialogs: storyboardDialogsBindings,
      visible: showNovelImport, mode: novelImportMode, text: novelText,
      maxChapters: novelMaxChapters, aiSummarize: novelAiSummarize,
      fileName: novelFileName, importing: novelImporting,
      onReset: novelImportReset, onFileChange: onNovelFileChange, onImport: onImportNovel,
      modelValue: showAiConfigDialog, initialServiceType: aiConfigInitialServiceType,
      beforeClose: confirmAiConfigWorkspaceClose, onBack: requestAiConfigWorkspaceClose,
      onConfigurationChanged: onAiConfigurationChanged,
      previewImageUrl: computed(() => unref(previewImageUrl) || ''),
      onCloseImagePreview: closeImagePreview, showGlobalMediaPicker,
      globalMediaPickerTitle, globalMediaPickerAccept, globalMediaPickerContext,
      onSelect: onGlobalMediaAssetSelected, onOpenLibrary: openMediaLibraryFromPicker,
    },
  }
}

/** 侧栏属性袋：storyboardMenuExpanded 可 v-model；不把 dramaId / episodeId 写进模型 */
export function createQuickNavBindings(values) {
  return createTemplateModelBindings(values, FILM_CREATE_QUICK_NAV_MODEL_KEYS)
}

/** 加载面属性袋：状态只读传入，不进入 v-model */
export function createProjectLoadStateBindings(values) {
  return createTemplateModelBindings(values, [])
}

/** 依赖警告属性袋：警告文案只读传入，不进入 v-model */
export function createProjectDependencyWarningBindings(values) {
  return createTemplateModelBindings(values, [])
}

/** 弹窗层属性袋：小说导入 / AI 配置 / 素材选择可 v-model；不把 dramaId / episodeId 写进模型 */
export function createWorkspaceDialogsLayerBindings(values) {
  return createTemplateModelBindings(values, FILM_CREATE_WORKSPACE_LAYER_MODEL_KEYS)
}

function isAssembledShellSources(value) {
  return Boolean(value?.quickNav && value?.workspaceDialogsLayer)
}

/**
 * 把侧栏 / 加载面 / 依赖警告 / 弹窗层装配成可 v-bind 的属性袋。
 * 可接收扁平制作页状态，或已装配的 quickNav / workspaceDialogsLayer 源。
 * 不把 projectLoadState 当成已装配源，因为它也是扁平 ctx 字段。
 * 不创建新状态。
 */
export function createFilmCreateShellBindings(ctx = {}) {
  const sources = isAssembledShellSources(ctx)
    ? ctx
    : createFilmCreateShellBindingSources(ctx)
  return {
    quickNavBindings: createQuickNavBindings(sources.quickNav || {}),
    projectLoadStateBindings: createProjectLoadStateBindings(sources.projectLoadState || {}),
    projectDependencyWarningBindings: createProjectDependencyWarningBindings(sources.projectDependencyWarning || {}),
    workspaceDialogsLayerBindings: createWorkspaceDialogsLayerBindings(sources.workspaceDialogsLayer || {}),
  }
}
