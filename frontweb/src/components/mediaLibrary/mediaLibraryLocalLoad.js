/**
 * 素材中心本地列表加载与筛选。只搬家，不改竞态、取消和失败时保留旧数据。
 */
import { describeServiceLoadError, isRequestCanceled, withRequestRetry } from '@/utils/requestError'
import { getVisibleSelectedMediaIds, normalizeMediaItem as normalizeItem } from '@/utils/mediaLibrary'
import { mediaLibraryAPI as defaultMediaLibraryAPI } from '@/api/mediaLibrary.js'

export function describeMediaLoadError(error) {
  return describeServiceLoadError(error, { serviceLabel: '素材服务' })
}

export function createMediaLibraryLocalLoad(ctx = {}) {
  const page = ctx.page
  const pageSize = ctx.pageSize
  const mediaType = ctx.mediaType
  const keyword = ctx.keyword
  const loading = ctx.loading
  const mediaItems = ctx.mediaItems
  const selectedIds = ctx.selectedIds
  const total = ctx.total
  const hasSuccessfulMediaLoad = ctx.hasSuccessfulMediaLoad
  const loadError = ctx.loadError
  const mediaRequestGuard = ctx.mediaRequestGuard
  const mediaLibraryAPI = ctx.mediaLibraryAPI || defaultMediaLibraryAPI

  let keywordTimer = null
  let mediaListAbortController = null

  function debouncedLoad() {
    clearTimeout(keywordTimer)
    keywordTimer = setTimeout(applyFilters, 400)
  }

  function applyFilters() {
    page.value = 1
    loadMedia()
  }

  function clearFilters() {
    mediaType.value = 'all'
    keyword.value = ''
    applyFilters()
  }

  async function loadMedia() {
    mediaListAbortController?.abort()
    const controller = new AbortController()
    mediaListAbortController = controller
    const requestId = mediaRequestGuard.begin()
    loading.value = true
    try {
      const params = {
        page: page.value,
        page_size: pageSize.value,
      }
      if (mediaType.value !== 'all') params.type = mediaType.value
      if (keyword.value.trim()) params.keyword = keyword.value.trim()
      const res = await withRequestRetry(
        () => mediaLibraryAPI.list(params, { suppressErrorToast: true, signal: controller.signal }),
        { maxAttempts: 2, delayMs: 400, signal: controller.signal },
      )
      const applied = mediaRequestGuard.commit(requestId, () => {
        const nextItems = (res?.items || []).map(normalizeItem)
        const visibleSelectedIds = getVisibleSelectedMediaIds(selectedIds, nextItems)
        mediaItems.value = nextItems
        selectedIds.clear()
        visibleSelectedIds.forEach((id) => selectedIds.add(id))
        total.value = res?.pagination?.total ?? res?.total ?? 0
        hasSuccessfulMediaLoad.value = true
        loadError.value = ''
      })
      return { status: applied ? 'applied' : 'stale', data: applied ? [...mediaItems.value] : null }
    } catch (err) {
      if (isRequestCanceled(err)) {
        return { status: 'stale', error: err }
      }
      const applied = mediaRequestGuard.commit(requestId, () => {
        loadError.value = describeMediaLoadError(err)
      })
      return { status: applied ? 'failed' : 'stale', error: err }
    } finally {
      mediaRequestGuard.commit(requestId, () => {
        loading.value = false
      })
    }
  }

  function abortMediaListRequest() {
    clearTimeout(keywordTimer)
    mediaListAbortController?.abort()
  }

  return {
    describeMediaLoadError,
    debouncedLoad,
    applyFilters,
    clearFilters,
    loadMedia,
    abortMediaListRequest,
  }
}
