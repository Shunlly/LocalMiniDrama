/**
 * 素材中心网络搜索、导入和来源证据复制。沿用现有 network media API，不接入新爬虫。
 */
import { ElMessage } from '@/utils/elementPlusFeedback.js'
import {
  mediaLibraryAPI as defaultMediaLibraryAPI,
  importNetworkAssetAndConfirm as defaultImportNetworkAssetAndConfirm,
} from '@/api/mediaLibrary.js'
import {
  describeMediaLibraryUserError,
  isMediaLibraryUserAbort,
} from '@/utils/mediaLibraryUserError'
import {
  buildMediaLibraryNetworkImportFeedback,
  runMediaOperationOnce,
} from '@/utils/mediaLibrary'
import {
  networkItemKey,
  networkItemTitle,
  networkItemImportability,
} from '@/components/mediaLibrary/mediaLibraryFormatters.js'

const NETWORK_SOURCE_NAME_RE = /Wikimedia Commons|Openverse|Creative Commons/g

function isAllowedNetworkSourceMessage(text) {
  const value = String(text || '').trim()
  if (!value || !/[一-鿿]/.test(value)) return false
  if (/https?:\/\//i.test(value)) return false
  NETWORK_SOURCE_NAME_RE.lastIndex = 0
  if (!NETWORK_SOURCE_NAME_RE.test(value)) return false
  NETWORK_SOURCE_NAME_RE.lastIndex = 0
  const stripped = value.replace(NETWORK_SOURCE_NAME_RE, ' ')
  return !/[A-Za-z]{4,}/.test(stripped)
}

export function describeNetworkError(error, fallback) {
  const raw = typeof error === 'string' ? error.trim() : String(error?.message || '').trim()
  if (isAllowedNetworkSourceMessage(raw)) return raw
  return describeMediaLibraryUserError(error, { serviceLabel: '网络素材服务', fallback })
}

export async function copySourceEvidence(value, label) {
  const text = String(value || '').trim()
  if (!text) return false
  try {
    await navigator.clipboard.writeText(text)
    ElMessage.success(`${label} 已复制`)
    return true
  } catch (_) {
    ElMessage.error(`${label} 复制失败，请手动选择复制`)
    return false
  }
}

export function createMediaLibraryNetworkActions(ctx = {}) {
  const networkKeyword = ctx.networkKeyword
  const networkMediaType = ctx.networkMediaType
  const networkSource = ctx.networkSource
  const networkItems = ctx.networkItems
  const networkLoading = ctx.networkLoading
  const networkError = ctx.networkError
  const networkNotice = ctx.networkNotice
  const networkSearched = ctx.networkSearched
  const networkRequestGuard = ctx.networkRequestGuard
  const networkImportFeedback = ctx.networkImportFeedback
  const networkImportRetryItem = ctx.networkImportRetryItem
  const networkImportingKeys = ctx.networkImportingKeys
  const scopedDramaId = ctx.scopedDramaId
  const loadMedia = ctx.loadMedia
  const mediaLibraryAPI = ctx.mediaLibraryAPI || defaultMediaLibraryAPI
  const importNetworkAssetAndConfirm = ctx.importNetworkAssetAndConfirm || defaultImportNetworkAssetAndConfirm

  let networkAbortController = null

  function clearNetworkSearch() {
    networkKeyword.value = ''
    networkMediaType.value = 'all'
    networkSource.value = 'all'
    invalidateNetworkSearch()
  }

  function cancelNetworkSearch() {
    if (!networkAbortController && !networkLoading.value) return
    networkAbortController?.abort()
    networkAbortController = null
    networkRequestGuard.begin()
    networkLoading.value = false
  }

  function invalidateNetworkSearch() {
    networkRequestGuard.begin()
    networkAbortController?.abort()
    networkAbortController = null
    networkItems.value = []
    networkError.value = ''
    networkNotice.value = ''
    networkSearched.value = false
    networkLoading.value = false
  }

  async function searchNetworkMedia() {
    const query = networkKeyword.value.trim()
    if (!query) {
      networkError.value = '请输入关键词后再搜索'
      return
    }
    networkAbortController?.abort()
    const abortController = new AbortController()
    networkAbortController = abortController
    const requestId = networkRequestGuard.begin()
    networkLoading.value = true
    networkError.value = ''
    networkNotice.value = ''
    try {
      const params = { keyword: query, source: networkSource.value }
      if (networkMediaType.value !== 'all') params.type = networkMediaType.value
      const result = await mediaLibraryAPI.searchNetwork(params, {
        suppressErrorToast: true,
        signal: abortController.signal,
      })
      networkRequestGuard.commit(requestId, () => {
        networkItems.value = result?.items || []
        networkNotice.value = result?.notice || ''
        networkSearched.value = true
      })
    } catch (error) {
      if (isMediaLibraryUserAbort(error)) return
      networkRequestGuard.commit(requestId, () => {
        networkItems.value = []
        networkNotice.value = ''
        networkSearched.value = true
        const message = describeNetworkError(error, '暂时无法搜索网络素材，请稍后重试')
        networkError.value = message || '暂时无法搜索网络素材，请稍后重试'
      })
    } finally {
      networkRequestGuard.commit(requestId, () => {
        networkLoading.value = false
      })
      if (networkAbortController === abortController) networkAbortController = null
    }
  }

  function handleNetworkTypeChange() {
    invalidateNetworkSearch()
    if (networkKeyword.value.trim()) searchNetworkMedia()
  }

  function handleNetworkSourceChange() {
    invalidateNetworkSearch()
    if (networkKeyword.value.trim()) searchNetworkMedia()
  }

  async function importNetworkItem(item) {
    const key = networkItemKey(item)
    const importability = networkItemImportability(item)
    if (!importability.allowed) {
      ElMessage.warning(importability.reason)
      return
    }
    await runMediaOperationOnce(networkImportingKeys, key, async () => {
      networkImportFeedback.value = null
      networkImportRetryItem.value = null
      try {
        const result = await importNetworkAssetAndConfirm({
          item,
          dramaId: scopedDramaId.value,
          api: mediaLibraryAPI,
          reload: loadMedia,
        })
        if (result.confirmed) {
          ElMessage.success(`已导入：${networkItemTitle(item)}`)
        } else {
          networkImportFeedback.value = buildMediaLibraryNetworkImportFeedback({
            status: 'unconfirmed',
            item,
          })
          ElMessage.error(networkImportFeedback.value.detail)
        }
      } catch (error) {
        if (isMediaLibraryUserAbort(error)) return
        networkImportRetryItem.value = item
        networkImportFeedback.value = buildMediaLibraryNetworkImportFeedback({
          status: 'failed',
          item,
          detail: describeNetworkError(error, '网络素材导入失败'),
        })
        ElMessage.error(networkImportFeedback.value.detail)
      }
    })
  }

  return {
    describeNetworkError,
    copySourceEvidence,
    clearNetworkSearch,
    cancelNetworkSearch,
    invalidateNetworkSearch,
    searchNetworkMedia,
    handleNetworkTypeChange,
    handleNetworkSourceChange,
    importNetworkItem,
  }
}
