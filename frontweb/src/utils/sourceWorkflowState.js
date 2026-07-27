import { workflowStepLabel } from './workflowRunStatus.js'

const FLOW_STEPS = [
  { id: 'intake', label: '导入素材' },
  { id: 'process', label: '启动处理' },
  { id: 'qa', label: 'QA' },
  { id: 'remediation', label: '修复' },
  { id: 'delivery', label: '剧集 / 时间线' },
]

function statusLabel(status) {
  const labels = {
    done: '已完成',
    active: '进行中',
    ready: '可开始',
    error: '需处理',
    blocked: '需人工处理',
    pending: '未开始',
  }
  return labels[status] || status
}

function buildStepSummary(stepId, context) {
  const {
    sources,
    hasSourceInput,
    run,
    qa,
    timeline,
    episodes,
  } = context

  if (stepId === 'intake') {
    if (sources > 0) return `${sources} 份素材已导入`
    if (hasSourceInput) return '当前输入已就绪，保存后可进入处理'
    return '等待网页、文件或文本素材'
  }

  if (stepId === 'process') {
    if (!run?.id) return sources > 0 ? '素材已就绪，可启动处理' : '需先导入素材'
    if (run.status === 'failed') return `流程失败：${workflowStepLabel(run.failedStep?.step_key || '') || '请重试'}`
    if (run.status === 'cancelled') return '上次流程已取消'
    if (run.status === 'paused') return '流程已暂停，等待恢复'
    if (run.activeStep?.step_key) return `当前：${workflowStepLabel(run.activeStep.step_key)}`
    if (run.status === 'completed') return '最近一次流程已完成'
    return '流程状态已记录'
  }

  if (stepId === 'qa') {
    if (!qa?.id) return run?.status === 'completed' ? '流程已完成，可执行 QA' : '等待流程完成'
    const qaScope = (qa.mode || run?.mode) === 'production' ? '正式交付检查' : '草稿结构检查'
    if (qa.passed) return `${qaScope} 通过，评分 ${qa.score}`
    return `${qaScope} 未通过，${qa.issueCount} 个问题待处理`
  }

  if (stepId === 'remediation') {
    if (!qa?.id) return '等待 QA 结果'
    if (qa.passed) return '无需修复'
    if (qa.canRemediate) return `${qa.remediationActions.length} 项可自动修复`
    return '需按 QA 建议人工处理'
  }

  if (timeline?.episodeCount) {
    return `${timeline.episodeCount} 集 / ${timeline.trackCount} 轨`
  }
  if (episodes > 0) return `${episodes} 集已生成，等待时间线`
  return '等待前序步骤完成'
}

function buildSourceEmptyState({ sourceCount, hasSourceInput, actionReasons }) {
  if (sourceCount > 0) return null
  return {
    title: '还没有已导入素材',
    description: hasSourceInput
      ? '当前输入尚未保存。导入成功后，这里会显示素材记录并可直接启动处理。'
      : '保存成功的网页、文件和文本素材会显示在这里，方便回看和重复启动流程。',
    primaryAction: {
      id: 'import',
      label: '仅导入素材',
      disabledReason: actionReasons.import,
    },
    secondaryAction: {
      id: 'start',
      label: '导入并启动处理',
      disabledReason: actionReasons.start,
    },
  }
}

function hasWorkflowId(value) {
  return value !== undefined && value !== null && value !== ''
}

function qaBelongsToRun(qa, run) {
  return Boolean(qa?.id) && hasWorkflowId(run?.id) && qa.run_id === run.id
}

export function buildSourceWorkflowState({ sourceCount, hasSourceInput, run, qa, timeline, episodeCount, actionReasons } = {}) {
  const sources = Math.max(0, Number(sourceCount) || 0)
  const episodes = Math.max(0, Number(episodeCount) || 0)
  const timelineEpisodes = Math.max(0, Number(timeline?.episodeCount) || 0)
  const runStatus = run?.status || ''
  const runCompleted = runStatus === 'completed'
  const runActive = runStatus === 'pending' || runStatus === 'processing' || runStatus === 'paused'
  const runError = runStatus === 'failed' || runStatus === 'cancelled'
  const currentQa = qaBelongsToRun(qa, run) ? qa : null
  const hasQa = Boolean(currentQa)
  const qaPassed = hasQa && Boolean(currentQa.passed)
  const qaFailed = hasQa && !qaPassed
  const deliveryReady = timelineEpisodes > 0 || episodes > 0

  const statuses = {
    intake: sources > 0 ? 'done' : hasSourceInput ? 'active' : 'ready',
    process: runCompleted ? 'done' : runError ? 'error' : runActive ? 'active' : sources > 0 ? 'ready' : 'pending',
    qa: qaPassed ? 'done' : qaFailed ? 'error' : runCompleted ? 'ready' : 'pending',
    remediation: !runCompleted ? 'pending' : qaPassed ? 'done' : qaFailed && currentQa.canRemediate ? 'active' : qaFailed ? 'blocked' : 'pending',
    delivery: deliveryReady ? 'done' : qaPassed || runCompleted ? 'ready' : 'pending',
  }

  const context = { sources, hasSourceInput, run, qa: currentQa, timeline, episodes }
  const steps = FLOW_STEPS.map((step, index) => ({
    ...step,
    number: index + 1,
    status: statuses[step.id],
    statusLabel: statusLabel(statuses[step.id]),
    summary: buildStepSummary(step.id, context),
  }))

  const activeStep = steps.find((step) => step.status === 'active')
    || steps.find((step) => step.status === 'error' || step.status === 'blocked')
    || steps.find((step) => step.status === 'ready')
    || steps[steps.length - 1]

  return {
    steps,
    activeStep,
    activeStepId: activeStep.id,
    complete: steps.every((step) => step.status === 'done'),
    sourceEmptyState: buildSourceEmptyState({
      sourceCount: sources,
      hasSourceInput,
      actionReasons: actionReasons || {},
    }),
  }
}

export function selectInspectedWorkflowStep(flowState, currentStepId, requestedStepId) {
  const steps = Array.isArray(flowState?.steps) ? flowState.steps : []
  return steps.some((step) => step.id === requestedStepId) ? requestedStepId : currentStepId
}

export function getNewWorkflowRunReason(runState = {}) {
  if (runState.active) return '当前已有处理流程运行中，请等待完成或先取消。'
  if (runState.status === 'paused') return '当前处理已暂停，请先恢复或取消后再启动新流程。'
  return ''
}

export function getSourceWorkflowActionReasons({ hasSourceInput, runState, qa } = {}) {
  const state = runState || {}
  const report = qa || {}
  const hasCurrentQa = qaBelongsToRun(report, state)
  const sourceInputReason = hasSourceInput
    ? ''
    : '请先粘贴网页 URL、选择本地文件或输入原始素材。'

  let qaReason = ''
  if (!hasWorkflowId(state.id)) qaReason = '请先启动并完成素材处理。'
  else if (state.active) qaReason = '素材处理仍在运行，完成后才能执行 QA。'
  else if (state.status === 'paused') qaReason = '请先恢复并完成当前处理。'
  else if (state.status === 'failed') qaReason = '请先重试失败步骤并完成处理。'
  else if (state.status === 'cancelled') qaReason = '当前处理已取消，请重新启动处理。'
  else if (state.status !== 'completed') qaReason = '当前处理尚未完成。'

  let remediationReason = ''
  if (!hasWorkflowId(state.id)) remediationReason = '请先启动并完成素材处理。'
  else if (state.active) remediationReason = '素材处理仍在运行，完成后才能自动修复。'
  else if (state.status === 'paused') remediationReason = '请先恢复并完成当前处理。'
  else if (state.status === 'failed') remediationReason = '请先重试失败步骤并完成处理。'
  else if (state.status === 'cancelled') remediationReason = '当前处理已取消，请重新启动处理。'
  else if (state.status !== 'completed') remediationReason = '当前处理尚未完成。'
  else if (!hasCurrentQa) remediationReason = '请先执行当前运行的 QA 审计。'
  else if (report.passed) remediationReason = 'QA 已通过，无需自动修复。'
  else if (!report.canRemediate) remediationReason = '当前问题没有可自动执行的修复动作，请按 QA 建议人工处理。'

  return {
    import: sourceInputReason,
    start: getNewWorkflowRunReason(state) || sourceInputReason,
    qa: qaReason,
    remediate: remediationReason,
    retry: state.canRetry ? '' : !state.id ? '暂无可重试的处理记录。' : '仅失败的处理可以重试。',
    pause: state.canPause ? '' : !state.id ? '暂无运行中的处理。' : '仅运行中的处理可以暂停。',
    resume: state.canResume ? '' : !state.id ? '暂无已暂停的处理。' : '仅已暂停的处理可以恢复。',
    cancel: state.canCancel ? '' : !state.id ? '暂无运行中的处理。' : '仅运行中的处理可以取消。',
  }
}
