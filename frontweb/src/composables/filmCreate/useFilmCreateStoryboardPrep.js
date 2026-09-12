import { useFilmCreateFirstLastFrameSetting } from './useFilmCreateFirstLastFrameSetting.js'
import { useFilmCreateScriptEstimates } from './useFilmCreateScriptEstimates.js'
import { useFilmCreateStoryboardImageGeneration } from './useFilmCreateStoryboardImageGeneration.js'
import { useFilmCreateStoryboardStateSync } from './useFilmCreateStoryboardStateSync.js'
import { useFilmCreateStoryboardUpload } from './useFilmCreateStoryboardUpload.js'
import { useFilmCreateStoryboardVideoFields } from './useFilmCreateStoryboardVideoFields.js'

/**
 * 装配分镜字段衍生能力、估算、首尾帧开关、出图和状态同步。
 * 只搬家，不创建新状态，不改空剧本门闩。
 */
export function useFilmCreateStoryboardPrep(ctx = {}) {
  const videoFields = useFilmCreateStoryboardVideoFields(ctx)
  const estimates = useFilmCreateScriptEstimates(ctx)
  const firstLastFrame = useFilmCreateFirstLastFrameSetting({
    ...ctx,
    saveProjectSettings: (...args) => ctx.saveProjectSettings(...args),
  })
  const imageGeneration = useFilmCreateStoryboardImageGeneration({
    ...ctx,
    loadDrama: (...args) => ctx.loadDrama(...args),
    angleToPromptFragment: (...args) => ctx.angleToPromptFragment(...args),
  })
  const upload = useFilmCreateStoryboardUpload(ctx)
  const stateSync = useFilmCreateStoryboardStateSync(ctx)
  return {
    ...videoFields,
    ...estimates,
    ...firstLastFrame,
    ...imageGeneration,
    ...upload,
    ...stateSync,
  }
}
