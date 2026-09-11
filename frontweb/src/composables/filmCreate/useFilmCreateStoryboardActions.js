import { useFilmCreateBatchGeneration } from './useFilmCreateBatchGeneration.js'
import { useFilmCreateLinkedStoryboardRegen } from './useFilmCreateLinkedStoryboardRegen.js'
import { useFilmCreateStoryboardBindings } from './useFilmCreateStoryboardBindings.js'
import { useFilmCreateStoryboardCrud } from './useFilmCreateStoryboardCrud.js'
import { useFilmCreateStoryboardExport } from './useFilmCreateStoryboardExport.js'
import { useFilmCreateStoryboardPrompts } from './useFilmCreateStoryboardPrompts.js'
import { useFilmCreateStoryboardReferences } from './useFilmCreateStoryboardReferences.js'
import { useFilmCreateStoryboardTts } from './useFilmCreateStoryboardTts.js'
import { useFilmCreateStoryboardVideoGeneration } from './useFilmCreateStoryboardVideoGeneration.js'
import { useFilmCreateTailFrameLink } from './useFilmCreateTailFrameLink.js'
import { useFilmCreateUniversalSegment } from './useFilmCreateUniversalSegment.js'

/**
 * 装配分镜绑定、配音、导出、参考图、提示词、成片和批量动作。
 * 只搬家，不创建新状态，不改空剧本门闩。
 */
export function useFilmCreateStoryboardActions(ctx = {}) {
  const bindings = useFilmCreateStoryboardBindings(ctx)
  const linkedRegen = useFilmCreateLinkedStoryboardRegen({
    ...ctx,
    ...bindings,
  })
  const tts = useFilmCreateStoryboardTts(ctx)
  const exported = useFilmCreateStoryboardExport({
    ...ctx,
    ...bindings,
  })
  const universal = useFilmCreateUniversalSegment(ctx)
  const references = useFilmCreateStoryboardReferences(ctx)
  let refreshStoryboardsOnly
  const prompts = useFilmCreateStoryboardPrompts({
    ...ctx,
    refreshStoryboardsOnly: (...args) => refreshStoryboardsOnly(...args),
  })
  const videoGeneration = useFilmCreateStoryboardVideoGeneration({
    ...ctx,
    ...references,
  })
  const tailFrame = useFilmCreateTailFrameLink({
    ...ctx,
    refreshStoryboardsOnly: (...args) => refreshStoryboardsOnly(...args),
  })
  const crud = useFilmCreateStoryboardCrud({
    ...ctx,
    polishUniversalSegmentsAfterGeneration: universal.polishUniversalSegmentsAfterGeneration,
  })
  refreshStoryboardsOnly = crud.refreshStoryboardsOnly
  const batch = useFilmCreateBatchGeneration({
    ...ctx,
    ...references,
  })
  return {
    ...bindings,
    ...linkedRegen,
    ...tts,
    ...exported,
    ...universal,
    ...references,
    ...prompts,
    ...videoGeneration,
    ...tailFrame,
    ...crud,
    ...batch,
  }
}
