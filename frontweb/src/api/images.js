import request from '@/utils/request'

export const imagesAPI = {
  list(params, options) {
    return request.get('/images', { ...(options || {}), params: params || {} })
  },
  create(data, options) {
    return request.post('/images', data, options || {})
  },
  upload(data) {
    return request.post('/images/upload', data)
  },
  delete(id) {
    return request.delete(`/images/${id}`)
  }
}
