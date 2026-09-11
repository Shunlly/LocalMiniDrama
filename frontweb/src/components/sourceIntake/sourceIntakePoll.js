import { shouldIgnoreSourceWorkflowPollError } from '@/utils/sourceImportOutcome'
import { normalizeWorkflowRun } from '@/utils/workflowRunStatus'

export function createSourceIntakePollController({
  isLifecycleActive,
  isRunActive,
  setPollState,
  setPollError,
  refreshSelectedRun,
  intervalMs = 2500,
} = {}) {
  let pollTimer = null

  function stopPoll() {
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }

  function startPoll() {
    if (!isLifecycleActive()) {
      stopPoll()
      return
    }
    stopPoll()
    if (!isRunActive()) {
      setPollState('idle')
      setPollError('')
      return
    }
    setPollState('polling')
    setPollError('')
    pollTimer = setInterval(refreshSelectedRun, intervalMs)
  }

  return { stopPoll, startPoll }
}

export function createSourceIntakePollSession({
  sourceWorkflowLifecycle,
  isRunActive,
  pollState,
  pollError,
  selectedRun,
  getRun,
  isUserFacingAbort,
  toUserFacingError,
  refreshWorkflowSnapshot,
  emitRefresh,
  intervalMs = 2500,
} = {}) {
  const isLifecycleActive = () => sourceWorkflowLifecycle.isActive()
  async function refreshSelectedRun() {
    if (!selectedRun.value?.id) return
    try {
      const run = await getRun(selectedRun.value.id)
      if (!isLifecycleActive()) return
      selectedRun.value = run
      pollState.value = normalizeWorkflowRun(run).active ? 'polling' : 'idle'
      pollError.value = ''
      if (!normalizeWorkflowRun(run).active) {
        stopPoll()
        await refreshWorkflowSnapshot()
        if (!isLifecycleActive()) return
        emitRefresh()
      }
    } catch (error) {
      if (shouldIgnoreSourceWorkflowPollError(error, sourceWorkflowLifecycle) || isUserFacingAbort(error)) return
      stopPoll()
      pollState.value = 'error'
      pollError.value = toUserFacingError(error, '处理状态刷新失败，自动轮询已暂停。', {
        serviceLabel: '处理状态',
      })
    }
  }

  async function resumePolling() {
    if (!selectedRun.value?.id || pollState.value === 'recovering') return
    pollState.value = 'recovering'
    pollError.value = ''
    try {
      const run = await getRun(selectedRun.value.id)
      if (!isLifecycleActive()) return
      selectedRun.value = run
      if (normalizeWorkflowRun(run).active) {
        startPoll()
        return
      }
      pollState.value = 'idle'
      await refreshWorkflowSnapshot()
      if (!isLifecycleActive()) return
      emitRefresh()
    } catch (error) {
      if (shouldIgnoreSourceWorkflowPollError(error, sourceWorkflowLifecycle) || isUserFacingAbort(error)) {
        if (sourceWorkflowLifecycle.isActive()) startPoll()
        return
      }
      pollState.value = 'error'
      pollError.value = toUserFacingError(error, '恢复轮询失败，请重试。', {
        serviceLabel: '处理状态',
      })
    }
  }

  const { stopPoll, startPoll } = createSourceIntakePollController({
    isLifecycleActive,
    isRunActive,
    setPollState: (value) => { pollState.value = value },
    setPollError: (value) => { pollError.value = value },
    refreshSelectedRun,
    intervalMs,
  })

  return { stopPoll, startPoll, refreshSelectedRun, resumePolling }
}
