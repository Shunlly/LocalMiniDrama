/**
 * 剧集详情项目加载、就绪依赖和页面导航。
 * 不把剧集 ID 和分集 ID 混成同一个键。
 */
import { nextTick } from 'vue'

import { backfillDramaStylePromptMetadataIfNeeded } from '@/constants/styleOptions'
import { requestCoreJson as requestCoreDrama } from '@/utils/coreJsonRequest'
import { focusSectionField, scrollAndFocusSection } from '@/utils/sectionFocus.js'

export function createDramaDetailLoadAndNav({
  dramaId,
  drama,
  episodes,
  loading,
  dramaLoadState,
  dramaLoadError,
  dramaLoadNotFound,
  dramaLoadFailureRef,
  isDramaReady,
  readinessDependencyState,
  readinessDependencyError,
  hasReadinessSnapshot,
  aiConfigs,
  sourceCount,
  projectLifecycle,
  aiAPI,
  sourceIntakeAPI,
  ElMessage,
  router,
  route,
  projectListReturnTo,
  currentEpisodeId,
  syncInfoFormFromDrama,
  clearInfoSaveTimer,
  infoSaveScheduled,
  infoSaveError,
  infoSaveState,
  loadCharList,
} = {}) {
  let dramaLoadRequestId = 0

  const coreDramaAPI = projectLifecycle.guardApi({
    get(id) {
      return requestCoreDrama(`/dramas/${encodeURIComponent(id)}`)
    },
    saveOutline(id, data) {
      return requestCoreDrama(`/dramas/${encodeURIComponent(id)}/outline`, { method: 'PUT', body: data })
    },
  })

  function friendlyDramaLoadError(error) {
    const status = Number(error?.status || error?.response?.status)
    if (status === 404) return '该项目不存在，或已移入回收站。'
    if (status >= 500) return '本地服务暂时不可用，请稍后重试。'
    return '无法连接本地服务，请确认服务已经启动后重试。'
  }

  async function loadDrama({ blocking = !isDramaReady.value } = {}) {
    const requestId = ++dramaLoadRequestId
    loading.value = true
    if (blocking) dramaLoadState.value = 'loading'
    dramaLoadError.value = ''
    dramaLoadNotFound.value = false
    try {
      let d = await coreDramaAPI.get(dramaId)
      d = await backfillDramaStylePromptMetadataIfNeeded(coreDramaAPI, dramaId, d)
      if (requestId !== dramaLoadRequestId) return false
      drama.value = d
      episodes.value = d.episodes || []
      syncInfoFormFromDrama(d)
      dramaLoadState.value = 'ready'
      dramaLoadNotFound.value = false
      return true
    } catch (e) {
      if (requestId !== dramaLoadRequestId) return false
      clearInfoSaveTimer()
      infoSaveScheduled.value = false
      infoSaveError.value = ''
      infoSaveState.value = 'saved'
      drama.value = null
      episodes.value = []
      dramaLoadNotFound.value = Number(e?.status || e?.response?.status) === 404
      dramaLoadError.value = friendlyDramaLoadError(e)
      dramaLoadState.value = 'error'
      await nextTick()
      dramaLoadFailureRef.value?.focus()
      return false
    } finally {
      if (requestId === dramaLoadRequestId) loading.value = false
    }
  }

  async function retryDramaLoad() {
    const loaded = await loadDrama({ blocking: true })
    if (!loaded) return
    await Promise.allSettled([loadReadinessDependencies(), loadCharList()])
  }

  function buildReadinessDependencyError(configsResult, sourcesResult) {
    const failed = []
    if (configsResult.status === 'rejected') failed.push('AI 配置')
    if (sourcesResult.status === 'rejected') failed.push('故事素材状态')
    if (!failed.length) return '项目就绪依赖加载失败，请稍后重试。'
    return `${failed.join('和')}加载失败，暂时无法判断项目就绪状态。`
  }

  async function loadReadinessDependencies() {
    readinessDependencyState.value = hasReadinessSnapshot.value ? 'refreshing' : 'loading'
    readinessDependencyError.value = ''
    const [configsResult, sourcesResult] = await Promise.allSettled([
      aiAPI.list(),
      sourceIntakeAPI.listForDrama(dramaId),
    ])
    if (configsResult.status === 'fulfilled' && sourcesResult.status === 'fulfilled') {
      aiConfigs.value = configsResult.value || []
      sourceCount.value = Array.isArray(sourcesResult.value) ? sourcesResult.value.length : 0
      readinessDependencyState.value = 'ready'
      readinessDependencyError.value = ''
      hasReadinessSnapshot.value = true
      return true
    }
    readinessDependencyState.value = 'error'
    readinessDependencyError.value = buildReadinessDependencyError(configsResult, sourcesResult)
    return false
  }

  async function handleSourceWorkflowRefresh() {
    const loaded = await loadDrama()
    if (loaded) await loadReadinessDependencies()
  }

  async function retryReadinessDependencies() {
    await loadReadinessDependencies()
  }

  function scrollToSection(id, { focus = true } = {}) {
    scrollAndFocusSection(id, { focus, focusDelay: id === 'source-intake-workflow' ? 250 : 0 })
  }

  function scrollToSourceIntake() {
    scrollToSection('source-intake-workflow')
    focusSectionField('source-intake-workflow', '[aria-label="网页 URL"]', { delay: 250 })
  }

  function handleReadinessAction(action) {
    if (!action) return
    if (action.target === 'readiness-dependencies') {
      retryReadinessDependencies()
      return
    }
    if (action.target === 'ai-config') {
      router.push({
        path: '/ai-config',
        query: { service_type: action.serviceType || '', returnTo: route.fullPath },
      })
      return
    }
    if (action.target === 'source-workflow') {
      scrollToSourceIntake()
      return
    }
    if (action.target === 'episode-list') {
      scrollToSection('episode-list')
      return
    }
    if (action.target === 'project-resources') {
      scrollToSection('project-resources')
      return
    }
    const query = {}
    if (action.episodeId) query.episode = action.episodeId
    if (action.id) query.focus = action.id
    router.push({ path: `/film/${dramaId}`, query: withProjectListReturnTo(query) })
  }

  function goList() {
    router.push(projectListReturnTo.value || { name: 'list' })
  }

  function withProjectListReturnTo(query = {}) {
    const nextQuery = { ...query }
    if (projectListReturnTo.value) nextQuery.returnTo = projectListReturnTo.value
    return nextQuery
  }

  function goCreate() {
    if (!currentEpisodeId.value) {
      ElMessage.warning('请先新增一集，再进入制作')
      scrollToSection('episode-list')
      return
    }
    const query = { episode: String(currentEpisodeId.value) }
    router.push({ path: `/film/${dramaId}`, query: withProjectListReturnTo(query) })
  }

  function goCanvasMode() {
    if (!currentEpisodeId.value) {
      ElMessage.warning('请先新增一集，再进入画布')
      scrollToSection('episode-list')
      return
    }
    const query = { episode: String(currentEpisodeId.value) }
    router.push({ path: `/film/${dramaId}/canvas`, query: withProjectListReturnTo(query) })
  }

  function goEpisode(epId) {
    router.push({ path: `/film/${dramaId}`, query: withProjectListReturnTo({ episode: epId }) })
  }

  return {
    loadDrama,
    retryDramaLoad,
    loadReadinessDependencies,
    retryReadinessDependencies,
    handleSourceWorkflowRefresh,
    handleReadinessAction,
    scrollToSection,
    scrollToSourceIntake,
    goList,
    withProjectListReturnTo,
    goCreate,
    goCanvasMode,
    goEpisode,
  }
}
