import {
  createResourceDialogsBindings,
  createResourcePanelBindings,
  createScriptWorkbenchBindings,
  createStoryboardDialogsBindings,
  createStoryboardPanelBindings,
} from '../../components/filmCreate/filmCreateProductionBindings.js'
import {
  FILM_CREATE_RESOURCE_DIALOG_MODEL_KEYS,
  FILM_CREATE_STORYBOARD_DIALOG_MODEL_KEYS,
} from '../../utils/filmCreateTemplateBindings.js'

/**
 * 装配制作页后半段的工作台属性袋，并提供挂载和卸载挂钩。
 * 不创建新状态，不抽 AI 配置 loadList / 连接测试。
 */
export function useFilmCreateWorkspaceBootstrap(deps = {}) {
  const {
    resourceDialogModelKeys = FILM_CREATE_RESOURCE_DIALOG_MODEL_KEYS,
    storyboardDialogModelKeys = FILM_CREATE_STORYBOARD_DIALOG_MODEL_KEYS,
    scriptWorkbench,
    resourcePanel,
    storyboardPanel,
    resourceDialogs,
    storyboardDialogs,
    route,
    handleBeforeUnload,
    applyRouteToStore,
    loadPipelineConcurrency,
    refreshVideoGenerationCapability,
    refreshProductionReadiness,
    invalidateProjectLoads,
    projectLifecycle,
    scriptDraftController,
  } = deps

  const scriptWorkbenchBindings = createScriptWorkbenchBindings(scriptWorkbench)
  const resourcePanelBindings = createResourcePanelBindings(resourcePanel)
  const storyboardPanelBindings = createStoryboardPanelBindings(storyboardPanel)
  const resourceDialogsBindings = createResourceDialogsBindings(resourceDialogs, resourceDialogModelKeys)
  const storyboardDialogsBindings = createStoryboardDialogsBindings(storyboardDialogs, storyboardDialogModelKeys)

  async function mountWorkspace() {
    window.addEventListener('beforeunload', handleBeforeUnload)
    applyRouteToStore()
    if (!route.params.id || route.params.id === 'new') {
      Promise.allSettled([
        loadPipelineConcurrency(),
        refreshVideoGenerationCapability(),
        refreshProductionReadiness(),
      ])
    }
  }

  function unmountWorkspace() {
    invalidateProjectLoads?.()
    projectLifecycle?.dispose?.()
    window.removeEventListener('beforeunload', handleBeforeUnload)
    scriptDraftController?.dispose?.()
  }

  return {
    scriptWorkbenchBindings,
    resourcePanelBindings,
    storyboardPanelBindings,
    resourceDialogsBindings,
    storyboardDialogsBindings,
    mountWorkspace,
    unmountWorkspace,
  }
}
