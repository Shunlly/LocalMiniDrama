import { isRef, unref } from 'vue'

import {
  createTemplateModelBindings,
  FILM_CREATE_RESOURCE_DIALOG_MODEL_KEYS,
  FILM_CREATE_RESOURCE_PANEL_MODEL_KEYS,
  FILM_CREATE_SCRIPT_WORKBENCH_MODEL_KEYS,
  FILM_CREATE_STORYBOARD_DIALOG_MODEL_KEYS,
  FILM_CREATE_STORYBOARD_PANEL_MODEL_KEYS,
} from '../../utils/filmCreateTemplateBindings.js'

function setRefTrue(model) {
  return () => {
    if (isRef(model)) model.value = true
  }
}

function omitKeys(values, keys) {
  const next = { ...values }
  for (const key of keys) delete next[key]
  return next
}

/**
 * 把制作页已有状态装配成剧本工作台可 v-bind 的属性袋。
 * 不创建新状态；dramaId / currentEpisodeId 只作只读展示，不进入 v-model。
 */
export function createScriptWorkbenchBindings(values) {
  const {
    saveProjectSettings,
    showNovelImport,
    router,
    dramaId,
    returnToScriptCreation,
    openSelectScriptDialog,
    loadSelectScriptList,
    onPickScriptFromDialog,
    ...rest
  } = values
  return createTemplateModelBindings({
    ...rest,
    dramaId,
    onSaveSettings: () => saveProjectSettings(false),
    onOpenNovelImport: setRefTrue(showNovelImport),
    onGoToDrama: () => router.push('/drama/' + unref(dramaId)),
    onReturnToCreation: returnToScriptCreation,
    onOpenSelectScript: openSelectScriptDialog,
    onLoadSelectScriptList: loadSelectScriptList,
    onPickScript: onPickScriptFromDialog,
  }, FILM_CREATE_SCRIPT_WORKBENCH_MODEL_KEYS)
}

/**
 * 把制作页已有状态装配成资源面板可 v-bind 的属性袋。
 * 打开资料库/新增弹窗只改对应 ref；onAddEpisode 只作函数透出，不把 dramaId 或 episodeId 写进模型。
 */
export function createResourcePanelBindings(values) {
  const {
    openAddCharacter,
    showCharLibrary,
    showAddProp,
    showPropLibrary,
    openAddScene,
    showSceneLibrary,
    editCharacter,
    editProp,
    editScene,
    onAddCharacterToMaterialLibrary,
    onAddPropToMaterialLibrary,
    onAddSceneToMaterialLibrary,
    doUploadResourceImage,
    openImagePreview,
    scrollToStoryboard,
    playSd2Voice,
    onAddEpisode,
    onSelectEpisode,
    ...rest
  } = values
  return createTemplateModelBindings({
    ...omitKeys(rest, ['currentEpisodeId', 'dramaId']),
    onAddEpisode,
    onSelectEpisode,
    onAddCharacter: openAddCharacter,
    onOpenCharLibrary: setRefTrue(showCharLibrary),
    onAddProp: setRefTrue(showAddProp),
    onOpenPropLibrary: setRefTrue(showPropLibrary),
    onAddScene: openAddScene,
    onOpenSceneLibrary: setRefTrue(showSceneLibrary),
    onEditCharacter: editCharacter,
    onEditProp: editProp,
    onEditScene: editScene,
    onAddCharacterToMaterial: onAddCharacterToMaterialLibrary,
    onAddPropToMaterial: onAddPropToMaterialLibrary,
    onAddSceneToMaterial: onAddSceneToMaterialLibrary,
    onUploadResourceImage: doUploadResourceImage,
    onPreviewImage: openImagePreview,
    onScrollToStoryboard: scrollToStoryboard,
    onPlaySd2Voice: playSd2Voice,
  }, FILM_CREATE_RESOURCE_PANEL_MODEL_KEYS)
}

/**
 * 把制作页已有状态装配成分镜面板可 v-bind 的属性袋。
 * onXxx 多数是面板 props；保存设置与上传分镜图走事件监听。
 */
export function createStoryboardPanelBindings(values) {
  const {
    saveProjectSettings,
    doUploadSbImage,
    onUploadSbImageClick,
    prepareSbImageUpload,
    onAddEpisode,
    ...rest
  } = values
  return createTemplateModelBindings({
    ...rest,
    onAddEpisode,
    prepareSbImageUpload: prepareSbImageUpload || onUploadSbImageClick,
    onSaveSettings: () => saveProjectSettings(false),
    onUploadSbImage: doUploadSbImage,
  }, FILM_CREATE_STORYBOARD_PANEL_MODEL_KEYS)
}

/** 资源弹窗属性袋：currentEpisodeId 只读传入，不进入 v-model */
export function createResourceDialogsBindings(values, modelKeys = FILM_CREATE_RESOURCE_DIALOG_MODEL_KEYS) {
  return createTemplateModelBindings(values, modelKeys)
}

/** 分镜弹窗属性袋：只绑定分镜编辑态，不把 dramaId / episodeId 写进模型 */
export function createStoryboardDialogsBindings(values, modelKeys = FILM_CREATE_STORYBOARD_DIALOG_MODEL_KEYS) {
  return createTemplateModelBindings(values, modelKeys)
}
