import { summarizeProviderCosts } from './providerPricing.js'

const STATUS_LABELS = {
  pending: '等待中',
  processing: '运行中',
  paused: '已暂停',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
}

const STEP_LABELS = {
  source_intake: '素材导入',
  adaptation_plan: '改编计划',
  apply_episodes: '写入分集',
  asset_bible: '资产设定',
  storyboard_draft: '分镜草稿',
  image_generation: '分镜生图',
  video_generation: '分镜视频',
  audio_generation: '对白与旁白配音',
  timeline_plan: '时间线',
  post_composite: '成片合成',
  qa_audit: 'QA 审计',
}

export function workflowTypeLabel(value) {
  return String(value || '').trim().toLowerCase().startsWith('novel2anime')
    ? '故事转动画'
    : '内容制作流程'
}

const MEDIA_STEP_KEYS = new Set([
  'image_generation',
  'video_generation',
  'audio_generation',
  'post_composite',
])

function parseObject(value) {
  if (!value) return {}
  if (typeof value === 'object') return value
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch (_) {
    return {}
  }
}

function runMode(run) {
  const input = parseObject(run?.input_json)
  return input.qa_mode === 'production' || input.mode === 'production' || run?.qa_mode === 'production'
    ? 'production'
    : 'draft'
}

function isMockMetadata(value, key = '') {
  if (value == null) return false
  if (Array.isArray(value)) return value.some((item) => isMockMetadata(item, key))
  if (typeof value === 'object') {
    return Object.entries(value).some(([childKey, child]) => isMockMetadata(child, childKey))
  }
  if (typeof value === 'boolean') return value && /placeholder|mock/i.test(key)
  if (typeof value !== 'string') return false
  const text = value.trim()
  if (/^(?:mock|placeholder):\/\//i.test(text)) return true
  return /provider|mode|kind|source/i.test(key) && /^(?:mock|placeholder)(?:-|$)/i.test(text)
}

function hasProductionMetadata(value, key = '') {
  if (value == null) return false
  if (Array.isArray(value)) return value.some((item) => hasProductionMetadata(item, key))
  if (typeof value === 'object') {
    return Object.entries(value).some(([childKey, child]) => hasProductionMetadata(child, childKey))
  }
  if (typeof value !== 'string') return false
  const text = value.trim().toLowerCase()
  if (/mode|qa_mode/i.test(key) && text === 'production') return true
  return /provider_name|provider/i.test(key) && Boolean(text) && !/^(?:mock|placeholder)(?:-|$)/i.test(text)
}

function outputIsReuseOnly(output) {
  let reused = 0
  let created = 0
  for (const [key, raw] of Object.entries(output || {})) {
    const value = Number(raw) || 0
    if (/_reused$/i.test(key)) reused += value
    if (/_created$/i.test(key)) created += value
  }
  return reused > 0 && created === 0
}

function stepMetadata(step) {
  return {
    output: parseObject(step?.output_json),
    providers: Array.isArray(step?.provider_invocations)
      ? step.provider_invocations
      : Array.isArray(step?.providers) ? step.providers : [],
    provider: step?.provider || null,
  }
}

export function classifyWorkflowStep(step, run) {
  const stepKey = typeof step === 'string' ? step : step?.step_key
  if (!MEDIA_STEP_KEYS.has(stepKey)) return 'standard'
  if (typeof step === 'string' && !run) return 'unknown'

  const metadata = stepMetadata(typeof step === 'object' ? step : null)
  if (isMockMetadata(metadata)) return runMode(run) === 'production' ? 'production_placeholder' : 'draft_placeholder'
  if (hasProductionMetadata(metadata)) {
    return outputIsReuseOnly(metadata.output) ? 'production_reused' : 'production_output'
  }
  return runMode(run) === 'production' ? 'production_planned' : 'draft_placeholder'
}

export function normalizeWorkflowRun(run) {
  const steps = Array.isArray(run?.steps) ? run.steps : []
  const mode = runMode(run)
  const isNovel2Anime = String(run?.type || '').startsWith('novel2anime')
  const stepKinds = steps.map((step) => ({ step, kind: classifyWorkflowStep(step, run) }))
  const failedStep = steps.find((step) => step.status === 'failed') || null
  const activeStep = steps.find((step) => step.status === 'processing') || steps.find((step) => step.status === 'pending') || null
  const completedCount = steps.filter((step) => step.status === 'completed').length
  const totalCount = steps.length
  const active = run?.status === 'pending' || run?.status === 'processing'
  const costSummary = summarizeProviderCosts(run?.provider_invocations)
  const costDigits = costSummary.amount > 0 && costSummary.amount < 0.01 ? 4 : 2
  const progress = Math.max(0, Math.min(100, Number(run?.progress) || (totalCount ? Math.round((completedCount / totalCount) * 100) : 0)))
  const hasPlaceholderOutputs = stepKinds.some(({ step, kind }) => (
    step.status === 'completed' && (kind === 'draft_placeholder' || kind === 'production_placeholder')
  ))
  const productionPlaceholder = stepKinds.some(({ kind }) => kind === 'production_placeholder')
  const novel2animePlaceholder = isNovel2Anime && mode === 'draft' && stepKinds.some(({ kind }) => kind === 'draft_placeholder')
  const statusLabel = STATUS_LABELS[run?.status] || run?.status || '等待中'
  let label = statusLabel
  if (isNovel2Anime) {
    label = productionPlaceholder
      ? '正式制作 · 检测到占位产物'
      : `${mode === 'production' ? '正式制作' : '草稿预演'} · ${statusLabel}`
  }

  return {
    id: run?.id || '',
    status: run?.status || 'pending',
    label,
    mode,
    modeLabel: mode === 'production' ? '正式制作' : '草稿预演',
    novel2animePlaceholder,
    hasPlaceholderOutputs,
    productionPlaceholder,
    mediaNotice: productionPlaceholder
      ? '正式制作检测到占位媒体产物，请检查对应步骤后重试。'
      : novel2animePlaceholder
        ? '草稿预演使用占位媒体，不作为正式成片交付。'
        : '',
    active,
    canRetry: run?.status === 'failed',
    canPause: active,
    canResume: run?.status === 'paused',
    canCancel: active || run?.status === 'paused',
    progress,
    failedStep,
    activeStep,
    completedCount,
    totalCount,
    costSummary,
    costLabel: costSummary.knownCount
      ? `预估成本 $${costSummary.amount.toFixed(costDigits)}`
      : '',
  }
}

export function workflowStepLabel(stepOrKey, run) {
  const stepKey = typeof stepOrKey === 'string' ? stepOrKey : stepOrKey?.step_key
  const label = STEP_LABELS[stepKey] || stepKey || ''
  if (!MEDIA_STEP_KEYS.has(stepKey)) return label

  const kind = classifyWorkflowStep(stepOrKey, run)
  const suffixes = {
    draft_placeholder: '（草稿占位）',
    production_placeholder: '（异常占位）',
    production_planned: '（正式制作）',
    production_output: '（正式产出）',
    production_reused: '（复用正式产物）',
  }
  return `${label}${suffixes[kind] || ''}`
}

export function workflowStepStatusLabel(status) {
  return STATUS_LABELS[status] || status || '等待中'
}
