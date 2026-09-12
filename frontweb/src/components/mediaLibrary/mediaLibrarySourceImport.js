/**
 * 素材中心网页导入：已有当前项目则直接进入素材流程，否则在本页弹出项目选择。
 */
import { ref } from 'vue'
import { dramaAPI as defaultDramaAPI } from '@/api/drama'
import { openWorkspaceNavItem as defaultOpenWorkspaceNavItem } from '@/layouts/AppWorkspaceNav.js'
import { describeServiceLoadError, isRequestCanceled, withRequestRetry } from '@/utils/requestError'
import {
  buildMediaLibrarySourceImportDestination,
  normalizeMediaLibrarySourceImportProjects,
} from '@/utils/mediaLibrarySourceImport.js'

const DEFAULT_PAGE_SIZE = 24
const SEARCH_DEBOUNCE_MS = 240

export function describeMediaLibrarySourceImportLoadError(error, signal) {
  return describeServiceLoadError(error, {
    serviceLabel: '项目服务',
    signal,
    fallback: '无法连接项目服务，请检查服务是否已启动',
  })
}

export function createMediaLibrarySourceImport(ctx = {}) {
  const dramaAPI = ctx.dramaAPI || defaultDramaAPI
  const openWorkspaceNavItem = ctx.openWorkspaceNavItem || defaultOpenWorkspaceNavItem
  const router = ctx.router
  const scopedDramaId = ctx.scopedDramaId
  const returnTo = ctx.returnTo
  const navigationLocked = ctx.navigationLocked

  const showPicker = ref(false)
  const loading = ref(false)
  const loadError = ref('')
  const projects = ref([])
  const total = ref(0)
  const page = ref(1)
  const pageSize = ref(DEFAULT_PAGE_SIZE)
  const keyword = ref('')
  const hasSuccessfulLoad = ref(false)

  let requestSequence = 0
  let abortController = null
  let keywordTimer = null

  function currentReturnTo() {
    return typeof returnTo?.value === 'string' ? returnTo.value : ''
  }

  function isNavigationLocked() {
    return Boolean(navigationLocked?.value)
  }

  function goSourceImport() {
    if (isNavigationLocked()) return 'locked'
    const direct = buildMediaLibrarySourceImportDestination({
      projectId: scopedDramaId?.value,
      returnTo: currentReturnTo(),
    })
    if (direct) {
      router.push(direct)
      return 'direct'
    }
    showPicker.value = true
    return 'picker'
  }

  async function loadProjects(options = {}) {
    const requestedPage = Math.max(1, Number(options.page ?? page.value) || 1)
    const requestedPageSize = Math.max(1, Number(options.pageSize ?? pageSize.value) || DEFAULT_PAGE_SIZE)
    abortController?.abort()
    const controller = new AbortController()
    abortController = controller
    const requestId = ++requestSequence
    loading.value = true
    try {
      const res = await withRequestRetry(
        () => dramaAPI.list({
          page: requestedPage,
          page_size: requestedPageSize,
          keyword: keyword.value.trim() || undefined,
          sort: 'updated-desc',
        }, { signal: controller.signal, suppressErrorToast: true }),
        { maxAttempts: 2, delayMs: 400, signal: controller.signal },
      )
      if (requestId !== requestSequence) return { status: 'stale' }
      const normalized = normalizeMediaLibrarySourceImportProjects(res, {
        page: requestedPage,
        pageSize: requestedPageSize,
      })
      if (normalized.total > 0 && requestedPage > normalized.lastPage) {
        page.value = normalized.lastPage
        return await loadProjects({ page: normalized.lastPage, pageSize: requestedPageSize })
      }
      projects.value = normalized.items
      total.value = normalized.total
      page.value = normalized.page
      pageSize.value = normalized.pageSize
      hasSuccessfulLoad.value = true
      loadError.value = ''
      return { status: 'applied' }
    } catch (error) {
      if (isRequestCanceled(error) || requestId !== requestSequence) {
        return { status: 'stale', error }
      }
      loadError.value = describeMediaLibrarySourceImportLoadError(error, controller.signal)
      return { status: 'failed', error }
    } finally {
      if (requestId === requestSequence) loading.value = false
    }
  }

  function scheduleSearch() {
    page.value = 1
    requestSequence += 1
    if (keywordTimer) clearTimeout(keywordTimer)
    keywordTimer = setTimeout(() => {
      keywordTimer = null
      loadProjects({ page: 1 })
    }, SEARCH_DEBOUNCE_MS)
  }

  function loadProjectPage(nextPage) {
    return loadProjects({ page: nextPage })
  }

  function selectProject(project) {
    if (isNavigationLocked()) return false
    const destination = buildMediaLibrarySourceImportDestination({
      projectId: project?.id,
      returnTo: currentReturnTo(),
    })
    if (!destination) return false
    showPicker.value = false
    router.push(destination)
    return true
  }

  function createProjectFromPicker() {
    if (isNavigationLocked()) return false
    showPicker.value = false
    openWorkspaceNavItem(router, 'list', { query: { new: '1', intent: 'source-import' } })
    return true
  }

  function resetPicker() {
    if (keywordTimer) clearTimeout(keywordTimer)
    keywordTimer = null
    abortController?.abort()
    keyword.value = ''
    page.value = 1
    projects.value = []
    total.value = 0
    loadError.value = ''
    hasSuccessfulLoad.value = false
    loading.value = false
  }

  function dispose() {
    resetPicker()
    showPicker.value = false
  }

  return {
    showPicker,
    loading,
    loadError,
    projects,
    total,
    page,
    pageSize,
    keyword,
    hasSuccessfulLoad,
    goSourceImport,
    loadProjects,
    scheduleSearch,
    loadProjectPage,
    selectProject,
    createProjectFromPicker,
    resetPicker,
    dispose,
  }
}
