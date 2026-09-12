import { computed, isRef, unref } from 'vue'

import { SOURCE_FILE_ACCEPT } from './sourceIntakeFileSelect.js'
import { formatTime, qaIssueDisplayMessage } from './sourceIntakeMessages.js'
import { SOURCE_TYPE_OPTIONS } from '@/utils/sourceIntakeAdapter'
import { selectQaReportForRun } from '@/utils/sourceImportOutcome'
import { normalizeWorkflowRun } from '@/utils/workflowRunStatus'
import { buildQaPresentation, normalizeQaReport } from '@/utils/qaReport'
import { formatDuration, normalizeTimelineSummary } from '@/utils/timelineSummary'
import { toUserFacingError } from '@/utils/userFacingError'
import {
  SOURCE_INTAKE_MEDIA_HELP,
  SOURCE_MEDIA_URL_UPLOAD_HINT,
  buildSourceWorkflowState,
  getNewWorkflowRunReason,
  getSourceWorkflowActionReasons,
  getSourceWorkflowBusyReason,
  isDeferredAutoExtractionSource,
  localizeSourceIntakeFailure,
  resolveSourceIntakeExtractionNextStep,
  resolveInspectedWorkflowStep,
  selectInspectedWorkflowStep,
} from '@/utils/sourceWorkflowState'
import { isValidHttpSourceUrl } from '@/utils/sourceWorkflowLaunch'

/**
 * 把素材流程已有状态装配成可 v-bind 的属性袋。
 * 只搬家，不创建新状态，不改离开保护。
 */
export function createSourceIntakeControlBindings(values, modelKeys = []) {
  const updaters = {}
  for (const key of modelKeys) {
    const model = values[key]
    updaters[`onUpdate:${key}`] = (next) => {
      if (isRef(model)) model.value = next
    }
  }
  return computed(() => {
    const bindings = { ...updaters }
    for (const [key, value] of Object.entries(values)) {
      bindings[key] = unref(value)
    }
    return bindings
  })
}

/** 阶段文案、忙闲原因、检查中步骤和完成摘要的计算值 */
export function createSourceIntakeWorkspaceComputeds({
  form,
  sourceFile,
  selectedFilename,
  sourceFileReading,
  sourceSaving,
  sourceListRefreshing,
  workflowStarting,
  readinessChecking,
  retrying,
  pausing,
  resuming,
  cancelling,
  loading,
  qaRunning,
  remediating,
  pollState,
  pollError,
  sourceOperationError,
  sourceListRefreshError,
  workflowDataError,
  sourceOperationMessage,
  workflowMode,
  productionReadiness,
  selectedRun,
  reports,
  timeline,
  sources,
  selectedFlowStepId,
  getDrama,
} = {}) {
  const rawSourceUrl = computed(() => String(form.source_url || '').trim())
  const sourceUrlValidationMessage = computed(() => {
    if (!rawSourceUrl.value) return ''
    if (!isValidHttpSourceUrl(rawSourceUrl.value)) return '请输入完整的 http:// 或 https:// 网页地址。'
    if (isDeferredAutoExtractionSource(rawSourceUrl.value)) return SOURCE_MEDIA_URL_UPLOAD_HINT
    return ''
  })
  const hasWebSourceUrl = computed(() => Boolean(rawSourceUrl.value) && !sourceUrlValidationMessage.value)
  const hasSourceInput = computed(() => Boolean(sourceFile.value || hasWebSourceUrl.value || form.text.trim()))
  const hasUnsavedSourceInput = computed(() => Boolean(sourceFile.value || rawSourceUrl.value || form.text.trim()))
  const isWorkflowLaunchBusy = computed(() => workflowStarting.value || readinessChecking.value)
  const sourceOperationActive = computed(() => Boolean(
    sourceFileReading.value
    || sourceSaving.value
    || sourceListRefreshing.value
    || workflowStarting.value
    || readinessChecking.value,
  ))
  const workflowActionBusy = computed(() => retrying.value || pausing.value || resuming.value || cancelling.value)
  const workflowModeShortLabel = computed(() => workflowMode.value === 'production' ? '正式制作' : '草稿预演')
  const workflowModeDescription = computed(() => workflowMode.value === 'production'
    ? '调用正式 AI 服务生成可交付媒体，并在本机完成成片合成。启动前会检查全部制作能力。'
    : '用于快速验证改编与镜头流程；媒体步骤生成草稿占位，不调用正式媒体服务。')
  const workflowStartButtonLabel = computed(() => {
    if (readinessChecking.value) return '正在检查正式制作条件'
    if (workflowStarting.value) return `正在启动 ${workflowModeShortLabel.value}`
    return `导入并启动 ${workflowModeShortLabel.value}`
  })
  const sourceUploadBusyReason = computed(() => {
    if (sourceFileReading.value) return '正在读取素材文件，请稍候。'
    if (sourceSaving.value) return '正在保存素材，请稍候。'
    if (sourceListRefreshing.value) return '正在刷新素材列表，请稍候。'
    if (readinessChecking.value) return '正在检查正式制作能力，请稍候。'
    if (workflowStarting.value) return `正在启动 ${workflowModeShortLabel.value}，请稍候。`
    return ''
  })
  const sourceListRetryReason = computed(() => {
    if (sourceFileReading.value) return '正在读取素材文件，请稍候。'
    if (sourceSaving.value) return '正在保存素材，请稍候。'
    if (readinessChecking.value) return '正在检查正式制作能力，请稍候。'
    if (workflowStarting.value) return `正在启动 ${workflowModeShortLabel.value}，请稍候。`
    return ''
  })
  const sourceOperationStatus = computed(() => {
    if (readinessChecking.value) return '正在检查正式制作所需的文本、图像、视频、配音与本地合成能力…'
    if (sourceFileReading.value) return `正在读取 ${selectedFilename.value || '文件'}…`
    if (sourceSaving.value && sourceFile.value) return `正在上传并解析 ${selectedFilename.value}…`
    if (sourceListRefreshing.value) return '正在刷新素材列表…'
    if (workflowStarting.value && sourceFile.value) return `正在上传并解析 ${selectedFilename.value}，完成后将启动处理…`
    if (workflowStarting.value) return `正在启动 ${workflowModeShortLabel.value} 流程…`
    return sourceOperationMessage.value
  })
  const runState = computed(() => normalizeWorkflowRun(selectedRun.value))
  const displayedRunError = computed(() => {
    const localized = localizeSourceIntakeFailure(
      runState.value.failedStep?.error || selectedRun.value?.error || '',
    )
    if (!localized) return ''
    return toUserFacingError(localized, '处理失败，请稍后重试。')
  })
  // 处理失败的抽取下一步必须随计算值返回，否则处理阶段绑定拿不到按钮。
  const extractionNextStep = computed(() => {
    const latestSource = Array.isArray(sources.value) ? sources.value[0] : null
    return resolveSourceIntakeExtractionNextStep(
      runState.value.failedStep?.error || selectedRun.value?.error || displayedRunError.value,
      {
        message: displayedRunError.value,
        filename: latestSource?.original_filename || latestSource?.filename || latestSource?.title || '',
        sourceUrl: latestSource?.source_url || '',
      },
    )
  })
  const intakeExtractionNextStep = computed(() => {
    const error = String(sourceOperationError.value || '').trim()
    if (!error) return null
    return resolveSourceIntakeExtractionNextStep(error, {
      file: sourceFile.value,
      filename: selectedFilename.value,
      message: error,
    })
  })
  const productionLaunchReason = computed(() => {
    if (workflowMode.value !== 'production') return ''
    if (readinessChecking.value) return '正在检查正式制作能力'
    if (!productionReadiness.value) return '尚未完成正式制作能力检查'
    if (productionReadiness.value.ready) return ''
    const labels = (productionReadiness.value.missing_capabilities || [])
      .map((item) => item?.label)
      .filter(Boolean)
    return labels.length
      ? `正式制作条件未满足：${labels.join('、')}`
      : '正式制作条件未满足，请检查制作能力配置'
  })
  const newWorkflowRunReason = computed(() => (
    getNewWorkflowRunReason(runState.value) || productionLaunchReason.value
  ))
  const timelineSummary = computed(() => normalizeTimelineSummary(timeline.value))
  const latestQa = computed(() => normalizeQaReport(
    selectQaReportForRun(reports.value, selectedRun.value?.id),
  ))
  const displayedQaIssues = computed(() => (
    latestQa.value.issues
      .map((issue) => {
        const message = qaIssueDisplayMessage(issue?.message)
        return message ? { code: issue?.code || message, message } : null
      })
      .filter(Boolean)
      .slice(0, 3)
  ))
  const displayedQaRecommendations = computed(() => (
    latestQa.value.recommendations
      .map((item) => toUserFacingError(item, ''))
      .filter(Boolean)
  ))
  const qaPresentation = computed(() => buildQaPresentation(latestQa.value, runState.value.mode))
  const baseActionReasons = computed(() => getSourceWorkflowActionReasons({
    hasSourceInput: hasSourceInput.value,
    runState: runState.value,
    qa: latestQa.value,
  }))
  const sourceRefreshRecoveryReason = computed(() => (
    sourceListRefreshError.value ? '素材已导入，请先刷新列表确认。' : ''
  ))
  const actionReasons = computed(() => {
    const reasons = {
      ...baseActionReasons.value,
      import: sourceUrlValidationMessage.value || baseActionReasons.value.import,
      start: sourceUrlValidationMessage.value || baseActionReasons.value.start || productionLaunchReason.value,
    }
    if (sourceUploadBusyReason.value) {
      reasons.import = reasons.import || sourceUploadBusyReason.value
      reasons.start = reasons.start || sourceUploadBusyReason.value
    }
    if (qaRunning.value) reasons.qa = reasons.qa || '正在执行质量检查，请稍候。'
    if (remediating.value) reasons.remediate = reasons.remediate || '正在启动自动修复，请稍候。'
    if (sourceRefreshRecoveryReason.value) {
      reasons.import = sourceRefreshRecoveryReason.value
      reasons.start = sourceRefreshRecoveryReason.value
    }
    return reasons
  })
  const workflowBusyReason = computed(() => getSourceWorkflowBusyReason({
    retrying: retrying.value,
    pausing: pausing.value,
    resuming: resuming.value,
    cancelling: cancelling.value,
  }))
  const controlActionReasons = computed(() => ({
    retry: actionReasons.value.retry || workflowBusyReason.value,
    pause: actionReasons.value.pause || workflowBusyReason.value,
    resume: actionReasons.value.resume || workflowBusyReason.value,
    cancel: actionReasons.value.cancel || workflowBusyReason.value,
  }))
  const existingSourceLaunchReason = computed(() => (
    newWorkflowRunReason.value || sourceUploadBusyReason.value
  ))
  const refreshBusyReason = computed(() => {
    if (readinessChecking.value) return '正在检查正式制作能力，请稍候。'
    if (workflowStarting.value) return `正在启动 ${workflowModeShortLabel.value}，请稍候。`
    return workflowBusyReason.value
  })
  const canRestartFromLatestSource = computed(() => (
    sources.value.length > 0
    && Boolean(selectedRun.value)
    && (runState.value.status === 'cancelled' || runState.value.status === 'failed')
  ))
  const flowState = computed(() => buildSourceWorkflowState({
    sourceCount: sources.value.length,
    hasSourceInput: hasSourceInput.value,
    run: selectedRun.value,
    qa: latestQa.value,
    timeline: timelineSummary.value,
    episodeCount: getDrama()?.episodes?.length || 0,
    actionReasons: actionReasons.value,
  }))
  const completionVisibilityBlocked = computed(() => Boolean(
    loading.value
    || sourceFileReading.value
    || sourceSaving.value
    || sourceListRefreshing.value
    || workflowStarting.value
    || readinessChecking.value
    || qaRunning.value
    || remediating.value
    || workflowActionBusy.value
    || pollState.value === 'recovering'
    || sourceOperationError.value
    || sourceListRefreshError.value
    || workflowDataError.value
    || pollError.value
))
  const compactCompletionVisible = computed(() => (
    flowState.value.complete && !completionVisibilityBlocked.value
  ))
  const completionSummaryReady = computed(() => (
    timelineSummary.value.episodeCount > 0
    && timelineSummary.value.trackCount > 0
    && timelineSummary.value.itemCount > 0
    && timelineSummary.value.durationSec > 0
  ))
  const completionTitle = computed(() => {
    if (!completionSummaryReady.value) return '结构处理已完成，交付摘要整理中'
    if (runState.value.mode !== 'production') return '草稿结构已完成'
    return runState.value.productionPlaceholder
      ? '正式流程已结束，媒体产物仍需修复'
      : '正式媒体已生成，交付检查已通过'
  })
  const completionEpisodeCount = computed(() => (
    timelineSummary.value.episodeCount || getDrama()?.episodes?.length || 0
  ))
  const completionPlaceholderCount = computed(() => (
    timelineSummary.value.placeholderItemCount
  ))
  const actualFlowStep = computed(() => (
    flowState.value.activeStep
    || flowState.value.steps[0]
    || {
      id: 'intake',
      number: 1,
      label: '导入素材',
      summary: '',
      status: 'ready',
      statusLabel: '可开始',
    }
  ))
  const inspectedFlowStep = computed(() => (
    flowState.value.steps.find((step) => step.id === selectedFlowStepId.value)
    || actualFlowStep.value
  ))
  const runTagType = computed(() => {
    if (runState.value.productionPlaceholder) return 'danger'
    if (runState.value.status === 'completed') return 'success'
    if (runState.value.status === 'failed') return 'danger'
    if (runState.value.status === 'cancelled') return 'info'
    if (runState.value.status === 'paused') return 'info'
    return 'warning'
  })
  const runProgressStatus = computed(() => {
    if (runState.value.status === 'completed') return 'success'
    if (runState.value.status === 'failed') return 'exception'
    return undefined
  })
  const pollStatusMessage = computed(() => {
    if (!selectedRun.value?.id) return ''
    if (pollState.value === 'recovering') return '正在恢复处理状态轮询…'
    if (pollState.value === 'error') return pollError.value || '处理状态刷新失败，自动轮询已暂停。'
    if (pollState.value === 'polling' && runState.value.active) return '正在自动轮询处理状态。'
    return ''
  })

  return {
    rawSourceUrl,
    sourceUrlValidationMessage,
    hasWebSourceUrl,
    hasSourceInput,
    hasUnsavedSourceInput,
    isWorkflowLaunchBusy,
    sourceOperationActive,
    workflowActionBusy,
    workflowModeShortLabel,
    workflowModeDescription,
    workflowStartButtonLabel,
    sourceUploadBusyReason,
    sourceListRetryReason,
    sourceOperationStatus,
    runState,
    displayedRunError,
    extractionNextStep,
    productionLaunchReason,
    newWorkflowRunReason,
    timelineSummary,
    latestQa,
    displayedQaIssues,
    displayedQaRecommendations,
    qaPresentation,
    baseActionReasons,
    sourceRefreshRecoveryReason,
    actionReasons,
    workflowBusyReason,
    controlActionReasons,
    existingSourceLaunchReason,
    refreshBusyReason,
    canRestartFromLatestSource,
    flowState,
    completionVisibilityBlocked,
    compactCompletionVisible,
    completionSummaryReady,
    completionTitle,
    completionEpisodeCount,
    completionPlaceholderCount,
    actualFlowStep,
    inspectedFlowStep,
    runTagType,
    runProgressStatus,
    pollStatusMessage,
    intakeExtractionNextStep,
  }
}

/** 完成条、步骤条和各阶段卡片的 v-bind 属性袋 */
export function createSourceIntakeWorkspaceBindings({
  completionTitle,
  qaPresentation,
  completionSummaryReady,
  completionEpisodeCount,
  timelineSummary,
  completionPlaceholderCount,
  workflowHistoryExpanded,
  flowState,
  inspectedFlowStep,
  workflowMode,
  workflowModeShortLabel,
  workflowModeDescription,
  isWorkflowLaunchBusy,
  sourceUploadBusyReason,
  readinessChecking,
  productionReadiness,
  sourceUrlValidationMessage,
  sourceFileReading,
  sourceFile,
  selectedFilename,
  sourceOperationStatus,
  sourceOperationError,
  sourceListRefreshError,
  sourceListRetryReason,
  sourceListRefreshing,
  sourceSaving,
  actionReasons,
  workflowStarting,
  startingSourceId,
  workflowStartButtonLabel,
  selectedRun,
  runState,
  runTagType,
  runProgressStatus,
  displayedRunError,
  extractionNextStep,
  controlActionReasons,
  retrying,
  pausing,
  resuming,
  cancelling,
  canRestartFromLatestSource,
  sources,
  existingSourceLaunchReason,
  latestQa,
  qaRunning,
  displayedQaIssues,
  displayedQaRecommendations,
  remediating,
  remediationStatus,
  sourceDetailVisible,
  sourceDetailLoading,
  sourceDetail,
  getDrama,
} = {}) {
  return {
    completionBannerBindings: createSourceIntakeControlBindings({
      completionTitle,
      qaPresentation,
      completionSummaryReady,
      completionEpisodeCount,
      timelineSummary,
      formatDuration,
      completionPlaceholderCount,
      workflowHistoryExpanded,
    }, ['workflowHistoryExpanded']),
    stepperBindings: createSourceIntakeControlBindings({
      flowState,
      inspectedFlowStep,
    }),
    currentStageBindings: createSourceIntakeControlBindings({
      inspectedFlowStep,
    }),
    launchModeBindings: createSourceIntakeControlBindings({
      workflowMode,
      workflowModeShortLabel,
      workflowModeDescription,
      isWorkflowLaunchBusy,
      sourceUploadBusyReason,
      readinessChecking,
      productionReadiness,
    }, ['workflowMode']),
    intakeFormBindings: createSourceIntakeControlBindings({
      sourceTypeOptions: SOURCE_TYPE_OPTIONS,
      sourceUrlValidationMessage,
      sourceFileAccept: SOURCE_FILE_ACCEPT,
      sourceFileReading,
      sourceUploadBusyReason,
      sourceFile,
      selectedFilename,
      sourceIntakeMediaHelp: SOURCE_INTAKE_MEDIA_HELP,
      sourceOperationStatus,
      sourceOperationError,
      sourceListRefreshError,
      sourceListRetryReason,
      sourceListRefreshing,
      sourceSaving,
      actionReasons,
      workflowModeShortLabel,
      workflowStarting,
      startingSourceId,
      workflowStartButtonLabel,
    }),
    processStageBindings: createSourceIntakeControlBindings({
      selectedRun,
      runState,
      runTagType,
      runProgressStatus,
      displayedRunError,
      extractionNextStep,
      formatTime,
      controlActionReasons,
      retrying,
      pausing,
      resuming,
      cancelling,
      canRestartFromLatestSource,
      sources,
      startingSourceId,
      workflowModeShortLabel,
      existingSourceLaunchReason,
    }),
    qaStageBindings: createSourceIntakeControlBindings({
      qaPresentation,
      latestQa,
      qaReason: computed(() => unref(actionReasons)?.qa || ''),
      qaRunning,
      displayedQaIssues,
      displayedQaRecommendations,
    }),
    remediationStageBindings: createSourceIntakeControlBindings({
      latestQa,
      remediateReason: computed(() => unref(actionReasons)?.remediate || ''),
      remediating,
      remediationStatus,
    }),
    deliveryStageBindings: createSourceIntakeControlBindings({
      timelineSummary,
      dramaEpisodeCount: computed(() => getDrama?.()?.episodes?.length || 0),
      formatDuration,
    }),
    sourceDetailBindings: createSourceIntakeControlBindings({
      visible: sourceDetailVisible,
      loading: sourceDetailLoading,
      sourceDetail,
      formatTime,
    }, ['visible']),
  }
}

/** 检查中步骤、完成折叠和剧目切换的 watch 装配 */
export function bindSourceIntakeWorkspaceWatches({
  watch,
  flowState,
  selectedFlowStepId,
  requestedFlowStepFromRoute,
  revealInspectedHistoryIfNeeded,
  route,
  workflowHistoryExpanded,
  props,
  syncDefaults,
  snapshotSession,
  sourceImportController,
  loadData,
  openSourceImportIntent,
} = {}) {
  watch(
    () => flowState.value.activeStepId,
    (_activeStepId, previousActiveStepId) => {
      const nextStepId = resolveInspectedWorkflowStep(flowState.value, {
        selectedStepId: selectedFlowStepId.value,
        previousActiveStepId,
        requestedStepId: requestedFlowStepFromRoute(),
      })
      selectedFlowStepId.value = nextStepId
      revealInspectedHistoryIfNeeded(nextStepId)
    },
    { immediate: true },
  )
  watch(
    () => route.query.step,
    () => {
      const requested = requestedFlowStepFromRoute()
      if (!requested) return
      selectedFlowStepId.value = selectInspectedWorkflowStep(
        flowState.value,
        selectedFlowStepId.value,
        requested,
      )
      revealInspectedHistoryIfNeeded(selectedFlowStepId.value)
    },
  )
  watch(
    () => flowState.value.complete,
    (complete, previousComplete) => {
      if (complete && !previousComplete) workflowHistoryExpanded.value = false
    },
  )
  watch(() => props.drama, syncDefaults, { immediate: true })
  watch(() => props.dramaId, () => {
    snapshotSession.reset()
    sourceImportController.reset()
    loadData()
  })
  watch(() => props.sourceImportIntent, (active) => {
    if (active) openSourceImportIntent()
  })
}
