import request from '@/utils/request'

export const sourceIntakeAPI = {
  listForDrama(dramaId) {
    return request.get(`/dramas/${dramaId}/story-sources`)
  },
  createForDrama(dramaId, data) {
    return request.post(`/dramas/${dramaId}/story-sources`, data)
  },
  uploadForDrama(dramaId, formData) {
    return request.post(`/dramas/${dramaId}/story-sources/upload`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },
  get(sourceId) {
    return request.get(`/story-sources/${sourceId}`)
  },
  createPlan(sourceId, data) {
    return request.post(`/story-sources/${sourceId}/adaptation-plans`, data || {})
  },
  applyPlan(planId) {
    return request.post(`/adaptation-plans/${planId}/apply`)
  },
}
