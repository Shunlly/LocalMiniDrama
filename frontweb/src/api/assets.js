import request from '@/utils/request'
import { normalizeMediaItem } from '@/utils/mediaLibrary'

function normalizeAssetListResponse(response) {
  const items = Array.isArray(response?.items) ? response.items : []
  return {
    ...response,
    items: items.map((item) => normalizeMediaItem(item)),
  }
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
  if (Number.isSafeInteger(value.drama_id) && value.drama_id > 0) {
    normalized.drama_id = value.drama_id
  }
  return normalized
}

function normalizeNetworkSearchResponse(response) {
  const items = Array.isArray(response?.items) ? response.items : []
  return {
    ...response,
    items: items.map(normalizeNetworkAsset),
  }
}

export const assetsAPI = {
  async list(params = {}, requestOptions = {}) {
    const response = await request.get('/assets', { ...requestOptions, params })
    return normalizeAssetListResponse(response)
  },

  async get(id) {
    const response = await request.get(`/assets/${id}`)
    return normalizeMediaItem(response || {})
  },

  async searchNetwork(params = {}, requestOptions = {}) {
    const response = await request.get('/assets/network-search', { ...requestOptions, params })
    return normalizeNetworkSearchResponse(response)
  },

  async importNetwork(item, requestOptions = {}) {
    const response = await request.post('/assets/network-import', normalizeNetworkAsset(item), requestOptions)
    return normalizeMediaItem(response || {})
  },

  async create(data) {
    const response = await request.post('/assets', data || {})
    return normalizeMediaItem(response || {})
  },
}
