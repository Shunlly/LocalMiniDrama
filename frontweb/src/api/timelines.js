import request from '@/utils/request'

export const timelinesAPI = {
  getDramaTimeline(dramaId) {
    return request.get(`/dramas/${dramaId}/timeline`)
  },
  getManifest(dramaId) {
    return request.get(`/dramas/${dramaId}/timeline/manifest`)
  },
  getEpisodeTimeline(episodeId) {
    return request.get(`/episodes/${episodeId}/timeline`)
  },
  getEpisodeSrt(episodeId) {
    return request.get(`/episodes/${episodeId}/timeline/srt`, { responseType: 'blob' })
  },
}
