import { computed, ref } from 'vue'

function defaultProjectLoadError({ projectLoadState, projectLoadNotFound, projectLoadErrorRaw }) {
  const raw = String(projectLoadErrorRaw.value || '').trim()
  if (raw) return raw
  if (projectLoadState.value !== 'error') return ''
  return projectLoadNotFound.value
    ? '该项目不存在，或已移入回收站。'
    : '无法连接本地服务，请确认服务已经启动后重试。'
}

/** 制作页项目加载失败面，不把 episodeId 当成项目 id */
export function useFilmCreateProjectLoadSurface({ initialRouteProjectId, store } = {}) {
  const projectLoadState = ref(initialRouteProjectId ? 'loading' : 'ready')
  const projectLoadErrorRaw = ref('')
  const projectLoadNotFound = ref(false)
  const projectLoadPending = ref(false)
  const projectLoadFailureRef = ref(null)
  const projectDependencyWarning = ref('')
  const projectDependencyLoading = ref(false)
  const projectLoadError = computed({
    get() {
      return defaultProjectLoadError({
        projectLoadState,
        projectLoadNotFound,
        projectLoadErrorRaw,
      })
    },
    set(value) {
      projectLoadErrorRaw.value = String(value || '')
    },
  })
  const projectLoadRetryable = computed(() => (
    projectLoadState.value === 'error' && !projectLoadNotFound.value
  ))
  const projectLoadErrorText = computed(() => projectLoadError.value)
  const projectPageTitle = computed(() => {
    if (projectLoadState.value === 'loading') return '正在加载项目'
    if (projectLoadState.value === 'error') {
      return projectLoadNotFound.value ? '项目不存在' : '项目加载失败'
    }
    return store?.dramaId ? (store.drama?.title || '项目') : '新建故事'
  })

  function focusProjectLoadFailure() {
    projectLoadFailureRef.value?.focus?.()
  }

  return {
    projectLoadState,
    projectLoadError,
    projectLoadNotFound,
    projectLoadPending,
    projectLoadFailureRef,
    projectDependencyWarning,
    projectDependencyLoading,
    projectLoadRetryable,
    projectLoadErrorText,
    projectPageTitle,
    focusProjectLoadFailure,
  }
}
