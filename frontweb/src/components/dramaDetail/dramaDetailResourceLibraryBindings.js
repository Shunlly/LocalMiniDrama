import { computed, isRef, unref } from 'vue'

/** 本剧资源库需要双向绑定的字段 */
export const DRAMA_DETAIL_RESOURCE_LIBRARY_MODEL_KEYS = [
  'activeResTab',
  'charKw', 'charPage', 'charPageSize',
  'sceneKw', 'scenePage', 'scenePageSize',
  'propKw', 'propPage', 'propPageSize',
]

/**
 * 把剧集详情页已有的 ref/函数装配成本剧资源库可 v-bind 的属性袋。
 * 不创建新状态，只补上 defineModel 需要的 onUpdate 监听。
 */
export function createDramaDetailResourceLibraryBindings(values) {
  const updaters = {}
  for (const key of DRAMA_DETAIL_RESOURCE_LIBRARY_MODEL_KEYS) {
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
