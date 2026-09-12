import { isRequestCanceled, isRequestTimeout, isSafeUserFacingMessage } from './requestError.js'
import { toUserFacingError } from './userFacingError.js'
import { normalizeWorkflowStatus, workflowStepLabel } from './workflowRunStatus.js'

export const SOURCE_WORKFLOW_CANCEL_REASON = '用户已取消处理'
export const SOURCE_WORKFLOW_PAUSE_REASON = '用户已暂停处理'
export const SOURCE_WORKFLOW_FAILURE_FALLBACK = '处理失败，请稍后重试。'

const FLOW_STEPS = [
  { id: 'intake', label: '导入素材' },
  { id: 'process', label: '启动处理' },
  { id: 'qa', label: '质量检查' },
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
  return labels[status] || '未知状态'
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
  const label = workflowStepLabel(step, run) || workflowStepLabel(step.step_key || '', run)
  return /[一-鿿]/.test(label) ? label : ''
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
    if (!qa?.id) return normalizeWorkflowStatus(run?.status) === 'completed' ? '流程已完成，可执行质量检查' : '等待流程完成'
    const qaScope = (qa.mode || run?.mode) === 'production' ? '正式交付检查' : '草稿结构检查'
    if (qa.passed) return `${qaScope} 通过，评分 ${qa.score}`
    return `${qaScope} 未通过，${qa.issueCount} 个问题待处理`
  }

  if (stepId === 'remediation') {
    if (!qa?.id) return '等待质量检查结果'
    if (qa.passed) return '无需修复'
    if (qa.canRemediate) return `${qa.remediationActions.length} 项可自动修复`
    return '需按质量检查建议人工处理'
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
      ? SOURCE_INTAKE_MEDIA_HELP + '当前输入尚未保存。导入成功后，这里会显示素材记录并可直接启动处理。'
      : SOURCE_INTAKE_MEDIA_HELP + '保存成功的网页、文件和文本素材会显示在这里，方便回看和重复启动流程。',
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
  if (!hasWorkflowId(runState?.id)) return ''
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
  else if (state.active) qaReason = '素材处理仍在运行，完成后才能执行质量检查。'
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
  else if (!hasCurrentQa) remediationReason = '请先执行当前运行的质量检查。'
  else if (report.passed) remediationReason = '质量检查已通过，无需自动修复。'
  else if (!report.canRemediate) remediationReason = '当前问题没有可自动执行的修复动作，请按质量检查建议人工处理。'

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

export const SOURCE_INTAKE_MEDIA_HELP = '文本可直接导入；PDF/图片需要图片识别，音视频需要语音转写。可先用本机 Tesseract，或在 AI 配置中添加对应服务。'
export const SOURCE_FILE_FORMAT_UNSUPPORTED_MESSAGE = '不支持此文件格式。请选择 txt、md、csv、tsv、srt、vtt、ass、json，或 PDF、图片、音频、视频文件。'
export const SOURCE_MEDIA_URL_UPLOAD_HINT = '网页 URL 仅支持公开文本或 HTML 页面。PDF、图片、音频和视频请选择本地文件上传。'
export const SOURCE_OCR_CONFIG_GUIDANCE = '图片识别失败。请到「AI 配置」添加「图片识别」服务，或先使用本机 Tesseract。'
export const SOURCE_TRANSCRIPTION_CONFIG_GUIDANCE = '语音转写失败。请到「AI 配置」添加「语音转写」服务。'
export const SOURCE_MEDIA_EXTRACTION_CONFIG_GUIDANCE = '自动抽取失败。请到「AI 配置」添加「图片识别」或「语音转写」服务，PDF/图片也可先使用本机 Tesseract。'
export const SOURCE_OCR_TIMEOUT_GUIDANCE = '图片识别超时。请到「AI 配置」检查「图片识别」服务后重试。'
export const SOURCE_TRANSCRIPTION_TIMEOUT_GUIDANCE = '语音转写超时。请到「AI 配置」检查「语音转写」服务后重试。'
export const SOURCE_MEDIA_EXTRACTION_TIMEOUT_GUIDANCE = '自动抽取超时。请到「AI 配置」检查「图片识别」或「语音转写」服务后重试。'
export const SOURCE_OCR_NEXT_STEP_LABEL = '去「AI 配置」添加图片识别'
export const SOURCE_TRANSCRIPTION_NEXT_STEP_LABEL = '去「AI 配置」添加语音转写'
export const SOURCE_MEDIA_EXTRACTION_NEXT_STEP_LABEL = '去「AI 配置」添加对应服务'
export const SOURCE_OCR_LOCAL_NEXT_STEP_HINT = '也可先安装本机 Tesseract。'

export const TEXT_SOURCE_FILE_EXTENSIONS = Object.freeze([
  '.txt', '.md', '.csv', '.tsv', '.srt', '.vtt', '.ass', '.json',
])
export const MEDIA_AUTO_EXTRACTION_EXTENSIONS = Object.freeze([
  '.pdf',
  '.png', '.jpg', '.jpeg', '.webp', '.gif',
  '.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg', '.oga',
  '.mp4', '.mov', '.mkv', '.avi', '.webm', '.ogv',
])

const IMAGE_OR_PDF_EXTENSION_SET = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.gif'])
const AUDIO_VIDEO_EXTENSION_SET = new Set([
  '.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg', '.oga',
  '.mp4', '.mov', '.mkv', '.avi', '.webm', '.ogv',
])
const MEDIA_AUTO_EXTRACTION_EXTENSION_SET = new Set(MEDIA_AUTO_EXTRACTION_EXTENSIONS)

const SOURCE_FORMAT_ENGLISH_FAILURE_PATTERN = /unsupported source intake file type|unsupported or invalid source file/i
const OCR_ENGLISH_FAILURE_PATTERN = /\bocr\b|tesseract|extractable text|extracted pdf text/i
const TRANSCRIPTION_ENGLISH_FAILURE_PATTERN = /whisper|speech[- ]to[- ]text|transcription|transcribe|extracted video audio|audio sent for transcription|uploaded video is /i
const NETWORK_ENGLISH_FAILURE_PATTERN = /failed to fetch|fetch failed|network error|load failed/i

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

function mediaExtractionKind(input) {
  if (!input) return ''
  const mime = String(input && typeof input === 'object' ? input.type || '' : '').toLowerCase()
  const ext = sourceFileExtension(sourcePathnameFromInput(input))
  if (mime === 'application/pdf' || mime.startsWith('image/') || IMAGE_OR_PDF_EXTENSION_SET.has(ext)) return 'ocr'
  if (mime.startsWith('audio/') || mime.startsWith('video/') || AUDIO_VIDEO_EXTENSION_SET.has(ext)) return 'transcription'
  return ''
}

function mediaConfigGuidance(kind) {
  if (kind === 'ocr') return SOURCE_OCR_CONFIG_GUIDANCE
  if (kind === 'transcription') return SOURCE_TRANSCRIPTION_CONFIG_GUIDANCE
  return SOURCE_MEDIA_EXTRACTION_CONFIG_GUIDANCE
}

function mediaTimeoutGuidance(kind) {
  if (kind === 'ocr') return SOURCE_OCR_TIMEOUT_GUIDANCE
  if (kind === 'transcription') return SOURCE_TRANSCRIPTION_TIMEOUT_GUIDANCE
  return SOURCE_MEDIA_EXTRACTION_TIMEOUT_GUIDANCE
}

function hasInternalServiceToken(text) {
  return /service_type\s*=/i.test(text) || /\b(drama_id|source_id|asset_id)\b/i.test(text)
}

function readIntakeFailureTexts(error) {
  if (typeof error === 'string') return [error.trim()].filter(Boolean)
  const texts = []
  const backend = String(error?.response?.data?.error?.message || '').trim()
  const message = String(error?.message || '').trim()
  if (backend) texts.push(backend)
  if (message && message !== backend) texts.push(message)
  return texts
}

/** 识别需要图片识别或语音转写的 PDF/图片/音视频，不再作为前端拦截条件。 */
export function isDeferredAutoExtractionSource(input) {
  const mime = String(input && typeof input === 'object' ? input.type || '' : '').toLowerCase()
  if (mime === 'application/pdf' || mime.startsWith('image/') || mime.startsWith('audio/') || mime.startsWith('video/')) {
    return true
  }
  return MEDIA_AUTO_EXTRACTION_EXTENSION_SET.has(sourceFileExtension(sourcePathnameFromInput(input)))
}

const NON_EXTRACTION_NEXT_STEP_PATTERN = /单个素材文件最大 20MB|素材文件为空|读取文本文件失败|暂时无法检查正式制作能力|素材已导入，但处理流程未启动|正式制作条件未满足|尚未完成正式制作能力检查|素材列表加载失败/

function extractionKindFromFailureText(text) {
  const hasTranscription = TRANSCRIPTION_ENGLISH_FAILURE_PATTERN.test(text) || text.includes('语音转写')
  const hasOcr = OCR_ENGLISH_FAILURE_PATTERN.test(text) || text.includes('图片识别') || text.includes('本机 Tesseract')
  if (hasTranscription && hasOcr) return 'media'
  if (hasTranscription) return 'transcription'
  if (hasOcr) return 'ocr'
  return ''
}

function shouldOfferExtractionNextStep(text) {
  if (!text) return false
  if (text === SOURCE_FILE_FORMAT_UNSUPPORTED_MESSAGE || text === SOURCE_MEDIA_URL_UPLOAD_HINT) return false
  if (SOURCE_FORMAT_ENGLISH_FAILURE_PATTERN.test(text)) return false
  if (NON_EXTRACTION_NEXT_STEP_PATTERN.test(text)) return false
  if (text === SOURCE_WORKFLOW_CANCEL_REASON || text === SOURCE_WORKFLOW_PAUSE_REASON) return false
  return true
}

function buildSourceIntakeExtractionNextStep(kind) {
  if (kind === 'ocr') {
    return {
      kind: 'ocr',
      serviceType: 'ocr',
      actionLabel: SOURCE_OCR_NEXT_STEP_LABEL,
      extraHint: SOURCE_OCR_LOCAL_NEXT_STEP_HINT,
    }
  }
  if (kind === 'transcription') {
    return {
      kind: 'transcription',
      serviceType: 'transcription',
      actionLabel: SOURCE_TRANSCRIPTION_NEXT_STEP_LABEL,
      extraHint: '',
    }
  }
  if (kind === 'media') {
    return {
      kind: 'media',
      serviceType: '',
      actionLabel: SOURCE_MEDIA_EXTRACTION_NEXT_STEP_LABEL,
      extraHint: SOURCE_OCR_LOCAL_NEXT_STEP_HINT,
    }
  }
  return null
}

export function resolveSourceIntakeExtractionNextStep(error, context = {}) {
  if (isRequestCanceled(error)) return null
  const hint = context.file || context.filename || context.sourceUrl || ''
  const displayed = String(context.message || '').trim()
  const texts = readIntakeFailureTexts(error)
  if (displayed && !texts.includes(displayed)) texts.push(displayed)
  const combined = texts.join('\n')
  if (!combined) return null
  if (!shouldOfferExtractionNextStep(combined)) return null
  const kind = mediaExtractionKind(hint) || extractionKindFromFailureText(combined)
  return buildSourceIntakeExtractionNextStep(kind)
}

export function extractionConfigServiceTypeFromMessage(message, context = {}) {
  return resolveSourceIntakeExtractionNextStep(message, context)?.serviceType || ''
}

export function localizeSourceIntakeFailure(error, context = {}) {
  const hint = context.file || context.filename || context.sourceUrl || ''
  const kind = mediaExtractionKind(hint)
  if (isRequestTimeout(error)) return mediaTimeoutGuidance(kind)
  if (isRequestCanceled(error)) return ''
  const texts = readIntakeFailureTexts(error)
  if (!texts.length) return ''

  for (const text of texts) {
    if (/user cancelled from source intake panel/i.test(text)) return SOURCE_WORKFLOW_CANCEL_REASON
    if (/user paused from source intake panel/i.test(text)) return SOURCE_WORKFLOW_PAUSE_REASON
  }

  for (const text of texts) {
    if (isSafeUserFacingMessage(text) && !hasInternalServiceToken(text)) return text
  }

  const combined = texts.join('\n')

  if (SOURCE_FORMAT_ENGLISH_FAILURE_PATTERN.test(combined)) return SOURCE_FILE_FORMAT_UNSUPPORTED_MESSAGE
  if (TRANSCRIPTION_ENGLISH_FAILURE_PATTERN.test(combined)) return SOURCE_TRANSCRIPTION_CONFIG_GUIDANCE
  if (OCR_ENGLISH_FAILURE_PATTERN.test(combined)) return SOURCE_OCR_CONFIG_GUIDANCE
  if (NETWORK_ENGLISH_FAILURE_PATTERN.test(combined)) return mediaConfigGuidance(kind)
  return toUserFacingError(error, SOURCE_WORKFLOW_FAILURE_FALLBACK)
}
