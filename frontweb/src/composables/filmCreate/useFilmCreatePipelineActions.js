import { useFilmCreateEpisodeCompose } from './useFilmCreateEpisodeCompose.js'
import { useFilmCreatePipelineStages } from './useFilmCreatePipelineStages.js'

/**
 * 装配整集成片和一键/文本框架流水线入口。
 * 只搬家，不创建新状态；空剧本门闩仍由页面禁用原因提供。
 */
export function useFilmCreatePipelineActions(ctx = {}) {
  const compose = useFilmCreateEpisodeCompose({
    ...ctx,
    pollTask: (...args) => ctx.pollTask(...args),
  })
  const stages = useFilmCreatePipelineStages({
    ...ctx,
    getFinalizeMergeOptions: compose.getFinalizeMergeOptions,
  })
  return {
    ...compose,
    ...stages,
  }
}
