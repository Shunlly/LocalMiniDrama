import { ref } from 'vue'

export function useFilmCreateWorkspaceNav(deps = {}) {
  const {
    router,
    route,
    dramaId,
    selectedEpisodeId,
    projectListReturnTo,
    showGlobalMediaPicker,
  } = deps
  const filmCreateHeaderRef = ref(null)

  function goList() {
    router.push(projectListReturnTo.value || { name: 'list' })
  }

  function goCanvasMode() {
    if (!dramaId.value) return
    const query = selectedEpisodeId.value ? { episode: String(selectedEpisodeId.value) } : {}
    if (projectListReturnTo.value) query.returnTo = projectListReturnTo.value
    router.push({ path: `/film/${dramaId.value}/canvas`, query })
  }

  function openMediaLibraryFromPicker() {
    showGlobalMediaPicker.value = false
    router.push({ name: 'media-library', query: { returnTo: route.fullPath } })
  }

  function onSelectEpisode() {
    if (filmCreateHeaderRef.value?.focusEpisodeSelect?.()) return
    if (typeof document === 'undefined') return
    document.querySelector('.header')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return {
    filmCreateHeaderRef,
    goList,
    goCanvasMode,
    openMediaLibraryFromPicker,
    onSelectEpisode,
  }
}
