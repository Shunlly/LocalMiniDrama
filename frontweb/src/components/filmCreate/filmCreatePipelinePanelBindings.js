import { computed } from 'vue'
import { getPipelineCompactAction, getPipelineCompactSecondaryAction, getPipelineControlReasons, isPipelineLocallyStopped } from '@/utils/filmPipelineAction'
import { toPipelineDisabledReason, describePipelineErrorLog, describePipelinePanelUx, resolvePipelineProductionReason } from '@/components/filmCreate/filmCreatePipelinePanelUx'

/** 把全流程面板的展示状态收成可绑定属性，不改空剧本禁用语义。 */
export function createFilmCreatePipelinePanelBindings(props) {
  const activeTaskLabels = computed(() => Array.from(props.activeTasks || []))
  const cleanCurrentStep = computed(() => {
    const stripped = String(props.currentStep || '').replace(/^\[步骤 \d+\/\d+\] /, '')
    if (!stripped) return ''
    return toPipelineDisabledReason(stripped, '正在执行全流程生成')
  })
  const productionReason = computed(() => resolvePipelineProductionReason({
    productionDisabledReason: props.productionDisabledReason,
    disabledReason: props.disabledReason,
    productionReadinessReason: props.productionReadinessReason,
    productionReadinessState: props.productionReadinessState,
  }))
  const draftReason = computed(() => toPipelineDisabledReason(
    props.draftDisabledReason || props.disabledReason,
    '草稿预演暂不可生成',
  ))
  const hasPipelineError = computed(() => props.errorLog.length > 0)
  const displayErrorLog = computed(() => describePipelineErrorLog(props.errorLog))
  const locallyStopped = computed(() => isPipelineLocallyStopped({
    running: props.running,
    stopping: props.stopping,
    stopRequired: props.stopRequired,
    hasError: hasPipelineError.value,
    currentStep: props.currentStep,
  }))
  const controlReasons = computed(() => getPipelineControlReasons({
    running: props.running,
    paused: props.paused,
    stopping: props.stopping,
    stopRequired: props.stopRequired,
    productionReason: productionReason.value,
  }))
  const panelUx = computed(() => describePipelinePanelUx({
    running: props.running,
    paused: props.paused,
    stopping: props.stopping,
    stopRequired: props.stopRequired,
    starting: props.starting,
    currentStep: props.currentStep,
    hasEpisode: props.hasEpisode,
    productionReason: productionReason.value,
    draftReason: draftReason.value,
    controlReasons: controlReasons.value,
    countdown: props.countdown,
    countdownMessage: props.countdownMessage,
  }))
  const pauseDisabledReason = computed(() => panelUx.value.pauseDisabledReason)
  const resumeDisabledReason = computed(() => panelUx.value.resumeDisabledReason)
  const cancelDisabledReason = computed(() => panelUx.value.cancelDisabledReason)
  const compactDisabledReason = computed(() => panelUx.value.compactDisabledReason)
  const productionButtonTitle = computed(() => panelUx.value.productionButtonTitle || undefined)
  const draftButtonTitle = computed(() => panelUx.value.draftButtonTitle || undefined)
  const productionButtonAriaLabel = computed(() => panelUx.value.productionButtonAriaLabel)
  const draftButtonAriaLabel = computed(() => panelUx.value.draftButtonAriaLabel)
  const progressStatusText = computed(() => panelUx.value.progressStatusText)
  const emptyGuidanceText = computed(() => panelUx.value.emptyGuidanceText)
  const emptyActionLabel = computed(() => panelUx.value.emptyActionLabel)
  const emptyActionAriaLabel = computed(() => panelUx.value.emptyActionLabel)
  const retryDisabledReason = computed(() => toPipelineDisabledReason(controlReasons.value.retry, '当前不能重试全流程'))
  const focusReason = computed(() => props.running ? '' : productionReason.value)
  const longFocusReason = computed(() => focusReason.value.length > 56)
  const focusState = computed(() => {
    if (props.starting) return 'checking'
    if (props.stopRequired) return 'error'
    if (props.running) return props.paused ? 'paused' : 'running'
    if (locallyStopped.value) return 'stopped'
    if (hasPipelineError.value) return 'error'
    if (!draftReason.value && props.productionReadinessState === 'checking') return 'checking'
    if (!draftReason.value && props.productionReadinessState === 'error') return 'error'
    return focusReason.value ? 'blocked' : 'ready'
  })
  const focusKicker = computed(() => {
    if (panelUx.value.progressKicker) return panelUx.value.progressKicker
    if (locallyStopped.value) return '已停止'
    if (hasPipelineError.value) return '执行失败'
    if (!draftReason.value && props.productionReadinessState === 'checking') return '能力检查'
    if (!draftReason.value && props.productionReadinessState === 'error') return '检查失败'
    return focusReason.value ? '当前阻断' : '当前任务'
  })
  const focusTitle = computed(() => {
    if (props.starting) return '正在确认完整成片的运行条件'
    if (props.stopRequired) return '全流程停止未完成'
    if (props.running) {
      return cleanCurrentStep.value || (props.paused ? '全流程生成已暂停' : '正在执行全流程生成')
    }
    if (locallyStopped.value) return cleanCurrentStep.value || '全流程已停止'
    if (hasPipelineError.value) return '全流程生成未完成'
    if (!draftReason.value && props.productionReadinessState === 'checking') return '正在检查完整成片能力'
    if (!draftReason.value && props.productionReadinessState === 'error') return '完整成片能力检查失败'
    return focusReason.value ? '完整成片暂不可生成' : '完整成片已可生成'
  })
  const focusNextStep = computed(() => {
    if (props.starting) return '确认服务能力与本次调用范围'
    if (props.stopRequired) return '重试停止剩余远端任务'
    if (props.running) return props.paused ? '继续当前生成流程' : '等待当前阶段完成'
    if (locallyStopped.value) return '可重新开始完整成片'
    if (hasPipelineError.value) return '查看错误后重试全流程'
    if (props.hasEpisode === false) return '添加一集后再保存剧本或启动生成'
    if (draftReason.value) return draftReason.value
    if (props.productionReadinessState === 'checking') return '等待检查完成'
    if (props.productionReadinessState === 'error') return '重试检查，确认本地服务与配置状态'
    if (props.productionReadinessState === 'missing') return '可先跑草稿预演，或前往 AI 配置补齐完整成片能力'
    return '一键生成完整成片'
  })
  const showReadinessAction = computed(() => (
    !props.running
    && !draftReason.value
    && props.productionReadinessState === 'missing'
  ))
  const showReadinessRetry = computed(() => (
    !props.running
    && !draftReason.value
    && props.productionReadinessState === 'error'
  ))
  const compactAction = computed(() => getPipelineCompactAction({
    readinessState: props.productionReadinessState,
    serviceType: props.productionReadinessServiceType,
    running: props.running,
    paused: props.paused,
    hasEpisode: props.hasEpisode,
    draftReason: draftReason.value,
    productionReason: productionReason.value,
    hasError: hasPipelineError.value,
  }))
  const compactSecondaryAction = computed(() => getPipelineCompactSecondaryAction({
    readinessState: props.productionReadinessState,
    serviceType: props.productionReadinessServiceType,
    running: props.running,
    hasEpisode: props.hasEpisode,
  }))
  const compactActionDisabledReason = computed(() => {
    const busy = compactDisabledReason.value
    if (busy) return busy
    if (compactAction.value?.event === 'start-text-framework') return draftReason.value
    return ''
  })
  const compactActionAriaLabel = computed(() => {
    const action = compactAction.value
    if (!action) return ''
    const reason = compactActionDisabledReason.value
    return reason ? `${action.label}不可用：${reason}` : action.label
  })
  const compactSecondaryActionAriaLabel = computed(() => {
    const action = compactSecondaryAction.value
    if (!action) return ''
    const reason = compactDisabledReason.value
    return reason ? `${action.label}不可用：${reason}` : action.label
  })
  const actionPanelProps = computed(() => ({
    starting: props.starting,
    running: props.running,
    paused: props.paused,
    stopping: props.stopping,
    stopRequired: props.stopRequired,
    productionReason: productionReason.value,
    draftReason: draftReason.value,
    productionButtonTitle: productionButtonTitle.value,
    draftButtonTitle: draftButtonTitle.value,
    productionButtonAriaLabel: productionButtonAriaLabel.value,
    draftButtonAriaLabel: draftButtonAriaLabel.value,
    pauseDisabledReason: pauseDisabledReason.value,
    resumeDisabledReason: resumeDisabledReason.value,
    cancelDisabledReason: cancelDisabledReason.value,
    showReadinessAction: showReadinessAction.value,
    showReadinessRetry: showReadinessRetry.value,
    productionReadinessServiceType: props.productionReadinessServiceType,
  }))
  const stepsPanelProps = computed(() => ({
    progressStatusText: progressStatusText.value,
    currentStep: props.currentStep,
    cleanCurrentStep: cleanCurrentStep.value,
    stepIndex: props.stepIndex,
    stepTotal: props.stepTotal,
  }))
  const statusPanelProps = computed(() => ({
    countdown: props.countdown,
    countdownMessage: panelUx.value.countdownMessage,
    countdownAriaLabel: panelUx.value.countdownAriaLabel,
    countdownPausedHint: panelUx.value.countdownPausedHint,
    skipCountdownDisabledReason: panelUx.value.skipCountdownDisabledReason,
    paused: props.paused,
    pauseDisabledReason: pauseDisabledReason.value,
    displayErrorLog: displayErrorLog.value,
    activeTaskLabels: activeTaskLabels.value,
    running: props.running,
    starting: props.starting,
    retryDisabledReason: retryDisabledReason.value,
  }))
  return {
    activeTaskLabels,
    cleanCurrentStep,
    productionReason,
    draftReason,
    hasPipelineError,
    displayErrorLog,
    locallyStopped,
    controlReasons,
    panelUx,
    pauseDisabledReason,
    resumeDisabledReason,
    cancelDisabledReason,
    compactDisabledReason,
    productionButtonTitle,
    draftButtonTitle,
    productionButtonAriaLabel,
    draftButtonAriaLabel,
    progressStatusText,
    emptyGuidanceText,
    emptyActionLabel,
    emptyActionAriaLabel,
    retryDisabledReason,
    focusReason,
    longFocusReason,
    focusState,
    focusKicker,
    focusTitle,
    focusNextStep,
    showReadinessAction,
    showReadinessRetry,
    compactAction,
    compactSecondaryAction,
    compactActionDisabledReason,
    compactActionAriaLabel,
    compactSecondaryActionAriaLabel,
    actionPanelProps,
    stepsPanelProps,
    statusPanelProps,
  }
}
