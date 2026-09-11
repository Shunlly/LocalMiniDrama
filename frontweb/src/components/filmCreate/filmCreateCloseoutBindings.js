import { createFilmCreateWorkspaceBindingSources } from './filmCreateWorkspaceBindings.js'
import { useFilmCreateWorkspaceBootstrap } from '../../composables/filmCreate/useFilmCreateWorkspaceBootstrap.js'

/**
 * 把制作页工作台绑定源闭合装配成可 v-bind 的属性袋，并提供挂载卸载挂钩。
 * 只搬家，不创建新状态，不改空剧本门闩和离开保护。
 */
export function createFilmCreateCloseoutBindings(ctx = {}) {
  return useFilmCreateWorkspaceBootstrap({
    ...createFilmCreateWorkspaceBindingSources(ctx),
    route: ctx.route,
    handleBeforeUnload: ctx.handleBeforeUnload,
    applyRouteToStore: ctx.applyRouteToStore,
    loadPipelineConcurrency: ctx.loadPipelineConcurrency,
    refreshVideoGenerationCapability: ctx.refreshVideoGenerationCapability,
    refreshProductionReadiness: ctx.refreshProductionReadiness,
    invalidateProjectLoads: ctx.invalidateProjectLoads,
    projectLifecycle: ctx.projectLifecycle,
    scriptDraftController: ctx.scriptDraftController,
  })
}
