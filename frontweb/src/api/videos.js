import request from '@/utils/request'

export const videosAPI = {
  list(params, options) {
    return request.get('/videos', { ...(options || {}), params: params || {} })
  },
  get(id) {
    return request.get(`/videos/${id}`)
  },
  /** 创建单条分镜视频生成任务，body: { drama_id, storyboard_id, prompt, image_url?, model?, ... } */
  create(body, options) {
    return request.post('/videos', body, options || {})
  }
}
