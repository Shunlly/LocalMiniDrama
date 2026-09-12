/**
 * 剧集详情资源库 Tab 键盘切换、预览和按 Tab 加载列表。
 * 不持有资源列表状态，也不把分集 ID 当成项目 ID。
 */
import { ref, watch, nextTick } from 'vue'

export const DRAMA_DETAIL_RESOURCE_TABS = ['lib-char', 'lib-scene', 'lib-prop', 'drama-char', 'drama-scene', 'drama-prop']

export function createDramaDetailResourceTabs({
  loadCharList,
  loadSceneList,
  loadPropList,
} = {}) {
  const activeResTab = ref('lib-char')
  const previewUrl = ref(null)

  function openPreview(url) {
    if (url) previewUrl.value = url
  }

  function onResourceTabKeydown(event) {
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const index = Math.max(0, DRAMA_DETAIL_RESOURCE_TABS.indexOf(activeResTab.value))
    let next = index
    if (event.key === 'ArrowRight') next = (index + 1) % DRAMA_DETAIL_RESOURCE_TABS.length
    else if (event.key === 'ArrowLeft') next = (index - 1 + DRAMA_DETAIL_RESOURCE_TABS.length) % DRAMA_DETAIL_RESOURCE_TABS.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = DRAMA_DETAIL_RESOURCE_TABS.length - 1
    activeResTab.value = DRAMA_DETAIL_RESOURCE_TABS[next]
    nextTick(() => {
      globalThis.document?.getElementById?.('drama-res-tab-' + DRAMA_DETAIL_RESOURCE_TABS[next])?.focus()
    })
  }

  watch(activeResTab, (tab) => {
    if (tab === 'lib-char') loadCharList()
    else if (tab === 'lib-scene') loadSceneList()
    else if (tab === 'lib-prop') loadPropList()
  })

  return {
    activeResTab,
    previewUrl,
    openPreview,
    onResourceTabKeydown,
  }
}
