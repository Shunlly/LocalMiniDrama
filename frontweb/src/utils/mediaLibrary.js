const VIDEO_EXTENSION = /\.(mp4|webm|mov)$/i
const NETWORK_LIBRARY_MODES = new Set(['local', 'network'])
const NETWORK_MEDIA_TYPES = new Set(['all', 'image', 'video'])
const UNKNOWN_LICENSE_VALUES = new Set([
  'unknown',
  'unspecified',
  'unlicensed',
  '未知',
  '未注明',
  '未注明许可',
  '无许可信息',
])
const MAX_NETWORK_KEYWORD_LENGTH = 200
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/

function cleanMediaPath(url) {
  return String(url || '').split(/[?#]/, 1)[0]
}

export function normalizeMediaItem(item = {}) {
  const url = item.url || item.image_url || item.video_url || ''
  const cleanPath = cleanMediaPath(url)
  const isVideo = item.type === 'video' || VIDEO_EXTENSION.test(cleanPath)

  return {
    ...item,
    type: isVideo ? 'video' : 'image',
    name: item.name || item.filename || cleanPath.split('/').pop() || '',
  }
}

export function formatMediaSize(size) {
  if (size == null || size === '') return ''
  const bytes = Number(size)
  if (!Number.isFinite(bytes) || bytes < 0) return ''
  if (bytes > 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB'
  if (bytes > 1024) return (bytes / 1024).toFixed(0) + ' KB'
  return bytes + ' B'
}

export function hasActiveMediaFilters(mediaType = 'all', keyword = '') {
  return mediaType !== 'all' || String(keyword).trim().length > 0
}

export function getVisibleSelectedMediaIds(selectedIds, visibleItems = []) {
  const selected = selectedIds instanceof Set ? selectedIds : new Set(selectedIds || [])
  const visibleIds = new Set(
    (Array.isArray(visibleItems) ? visibleItems : []).map((item) => item?.id),
  )
  return Array.from(selected).filter((id) => visibleIds.has(id))
}

export function mediaLibraryAccessState({
  loading = false,
  uploading = false,
  hasSuccessfulLoad = false,
  loadError = '',
  itemCount = 0,
} = {}) {
  return {
    navigationLocked: Boolean(uploading),
    showEntryStrip: Boolean(loading || loadError || Number(itemCount) > 0),
    writeLocked: Boolean(loading || !hasSuccessfulLoad || loadError),
  }
}

export function getMediaLibraryDramaId(returnTo = '') {
  const match = String(returnTo).match(/^\/film\/([1-9]\d*)(?:\/canvas)?(?:[?#]|$)/)
  if (!match) return null
  const dramaId = Number(match[1])
  return Number.isSafeInteger(dramaId) ? dramaId : null
}

function positiveDramaId(value) {
  const dramaId = Number(value)
  return Number.isSafeInteger(dramaId) && dramaId > 0 ? dramaId : null
}

export function getMediaOriginLabel(item = {}, options = {}) {
  const title = String(item?.source_drama_title || '').trim()
  if (title) return title
  const dramaId = positiveDramaId(item?.drama_id)
  if (dramaId) return `项目素材（ID ${dramaId}）`
  return options.globalLabel || '全局上传，可跨项目复用'
}

export function describeMediaDeleteImpact(item = {}, options = {}) {
  const name = String(item?.name || '').trim() || '未命名素材'
  const origin = getMediaOriginLabel(item, options)
  return `「${name}」来自${origin}。删除后所有项目都不能再使用它；若仍被分镜或画布引用，删除会被拒绝。`
}

export function describeMediaBatchDeleteImpact(count) {
  const total = Number(count)
  const safeCount = Number.isSafeInteger(total) && total > 0 ? total : 0
  return `将删除选中的 ${safeCount} 个素材。它们可能被其他项目复用；若仍被分镜或画布引用，删除会被拒绝。`
}

export function isMediaInUseError(error) {
  const code = error?.response?.data?.error?.code || error?.code
  if (code === 'ASSET_IN_USE') return true
  return /正在被/.test(String(error?.message || error?.response?.data?.error?.message || ''))
}

export function isMediaPickerItemInScope(item, context = {}) {
  if (context?.reusePolicy !== 'current-or-global') return true
  const scopeId = positiveDramaId(context.dramaId ?? context.drama_id)
  if (!scopeId) return true
  const itemDramaId = item?.drama_id
  if (itemDramaId == null || itemDramaId === '') return true
  if (Number(itemDramaId) === 0) return true
  return Number(itemDramaId) === scopeId
}

export function mediaPickerIncompatibleReason(item, { accept = 'all', context = {} } = {}) {
  if (!item) return '未选择素材'
  if (accept === 'video' && item.type !== 'video') return '当前用途只接受视频素材'
  if (accept === 'image' && item.type !== 'image') return '当前用途只接受图片素材'
  if (!isMediaPickerItemInScope(item, context)) {
    return '其他项目素材不能直接用于当前项目，请选择全局或当前项目素材'
  }
  return ''
}

function firstQueryValue(value) {
  return Array.isArray(value) ? value[0] : value
}

function normalizeNetworkChoice(value, allowedValues, fallback) {
  const candidate = firstQueryValue(value)
  return typeof candidate === 'string' && allowedValues.has(candidate) ? candidate : fallback
}

function normalizeNetworkKeyword(value) {
  const candidate = firstQueryValue(value)
  if (typeof candidate !== 'string' || CONTROL_CHARACTERS.test(candidate)) return ''
  return candidate.trim().slice(0, MAX_NETWORK_KEYWORD_LENGTH)
}

export function normalizeMediaLibraryNetworkRoute(query = {}) {
  return {
    mode: normalizeNetworkChoice(query?.source, NETWORK_LIBRARY_MODES, 'local'),
    keyword: normalizeNetworkKeyword(query?.network_q),
    type: normalizeNetworkChoice(query?.network_type, NETWORK_MEDIA_TYPES, 'all'),
  }
}

export function mergeMediaLibraryNetworkRoute(query = {}, state = {}) {
  const nextQuery = query && typeof query === 'object' ? { ...query } : {}
  delete nextQuery.source
  delete nextQuery.network_q
  delete nextQuery.network_type

  const normalized = normalizeMediaLibraryNetworkRoute({
    source: state.mode,
    network_q: state.keyword,
    network_type: state.type,
  })
  if (normalized.mode === 'network') nextQuery.source = 'network'
  if (normalized.keyword) nextQuery.network_q = normalized.keyword
  if (normalized.type !== 'all') nextQuery.network_type = normalized.type
  return nextQuery
}

function isAuditableHttpsUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password
  } catch (_) {
    return false
  }
}

export function getNetworkAssetImportability(item = {}) {
  if (!isAuditableHttpsUrl(item?.source_url)) {
    return { allowed: false, reason: '缺少可审计的 HTTPS 来源链接' }
  }

  const license = String(item?.license || '').trim()
  if (!license || UNKNOWN_LICENSE_VALUES.has(license.toLowerCase())) {
    return { allowed: false, reason: '许可信息未知，禁止导入' }
  }
  if (!isAuditableHttpsUrl(item?.license_url)) {
    return { allowed: false, reason: '缺少可审计的 HTTPS 许可链接' }
  }
  return { allowed: true, reason: '' }
}

export function hasPendingMediaLibraryOperations(uploading = false, activeNetworkImports = null) {
  return Boolean(uploading) || Number(activeNetworkImports?.size || 0) > 0
}

export function getNetworkAssetCardImageUrl(item = {}) {
  return String(item?.thumbnail_url || item?.download_url || '').trim()
}

export function getNetworkAssetPreviewUrl(item = {}) {
  if (item?.media_type === 'video') return String(item?.download_url || '').trim()
  return String(item?.download_url || item?.thumbnail_url || '').trim()
}

export async function importNetworkAssetAndConfirm({
  item,
  dramaId = null,
  importAsset,
  confirmAsset,
  reload,
} = {}) {
  const importability = getNetworkAssetImportability(item)
  if (!importability.allowed) {
    const error = new Error(importability.reason)
    error.code = 'NETWORK_ASSET_NOT_AUDITABLE'
    throw error
  }
  const payload = Number.isSafeInteger(dramaId) && dramaId > 0
    ? { ...(item || {}), drama_id: dramaId }
    : { ...(item || {}) }
  const asset = await importAsset(payload)
  let confirmation
  try {
    confirmation = Number.isSafeInteger(Number(asset?.id))
      ? await confirmAsset(asset.id)
      : null
  } catch (error) {
    confirmation = { error }
  }
  let refresh
  try {
    refresh = await reload()
  } catch (error) {
    refresh = { status: 'failed', error }
  }
  return {
    asset,
    confirmation,
    refresh,
    confirmed: Number.isSafeInteger(Number(asset?.id))
      && Number(confirmation?.id) === Number(asset.id),
  }
}

export async function runMediaOperationOnce(activeKeys, key, operation) {
  if (!key || activeKeys.has(key)) return { started: false }
  activeKeys.add(key)
  try {
    return { started: true, value: await operation() }
  } finally {
    activeKeys.delete(key)
  }
}

export function createLatestMediaRequestGuard() {
  let latestRequestId = 0

  return {
    begin() {
      latestRequestId += 1
      return latestRequestId
    },

    commit(requestId, update) {
      if (requestId !== latestRequestId) return false
      update()
      return true
    },
  }
}
