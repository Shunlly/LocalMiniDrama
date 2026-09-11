export async function fetchSourceIntakeWorkflowSnapshot({
  dramaId,
  generation,
  targetEpisodeCount,
  style,
  sourceIntakeAPI,
  workflowRunsAPI,
  qaReportsAPI,
  timelinesAPI,
  normalizeProductionReadiness,
} = {}) {
  const readinessPayload = {
    drama_id: dramaId,
    qa_mode: 'production',
    target_episode_count: targetEpisodeCount,
    style: style || '',
  }
  const [nextSources, nextRuns, nextReports, nextReadiness, nextTimeline] = await Promise.all([
    sourceIntakeAPI.listForDrama(dramaId),
    workflowRunsAPI.list({ drama_id: dramaId, type: 'novel2anime', limit: 10 }),
    qaReportsAPI.list({ drama_id: dramaId, limit: 10 }),
    workflowRunsAPI.getNovel2AnimeReadiness(readinessPayload),
    timelinesAPI.getDramaTimeline(dramaId).catch(() => null),
  ])
  const latest = nextRuns[0]
  const nextSelectedRun = latest ? await workflowRunsAPI.get(latest.id) : null
  return {
    dramaId,
    generation,
    sources: nextSources,
    runs: nextRuns,
    reports: nextReports,
    readiness: normalizeProductionReadiness(nextReadiness),
    selectedRun: nextSelectedRun,
    timeline: nextTimeline,
  }
}

export function applySourceIntakeWorkflowSnapshot(snapshot, {
  isActive,
  dramaId,
  sources,
  runs,
  reports,
  productionReadiness,
  selectedRun,
  timeline,
  workflowDataError,
  startPoll,
} = {}) {
  if (!isActive?.() || snapshot.dramaId !== dramaId) return false
  sources.value = snapshot.sources
  runs.value = snapshot.runs
  reports.value = snapshot.reports
  productionReadiness.value = snapshot.readiness
  selectedRun.value = snapshot.selectedRun
  timeline.value = snapshot.timeline
  workflowDataError.value = ''
  startPoll?.()
  return true
}

export async function refreshAndConfirmSourceIntakeRun(refreshWorkflowSnapshot, runId) {
  try {
    const outcome = await refreshWorkflowSnapshot()
    return outcome.status === 'applied'
      && outcome.data?.runs?.some((run) => String(run?.id) === String(runId))
  } catch (_) {
    return false
  }
}

export async function loadSourceIntakeWorkflowData({
  dramaId,
  beginLoad,
  endLoad,
  refreshWorkflowSnapshot,
  shouldIgnoreError,
  onFailed,
} = {}) {
  if (!dramaId) return
  beginLoad?.()
  try {
    return await refreshWorkflowSnapshot()
  } catch (e) {
    if (shouldIgnoreError?.(e)) {
      return { status: 'ignored', error: e }
    }
    onFailed?.(e)
    return { status: 'failed', error: e }
  } finally {
    endLoad?.()
  }
}

export function createSourceIntakeSnapshotSession({
  getDramaId,
  getTargetEpisodeCount,
  getStyle,
  sourceIntakeAPI,
  workflowRunsAPI,
  qaReportsAPI,
  timelinesAPI,
  normalizeProductionReadiness,
  createSnapshotController,
  isActive,
  sources,
  runs,
  reports,
  productionReadiness,
  selectedRun,
  timeline,
  workflowDataError,
  startPoll,
} = {}) {
  async function fetchWorkflowSnapshot({ generation } = {}) {
    return fetchSourceIntakeWorkflowSnapshot({
      dramaId: getDramaId(),
      generation,
      targetEpisodeCount: getTargetEpisodeCount(),
      style: getStyle(),
      sourceIntakeAPI,
      workflowRunsAPI,
      qaReportsAPI,
      timelinesAPI,
      normalizeProductionReadiness,
    })
  }

  function applyWorkflowSnapshot(snapshot) {
    return applySourceIntakeWorkflowSnapshot(snapshot, {
      isActive,
      dramaId: getDramaId(),
      sources,
      runs,
      reports,
      productionReadiness,
      selectedRun,
      timeline,
      workflowDataError,
      startPoll,
    })
  }

  const controller = createSnapshotController({
    fetchSnapshot: fetchWorkflowSnapshot,
    applySnapshot: applyWorkflowSnapshot,
  })

  async function refreshWorkflowSnapshot() {
    return controller.refresh({ dramaId: getDramaId() })
  }

  async function refreshAndConfirmRun(runId) {
    return refreshAndConfirmSourceIntakeRun(refreshWorkflowSnapshot, runId)
  }

  return {
    fetchWorkflowSnapshot,
    applyWorkflowSnapshot,
    refreshWorkflowSnapshot,
    refreshAndConfirmRun,
    reset: () => controller.reset(),
  }
}

export function createSourceIntakeDataActions({
  getDramaId,
  refreshWorkflowSnapshot,
  loading,
  workflowDataError,
  shouldIgnoreError,
  toUserFacingError,
  sourceImportController,
  refreshUnconfirmedMessage,
  sourceOperationMessage,
} = {}) {
  let activeLoadCount = 0

  async function loadSources() {
    return sourceImportController.loadSources()
  }

  function markWorkflowRefreshUnconfirmed() {
    sourceImportController.markRefreshUnconfirmed(refreshUnconfirmedMessage)
    sourceOperationMessage.value = refreshUnconfirmedMessage
  }

  async function loadData() {
    return loadSourceIntakeWorkflowData({
      dramaId: getDramaId(),
      refreshWorkflowSnapshot,
      beginLoad() {
        activeLoadCount += 1
        loading.value = true
        workflowDataError.value = ''
      },
      endLoad() {
        activeLoadCount -= 1
        loading.value = activeLoadCount > 0
      },
      shouldIgnoreError,
      onFailed(e) {
        workflowDataError.value = toUserFacingError(e, '加载素材流程状态失败，请稍后重试。', {
          serviceLabel: '素材流程',
        })
      },
    })
  }

  return { loadData, loadSources, markWorkflowRefreshUnconfirmed }
}
