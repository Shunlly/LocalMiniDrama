/**
 * 剧集详情角色/场景/道具编辑弹窗的本地状态。
 * 只创建 ref，不把剧集 ID 和分集 ID 混成同一个键。
 */
import { ref } from 'vue'

export const DRAMA_DETAIL_RESOURCE_EDITOR_MESSAGE_BOX_KEYBOARD = {
  closeOnClickModal: false,
  closeOnPressEscape: true,
  distinguishCancelAndClose: true,
}

function createEditorRefs() {
  return {
    visible: ref(false),
    form: ref(null),
    saving: ref(false),
    baseline: ref(''),
  }
}

export function createDramaDetailResourceEditorState() {
  const dramaChar = createEditorRefs()
  const dramaScene = createEditorRefs()
  const dramaProp = createEditorRefs()
  const char = createEditorRefs()
  const scene = createEditorRefs()
  const prop = createEditorRefs()

  return {
    editDramaCharVisible: dramaChar.visible,
    editDramaCharForm: dramaChar.form,
    editDramaCharSaving: dramaChar.saving,
    editDramaCharBaseline: dramaChar.baseline,
    editDramaSceneVisible: dramaScene.visible,
    editDramaSceneForm: dramaScene.form,
    editDramaSceneSaving: dramaScene.saving,
    editDramaSceneBaseline: dramaScene.baseline,
    editDramaPropVisible: dramaProp.visible,
    editDramaPropForm: dramaProp.form,
    editDramaPropSaving: dramaProp.saving,
    editDramaPropBaseline: dramaProp.baseline,
    editCharVisible: char.visible,
    editCharForm: char.form,
    editCharSaving: char.saving,
    editCharBaseline: char.baseline,
    editSceneVisible: scene.visible,
    editSceneForm: scene.form,
    editSceneSaving: scene.saving,
    editSceneBaseline: scene.baseline,
    editPropVisible: prop.visible,
    editPropForm: prop.form,
    editPropSaving: prop.saving,
    editPropBaseline: prop.baseline,
    editors: {
      dramaChar: { visible: dramaChar.visible, form: dramaChar.form, baseline: dramaChar.baseline },
      dramaScene: { visible: dramaScene.visible, form: dramaScene.form, baseline: dramaScene.baseline },
      dramaProp: { visible: dramaProp.visible, form: dramaProp.form, baseline: dramaProp.baseline },
      char: { visible: char.visible, form: char.form, baseline: char.baseline },
      scene: { visible: scene.visible, form: scene.form, baseline: scene.baseline },
      prop: { visible: prop.visible, form: prop.form, baseline: prop.baseline },
    },
  }
}
