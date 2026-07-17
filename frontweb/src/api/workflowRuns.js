import request from '@/utils/request'

export const workflowRunsAPI = {
  list(params) {
    return request.get('/workflows', { params: params || {} })
  },
  get(runId) {
    return request.get(`/workflows/${runId}`)
  },
  getNovel2AnimeReadiness(data) {
    return request.post('/workflows/novel2anime/readiness', data)
  },
  startNovel2Anime(data) {
    return request.post('/workflows/novel2anime', data)
  },
  retry(runId, data) {
    return request.post(`/workflows/${runId}/retry`, data || {})
  },
  cancel(runId, reason) {
    return request.post(`/workflows/${runId}/cancel`, { reason })
  },
  pause(runId, reason) {
    return request.post(`/workflows/${runId}/pause`, { reason })
  },
  resume(runId) {
    return request.post(`/workflows/${runId}/resume`)
  },
}
