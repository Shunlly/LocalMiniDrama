export function useFilmCreateResourceGenerate(deps = {}) {
  const {
    store,
    trackFilmCreateAction,
    onGenerateCharactersRaw,
    onExtractPropsRaw,
    onExtractScenesRaw,
  } = deps
  async function onGenerateCharacters() {
    trackFilmCreateAction('generate_characters_click')
    const beforeCount = (store.currentEpisode?.characters || []).length
    try {
      await onGenerateCharactersRaw()
      const afterCount = (store.currentEpisode?.characters || []).length
      trackFilmCreateAction('generate_characters_complete', {
        extra: { before_count: beforeCount, after_count: afterCount },
      })
    } catch (e) {
      trackFilmCreateAction('generate_characters_failed', {
        extra: { message: String(e?.message || 'failed').slice(0, 120) },
      })
      throw e
    }
  }

  async function onExtractProps() {
    trackFilmCreateAction('extract_props_click')
    const beforeCount = (store.props || []).length
    try {
      await onExtractPropsRaw()
      const afterCount = (store.props || []).length
      trackFilmCreateAction('extract_props_complete', {
        extra: { before_count: beforeCount, after_count: afterCount },
      })
    } catch (e) {
      trackFilmCreateAction('extract_props_failed', {
        extra: { message: String(e?.message || 'failed').slice(0, 120) },
      })
      throw e
    }
  }

  async function onExtractScenes() {
    trackFilmCreateAction('extract_scenes_click')
    const beforeCount = (store.currentEpisode?.scenes || []).length
    try {
      await onExtractScenesRaw()
      const afterCount = (store.currentEpisode?.scenes || []).length
      trackFilmCreateAction('extract_scenes_complete', {
        extra: { before_count: beforeCount, after_count: afterCount },
      })
    } catch (e) {
      trackFilmCreateAction('extract_scenes_failed', {
        extra: { message: String(e?.message || 'failed').slice(0, 120) },
      })
      throw e
    }
  }
  return {
    onGenerateCharacters,
    onExtractProps,
    onExtractScenes,
  }
}
