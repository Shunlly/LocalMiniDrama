import request from '../utils/request.js'
import {
  getNetworkAssetImportability,
  normalizeMediaItem,
} from '../utils/mediaLibrary.js'

function positiveAssetId(value) {
  const normalized = typeof value === 'string' && /^\d+$/.test(value.trim())
    ? Number(value.trim())
    : value
  return Number.isSafeInteger(normalized) && normalized > 0 ? normalized : null
}

function normalizeNetworkAsset(item) {
  const value = item && typeof item === 'object' ? item : {}
  const normalized = {
    title: String(value.title || '').trim(),
    thumbnail_url: String(value.thumbnail_url || '').trim(),
    source_url: String(value.source_url || '').trim(),
    download_url: String(value.download_url || '').trim(),
    author: String(value.author || '').trim(),
    license: String(value.license || '').trim(),
    license_url: String(value.license_url || '').trim(),
    commons_page_id: Number.isSafeInteger(Number(value.commons_page_id))
      ? Number(value.commons_page_id)
      : null,
    commons_revision_timestamp: String(value.commons_revision_timestamp || '').trim(),
    commons_sha1: String(value.commons_sha1 || '').trim(),
    media_type: value.media_type === 'video' ? 'video' : 'image',
    width: Number(value.width) || null,
    height: Number(value.height) || null,
  }
  const dramaId = positiveAssetId(value.drama_id)
  if (dramaId) normalized.drama_id = dramaId
  return normalized
}

function normalizeAssetListResponse(response) {
  const items = Array.isArray(response?.items) ? response.items : []
  return {
    ...response,
    items: items.map((item) => normalizeMediaItem(item)),
  }
}

function normalizeNetworkSearchResponse(response) {
  const items = Array.isArray(response?.items) ? response.items : []
  return {
    ...response,
    items: items.map(normalizeNetworkAsset),
  }
}

function invalidAssetIdError(value) {
  const error = new Error(`素材 ID 无效：${String(value ?? '')}`)
  error.code = 'MEDIA_ASSET_ID_INVALID'
  return error
}

function normalizeDramaId(value) {
  if (value == null || value === '') return null
  const normalized = positiveAssetId(value)
  if (!normalized) {
    const error = new Error(`项目 ID 无效：${String(value)}`)
    error.code = 'MEDIA_DRAMA_ID_INVALID'
    throw error
  }
  return normalized
}

function scopeMatches(asset, dramaId) {
  const expectedDramaId = normalizeDramaId(dramaId)
  if (expectedDramaId) return positiveAssetId(asset?.drama_id) === expectedDramaId
  return asset?.drama_id == null || asset?.drama_id === ''
}

export function createMediaLibraryAPI(client = request) {
  return {
    async list(params = {}, requestOptions = {}) {
      const response = await client.get('/assets', { ...requestOptions, params })
      return normalizeAssetListResponse(response)
    },

    async getById(id, requestOptions = {}) {
      const normalizedId = positiveAssetId(id)
      if (!normalizedId) throw invalidAssetIdError(id)
      const response = await client.get(`/assets/${normalizedId}`, {
        ...requestOptions,
        suppressErrorToast: true,
      })
      const asset = normalizeMediaItem(response || {})
      if (positiveAssetId(asset.id) !== normalizedId) {
        const error = invalidAssetIdError(asset.id)
        error.code = 'MEDIA_ASSET_CONFIRMATION_MISMATCH'
        throw error
      }
      return asset
    },

    async searchNetwork(params = {}, requestOptions = {}) {
      const response = await client.get('/assets/network-search', { ...requestOptions, params })
      return normalizeNetworkSearchResponse(response)
    },

    async importNetwork(item, requestOptions = {}) {
      const response = await client.post(
        '/assets/network-import',
        normalizeNetworkAsset(item),
        requestOptions,
      )
      return normalizeMediaItem(response || {})
    },
  }
}

export const mediaLibraryAPI = createMediaLibraryAPI()

export async function importNetworkAssetAndConfirm({
  item,
  dramaId = null,
  api = mediaLibraryAPI,
  reload = async () => ({ status: 'skipped' }),
} = {}) {
  const importability = getNetworkAssetImportability(item)
  if (!importability.allowed) {
    const error = new Error(importability.reason)
    error.code = 'NETWORK_ASSET_NOT_AUDITABLE'
    throw error
  }

  const normalizedDramaId = normalizeDramaId(dramaId)
  const payload = normalizedDramaId ? { ...(item || {}), drama_id: normalizedDramaId } : { ...(item || {}) }
  const asset = await api.importNetwork(payload, { suppressErrorToast: true })
  const assetId = positiveAssetId(asset?.id)
  let confirmation = null
  let confirmationError = null

  if (assetId) {
    try {
      confirmation = await api.getById(assetId, { suppressErrorToast: true })
    } catch (error) {
      confirmationError = error
    }
  } else {
    confirmationError = invalidAssetIdError(asset?.id)
    confirmationError.code = 'MEDIA_ASSET_CONFIRMATION_MISSING'
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
    confirmationError,
    refresh,
    confirmed: Boolean(
      assetId
      && !confirmationError
      && positiveAssetId(confirmation?.id) === assetId
      && scopeMatches(confirmation, normalizedDramaId),
    ),
  }
}
