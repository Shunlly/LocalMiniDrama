import { ref } from 'vue'
import { imagesAPI } from '@/api/images'
import { videosAPI } from '@/api/videos'

function hasOwnMediaCache(map, storyboardId) {
  return Object.prototype.hasOwnProperty.call(map || {}, storyboardId)
}

function mediaQueryErrorMessage(error) {
  const message = String(error?.message || '').trim()
  return message || '媒体查询失败'
}

export async function fetchStoryboardMediaSnapshot(
  storyboards,
  {
    imagesBySbId = {},
    videosBySbId = {},
    mediaStatusBySbId = {},
    imagesAPIImpl = imagesAPI,
    videosAPIImpl = videosAPI,
  } = {},
) {
  const boards = Array.isArray(storyboards) ? storyboards.filter((storyboard) => storyboard?.id != null) : []
  const nextImages = { ...imagesBySbId }
  const nextVideos = { ...videosBySbId }
  const nextMediaStatus = { ...mediaStatusBySbId }
  const failedStoryboardIds = []

  await Promise.all(
    boards.map(async (storyboard) => {
      const storyboardId = storyboard.id
      try {
        const [imgRes, vidRes] = await Promise.all([
          imagesAPIImpl.list({ storyboard_id: storyboardId, page: 1, page_size: 100 }),
          videosAPIImpl.list({ storyboard_id: storyboardId, page: 1, page_size: 50 }),
        ])
        nextImages[storyboardId] = imgRes?.items || []
        nextVideos[storyboardId] = vidRes?.items || []
        nextMediaStatus[storyboardId] = {
          state: 'ready',
          error: '',
          retryable: false,
          preservedData: false,
        }
      } catch (error) {
        failedStoryboardIds.push(storyboardId)
        nextMediaStatus[storyboardId] = {
          state: 'unknown',
          error: mediaQueryErrorMessage(error),
          retryable: true,
          preservedData: (
            hasOwnMediaCache(imagesBySbId, storyboardId)
            || hasOwnMediaCache(videosBySbId, storyboardId)
          ),
        }
      }
    }),
  )

  return {
    nextImages,
    nextVideos,
    nextMediaStatus,
    failedStoryboardIds,
    failedCount: failedStoryboardIds.length,
    total: boards.length,
  }
}

export function useCanvasStoryboardMedia() {
  const imagesBySbId = ref({})
  const videosBySbId = ref({})
  const mediaStatusBySbId = ref({})
  const mediaLoading = ref(false)
  let mediaRequestId = 0

  async function loadForStoryboards(storyboards, { prune = true } = {}) {
    const boards = storyboards || []
    if (!boards.length) {
      imagesBySbId.value = {}
      videosBySbId.value = {}
      mediaStatusBySbId.value = {}
      return { failedCount: 0, failedStoryboardIds: [], total: 0 }
    }

    const requestId = ++mediaRequestId
    mediaLoading.value = true
    try {
      const snapshot = await fetchStoryboardMediaSnapshot(boards, {
        imagesBySbId: imagesBySbId.value,
        videosBySbId: videosBySbId.value,
        mediaStatusBySbId: mediaStatusBySbId.value,
      })
      if (requestId !== mediaRequestId) return { ...snapshot, stale: true }

      if (prune) {
        const scopedIds = new Set(boards.map((storyboard) => String(storyboard.id)))
        imagesBySbId.value = Object.fromEntries(
          Object.entries(snapshot.nextImages).filter(([storyboardId]) => scopedIds.has(String(storyboardId))),
        )
        videosBySbId.value = Object.fromEntries(
          Object.entries(snapshot.nextVideos).filter(([storyboardId]) => scopedIds.has(String(storyboardId))),
        )
        mediaStatusBySbId.value = Object.fromEntries(
          Object.entries(snapshot.nextMediaStatus).filter(([storyboardId]) => scopedIds.has(String(storyboardId))),
        )
      } else {
        imagesBySbId.value = snapshot.nextImages
        videosBySbId.value = snapshot.nextVideos
        mediaStatusBySbId.value = snapshot.nextMediaStatus
      }

      return snapshot
    } finally {
      if (requestId === mediaRequestId) mediaLoading.value = false
    }
  }

  async function loadForDrama(drama, episodeId = null) {
    const episodes = episodeId
      ? (drama?.episodes || []).filter((ep) => ep.id === episodeId)
      : (drama?.episodes || [])
    const boards = episodes.flatMap((ep) => ep.storyboards || [])
    return loadForStoryboards(boards, { prune: true })
  }

  return {
    imagesBySbId,
    videosBySbId,
    mediaStatusBySbId,
    mediaLoading,
    loadForStoryboards,
    loadForDrama,
  }
}
