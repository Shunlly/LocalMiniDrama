/**
 * 画布路由焦点：解析查询、认领焦点、同步实体和项目重置。只搬家，不改焦点所有权和集数过滤。
 */
function ctxFn(ctx, key) {
  return (...args) => ctx[key](...args)
}

function ctxRef(ctx, key) {
  return {
    get value() { return ctx[key].value },
    set value(next) { ctx[key].value = next },
  }
}

export function createDramaCanvasRouteFocus(ctx = {}) {
  const route = ctx.route
  const router = ctx.router
  const canvasProjectId = ctxRef(ctx, 'canvasProjectId')
  const canvasInstanceActive = ctxRef(ctx, 'canvasInstanceActive')
  const drama = ctxRef(ctx, 'drama')
  const selectedFreeNodeId = ctxRef(ctx, 'selectedFreeNodeId')
  const selectedFreeNodeIds = ctxRef(ctx, 'selectedFreeNodeIds')
  const selectedFreeEdgeIds = ctxRef(ctx, 'selectedFreeEdgeIds')
  const freeCanvas = ctxRef(ctx, 'freeCanvas')
  const canvasMode = ctxRef(ctx, 'canvasMode')
  const nodes = ctxRef(ctx, 'nodes')
  const filterEpisodeId = ctxRef(ctx, 'filterEpisodeId')
  const focusedNodeId = ctxRef(ctx, 'focusedNodeId')
  const highlightAssetId = ctxRef(ctx, 'highlightAssetId')
  const layoutCache = ctxRef(ctx, 'layoutCache')
  const productionGraph = ctxRef(ctx, 'productionGraph')
  const projectAssets = ctxRef(ctx, 'projectAssets')
  const freeMediaPickerVisible = ctxRef(ctx, 'freeMediaPickerVisible')
  const activeGroupId = ctxRef(ctx, 'activeGroupId')
  const workflowOutcomeUnknown = ctxRef(ctx, 'workflowOutcomeUnknown')
  const selectedStoryboardIds = ctxRef(ctx, 'selectedStoryboardIds')
  const editingFreeNodeId = ctxRef(ctx, 'editingFreeNodeId')
  const initialFitDone = ctxRef(ctx, 'initialFitDone')
  const canvasInteractive = ctxRef(ctx, 'canvasInteractive')
  const mediaValidity = ctx.mediaValidity
  const productionReadinessState = ctxRef(ctx, 'productionReadinessState')
  const freeCanvasVideoCapability = ctxRef(ctx, 'freeCanvasVideoCapability')
  const layoutDirty = ctxRef(ctx, 'layoutDirty')
  const failedCanvasSaveOperation = ctxRef(ctx, 'failedCanvasSaveOperation')
  const layoutSaveError = ctxRef(ctx, 'layoutSaveError')
  const layoutSaveState = ctxRef(ctx, 'layoutSaveState')
  const nextTick = ctxFn(ctx, 'nextTick')
  const document = ctx.document ?? globalThis.document
  const setTimeout = ctx.setTimeout ?? globalThis.setTimeout
  const Date = ctx.Date ?? globalThis.Date
  const Number = ctx.Number ?? globalThis.Number
  const String = ctx.String ?? globalThis.String
  const FREE_INSPECTOR_FOCUS_TIMEOUT_MS = ctx.FREE_INSPECTOR_FOCUS_TIMEOUT_MS ?? 800
  const FREE_INSPECTOR_FOCUS_POLL_MS = ctx.FREE_INSPECTOR_FOCUS_POLL_MS ?? 10
  const getVideoGenerationCapability = ctxFn(ctx, 'getVideoGenerationCapability')
  const setFocusedCanvasNode = ctxFn(ctx, 'setFocusedCanvasNode')
  const setCanvasMode = ctxFn(ctx, 'setCanvasMode')
  const activateFreeCanvasNode = ctxFn(ctx, 'activateFreeCanvasNode')
  const loadCanvasProject = ctxFn(ctx, 'loadCanvasProject')
  const loadForDrama = ctxFn(ctx, 'loadForDrama')
  const rebuildGraph = ctxFn(ctx, 'rebuildGraph')
  const cancelScheduledCanvasSave = ctxFn(ctx, 'cancelScheduledCanvasSave')
  const refreshProductionReadiness = ctxFn(ctx, 'refreshProductionReadiness')
  const refreshFreeCanvasVideoCapability = ctxFn(ctx, 'refreshFreeCanvasVideoCapability')
  const focusFreeCanvasNodeTrigger = ctxFn(ctx, 'focusFreeCanvasNodeTrigger')
  let canvasEntityFocusRevision = 0
  let canvasRouteSynchronization = Promise.resolve(true)

  function routeFocusNodeId(routeLike = route) {
    const raw = Array.isArray(routeLike?.query?.focus) ? routeLike.query.focus[0] : routeLike?.query?.focus
    const value = String(raw || '').trim()
    return /^[A-Za-z0-9:_-]{1,128}$/.test(value) ? value : ''
  }

  function routeEpisodeId(routeLike = route) {
    const raw = Array.isArray(routeLike?.query?.episode) ? routeLike.query.episode[0] : routeLike?.query?.episode
    if (raw == null || raw === '') return null
    const rawValue = String(raw).trim()
    if (!/^[1-9]\d*$/.test(rawValue)) return null
    const value = Number(rawValue)
    return Number.isSafeInteger(value) && value > 0 ? value : null
  }

  function canvasRouteContext(routeLike = route) {
    return {
      projectId: String(routeLike?.params?.id || ''),
      focusNodeId: routeFocusNodeId(routeLike),
      episodeId: routeEpisodeId(routeLike),
    }
  }

  function claimCanvasEntityFocus(nodeId, { routeOwned = false } = {}) {
    return {
      revision: ++canvasEntityFocusRevision,
      projectId: Number(canvasProjectId.value),
      nodeId: String(nodeId || ''),
      episodeId: routeEpisodeId(),
      routeOwned,
    }
  }

  function claimRouteEntityFocus() {
    return claimCanvasEntityFocus(routeFocusNodeId(), { routeOwned: true })
  }

  function ownsCanvasEntityFocus(ownership, { requireSelection = false } = {}) {
    if (
      !ownership
      || ownership.revision !== canvasEntityFocusRevision
      || !canvasInstanceActive.value
      || ownership.projectId !== Number(canvasProjectId.value)
      || ownership.projectId !== Number(drama.value?.id)
    ) return false
    if (ownership.routeOwned && ownership.nodeId !== routeFocusNodeId()) return false
    if (ownership.routeOwned && ownership.episodeId !== routeEpisodeId()) return false
    return !requireSelection || String(selectedFreeNodeId.value || '') === ownership.nodeId
  }

  async function waitForFreeCanvasInspectorFocus(ownership, timeoutMs = FREE_INSPECTOR_FOCUS_TIMEOUT_MS) {
    const deadline = Date.now() + Math.max(0, timeoutMs)
    while (ownsCanvasEntityFocus(ownership, { requireSelection: true })) {
      await nextTick()
      if (!ownsCanvasEntityFocus(ownership, { requireSelection: true })) return false
      const inspector = document.querySelector('.free-canvas-inspector-dock')
      const inspectorNodeId = String(inspector?.dataset?.freeNodeId || '')
      const focusTarget = inspectorNodeId === ownership.nodeId
        ? inspector.querySelector('input:not([disabled]), textarea:not([disabled]), button:not([disabled])')
        : null
      if (focusTarget) {
        focusTarget.focus({ preventScroll: true })
        if (document.activeElement === focusTarget) return true
      }
      const remaining = deadline - Date.now()
      if (remaining <= 0) return false
      await new Promise((resolve) => setTimeout(resolve, Math.min(FREE_INSPECTOR_FOCUS_POLL_MS, remaining)))
    }
    return false
  }

  async function synchronizeRouteFocusedEntity(ownership = claimRouteEntityFocus()) {
    if (!ownsCanvasEntityFocus(ownership)) return false
    const targetId = ownership.nodeId
    const freeTarget = freeCanvas.value.nodes.find((node) => String(node.id) === targetId)
    if (freeTarget) {
      await setFocusedCanvasNode(null, { force: true, restoreFocus: false })
      if (!ownsCanvasEntityFocus(ownership)) return false
      if (canvasMode.value !== 'free') await setCanvasMode('free')
      if (!ownsCanvasEntityFocus(ownership) || canvasMode.value !== 'free') return false
      activateFreeCanvasNode(freeTarget.id, { focusInspector: false, ownership })
      return waitForFreeCanvasInspectorFocus(ownership)
    }

    closeFreeCanvasInspector({ restoreFocus: false, invalidateFocus: false })
    selectedFreeNodeIds.value = []
    selectedFreeEdgeIds.value = []
    if (!ownsCanvasEntityFocus(ownership)) return false
    if (!targetId || !nodes.value.some((node) => String(node.id) === targetId)) {
      return setFocusedCanvasNode(null, { force: true, restoreFocus: false })
    }
    if (canvasMode.value !== 'production') {
      await setCanvasMode('production', { preserveRouteFocusOwnership: true })
    }
    if (!ownsCanvasEntityFocus(ownership) || canvasMode.value !== 'production') return false
    return setFocusedCanvasNode(targetId, { force: true })
  }

  async function synchronizeCanvasRouteFocus({ resetProject = false } = {}) {
    if (resetProject) resetCanvasProjectForRoute()
    const ownership = claimRouteEntityFocus()

    const projectAlreadyLoaded = Number(drama.value?.id) === ownership.projectId
    const loaded = projectAlreadyLoaded || await loadCanvasProject({
      blocking: true,
      preserveOnError: false,
    })
    if (!loaded || !ownsCanvasEntityFocus(ownership)) return false
    if (filterEpisodeId.value !== ownership.episodeId) {
      filterEpisodeId.value = ownership.episodeId
      await loadForDrama(drama.value, ownership.episodeId)
      if (!ownsCanvasEntityFocus(ownership)) return false
      rebuildGraph()
    }
    return synchronizeRouteFocusedEntity(ownership)
  }

  function startCanvasRouteSynchronization(options = {}) {
    canvasRouteSynchronization = synchronizeCanvasRouteFocus(options).catch(() => false)
    return canvasRouteSynchronization
  }

  async function requestEpisodeFilterChange(value) {
    const numericEpisodeId = Number(value)
    const episodeId = value == null || value === ''
      ? null
      : (Number.isSafeInteger(numericEpisodeId) && numericEpisodeId > 0 ? numericEpisodeId : null)
    const routeHasEpisodeQuery = Object.prototype.hasOwnProperty.call(route.query || {}, 'episode')
    const routeEpisodeMatches = episodeId == null
      ? !routeHasEpisodeQuery
      : routeEpisodeId() === episodeId
    if (
      String(filterEpisodeId.value ?? '') === String(episodeId ?? '')
      && routeEpisodeMatches
    ) return await canvasRouteSynchronization
    const query = { ...route.query }
    if (episodeId != null) query.episode = String(episodeId)
    else delete query.episode
    delete query.focus
    try {
      const navigationFailure = await router.replace({ query })
      if (navigationFailure) return false
      return await canvasRouteSynchronization
    } catch (_) {
      return false
    }
  }

  function resetCanvasProjectForRoute() {
    canvasEntityFocusRevision += 1
    cancelScheduledCanvasSave()
    layoutDirty.value = false
    failedCanvasSaveOperation.value = null
    layoutSaveError.value = ''
    layoutSaveState.value = 'idle'
    highlightAssetId.value = null
    layoutCache.value = null
    productionGraph.value = { nodes: [], edges: [] }
    projectAssets.value = []
    freeMediaPickerVisible.value = false
    activeGroupId.value = null
    workflowOutcomeUnknown.value = false
    selectedStoryboardIds.value = []
    focusedNodeId.value = null
    selectedFreeNodeId.value = null
    selectedFreeNodeIds.value = []
    selectedFreeEdgeIds.value = []
    editingFreeNodeId.value = null
    initialFitDone.value = false
    canvasInteractive.value = true
    for (const key of Object.keys(mediaValidity)) delete mediaValidity[key]
    productionReadinessState.value = { status: 'loading', data: null }
    freeCanvasVideoCapability.value = getVideoGenerationCapability([], { loading: true })
    refreshProductionReadiness()
    refreshFreeCanvasVideoCapability()
  }

  function closeFreeCanvasInspector({ restoreFocus = true, invalidateFocus = true } = {}) {
    const previousId = selectedFreeNodeId.value
    if (invalidateFocus) canvasEntityFocusRevision += 1
    selectedFreeNodeId.value = null
    if (restoreFocus && previousId) void focusFreeCanvasNodeTrigger(previousId)
  }

  return {
    routeFocusNodeId,
    routeEpisodeId,
    canvasRouteContext,
    claimCanvasEntityFocus,
    claimRouteEntityFocus,
    ownsCanvasEntityFocus,
    waitForFreeCanvasInspectorFocus,
    synchronizeRouteFocusedEntity,
    synchronizeCanvasRouteFocus,
    startCanvasRouteSynchronization,
    requestEpisodeFilterChange,
    resetCanvasProjectForRoute,
    closeFreeCanvasInspector,
  }
}
