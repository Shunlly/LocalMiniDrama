import request from '@/utils/request'
import { normalizeMediaItem } from '@/utils/mediaLibrary'

function normalizeAssetListResponse(response) {
  const items = Array.isArray(response?.items) ? response.items : []
  return {
    ...response,
    items: items.map((item) => normalizeMediaItem(item)),
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
}
