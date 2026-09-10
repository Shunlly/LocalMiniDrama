import { computed, isRef, unref } from 'vue'

/** 资源弹窗需要双向绑定的字段 */
export const FILM_CREATE_RESOURCE_DIALOG_MODEL_KEYS = [
  'showAddProp', 'showCharLibrary', 'showCharSd2Cert', 'showEditCharLibrary',
  'showEditCharacter', 'showEditProp', 'showEditPropLibrary', 'showEditScene',
  'showEditSceneLibrary', 'showPropLibrary', 'showSceneLibrary', 'charLibraryKeyword',
  'charLibraryPage', 'charLibraryPageSize', 'charLibraryTab', 'dramaAllCharKeyword',
  'dramaAllCharPage', 'dramaAllCharPageSize', 'dramaAllPropKeyword', 'dramaAllPropPage',
  'dramaAllPropPageSize', 'dramaAllSceneKeyword', 'dramaAllScenePage', 'dramaAllScenePageSize',
  'propLibraryKeyword', 'propLibraryPage', 'propLibraryPageSize', 'propLibraryTab',
  'sceneLibraryKeyword', 'sceneLibraryPage', 'sceneLibraryPageSize', 'sceneLibraryTab',
  'addCharRefImage', 'addPropAddRefImage', 'addPropForm', 'addPropRefImage',
  'addSceneRefImage', 'editCharLibraryForm', 'editPropLibraryForm', 'editSceneLibraryForm',
]

/** 分镜弹窗需要双向绑定的字段 */
export const FILM_CREATE_STORYBOARD_DIALOG_MODEL_KEYS = [
  'showSbPromptDialog', 'showFramePromptEditor', 'showVideoParamsDialog', 'editingFramePromptText',
  'sbPromptImageText', 'sbPromptPolishedText', 'sbPromptVideoText', 'sbPromptTarget',
]

/** 剧本工作台需要双向绑定的字段；不含 dramaId / currentEpisodeId */
export const FILM_CREATE_SCRIPT_WORKBENCH_MODEL_KEYS = [
  'scriptWorkbenchMode', 'storyInput', 'storyStyle', 'storyType', 'storyEpisodeCount',
  'scriptTitle', 'scriptContent', 'showSelectScriptDialog', 'selectPreviewEpisodeId',
]

/** 资源面板折叠与视图开关；不含 dramaId / currentEpisodeId */
export const FILM_CREATE_RESOURCE_PANEL_MODEL_KEYS = [
  'resourcePanelCollapsed', 'charactersBlockCollapsed', 'propsBlockCollapsed',
  'scenesBlockCollapsed', 'propUseQuadGrid', 'sceneUseQuadGrid',
]

/** 分镜面板配置项；不含 dramaId / currentEpisodeId */
export const FILM_CREATE_STORYBOARD_PANEL_MODEL_KEYS = [
  'storyboardCount', 'videoDuration', 'gridMode',
  'storyboardUseFirstLastFrame', 'storyboardUniversalOmni', 'storyboardIncludeNarration',
  'lastFrameUseFirstLayoutLock', 'videoFrameContiguity',
  'sbTruncatedDismissed', 'batchImageStopping', 'batchVideoStopping', 'dragOverSbId',
]

/**
 * 把页面里已有的 ref/函数装配成可 v-bind 的属性袋。
 * 不创建新状态，只补上 defineModel 需要的 onUpdate 监听。
 */
export function createTemplateModelBindings(values, modelKeys = []) {
  const updaters = {}
  for (const key of modelKeys) {
    const model = values[key]
    updaters[`onUpdate:${key}`] = (next) => {
      if (isRef(model)) model.value = next
    }
  }
  return computed(() => {
    const bindings = { ...updaters }
    for (const [key, value] of Object.entries(values)) {
      bindings[key] = unref(value)
    }
    return bindings
  })
}
