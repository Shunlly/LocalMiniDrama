import { computed, isRef, unref } from 'vue'

/** 剧集详情资源弹窗需要双向绑定的字段 */
export const DRAMA_DETAIL_RESOURCE_DIALOG_MODEL_KEYS = [
  'editDramaCharVisible', 'editDramaCharForm',
  'editDramaSceneVisible', 'editDramaSceneForm',
  'editDramaPropVisible', 'editDramaPropForm',
  'editCharVisible', 'editCharForm',
  'editSceneVisible', 'editSceneForm',
  'editPropVisible', 'editPropForm',
  'importVisible', 'importKw', 'importPage', 'importPageSize',
  'previewUrl',
]

/**
 * 把剧集详情页已有的 ref/函数装配成可 v-bind 的属性袋。
 * 不创建新状态，只补上 defineModel 需要的 onUpdate 监听。
 */
export function createDramaDetailResourceDialogBindings(values) {
  const updaters = {}
  for (const key of DRAMA_DETAIL_RESOURCE_DIALOG_MODEL_KEYS) {
    const model = values[key]
    updaters['onUpdate:' + key] = (next) => {
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
