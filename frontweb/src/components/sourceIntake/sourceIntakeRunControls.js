export function createSourceIntakeRunControls({
  selectedRun,
  isActionBusy,
  getControlReasons,
  retrying,
  pausing,
  resuming,
  cancelling,
  retryRunApi,
  pauseRunApi,
  resumeRunApi,
  cancelRunApi,
  cancelReason,
  pauseReason,
  isLifecycleActive,
  refreshAndConfirmRun,
  markWorkflowRefreshUnconfirmed,
  persistProcessStep,
  showWorkflowMessage,
  emitRefresh,
  startPoll,
  stopPoll,
  captureProductionReadinessError,
  shouldIgnoreError,
  isUserFacingAbort,
  toUserFacingError,
  confirmCancel,
} = {}) {
  async function retryRun() {
    if (!selectedRun.value?.id || isActionBusy() || getControlReasons().retry) return
    retrying.value = true
    try {
      const nextRun = await retryRunApi(selectedRun.value.id)
      if (!isLifecycleActive()) return
      if (!nextRun?.id) throw new Error('重试接口未返回有效的流程记录。')
      if (!await refreshAndConfirmRun(nextRun.id)) {
        selectedRun.value = nextRun
        markWorkflowRefreshUnconfirmed()
        persistProcessStep()
        startPoll()
        return
      }
      persistProcessStep()
      showWorkflowMessage('success', '已提交重试')
      emitRefresh()
      startPoll()
    } catch (e) {
      if (shouldIgnoreError(e) || isUserFacingAbort(e)) return
      captureProductionReadinessError(e)
      showWorkflowMessage('error', toUserFacingError(e, '重试失败', { serviceLabel: '处理流程' }))
    } finally {
      retrying.value = false
    }
  }

  async function cancelRun() {
    if (!selectedRun.value?.id || isActionBusy() || getControlReasons().cancel) return
    if (typeof confirmCancel === 'function') {
      const allowed = await confirmCancel()
      if (!allowed) return
    }
    cancelling.value = true
    try {
      const nextRun = await cancelRunApi(selectedRun.value.id, cancelReason)
      if (!isLifecycleActive()) return
      selectedRun.value = nextRun
      showWorkflowMessage('success', '已取消')
      stopPoll()
      emitRefresh()
    } catch (e) {
      if (shouldIgnoreError(e) || isUserFacingAbort(e)) return
      showWorkflowMessage('error', toUserFacingError(e, '取消失败', { serviceLabel: '处理流程' }))
    } finally {
      cancelling.value = false
    }
  }

  async function pauseRun() {
    if (!selectedRun.value?.id || isActionBusy() || getControlReasons().pause) return
    pausing.value = true
    try {
      const nextRun = await pauseRunApi(selectedRun.value.id, pauseReason)
      if (!isLifecycleActive()) return
      selectedRun.value = nextRun
      showWorkflowMessage('success', '已暂停')
      stopPoll()
      emitRefresh()
    } catch (e) {
      if (shouldIgnoreError(e) || isUserFacingAbort(e)) return
      showWorkflowMessage('error', toUserFacingError(e, '暂停失败', { serviceLabel: '处理流程' }))
    } finally {
      pausing.value = false
    }
  }

  async function resumeRun() {
    if (!selectedRun.value?.id || isActionBusy() || getControlReasons().resume) return
    resuming.value = true
    try {
      const nextRun = await resumeRunApi(selectedRun.value.id)
      if (!isLifecycleActive()) return
      selectedRun.value = nextRun
      showWorkflowMessage('success', '已恢复')
      emitRefresh()
      startPoll()
    } catch (e) {
      if (shouldIgnoreError(e) || isUserFacingAbort(e)) return
      captureProductionReadinessError(e)
      showWorkflowMessage('error', toUserFacingError(e, '恢复失败', { serviceLabel: '处理流程' }))
    } finally {
      resuming.value = false
    }
  }

  return { retryRun, pauseRun, resumeRun, cancelRun }
}
