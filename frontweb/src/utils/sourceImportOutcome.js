import { runWithOwnedRequestErrorToast } from './request.js'

export const SOURCE_LIST_REFRESH_FAILED_MESSAGE = '素材已导入，但列表刷新失败'
export const SOURCE_POST_CREATE_FAILED_MESSAGE = '素材已导入，但页面状态更新未完成。请勿重复导入，请刷新列表确认。'

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
    await loadSources()
    return { status: 'refreshed', error: null }
  } catch (error) {
    return { status: 'refresh_failed', error }
  }
}

export async function runSourceImport({ createSource, onCreated, loadSources }) {
  let source
  try {
    source = await createSource()
  } catch (error) {
    return { status: 'create_failed', error, source: null }
  }

  let postCreateError = null
  try {
    await onCreated?.(source)
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
  return { ...refreshOutcome, source }
}

export function createSourceImportController({
  createSource,
  fetchSources,
  applySources,
  clearInput,
  onImportStarted,
  onCreated,
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
    const loadedSources = await fetchSources()
    if (requestGeneration !== sourceListRequestGeneration) return undefined
    await applySources?.(loadedSources)
    if (requestGeneration !== sourceListRequestGeneration) return undefined
    updateRefreshAlert('')
    return loadedSources
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
      onCreated: async (source) => {
        if (!isCurrentImport()) return
        let postCreateError = null
        try {
          await clearInput?.(source, context)
        } catch (error) {
          postCreateError = error
        }
        try {
          if (!isCurrentImport()) return
          await onCreated?.(source, context)
        } catch (error) {
          postCreateError ||= error
        }
        if (postCreateError) throw postCreateError
      },
      loadSources: () => (isCurrentImport() ? loadSources() : undefined),
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
    if (outcome.status === 'refresh_failed') {
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

  return {
    importSource,
    loadSources,
    refreshSources,
    reset,
  }
}
