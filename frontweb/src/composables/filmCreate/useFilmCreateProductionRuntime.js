import { useFilmCreateTaskPolling } from './useFilmCreateTaskPolling.js'
import { useFilmCreatePipelineRun } from './useFilmCreatePipelineRun.js'

/**
 * 装配任务轮询和一键全流程运行时。
 * 只搬家，不创建新状态，不改空剧本门闩和离开保护。
 * 不提前读取 storyboardMediaActionReason，保留页面里的惰性 getter。
 */
export function useFilmCreateProductionRuntime(ctx = {}) {
  const polling = useFilmCreateTaskPolling(ctx)
  const pipelineRun = useFilmCreatePipelineRun({
    store: ctx.store,
    videoClipDuration: ctx.videoClipDuration,
    taskAPI: ctx.taskAPI,
    genStore: ctx.genStore,
    trackFilmCreateAction: ctx.trackFilmCreateAction,
    getStoryboardCountForApi: ctx.getStoryboardCountForApi,
    get storyboardMediaActionReason() {
      return ctx.storyboardMediaActionReason
    },
    resolvePollMeta: (meta) => polling.resolvePollMeta(meta),
  })
  return {
    ...polling,
    ...pipelineRun,
  }
}
