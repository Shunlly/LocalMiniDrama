import request from '@/utils/request'

export const taskAPI = {
  get(taskId, options) {
    return request.get(`/tasks/${taskId}`, options || {})
  },
  cancel(taskId, body, options) {
    return request.post(`/tasks/${taskId}/cancel`, body || {}, options || {})
  },
  listByResource(resourceId) {
    return request.get('/tasks', { params: { resource_id: String(resourceId) } })
  },
}
