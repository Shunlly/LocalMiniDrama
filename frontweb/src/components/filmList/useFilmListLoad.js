/** 项目列表分页加载、封面失败态和写锁。 */
import { computed, onBeforeUnmount, ref } from 'vue'
import { dramaAPI } from '@/api/drama'
import { projectCoverUrl as resolveProjectCoverUrl, describeListWriteLockReason } from '@/components/filmList/filmListFormatters.js'
import { createOperationId, logOperation } from '@/utils/operationLog'
import { describeServiceLoadError, isRequestCanceled, withRequestRetry } from '@/utils/requestError'

export function useFilmListLoad(deps = {}) {
  const {
    normalizedProjectSearch,
    projectStatusFilter,
    projectSort,
  } = deps

  const loading = ref(false)
  const dramas = ref([])
  const total = ref(0)
  const projectPage = ref(1)
  const projectPageSize = ref(24)
  const listError = ref('')
  const hasSuccessfulListLoad = ref(false)
  const listIsStale = computed(() => Boolean(listError.value) && hasSuccessfulListLoad.value)
  const listWriteLocked = computed(() => loading.value || !hasSuccessfulListLoad.value || Boolean(listError.value))
  const listWriteLockReason = computed(() => describeListWriteLockReason({
    loading: loading.value,
    listError: listError.value,
    isStale: listIsStale.value,
    hasSuccessfulListLoad: hasSuccessfulListLoad.value,
  }))
  let listRequestSequence = 0
  let projectReloadTimer = null
  const projectCoverErrors = ref(new Set())
  let listAbortController = null

  function describeProjectLoadError(error) {
    return describeServiceLoadError(error, { serviceLabel: '项目服务' })
  }

  function scheduleProjectListReload() {
    projectPage.value = 1
    listRequestSequence += 1
    if (projectReloadTimer) clearTimeout(projectReloadTimer)
    projectReloadTimer = setTimeout(() => {
      projectReloadTimer = null
      loadList({ page: 1 })
    }, 240)
  }

  async function loadList(options = {}) {
    const requestedPage = Math.max(1, Number(options.page ?? projectPage.value) || 1)
    const requestedPageSize = Math.max(1, Number(options.pageSize ?? projectPageSize.value) || 24)
    listAbortController?.abort()
    const controller = new AbortController()
    listAbortController = controller
    const requestId = ++listRequestSequence
    const operationId = createOperationId('project_list_load')
    loading.value = true
    let loaded = false
    logOperation({
      operation: 'project_list_load',
      operationId,
      phase: 'start',
      page: requestedPage,
      pageSize: requestedPageSize,
    })
    const startedAt = Date.now()
    try {
      const res = await withRequestRetry(
        () => dramaAPI.list({
          page: requestedPage,
          page_size: requestedPageSize,
          keyword: normalizedProjectSearch.value || undefined,
          status: projectStatusFilter.value !== 'all' ? projectStatusFilter.value : undefined,
          sort: projectSort.value,
        }, { signal: controller.signal }),
        { maxAttempts: 2, delayMs: 400, signal: controller.signal },
      )
      if (requestId !== listRequestSequence) {
        logOperation({
          operation: 'project_list_load',
          operationId,
          phase: 'cancel',
          status: 'stale',
          durationMs: Date.now() - startedAt,
        })
        return false
      }
      const pagination = res?.pagination ?? {}
      const nextTotal = Number(pagination.total ?? 0) || 0
      const nextPageSize = Number(pagination.page_size ?? requestedPageSize) || requestedPageSize
      const lastPage = Math.max(1, Math.ceil(nextTotal / nextPageSize))
      if (nextTotal > 0 && requestedPage > lastPage) {
        projectPage.value = lastPage
        return await loadList({ page: lastPage, pageSize: nextPageSize })
      }
      dramas.value = res?.items ?? []
      total.value = nextTotal
      projectPage.value = Math.min(Math.max(1, Number(pagination.page ?? requestedPage) || requestedPage), lastPage)
      projectPageSize.value = nextPageSize
      projectCoverErrors.value = new Set()
      hasSuccessfulListLoad.value = true
      listError.value = ''
      loaded = true
    } catch (error) {
      if (isRequestCanceled(error) || requestId !== listRequestSequence) {
        return false
      }
      if (requestId === listRequestSequence) {
        listError.value = describeProjectLoadError(error)
        logOperation({
          operation: 'project_list_load',
          operationId,
          phase: 'error',
          durationMs: Date.now() - startedAt,
          error: listError.value,
        })
      }
    } finally {
      if (requestId === listRequestSequence) loading.value = false
    }
    if (loaded) {
      logOperation({
        operation: 'project_list_load',
        operationId,
        phase: 'success',
        durationMs: Date.now() - startedAt,
        page: projectPage.value,
        total: total.value,
      })
      deps.onLoaded?.()
    }
    return loaded
  }

  function loadProjectPage(page) {
    return loadList({ page })
  }

  function handleProjectPageSizeChange(pageSize) {
    projectPage.value = 1
    return loadList({ page: 1, pageSize })
  }

  function projectCoverUrl(drama) {
    return resolveProjectCoverUrl(drama, projectCoverErrors.value)
  }

  function markProjectCoverError(drama) {
    const id = String(drama?.id ?? '')
    if (!id) return
    const next = new Set(projectCoverErrors.value)
    next.add(id)
    projectCoverErrors.value = next
  }

  function disposeLoad() {
    if (projectReloadTimer) clearTimeout(projectReloadTimer)
    projectReloadTimer = null
    listAbortController?.abort()
  }

  onBeforeUnmount(() => {
    if (projectReloadTimer) clearTimeout(projectReloadTimer)
    listAbortController?.abort()
  })

  return {
    loading,
    dramas,
    total,
    projectPage,
    projectPageSize,
    listError,
    hasSuccessfulListLoad,
    listIsStale,
    listWriteLocked,
    listWriteLockReason,
    scheduleProjectListReload,
    loadList,
    loadProjectPage,
    handleProjectPageSizeChange,
    describeProjectLoadError,
    projectCoverUrl,
    markProjectCoverError,
    disposeLoad,
  }
}
