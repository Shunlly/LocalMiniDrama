export function useFilmCreateWorkspaceNav(deps = {}) {
  const {
    router,
    route,
    dramaId,
    selectedEpisodeId,
    projectListReturnTo,
    showGlobalMediaPicker,
  } = deps
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
  return {
    goList,
    goCanvasMode,
    openMediaLibraryFromPicker,
  }
}
