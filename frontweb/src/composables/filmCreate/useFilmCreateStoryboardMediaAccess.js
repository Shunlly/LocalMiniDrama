import { useFilmCreateStoryboardAccessors } from './useFilmCreateStoryboardAccessors.js'
import { useFilmCreateStoryboardMedia } from './useFilmCreateStoryboardMedia.js'

/**
 * 装配分镜媒体读写和选中帧访问器。
 * 只搬家，不创建新状态，不改空剧本门闩。
 */
export function useFilmCreateStoryboardMediaAccess(ctx = {}) {
  let restoreSelectionsFromBackend
  const media = useFilmCreateStoryboardMedia({
    dramaId: ctx.dramaId,
    currentEpisodeId: ctx.currentEpisodeId,
    getStoryboards: ctx.getStoryboards,
    imagesAPI: ctx.imagesAPI,
    videosAPI: ctx.videosAPI,
    onSelectionsRestored: () => restoreSelectionsFromBackend(),
    loadDrama: (...args) => ctx.loadDrama(...args),
  })
  const accessors = useFilmCreateStoryboardAccessors({
    ...ctx,
    ...media,
    isSbUniversalMode: (...args) => ctx.isSbUniversalMode(...args),
  })
  restoreSelectionsFromBackend = accessors.restoreSelectionsFromBackend
  return {
    ...media,
    ...accessors,
  }
}
