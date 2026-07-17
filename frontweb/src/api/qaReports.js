import request from '@/utils/request'

export const qaReportsAPI = {
  list(params) {
    return request.get('/qa/reports', { params: params || {} })
  },
  get(reportId) {
    return request.get(`/qa/reports/${reportId}`)
  },
  audit(data) {
    return request.post('/qa/audit', data)
  },
  remediate(reportId, data) {
    return request.post(`/qa/reports/${reportId}/remediate`, data || {})
  },
}
