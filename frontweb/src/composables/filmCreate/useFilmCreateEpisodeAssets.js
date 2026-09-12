import { useCharacters } from './useCharacters.js'
import { useProps as usePropsComposable } from './useProps.js'
import { useScenes } from './useScenes.js'

/**
 * 装配角色/道具/场景 composable。
 * 只搬家，不创建新状态，不改空剧本门闩。
 */
export function useFilmCreateEpisodeAssets(ctx = {}) {
  const shared = {
    store: ctx.store,
    dramaId: ctx.dramaId,
    currentEpisodeId: ctx.currentEpisodeId,
    getSelectedStyle: ctx.getSelectedStyle,
    loadDrama: (...args) => ctx.loadDrama(...args),
    pollTask: ctx.pollTask,
    pollUntilResourceHasImage: ctx.pollUntilResourceHasImage,
    hasAssetImage: ctx.hasAssetImage,
    ElMessage: ctx.ElMessage,
    uploadAPI: ctx.uploadAPI,
  }
  const charactersApi = useCharacters({
    ...shared,
    characterAPI: ctx.characterAPI,
    characterLibraryAPI: ctx.characterLibraryAPI,
    dramaAPI: ctx.dramaAPI,
    generationAPI: ctx.generationAPI,
  })
  const propsApi = usePropsComposable({
    ...shared,
    propAPI: ctx.propAPI,
    propLibraryAPI: ctx.propLibraryAPI,
  })
  const scenesApi = useScenes({
    ...shared,
    scriptLanguage: ctx.scriptLanguage,
    dramaAPI: ctx.dramaAPI,
    sceneAPI: ctx.sceneAPI,
    sceneLibraryAPI: ctx.sceneLibraryAPI,
  })
  return { charactersApi, propsApi, scenesApi }
}
