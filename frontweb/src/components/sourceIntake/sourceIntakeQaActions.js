import { runGatedQaRemediation } from '@/utils/sourceImportOutcome'

export function createSourceIntakeQaActions({
  qaRunning,
  remediating,
  remediationStatus,
  getDramaId,
  getSelectedRunId,
  getRunMode,
  getLatestQa,
  getRemediateReason,
  getRemediatePayload,
  auditQa,
  remediateQaApi,
  isLifecycleActive,
  refreshWorkflowSnapshot,
  refreshAndConfirmRun,
  markWorkflowRefreshUnconfirmed,
  refreshUnconfirmedMessage,
  showWorkflowMessage,
  isUserFacingAbort,
  toUserFacingError,
} = {}) {
  async function runQaAudit() {
    qaRunning.value = true
    try {
      await auditQa({
        drama_id: getDramaId(),
        run_id: getSelectedRunId() || undefined,
        mode: getRunMode(),
      })
      if (!isLifecycleActive()) return
      await refreshWorkflowSnapshot()
      if (!isLifecycleActive()) return
      showWorkflowMessage('success', '质量检查已完成')
    } catch (e) {
      if (!isLifecycleActive()) return
      if (isUserFacingAbort(e)) return
      showWorkflowMessage('error', toUserFacingError(e, '质量检查失败'))
    } finally {
      qaRunning.value = false
    }
  }

  async function remediateQa() {
    await runGatedQaRemediation({
      report: getLatestQa(),
      blockedReason: getRemediateReason(),
      payload: getRemediatePayload(),
      remediate: (reportId, payload) => remediateQaApi(reportId, payload),
      onStarted: () => {
        remediating.value = true
        remediationStatus.value = '正在提交自动修复...'
      },
      onSucceeded: async (result) => {
        if (!isLifecycleActive()) return
        if (result.workflow_run) {
          if (!await refreshAndConfirmRun(result.workflow_run.id)) {
            markWorkflowRefreshUnconfirmed()
            remediationStatus.value = refreshUnconfirmedMessage
            return
          }
          const action = result.actions_taken?.[0]?.code || 'workflow'
          remediationStatus.value = `已启动修复：${action}`
          showWorkflowMessage('success', '已启动自动修复流程')
        } else {
          try {
            const refreshOutcome = await refreshWorkflowSnapshot()
            if (refreshOutcome.status !== 'applied') {
              markWorkflowRefreshUnconfirmed()
              remediationStatus.value = refreshUnconfirmedMessage
              return
            }
          } catch (_) {
            markWorkflowRefreshUnconfirmed()
            remediationStatus.value = refreshUnconfirmedMessage
            return
          }
          remediationStatus.value = result.reason || '当前质量检查报告没有可自动执行的修复动作'
          showWorkflowMessage('warning', remediationStatus.value)
        }
      },
      onFailed: (error) => {
        if (!isLifecycleActive()) return
        remediationStatus.value = ''
        if (isUserFacingAbort(error)) return
        showWorkflowMessage('error', toUserFacingError(error, '自动修复失败'))
      },
      onFinished: () => { remediating.value = false },
    })
  }

  return { runQaAudit, remediateQa }
}
