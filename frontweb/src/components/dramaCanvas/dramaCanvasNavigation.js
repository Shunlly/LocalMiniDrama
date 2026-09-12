/**
 * 画布页跳转。只搬家，不改 returnTo、集数和焦点查询的拼法。
 */
import { buildAiConfigLocation } from '@/utils/sourceWorkflowLaunch'

export function createDramaCanvasNavigation(ctx = {}) {
  function goProjectList() {
    ctx.router.push(ctx.projectListReturnTo.value || '/')
  }

  function navigateToStoryboard(episodeId, storyboardId) {
    const query = episodeId ? { episode: String(episodeId) } : {}
    if (ctx.projectListReturnTo.value) query.returnTo = ctx.projectListReturnTo.value
    ctx.router.push({
      path: `/film/${ctx.dramaId.value}`,
      query,
      hash: storyboardId ? `#sb-${storyboardId}` : undefined,
    })
  }

  function goMediaLibrary() {
    const buildCanvasReturnTo = ctx.buildCanvasReturnTo
    ctx.router.push({ name: 'media-library', query: { returnTo: buildCanvasReturnTo() } })
  }

  function openAiConfig(serviceType, focusNodeId = '') {
    const returnTo = ctx.buildCanvasReturnTo(focusNodeId)
    ctx.router.push(buildAiConfigLocation({
      dramaId: ctx.dramaId.value,
      serviceType,
      returnTo,
    }))
  }

  return {
    goProjectList,
    navigateToStoryboard,
    goMediaLibrary,
    openAiConfig,
  }
}
