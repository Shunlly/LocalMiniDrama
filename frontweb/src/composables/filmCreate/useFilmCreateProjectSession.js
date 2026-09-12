import { createEpisodeSwitchController } from '@/utils/scriptDraft'
import { useFilmCreateProjectLoad } from './useFilmCreateProjectLoad.js'

/**
 * 装配剧集切换控制器和项目加载。
 * 只搬家，不创建新状态，不改空剧本门闩和离开保护。
 */
export function useFilmCreateProjectSession(ctx = {}) {
  let applySelectedEpisode
  let refreshProjectDependencies
  const episodeSwitchController = createEpisodeSwitchController({
    flushDraft: ctx.flushDraft,
    resolveEpisode: ctx.resolveEpisode,
    commitEpisode: (episode) => applySelectedEpisode(episode),
    refreshEpisode: (...args) => refreshProjectDependencies(...args),
    onBusyChange: ctx.onBusyChange,
  })
  const projectLoad = useFilmCreateProjectLoad({
    ...ctx,
    episodeSwitchController,
    syncEpisodeRouteQuery: (episodeId) => ctx.syncEpisodeRouteQuery(episodeId),
    refreshVideoGenerationCapability: (...args) => ctx.refreshVideoGenerationCapability(...args),
    refreshProductionReadiness: (...args) => ctx.refreshProductionReadiness(...args),
  })
  applySelectedEpisode = projectLoad.applySelectedEpisode
  refreshProjectDependencies = projectLoad.refreshProjectDependencies
  return {
    episodeSwitchController,
    ...projectLoad,
  }
}
