import { runWithOwnedRequestErrorToast } from './request.js'

export const SOURCE_LIST_REFRESH_FAILED_MESSAGE = '素材已在服务端完成导入，但列表尚未确认。请勿重复导入，请刷新列表确认。'
export const SOURCE_POST_CREATE_FAILED_MESSAGE = '素材已导入，但页面状态更新未完成。请勿重复导入，请刷新列表确认。'
export const SOURCE_WORKFLOW_REFRESH_UNCONFIRMED_MESSAGE = '服务端已完成操作，但列表尚未确认。请勿重复操作，请刷新列表确认。'

export function extractCreatedStorySource(result) {
  return result?.source && typeof result.source === 'object' ? result.source : null
}

export function createSourceWorkflowLifecycleGuard() {
  let active = true
  const closeHandles = new Set()

  function retainCloseHandle(value) {
    try {
      if (value && typeof value.close === 'function') closeHandles.add(value)
    } catch {
      // A malformed third-party handle must not break workflow teardown.
    }
    return value
  }

  function execute(operation) {
    if (!active || typeof operation !== 'function') return Promise.reject(sourceWorkflowDisposedError())
    return Promise.resolve()
      .then(operation)
      .then((result) => {
        if (!active) throw sourceWorkflowDisposedError()
        return result
      })
      .catch((error) => {
        if (!active) throw sourceWorkflowDisposedError()
        throw error
      })
  }

  function guardApi(api) {
    return new Proxy(api, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver)
        if (typeof value !== 'function') return value
        return (...args) => execute(() => runWithOwnedRequestErrorToast(
          () => value.apply(target, args),
        ))
      },
    })
  }

  return {
    execute,
    guardApi,
    isActive: () => active,
    run(callback) {
      if (!active || typeof callback !== 'function') return undefined
      return retainCloseHandle(callback())
    },
    dispose() {
      if (!active) return
      active = false
      const handles = [...closeHandles]
      closeHandles.clear()
      for (const handle of handles) {
        try {
          handle.close()
        } catch {
          // Continue closing the remaining workflow-owned handles.
        }
      }
    },
  }
}

function sourceWorkflowDisposedError() {
  const error = new Error('来源工作流界面已关闭。')
  error.name = 'SourceWorkflowDisposedError'
  error.code = 'SOURCE_WORKFLOW_DISPOSED'
  return error
}

export function assertSourceWorkflowLifecycleActive(lifecycle) {
  if (lifecycle?.isActive?.()) return
  throw sourceWorkflowDisposedError()
}

export function selectQaReportForRun(reports, runId) {
  if (runId === undefined || runId === null) return null
  return (Array.isArray(reports) ? reports : []).find((report) => report?.run_id === runId) || null
}

export function createSourceWorkflowSnapshotController({ fetchSnapshot, applySnapshot } = {}) {
  let generation = 0

  async function refresh(context = {}) {
    const requestGeneration = ++generation
    const requestContext = { ...context, generation: requestGeneration }
    let snapshot
    try {
      snapshot = await fetchSnapshot(requestContext)
    } catch (error) {
      if (requestGeneration !== generation) {
        return { status: 'stale', data: null, generation: requestGeneration }
      }
      throw error
    }
    if (requestGeneration !== generation) {
      return { status: 'stale', data: null, generation: requestGeneration }
    }
    await applySnapshot(snapshot, requestContext)
    if (requestGeneration !== generation) {
      return { status: 'stale', data: null, generation: requestGeneration }
    }
    return { status: 'applied', data: snapshot, generation: requestGeneration }
  }

  function reset() {
    generation += 1
  }

  return { refresh, reset }
}

export async function runGatedQaRemediation({
  report,
  blockedReason,
  payload,
  remediate,
  onStarted,
  onSucceeded,
  onFailed,
  onFinished,
}) {
  if (!report?.id || blockedReason) {
    return { status: 'blocked', reason: blockedReason || '当前没有可修复的 QA 报告' }
  }

  await onStarted?.()
  try {
    const result = await remediate(report.id, payload)
    await onSucceeded?.(result)
    return { status: 'submitted', result }
  } catch (error) {
    await onFailed?.(error)
    return { status: 'failed', error }
  } finally {
    await onFinished?.()
  }
}

export async function refreshSourceImportList(loadSources) {
  try {
    const result = await loadSources()
    if (result?.status === 'stale') return { status: 'stale', error: null }
    return { status: 'refreshed', error: null, data: result?.data ?? result }
  } catch (error) {
    return { status: 'refresh_failed', error }
  }
}

export async function runSourceImport({ createSource, onServerCreated, onCreated, loadSources, confirmCreated }) {
  let source
  try {
    source = await createSource()
  } catch (error) {
    return { status: 'create_failed', error, source: null }
  }

  let postCreateError = null
  try {
    await onServerCreated?.(source)
  } catch (error) {
    postCreateError = error
  }

  const refreshOutcome = await refreshSourceImportList(loadSources)
  if (postCreateError) {
    return {
      status: 'post_create_failed',
      source,
      postCreateError,
      refreshStatus: refreshOutcome.status,
      refreshError: refreshOutcome.error,
    }
  }
  if (refreshOutcome.status !== 'refreshed') return { ...refreshOutcome, source }
  if (confirmCreated && !confirmCreated(source, refreshOutcome.data)) {
    return {
      status: 'refresh_unconfirmed',
      source,
      error: new Error('刷新结果中未找到刚导入的素材。'),
    }
  }

  try {
    await onCreated?.(source)
  } catch (error) {
    return {
      status: 'post_create_failed',
      source,
      postCreateError: error,
      refreshStatus: refreshOutcome.status,
      refreshError: refreshOutcome.error,
    }
  }
  return { ...refreshOutcome, source }
}

export function createSourceImportController({
  createSource,
  fetchSources,
  applySources,
  clearInput,
  onImportStarted,
  onCreated,
  confirmCreated,
  onCreateFailed,
  setRefreshAlert,
  emitRefresh,
} = {}) {
  let refreshAlert = ''
  let refreshAlertRevision = 0
  let sourceListRequestGeneration = 0
  let importGeneration = 0
  let contextGeneration = 0

  function updateRefreshAlert(message) {
    refreshAlert = message
    refreshAlertRevision += 1
    setRefreshAlert?.(message)
  }

  async function loadSources() {
    const requestGeneration = ++sourceListRequestGeneration
    const loadedSources = await fetchSources({ generation: requestGeneration })
    if (requestGeneration !== sourceListRequestGeneration) return { status: 'stale', data: null }
    if (loadedSources?.status === 'stale') return { status: 'stale', data: null }
    await applySources?.(loadedSources, { generation: requestGeneration })
    if (requestGeneration !== sourceListRequestGeneration) return { status: 'stale', data: null }
    updateRefreshAlert('')
    return {
      status: 'applied',
      data: loadedSources?.data ?? loadedSources,
      generation: requestGeneration,
    }
  }

  async function importSource(context) {
    const requestGeneration = ++importGeneration
    const isCurrentImport = () => requestGeneration === importGeneration
    updateRefreshAlert('')
    const importAlertRevision = refreshAlertRevision
    await onImportStarted?.(context)
    if (!isCurrentImport()) return { status: 'stale', source: null }

    const outcome = await runSourceImport({
      createSource: () => createSource(context),
      onServerCreated: async (source) => {
        if (!isCurrentImport()) return
        await clearInput?.(source, context)
      },
      onCreated: (source) => (isCurrentImport() ? onCreated?.(source, context) : undefined),
      loadSources: () => (isCurrentImport() ? loadSources() : undefined),
      confirmCreated,
    })

    if (!isCurrentImport()) return { status: 'stale', source: outcome.source || null }

    if (outcome.status === 'create_failed') {
      await onCreateFailed?.(outcome.error, context)
      return outcome
    }
    if (outcome.status === 'post_create_failed') {
      updateRefreshAlert(SOURCE_POST_CREATE_FAILED_MESSAGE)
      if (outcome.refreshStatus === 'refreshed') await emitRefresh?.()
      return outcome
    }
    if (outcome.status === 'refresh_failed' || outcome.status === 'refresh_unconfirmed') {
      if (refreshAlertRevision === importAlertRevision) {
        updateRefreshAlert(SOURCE_LIST_REFRESH_FAILED_MESSAGE)
      }
      return outcome
    }
    if (outcome.status === 'stale') {
      if (refreshAlertRevision === importAlertRevision) {
        updateRefreshAlert(SOURCE_LIST_REFRESH_FAILED_MESSAGE)
      }
      return outcome
    }

    await emitRefresh?.()
    return outcome
  }

  async function refreshSources() {
    const requestContextGeneration = contextGeneration
    const previousAlert = refreshAlert
    const requestAlertRevision = refreshAlertRevision
    const outcome = await refreshSourceImportList(loadSources)
    if (outcome.status === 'refresh_failed') {
      if (refreshAlertRevision === requestAlertRevision) {
        updateRefreshAlert(previousAlert || SOURCE_LIST_REFRESH_FAILED_MESSAGE)
      }
      return outcome
    }
    if (outcome.status === 'stale') return outcome
    if (requestContextGeneration !== contextGeneration) return { status: 'stale', error: null }
    await emitRefresh?.()
    return outcome
  }

  function reset() {
    sourceListRequestGeneration += 1
    importGeneration += 1
    contextGeneration += 1
    updateRefreshAlert('')
  }

  function markRefreshUnconfirmed(message = SOURCE_LIST_REFRESH_FAILED_MESSAGE) {
    updateRefreshAlert(message)
  }

  return {
    importSource,
    loadSources,
    markRefreshUnconfirmed,
    refreshSources,
    reset,
  }
}
