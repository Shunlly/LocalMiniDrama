import { isRequestCanceled } from './requestError.js'
import { normalizeWorkflowStatus, workflowStepLabel } from './workflowRunStatus.js'

export const SOURCE_WORKFLOW_CANCEL_REASON = '用户已取消处理'
export const SOURCE_WORKFLOW_PAUSE_REASON = '用户已暂停处理'

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

function firstStepWithStatus(run, statuses) {
  const steps = Array.isArray(run?.steps) ? run.steps : []
  const wanted = new Set((statuses || []).map((status) => normalizeWorkflowStatus(status)))
  return steps.find((step) => wanted.has(normalizeWorkflowStatus(step?.status))) || null
}

export function resolveWorkflowRunActiveStep(run) {
  if (run?.activeStep?.step_key) return run.activeStep
  const current = firstStepWithStatus(run, ['processing']) || firstStepWithStatus(run, ['pending'])
  if (current) return current
  const status = normalizeWorkflowStatus(run.status)
  if (
    run?.current_step
    && (status === 'pending' || status === 'processing' || status === 'paused')
  ) {
    return { step_key: run.current_step }
  }
  return null
}

export function resolveWorkflowRunFailedStep(run) {
  if (run?.failedStep?.step_key) return run.failedStep
  const failed = firstStepWithStatus(run, ['failed'])
  if (failed) return failed
  if (normalizeWorkflowStatus(run?.status) === 'failed' && run.current_step) return { step_key: run.current_step }
  return null
}

function labeledRunStep(step, run) {
  if (!step) return ''
  return workflowStepLabel(step, run) || workflowStepLabel(step.step_key || '', run)
}

export function resolveInspectedWorkflowStep(flowState, {
  selectedStepId = '',
  previousActiveStepId = '',
  requestedStepId = '',
} = {}) {
  const steps = Array.isArray(flowState?.steps) ? flowState.steps : []
  const activeStepId = flowState?.activeStepId || steps[0]?.id || ''
  if (requestedStepId) {
    const requested = selectInspectedWorkflowStep(flowState, '', requestedStepId)
    if (requested === requestedStepId) return requested
  }
  if (
    selectedStepId
    && previousActiveStepId
    && selectedStepId !== previousActiveStepId
  ) {
    return selectInspectedWorkflowStep(flowState, selectedStepId, selectedStepId) || activeStepId
  }
  return activeStepId
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
    const failedStep = resolveWorkflowRunFailedStep(run)
    const activeStep = resolveWorkflowRunActiveStep(run)
    const runStatus = normalizeWorkflowStatus(run.status)
    if (runStatus === 'failed') return `流程失败：${labeledRunStep(failedStep, run) || '请重试'}`
    if (runStatus === 'cancelled') return '上次流程已取消，可重新启动'
    if (runStatus === 'paused') return '流程已暂停，等待恢复'
    if (activeStep?.step_key) return `当前：${labeledRunStep(activeStep, run)}`
    if (runStatus === 'completed') return '最近一次流程已完成'
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
  const runStatus = normalizeWorkflowStatus(run?.status)
  const runCompleted = runStatus === 'completed'
  const runActive = runStatus === 'pending' || runStatus === 'processing' || runStatus === 'paused'
  const runFailed = runStatus === 'failed'
  const currentQa = qaBelongsToRun(qa, run) ? qa : null
  const hasQa = Boolean(currentQa)
  const qaPassed = hasQa && Boolean(currentQa.passed)
  const qaFailed = hasQa && !qaPassed
  const deliveryReady = timelineEpisodes > 0 || episodes > 0

  const statuses = {
    intake: sources > 0 ? 'done' : hasSourceInput ? 'active' : 'ready',
    process: runCompleted ? 'done' : runFailed ? 'error' : runActive ? 'active' : sources > 0 ? 'ready' : 'pending',
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
  if (normalizeWorkflowStatus(runState.status) === 'paused') return '当前处理已暂停，请先恢复或取消后再启动新流程。'
  return ''
}

export function getSourceWorkflowActionReasons({ hasSourceInput, runState, qa } = {}) {
  const state = runState || {}
  const status = normalizeWorkflowStatus(state.status)
  const canRetry = Boolean(state.canRetry) || status === 'failed'
  const canPause = Boolean(state.canPause) || Boolean(state.active) || status === 'pending' || status === 'processing'
  const canResume = Boolean(state.canResume) || status === 'paused'
  const canCancel = Boolean(state.canCancel) || canPause || canResume
  const report = qa || {}
  const hasCurrentQa = qaBelongsToRun(report, state)
  const sourceInputReason = hasSourceInput
    ? ''
    : '请先粘贴网页 URL、选择本地文件或输入原始素材。'

  let qaReason = ''
  if (!hasWorkflowId(state.id)) qaReason = '请先启动并完成素材处理。'
  else if (state.active) qaReason = '素材处理仍在运行，完成后才能执行 QA。'
  else if (status === 'paused') qaReason = '请先恢复并完成当前处理。'
  else if (status === 'failed') qaReason = '请先重试失败步骤并完成处理。'
  else if (status === 'cancelled') qaReason = '当前处理已取消，请重新启动处理。'
  else if (status !== 'completed') qaReason = '当前处理尚未完成。'

  let remediationReason = ''
  if (!hasWorkflowId(state.id)) remediationReason = '请先启动并完成素材处理。'
  else if (state.active) remediationReason = '素材处理仍在运行，完成后才能自动修复。'
  else if (status === 'paused') remediationReason = '请先恢复并完成当前处理。'
  else if (status === 'failed') remediationReason = '请先重试失败步骤并完成处理。'
  else if (status === 'cancelled') remediationReason = '当前处理已取消，请重新启动处理。'
  else if (status !== 'completed') remediationReason = '当前处理尚未完成。'
  else if (!hasCurrentQa) remediationReason = '请先执行当前运行的 QA 审计。'
  else if (report.passed) remediationReason = 'QA 已通过，无需自动修复。'
  else if (!report.canRemediate) remediationReason = '当前问题没有可自动执行的修复动作，请按 QA 建议人工处理。'

  return {
    import: sourceInputReason,
    start: getNewWorkflowRunReason(state) || sourceInputReason,
    qa: qaReason,
    remediate: remediationReason,
    retry: canRetry ? '' : !state.id ? '暂无可重试的处理记录。' : '仅失败的处理可以重试。',
    pause: canPause ? '' : !state.id ? '暂无运行中的处理。' : '仅运行中的处理可以暂停。',
    resume: canResume ? '' : !state.id ? '暂无已暂停的处理。' : '仅已暂停的处理可以恢复。',
    cancel: canCancel ? '' : !state.id ? '暂无运行中的处理。' : '仅运行中的处理可以取消。',
  }
}

export function getSourceWorkflowBusyReason({ retrying, pausing, resuming, cancelling } = {}) {
  if (retrying) return '正在提交重试，请稍候。'
  if (pausing) return '正在暂停处理，请稍候。'
  if (resuming) return '正在恢复处理，请稍候。'
  if (cancelling) return '正在取消处理，请稍候。'
  return ''
}

export const SOURCE_AUTO_EXTRACTION_UNSUPPORTED_MESSAGE = 'PDF、图片、音频和视频暂不支持自动抽取，请改为导入文本或网页。'

const DEFERRED_AUTO_EXTRACTION_EXTENSIONS = new Set([
  '.pdf',
  '.png', '.jpg', '.jpeg', '.webp', '.gif',
  '.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg', '.oga',
  '.mp4', '.mov', '.mkv', '.avi', '.webm', '.ogv',
])

const ENGLISH_AUTO_EXTRACTION_FAILURE_PATTERN = /ocr|tesseract|transcription|transcribe|extractable text|extracted video audio|unsupported source intake file type|unsupported or invalid source file|the pdf |extracted pdf text|audio sent for transcription|uploaded video is /i

export function sourceFileExtension(value) {
  const name = String(value || '').trim().split(/[\\/]/).pop() || ''
  const index = name.lastIndexOf('.')
  return index >= 0 ? name.slice(index).toLowerCase() : ''
}

function sourceNameFromInput(input) {
  if (!input) return ''
  if (typeof input === 'string') return input.trim()
  return String(input.name || '').trim()
}

function sourcePathnameFromInput(input) {
  const raw = sourceNameFromInput(input)
  if (!raw) return ''
  try {
    if (/^https?:\/\//i.test(raw)) return decodeURIComponent(new URL(raw).pathname || '')
  } catch (_) {}
  return raw
}

export function isDeferredAutoExtractionSource(input) {
  const mime = String(input && typeof input === 'object' ? input.type || '' : '').toLowerCase()
  if (mime === 'application/pdf' || mime.startsWith('image/') || mime.startsWith('audio/') || mime.startsWith('video/')) {
    return true
  }
  return DEFERRED_AUTO_EXTRACTION_EXTENSIONS.has(sourceFileExtension(sourcePathnameFromInput(input)))
}

export function localizeSourceIntakeFailure(error, context = {}) {
  const message = String(error?.message || error || '').trim()
  const hint = context.file || context.filename || context.sourceUrl || ''
  if (hint && isDeferredAutoExtractionSource(hint)) return SOURCE_AUTO_EXTRACTION_UNSUPPORTED_MESSAGE
  if (ENGLISH_AUTO_EXTRACTION_FAILURE_PATTERN.test(message)) return SOURCE_AUTO_EXTRACTION_UNSUPPORTED_MESSAGE
  if (isRequestCanceled(error)) return ''
  if (/user cancelled from source intake panel/i.test(message)) return SOURCE_WORKFLOW_CANCEL_REASON
  if (/user paused from source intake panel/i.test(message)) return SOURCE_WORKFLOW_PAUSE_REASON
  return message
}
