import { computed, unref } from 'vue'
import { isEpisodeExtractRunning } from '@/composables/useGenerationTaskSync'
import { GEN_RESOURCE } from '@/stores/generationTaskStore'
import { normalizeProjectListReturnTo } from '@/utils/projectListRoute'

/** 制作页路由回跳展示值，不改查询语义。 */
export function useFilmCreateRouteDisplay({ route } = {}) {
  const projectListReturnTo = computed(() => normalizeProjectListReturnTo(route?.query?.returnTo))
  return { projectListReturnTo }
}

/** 制作页根节点 class，只映射已有折叠/加载态。 */
export function useFilmCreateRootClass({ navCollapsed, projectLoadState } = {}) {
  const filmCreateRootClass = computed(() => ({
    'sidebar-collapsed': Boolean(unref(navCollapsed)),
    'project-state-active': unref(projectLoadState) !== 'ready',
  }))
  return { filmCreateRootClass }
}

/**
 * 把 store 已有字段收成制作页展示绑定。
 * 不创建新状态；dramaId 与 currentEpisodeId 保持各自来源，互不顶替。
 */
export function useFilmCreateStoreDisplay({ store, storeVideoResolution } = {}) {
  const scriptContent = computed({
    get: () => store.scriptContent,
    set: (value) => store.setScriptContent(value),
  })
  const videoResolution = storeVideoResolution
  const dramaId = computed(() => store.dramaId)
  const characters = computed(() => store.characters)
  const scenes = computed(() => store.scenes)
  const props = computed(() => store.props)
  const storyboards = computed(() => store.storyboards)
  const currentEpisode = computed(() => store.currentEpisode)
  const currentEpisodeId = computed(() => store.currentEpisode?.id ?? null)
  const hasAnyEpisode = computed(() => (store.drama?.episodes || []).length > 0)
  const videoProgress = computed(() => store.videoProgress)
  const videoStatus = computed(() => store.videoStatus)
  return {
    scriptContent,
    videoResolution,
    dramaId,
    characters,
    scenes,
    props,
    storyboards,
    currentEpisode,
    currentEpisodeId,
    hasAnyEpisode,
    videoProgress,
    videoStatus,
  }
}

/** 完整成片缺失服务类型，只读缺口上的 service_type。 */
export function useFilmCreateReadinessDisplay({ productionCapabilityGaps } = {}) {
  const productionReadinessServiceType = computed(() => (
    unref(productionCapabilityGaps)?.find((gap) => gap.service_type)?.service_type || ''
  ))
  return { productionReadinessServiceType }
}

/** 分镜提取是否进行中，只做展示/门闩输入，不改任务 store。 */
export function useFilmCreateGeneratingDisplay({ genStore, dramaId, currentEpisodeId } = {}) {
  const storyboardGenerating = computed(() => (
    isEpisodeExtractRunning(genStore, unref(dramaId), unref(currentEpisodeId), GEN_RESOURCE.GENERATE_STORYBOARD)
  ))
  return { storyboardGenerating }
}
