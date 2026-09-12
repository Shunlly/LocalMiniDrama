import { buildSourceIntakePayload } from '@/utils/sourceIntakeAdapter'
import { launchSourceWorkflow } from '@/utils/sourceWorkflowLaunch'

export function createSourceIntakeLaunchController({
  isLaunchBusy,
  getBlockedReason,
  getSelectedFilename,
  getDramaId,
  form,
  getDrama,
  getWorkflowMode,
  checkReadiness,
  lifecycle,
  sourceFile,
  hasWebSourceUrl,
  createSourceFromForm,
  startNovel2Anime,
  resetSourceInput,
  refreshAndConfirmRun,
  markWorkflowRefreshUnconfirmed,
  persistProcessStep,
  showWorkflowMessage,
  emitRefresh,
  productionReadiness,
  loadSources,
  sourceOperationMessage,
  sourceOperationError,
  startingSourceId,
  workflowStarting,
  getWorkflowModeShortLabel,
  isUserFacingAbort,
  toUserFacingError,
  sourceIntakeFailureMessage,
  assertSourceWorkflowLifecycleActive,
  importSourceOnly,
} = {}) {
  async function startWorkflowFromSource(source) {
    if (!source?.id) throw new Error('素材记录无效，无法启动处理。')
    const result = await launchSourceWorkflow({
      mode: getWorkflowMode(),
      payload: {
        drama_id: getDramaId(),
        source_id: source.id,
        title: source.title || '',
        source_type: source.source_type || '',
        target_episode_count: form.target_episode_count,
        style: getDrama()?.style || '',
        metadata: getDrama()?.metadata || {},
      },
      checkReadiness,
      start: (launchPayload) => {
        assertSourceWorkflowLifecycleActive(lifecycle)
        return startNovel2Anime(launchPayload)
      },
    })
    assertSourceWorkflowLifecycleActive(lifecycle)
    return result.run
  }

  async function startWorkflow() {
    if (isLaunchBusy() || getBlockedReason()) return
    const uploadedFilename = getSelectedFilename()
    let createdSource = null
    sourceOperationMessage.value = ''
    sourceOperationError.value = ''
    startingSourceId.value = null
    workflowStarting.value = true
    try {
      const basePayload = {
        drama_id: getDramaId(),
        ...buildSourceIntakePayload(form, getDrama()),
      }
      const result = await launchSourceWorkflow({
        mode: getWorkflowMode(),
        payload: basePayload,
        checkReadiness,
        start: async (launchPayload) => {
          assertSourceWorkflowLifecycleActive(lifecycle)
          if (!sourceFile.value && !hasWebSourceUrl()) {
            return startNovel2Anime(launchPayload)
          }
          const sourceResult = await createSourceFromForm()
          assertSourceWorkflowLifecycleActive(lifecycle)
          createdSource = sourceResult?.source || null
          if (!createdSource?.id) throw new Error('素材导入成功，但未返回可启动的素材记录。')
          const sourceLaunchPayload = { ...launchPayload }
          delete sourceLaunchPayload.text
          return startNovel2Anime({
            ...sourceLaunchPayload,
            source_id: createdSource.id,
            title: createdSource.title || launchPayload.title || '',
            source_type: createdSource.source_type || launchPayload.source_type || '',
          })
        },
      })
      if (!lifecycle.isActive()) return
      resetSourceInput()
      const refreshConfirmed = await refreshAndConfirmRun(result.run.id)
      if (!lifecycle.isActive()) return
      if (!refreshConfirmed) {
        markWorkflowRefreshUnconfirmed()
        return
      }
      persistProcessStep()
      sourceOperationMessage.value = uploadedFilename
        ? `${uploadedFilename} 上传解析完成，${getWorkflowModeShortLabel()} 流程已启动。`
        : `${getWorkflowModeShortLabel()} 流程已启动。`
      showWorkflowMessage('success', `${getWorkflowModeShortLabel()} 流程已启动`)
      emitRefresh()
    } catch (e) {
      if (!lifecycle.isActive()) return
      if (e?.readiness) productionReadiness.value = e.readiness
      const aborted = isUserFacingAbort(e)
      if (createdSource) {
        resetSourceInput()
        try {
          await loadSources()
        } catch (_) {}
      }
      if (aborted) {
        sourceOperationMessage.value = createdSource
          ? '素材已导入，但处理流程未启动。可从“已导入素材”中重试。'
          : ''
        return
      }
      const failure = createdSource
        ? toUserFacingError(e, '启动失败')
        : sourceIntakeFailureMessage(e, '启动失败')
      if (!failure) return
      sourceOperationMessage.value = ''
      sourceOperationError.value = createdSource
        ? `素材已导入，但处理流程未启动。${failure}`
        : failure
      showWorkflowMessage('error', sourceOperationError.value)
    } finally {
      workflowStarting.value = false
    }
  }

  async function startExistingSource(source) {
    if (isLaunchBusy() || getBlockedReason()) return
    sourceOperationMessage.value = ''
    sourceOperationError.value = ''
    startingSourceId.value = source.id
    workflowStarting.value = true
    try {
      const run = await startWorkflowFromSource(source)
      if (!lifecycle.isActive()) return
      if (!await refreshAndConfirmRun(run.id)) {
        markWorkflowRefreshUnconfirmed()
        return
      }
      persistProcessStep()
      showWorkflowMessage('success', `已从素材启动 ${getWorkflowModeShortLabel()} 流程`)
      emitRefresh()
    } catch (e) {
      if (!lifecycle.isActive()) return
      if (e?.readiness) productionReadiness.value = e.readiness
      if (isUserFacingAbort(e)) return
      sourceOperationError.value = toUserFacingError(e, '启动失败')
      if (!sourceOperationError.value) return
      showWorkflowMessage('error', sourceOperationError.value)
    } finally {
      workflowStarting.value = false
      startingSourceId.value = null
    }
  }

  async function runSourceEmptyStateAction(actionId) {
    if (actionId === 'import') {
      await importSourceOnly()
      return
    }
    if (actionId === 'start') {
      await startWorkflow()
    }
  }

  return { startWorkflow, startExistingSource, startWorkflowFromSource, runSourceEmptyStateAction }
}
