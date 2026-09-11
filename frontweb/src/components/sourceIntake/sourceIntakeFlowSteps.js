import { selectInspectedWorkflowStep } from '@/utils/sourceWorkflowState'
import { buildAiConfigLocation, normalizeProductionReadiness } from '@/utils/sourceWorkflowLaunch'
import { buildInspectedFlowStepQuery, parseRequestedFlowStep } from './sourceIntakeFlowRoute.js'

export function createSourceIntakeFlowStepController({
  route,
  router,
  flowState,
  selectedFlowStepId,
  compactCompletionVisible,
  workflowHistoryExpanded,
  productionReadiness,
  sourceOperationError,
  sourceOperationMessage,
  workflowMode,
  form,
  getDramaId,
  getDramaStyle,
  workflowRunsAPI,
  readinessChecking,
} = {}) {
  function requestedFlowStepFromRoute() {
    return parseRequestedFlowStep(route.query)
  }

  function persistInspectedFlowStep(stepId) {
    const planned = buildInspectedFlowStepQuery(route.query, flowState.value.activeStepId, stepId)
    if (planned.unchanged) return
    router.replace({ query: planned.query, hash: route.hash }).catch(() => {})
  }

  function revealInspectedHistoryIfNeeded(stepId) {
    if (
      compactCompletionVisible.value
      && stepId
      && stepId !== flowState.value.activeStepId
    ) {
      workflowHistoryExpanded.value = true
    }
  }

  function selectFlowStep(stepId) {
    selectedFlowStepId.value = selectInspectedWorkflowStep(
      flowState.value,
      selectedFlowStepId.value,
      stepId,
    )
    persistInspectedFlowStep(selectedFlowStepId.value)
    revealInspectedHistoryIfNeeded(selectedFlowStepId.value)
  }

  async function checkProductionReadiness(payload) {
    readinessChecking.value = true
    productionReadiness.value = null
    try {
      const readiness = normalizeProductionReadiness(
        await workflowRunsAPI.getNovel2AnimeReadiness(payload)
      )
      productionReadiness.value = readiness
      return readiness
    } finally {
      readinessChecking.value = false
    }
  }

  async function handleWorkflowModeChange() {
    productionReadiness.value = null
    sourceOperationError.value = ''
    sourceOperationMessage.value = ''
    if (workflowMode.value !== 'production') return
    try {
      await checkProductionReadiness({
        drama_id: getDramaId(),
        qa_mode: 'production',
        target_episode_count: form.target_episode_count,
        style: getDramaStyle(),
      })
    } catch (_) {
      sourceOperationError.value = '暂时无法检查正式制作能力，请稍后重试。'
    }
  }

  function captureProductionReadinessError(error) {
    const apiError = error?.response?.data?.error
    if (apiError?.code !== 'WORKFLOW_NOT_READY' || !apiError.details) return false
    try {
      productionReadiness.value = normalizeProductionReadiness(apiError.details)
      workflowMode.value = 'production'
      selectedFlowStepId.value = 'process'
      persistInspectedFlowStep('process')
      return true
    } catch (_) {
      return false
    }
  }

  function openAiConfigForReadiness() {
    router.push(buildAiConfigLocation({
      dramaId: getDramaId(),
      readiness: productionReadiness.value,
      returnTo: route.fullPath,
    }))
  }

  function persistProcessStep() {
    selectedFlowStepId.value = 'process'
    persistInspectedFlowStep('process')
  }

  return {
    requestedFlowStepFromRoute,
    persistInspectedFlowStep,
    revealInspectedHistoryIfNeeded,
    selectFlowStep,
    checkProductionReadiness,
    handleWorkflowModeChange,
    captureProductionReadinessError,
    openAiConfigForReadiness,
    persistProcessStep,
  }
}
