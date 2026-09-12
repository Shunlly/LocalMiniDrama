import { ElMessage } from '@/utils/elementPlusFeedback.js'
import { useFilmCreatePipelineOneClick } from './useFilmCreatePipelineOneClick.js'
import { useFilmCreatePipelineRepair } from './useFilmCreatePipelineRepair.js'

/**
 * 装配一键/文本框架/修复缺失流水线入口与执行体。
 * 只搬家，不创建新状态，不改空剧本门闩。
 */
export function useFilmCreatePipelineStages(deps = {}) {
  const {
    currentEpisodeId,
    store,
    refreshProductionReadiness,
    trackFilmCreateAction,
    pipelineStarting,
    pipelineRunning,
    pipelineStopping,
    activePipelineRunPromise,
    pipelineAbortRequested,
    pipelineErrorLog,
    pipelineCurrentStep,
    pipelineStepIndex,
    pipelineActiveTasks,
    pipelineOwnedTaskIds,
    pipelineStepTotal,
    executeOwnedPipelineRun,
    confirmProductionPipelineCost,
    storyboardMediaActionReason,
    productionCapabilityGaps,
  } = deps

  const { runOneClickPipeline } = useFilmCreatePipelineOneClick(deps)
  const { runRepairPipeline } = useFilmCreatePipelineRepair(deps)

  // 测试桩可以不传 store；真实制作页有 store 时，空剧本不启动全流程。
  function hasEpisodeScript() {
    return Boolean(String(store?.scriptContent || '').trim())
  }

  function warnEmptyEpisodeScript() {
    if (!store || hasEpisodeScript()) return false
    ElMessage.warning('当前集还没有剧本，请先编写或导入剧本')
    return true
  }

  function missingTextCapabilityGap() {
    const raw = productionCapabilityGaps && typeof productionCapabilityGaps === 'object' && 'value' in productionCapabilityGaps
      ? productionCapabilityGaps.value
      : productionCapabilityGaps
    const gaps = Array.isArray(raw) ? raw : []
    return gaps.find((item) => String(item?.service_type || '') === 'text') || null
  }

  function warnMissingTextModel() {
    const gap = missingTextCapabilityGap()
    if (!gap) return false
    const label = String(gap.label || '文本模型').trim() || '文本模型'
    const detail = String(gap.detail || '').trim()
    ElMessage.warning(detail ? (label + '：' + detail) : '草稿预演需要先配置文本模型')
    return true
  }

  async function startOneClickPipeline() {
    if (!currentEpisodeId.value || pipelineStarting.value || pipelineRunning.value || pipelineStopping.value || activePipelineRunPromise.value) return
    if (warnEmptyEpisodeScript()) return
    if (storyboardMediaActionReason.value) {
      ElMessage.warning(storyboardMediaActionReason.value)
      return
    }
    pipelineAbortRequested.value = false
    pipelineStarting.value = true
    try {
      const productionCapability = await refreshProductionReadiness()
      if (pipelineAbortRequested.value) return
      if (storyboardMediaActionReason.value) {
        ElMessage.warning(storyboardMediaActionReason.value)
        return
      }
      if (!productionCapability.ready) {
        ElMessage.warning(productionCapability.reason)
        return
      }
      if (!await confirmProductionPipelineCost()) return
      if (pipelineAbortRequested.value) return
      if (storyboardMediaActionReason.value) {
        ElMessage.warning(storyboardMediaActionReason.value)
        return
      }

      trackFilmCreateAction('one_click_generate_start')
      pipelineErrorLog.value = []
      pipelineCurrentStep.value = ''
      pipelineStepIndex.value = 0
      pipelineActiveTasks.clear()
      pipelineOwnedTaskIds.clear()
      pipelineStepTotal.value = 10
      pipelineStarting.value = false
      await executeOwnedPipelineRun(
        () => runOneClickPipeline(false),
        { requireStoryboardMedia: true },
      )
    } finally {
      pipelineStarting.value = false
    }
  }

  async function startTextFrameworkPipeline() {
    if (!currentEpisodeId.value || pipelineStarting.value || pipelineRunning.value || pipelineStopping.value || activePipelineRunPromise.value) return
    if (warnEmptyEpisodeScript()) return
    if (warnMissingTextModel()) return
    pipelineAbortRequested.value = false
    pipelineStarting.value = true
    try {
      pipelineErrorLog.value = []
      pipelineCurrentStep.value = ''
      pipelineStepIndex.value = 0
      pipelineActiveTasks.clear()
      pipelineOwnedTaskIds.clear()
      pipelineStepTotal.value = 4
      pipelineStarting.value = false
      trackFilmCreateAction('text_framework_generate_start')
      await executeOwnedPipelineRun(() => runOneClickPipeline(true))
    } finally {
      pipelineStarting.value = false
    }
  }

  async function startRepairPipeline() {
    if (!currentEpisodeId.value || pipelineStarting.value || pipelineRunning.value || pipelineStopping.value || activePipelineRunPromise.value) return
    if (storyboardMediaActionReason.value) {
      ElMessage.warning(storyboardMediaActionReason.value)
      return
    }
    pipelineAbortRequested.value = false
    pipelineStarting.value = true
    try {
      const productionCapability = await refreshProductionReadiness()
      if (pipelineAbortRequested.value) return
      if (storyboardMediaActionReason.value) {
        ElMessage.warning(storyboardMediaActionReason.value)
        return
      }
      if (!productionCapability.ready) {
        ElMessage.warning(productionCapability.reason)
        return
      }
      if (!await confirmProductionPipelineCost()) return
      if (pipelineAbortRequested.value) return
      if (storyboardMediaActionReason.value) {
        ElMessage.warning(storyboardMediaActionReason.value)
        return
      }

      pipelineErrorLog.value = []
      pipelineCurrentStep.value = ''
      pipelineActiveTasks.clear()
      pipelineOwnedTaskIds.clear()
      pipelineStarting.value = false
      await executeOwnedPipelineRun(runRepairPipeline, { requireStoryboardMedia: true })
    } finally {
      pipelineStarting.value = false
    }
  }

  return {
    startOneClickPipeline,
    startTextFrameworkPipeline,
    runOneClickPipeline,
    startRepairPipeline,
    runRepairPipeline,
  }
}
