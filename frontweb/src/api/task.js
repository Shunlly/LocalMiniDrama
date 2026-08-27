import request from '@/utils/request'

export const taskAPI = {
  get(taskId, options) {
    return request.get(`/tasks/${taskId}`, options || {})
  },
  cancel(taskId, body, options) {
    return request.post(`/tasks/${taskId}/cancel`, body || {}, options || {})
  },
  listByResource(resourceId, options = {}) {
    const params = { resource_id: String(resourceId) }
    if (options.drama_id != null) params.drama_id = String(options.drama_id)
    return request.get('/tasks', { params })
  },
}
