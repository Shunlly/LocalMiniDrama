import { computed, ref } from 'vue'

/** 制作页项目加载失败面，不把 episodeId 当成项目 id */
export function useFilmCreateProjectLoadSurface({ initialRouteProjectId, store } = {}) {
  const projectLoadState = ref(initialRouteProjectId ? 'loading' : 'ready')
  const projectLoadError = ref('')
  const projectLoadNotFound = ref(false)
  const projectLoadPending = ref(false)
  const projectLoadFailureRef = ref(null)
  const projectDependencyWarning = ref('')
  const projectDependencyLoading = ref(false)
  const projectPageTitle = computed(() => {
    if (projectLoadState.value === 'loading') return '正在加载项目'
    if (projectLoadState.value === 'error') return '项目加载失败'
    return store?.dramaId ? (store.drama?.title || '项目') : '新建故事'
  })

  return {
    projectLoadState,
    projectLoadError,
    projectLoadNotFound,
    projectLoadPending,
    projectLoadFailureRef,
    projectDependencyWarning,
    projectDependencyLoading,
    projectPageTitle,
  }
}
