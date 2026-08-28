import { computed, ref } from 'vue'
import { createStoryboardMediaStateController } from '@/utils/storyboardMedia'

export function describeStoryboardMediaLoadError(failedCount = 1) {
  const count = Math.max(1, Number(failedCount) || 1)
  return `${count} 个分镜的图片或视频读取失败，已保留上次成功读取的内容。重试成功前，为避免重复生成和计费，批量与完整成片已暂停。`
}

export function useFilmCreateStoryboardMedia({
  dramaId,
  currentEpisodeId,
  getStoryboards,
  imagesAPI,
  videosAPI,
  onSelectionsRestored,
  loadDrama,
} = {}) {
  const sbImages = ref({})
  const sbVideos = ref({})
  const storyboardMediaLoadState = ref('unknown')
  const storyboardMediaLoadError = ref('')

  function currentStoryboardMediaContext(projectId = dramaId.value, episodeId = currentEpisodeId.value) {
    return { projectId, episodeId }
  }

  function applyStoryboardMediaSnapshot(snapshot) {
    sbImages.value = snapshot.media.images
    sbVideos.value = snapshot.media.videos
    storyboardMediaLoadState.value = snapshot.status
    const failedStoryboardCount = new Set(
      snapshot.failedEndpoints.map(({ storyboardId }) => storyboardId),
    ).size
    storyboardMediaLoadError.value = failedStoryboardCount > 0
      ? describeStoryboardMediaLoadError(failedStoryboardCount)
      : ''
  }

  const storyboardMediaStateController = createStoryboardMediaStateController({
    onChange: applyStoryboardMediaSnapshot,
  })

  function resetStoryboardMediaContext(
    projectId = dramaId.value,
    episodeId = currentEpisodeId.value,
  ) {
    storyboardMediaStateController.setContext(currentStoryboardMediaContext(projectId, episodeId))
  }

  function ensureStoryboardMediaContext(
    projectId = dramaId.value,
    episodeId = currentEpisodeId.value,
  ) {
    const context = currentStoryboardMediaContext(projectId, episodeId)
    if (!storyboardMediaStateController.isCurrentContext(context)) {
      storyboardMediaStateController.setContext(context)
    }
  }

  function assertStoryboardMediaReady() {
    return storyboardMediaStateController.assertReady(currentStoryboardMediaContext())
  }

  function currentEpisodeStoryboardIds() {
    const episodeId = currentEpisodeId.value
    return (getStoryboards() || [])
      .filter((storyboard) => (
        storyboard?.episode_id == null || Number(storyboard.episode_id) === Number(episodeId)
      ))
      .map((storyboard) => storyboard.id)
  }

  async function loadStoryboardMedia({ failClosed = false } = {}) {
    const boards = getStoryboards() || []
    const context = currentStoryboardMediaContext()
    const requests = storyboardMediaStateController.beginFull(boards.map((sb) => sb.id))
    const outcomes = await Promise.all(requests.map(async (request) => {
      try {
        const response = request.endpoint === 'images'
          ? await imagesAPI.list({ storyboard_id: request.storyboardId, page: 1, page_size: 100 })
          : await videosAPI.list({ storyboard_id: request.storyboardId, page: 1, page_size: 50 })
        return {
          request,
          failed: false,
          committed: storyboardMediaStateController.commitSuccess(request, response?.items || []),
        }
      } catch (error) {
        return {
          request,
          failed: true,
          committed: storyboardMediaStateController.commitFailure(request, error),
        }
      }
    }))
    const committedOutcomes = outcomes.filter(({ committed }) => committed)
    const failedStoryboardIds = new Set(
      committedOutcomes.filter(({ failed }) => failed).map(({ request }) => request.storyboardId),
    )
    let failedCount = 0
    for (const _storyboardId of failedStoryboardIds) failedCount += 1
    const stale = committedOutcomes.length !== outcomes.length
    if (committedOutcomes.length > 0 && storyboardMediaStateController.isCurrentContext(context)) {
      onSelectionsRestored?.()
    }
    if (failClosed) assertStoryboardMediaReady()
    return { failedCount, total: boards.length, stale }
  }

  async function loadSingleStoryboardMedia(sbId, expectedContext) {
    if (!sbId || !expectedContext) return { stale: true }
    if (!storyboardMediaStateController.isCurrentContext(expectedContext)) return { stale: true }
    const storyboardIds = currentEpisodeStoryboardIds()
    if (!storyboardIds.some((storyboardId) => Number(storyboardId) === Number(sbId))) {
      return { stale: true }
    }
    const requests = storyboardMediaStateController.beginSingle(sbId, {
      expectedContext,
      storyboardIds,
    })
    if (requests.length === 0) return { stale: true }
    const outcomes = await Promise.all(requests.map(async (request) => {
      try {
        const response = request.endpoint === 'images'
          ? await imagesAPI.list({ storyboard_id: request.storyboardId, page: 1, page_size: 100 })
          : await videosAPI.list({ storyboard_id: request.storyboardId, page: 1, page_size: 50 })
        return {
          failed: false,
          committed: storyboardMediaStateController.commitSuccess(request, response?.items || []),
        }
      } catch (error) {
        return {
          failed: true,
          committed: storyboardMediaStateController.commitFailure(request, error),
        }
      }
    }))
    const committedOutcomes = outcomes.filter(({ committed }) => committed)
    if (committedOutcomes.length > 0 && storyboardMediaStateController.isCurrentContext(expectedContext)) {
      onSelectionsRestored?.()
    }
    return {
      failedCount: committedOutcomes.filter(({ failed }) => failed).length,
      stale: committedOutcomes.length !== outcomes.length,
    }
  }

  function captureStoryboardMediaRefresh(storyboardId, expectedContext = currentStoryboardMediaContext()) {
    const capturedContext = { ...expectedContext }
    return () => loadSingleStoryboardMedia(storyboardId, capturedContext)
  }

  function refreshStoryboardMediaForCurrentContext(storyboardId) {
    return loadSingleStoryboardMedia(storyboardId, currentStoryboardMediaContext())
  }

  const storyboardMediaActionReason = computed(() => {
    storyboardMediaLoadState.value
    return storyboardMediaStateController.actionReason(currentStoryboardMediaContext())
  })


  function captureDramaRefresh(expectedContext = currentStoryboardMediaContext()) {
    const capturedContext = { ...expectedContext }
    return () => loadDrama({ expectedContext: capturedContext })
  }

  return {
    sbImages,
    sbVideos,
    storyboardMediaLoadState,
    storyboardMediaLoadError,
    storyboardMediaStateController,
    storyboardMediaActionReason,
    currentStoryboardMediaContext,
    resetStoryboardMediaContext,
    ensureStoryboardMediaContext,
    assertStoryboardMediaReady,
    currentEpisodeStoryboardIds,
    captureStoryboardMediaRefresh,
    refreshStoryboardMediaForCurrentContext,
    loadStoryboardMedia,
    loadSingleStoryboardMedia,
    captureDramaRefresh,
  }
}
