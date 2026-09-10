import { canvasUserError } from '@/composables/useCanvasUserError'
import { taskAPI } from '@/api/task'
import { imagesAPI } from '@/api/images'
import { videosAPI } from '@/api/videos'
import { aiAPI } from '@/api/ai'
import { storyboardsAPI } from '@/api/storyboards'
import request from '@/utils/request'
import { isRequestTimeout } from '@/utils/requestError'
import { storyboardImageUrl } from '@/utils/mediaUrl'
import {
  DEFAULT_PIPELINE,
  findStoryboardInDrama,
  getDramaGenerationOptions,
  toAbsoluteMediaUrl,
} from '@/utils/canvasWorkflow'
import {
  dramaUsesFirstLastFrame,
  imageRecordUrl,
  resolveSbFirstImageRecord,
  resolveSbMainImageRecord,
  sbVideoFirstLastUrls,
} from '@/utils/storyboardMedia'
import {
  buildStoryboardVideoPrompt,
  buildStoryboardVideoRequest,
  collectStoryboardReferenceUrls,
  videoConfigSupportsGridReference,
  videoConfigSupportsOmni,
} from '@/utils/storyboardVideoRequest'

const POLL_DEADLINE_MS = 15 * 60 * 1000
const POLL_REQUEST_TIMEOUT_MS = 15 * 1000
const SUBMISSION_REQUEST_TIMEOUT_MS = 15 * 1000
const AUDIO_SUBMISSION_REQUEST_TIMEOUT_MS = 5 * 60 * 1000

function submissionRequestOptions(signal) {
  return { signal, timeout: SUBMISSION_REQUEST_TIMEOUT_MS }
}

function audioSubmissionRequestOptions(signal) {
  return { signal, timeout: AUDIO_SUBMISSION_REQUEST_TIMEOUT_MS }
}


function createAbortError(message = '任务已取消') {
  if (typeof DOMException === 'function') return new DOMException(message, 'AbortError')
  const error = new Error(message)
  error.name = 'AbortError'
  return error
}

function isAbortError(error, signal) {
  if (isRequestTimeout(error, signal)) return false
  return error?.name === 'AbortError'
    || error?.name === 'CanceledError'
    || error?.code === 'ERR_CANCELED'
}

const CANVAS_SECRET_LEAK_RE = /sk-[A-Za-z0-9._-]{6,}|api[_-]?key|bearer\s+[A-Za-z0-9._-]+|password\s*=|client_secret|authorization\s*:|https?:\/\//i

function sanitizeCanvasError(error, fallback) {
  const text = canvasUserError(error, fallback)
  if (!text || !/[\u4e00-\u9fff]/.test(text) || CANVAS_SECRET_LEAK_RE.test(text)) return fallback
  return text
}

function sanitizeAbortMessage(raw) {
  const text = typeof raw === 'string' ? raw.trim() : String(raw?.message || raw || '').trim()
  if (text && /[\u4e00-\u9fff]/.test(text) && !CANVAS_SECRET_LEAK_RE.test(text)) return text
  return '任务已取消'
}

function throwAborted(signal, error) {
  const raw = signal?.aborted ? (signal.reason || error) : error
  throw createAbortError(sanitizeAbortMessage(raw))
}

function rethrowUnlessAbort(error, fallback, signal) {
  if (isAbortError(error, signal) || signal?.aborted) throwAborted(signal, error)
  if (error?.code === 'SUBMISSION_OUTCOME_UNKNOWN') throw error
  const next = new Error(sanitizeCanvasError(error, fallback))
  if (error?.code) next.code = error.code
  throw next
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return
  throw createAbortError(sanitizeAbortMessage(signal.reason))
}

function waitForPoll(ms, signal) {
  throwIfAborted(signal)
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    function onAbort() {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      reject(createAbortError(sanitizeAbortMessage(signal?.reason)))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function pollTaskOptions(options = {}) {
  return {
    signal: options.signal,
    getTask: options.getTask,
    maxAttempts: options.maxAttempts,
    interval: options.interval,
    deadlineMs: options.deadlineMs,
    requestTimeoutMs: options.requestTimeoutMs,
  }
}

export async function pollTaskSimple(taskId, options = {}) {
  if (!taskId) return { status: 'failed', error: '缺少任务编号' }
  const maxAttempts = options.maxAttempts ?? 450
  const interval = options.interval ?? 2000
  const deadlineMs = Math.max(0, options.deadlineMs ?? POLL_DEADLINE_MS)
  const requestTimeoutMs = Math.min(
    POLL_REQUEST_TIMEOUT_MS,
    Math.max(1, options.requestTimeoutMs ?? POLL_REQUEST_TIMEOUT_MS),
  )
  const deadlineAt = Date.now() + deadlineMs
  const signal = options.signal
  const getTask = options.getTask || ((id, reqOpts) => taskAPI.get(id, reqOpts))
  throwIfAborted(signal)
  for (let i = 0; i < maxAttempts; i++) {
    const waitMs = Math.min(Math.max(0, interval), Math.max(0, deadlineAt - Date.now()))
    await waitForPoll(waitMs, signal)
    throwIfAborted(signal)
    const remainingMs = deadlineAt - Date.now()
    if (remainingMs <= 0) return { status: 'timeout', error: '任务超时' }
    try {
      const t = await getTask(taskId, {
        signal,
        timeout: Math.max(1, Math.min(requestTimeoutMs, remainingMs)),
      })
      throwIfAborted(signal)
      if (t.status === 'completed') return { status: 'completed', result: t.result }
      if (t.status === 'failed') {
        return { status: 'failed', error: sanitizeCanvasError(t.error || '任务失败', '任务失败') }
      }
      if (t.status === 'cancelled' || t.status === 'canceled') {
        throw createAbortError(sanitizeAbortMessage(t.error?.message || t.error || '任务已取消'))
      }
    } catch (e) {
      if (isAbortError(e, signal) || signal?.aborted) throwAborted(signal, e)
      if (Date.now() >= deadlineAt) return { status: 'timeout', error: '任务超时' }
      if (i === maxAttempts - 1) return { status: 'failed', error: sanitizeCanvasError(e, '轮询失败') }
    }
  }
  return { status: 'timeout', error: '任务超时' }
}

export async function runImageStep(drama, sb, genOpts, options = {}) {
  const signal = options.signal
  throwIfAborted(signal)
  try {
    const prompt = sb.polished_prompt || sb.image_prompt || sb.description || sb.action || ''
    if (!prompt.trim()) throw new Error(`分镜 #${sb.storyboard_number ?? sb.id} 缺少图片提示词`)
    const createImage = options.createImage || ((body, reqOpts) => imagesAPI.create(body, reqOpts))
    const references = collectStoryboardReferenceUrls(drama, sb, { toAbsolute: toAbsoluteMediaUrl })
    const res = await createImage({
      storyboard_id: sb.id,
      drama_id: drama.id,
      prompt,
      style: genOpts.style || undefined,
      aspect_ratio: genOpts.aspectRatio,
      reference_images: references.length ? references : undefined,
    }, submissionRequestOptions(signal))
    throwIfAborted(signal)
    if (res?.task_id) {
      const polled = await pollTaskSimple(res.task_id, pollTaskOptions(options))
      throwIfAborted(signal)
      if (polled.status !== 'completed') throw new Error(sanitizeCanvasError(polled.error, '分镜图生成失败'))
    }
  } catch (error) {
    rethrowUnlessAbort(error, '分镜图生成失败', signal)
  }
}

async function resolveProfessionalFramePrompt(sb, frameKind, options = {}) {
  const signal = options.signal
  throwIfAborted(signal)
  const frameType = frameKind === 'last' ? 'last' : 'first'
  const readCached = async () => {
    const getFramePrompts = options.getFramePrompts || ((id, reqOpts) => storyboardsAPI.getFramePrompts(id, reqOpts))
    const result = await getFramePrompts(sb.id, submissionRequestOptions(signal))
    throwIfAborted(signal)
    const row = (result?.frame_prompts || []).find((item) => item.frame_type === frameType)
    return String(row?.prompt || '').trim()
  }
  try {
    const cached = await readCached()
    throwIfAborted(signal)
    if (cached) return cached
    const generateFramePrompt = options.generateFramePrompt || ((id, body, reqOpts) => storyboardsAPI.generateFramePrompt(id, body, reqOpts))
    const created = await generateFramePrompt(
      sb.id,
      { frame_type: frameType },
      submissionRequestOptions(signal),
    )
    throwIfAborted(signal)
    if (created?.task_id) {
      const polled = await pollTaskSimple(created.task_id, pollTaskOptions(options))
      throwIfAborted(signal)
      if (polled.status !== 'completed') throw new Error(sanitizeCanvasError(polled.error, '帧提示词生成失败'))
      const fromTask = String(polled.result?.response?.single_frame?.prompt || '').trim()
      if (fromTask) return fromTask
    }
    const generated = await readCached()
    throwIfAborted(signal)
    if (generated) return generated
  } catch (error) {
    if (isAbortError(error, signal) || signal?.aborted) throwAborted(signal, error)
    options.onWarning?.({
      code: 'frame-prompt-fallback',
      message: '专业帧提示词服务不可用，已改用本地提示词；请检查文本模型配置。',
    })
  }
  if (frameKind === 'last') {
    return [sb.result, sb.action, sb.video_prompt, '尾帧静止画面，保持首帧构图与人物站位'].filter(Boolean).join('，')
  }
  return String(sb.polished_prompt || sb.image_prompt || sb.description || sb.action || '').trim()
}

export async function runFrameImageStep(drama, sb, genOpts, frameKind, options = {}) {
  const signal = options.signal
  throwIfAborted(signal)
  try {
  const kind = frameKind === 'last' ? 'last' : 'first'
  const prompt = await resolveProfessionalFramePrompt(sb, kind, options)
  throwIfAborted(signal)
  if (!prompt) throw new Error(`分镜 #${sb.storyboard_number ?? sb.id} 缺少${kind === 'last' ? '尾帧' : '首帧'}提示词`)
  const imagesBySbId = genOpts?.imagesBySbId || {}
  const firstRecord = resolveSbFirstImageRecord(sb, imagesBySbId)
  const firstReference = kind === 'last' ? imageRecordUrl(firstRecord) : ''
  if (kind === 'last' && !firstReference) {
    throw new Error(`分镜 #${sb.storyboard_number ?? sb.id} 请先生成首帧`)
  }
  const entityReferences = collectStoryboardReferenceUrls(drama, sb, { toAbsolute: toAbsoluteMediaUrl })
  const frameReferences = [firstReference, ...entityReferences].filter(Boolean).slice(0, 10)
  const createImage = options.createImage || ((body, reqOpts) => imagesAPI.create(body, reqOpts))
  const result = await createImage({
    storyboard_id: sb.id,
    drama_id: drama.id,
    prompt,
    style: genOpts.style || undefined,
    frame_type: kind === 'last' ? 'storyboard_last' : 'storyboard_first',
    aspect_ratio: genOpts.aspectRatio,
    reference_images: frameReferences.length ? frameReferences : undefined,
    use_first_frame_layout_lock: kind === 'last' ? true : undefined,
  }, submissionRequestOptions(signal))
  throwIfAborted(signal)
  if (result?.task_id) {
    const polled = await pollTaskSimple(result.task_id, pollTaskOptions(options))
    throwIfAborted(signal)
    if (polled.status !== 'completed') throw new Error(sanitizeCanvasError(polled.error, `${kind === 'last' ? '尾帧' : '首帧'}生成失败`))
  }
  } catch (error) {
    rethrowUnlessAbort(error, '分镜图生成失败', signal)
  }
}

export async function runVideoStep(drama, sb, genOpts, options = {}) {
  const signal = options.signal
  throwIfAborted(signal)
  try {
  const useFirstLast = dramaUsesFirstLastFrame(drama)
  const imagesBySbId = genOpts?.imagesBySbId || {}
  const universal = sb?.creation_mode === 'universal'
  const selectedGridId = Number(sb?.video_reference_image_id)
  const selectedGrid = Number.isFinite(selectedGridId) && selectedGridId > 0
    ? (imagesBySbId[sb.id] || []).find((image) => (
        Number(image?.id) === selectedGridId &&
        image?.status === 'completed' &&
        ['quad_grid', 'nine_grid'].includes(image?.frame_type)
      ))
    : null
  if (selectedGridId > 0 && !selectedGrid) {
    throw new Error('选中的宫格视频参考图不存在或不属于当前分镜')
  }
  let activeVideoConfig = null
  if (universal || selectedGrid) {
    try {
      const listAi = options.listAi || ((type, reqOpts) => aiAPI.list(type, reqOpts))
      const configs = await listAi('video', submissionRequestOptions(signal))
      throwIfAborted(signal)
      const enabled = (Array.isArray(configs) ? configs : []).filter((item) => item?.is_active !== false)
      activeVideoConfig = enabled.find((item) => item?.is_default) || enabled[0] || null
    } catch (error) {
      if (isAbortError(error, signal) || signal?.aborted) throwAborted(signal, error)
      activeVideoConfig = null
    }
  }
  const universalOmni = universal && videoConfigSupportsOmni(activeVideoConfig)
  if (selectedGrid && !videoConfigSupportsGridReference(activeVideoConfig)) {
    throw new Error('当前视频模型未声明支持宫格整图参考，请在 AI 配置的高级设置中开启宫格整图参考，或改回主图/首帧。')
  }
  const allReferences = collectStoryboardReferenceUrls(drama, sb, { toAbsolute: toAbsoluteMediaUrl })
  const fallbackReferences = collectStoryboardReferenceUrls(drama, sb, {
    kinds: ['scene', 'free'],
    toAbsolute: toAbsoluteMediaUrl,
  })

  const { first, last } = sbVideoFirstLastUrls(sb, imagesBySbId, useFirstLast)
  const mainRecord = resolveSbMainImageRecord(sb, imagesBySbId)
  const fallbackMain = imageRecordUrl(mainRecord) || storyboardImageUrl(sb)
  const gridPath = selectedGrid ? imageRecordUrl(selectedGrid) : ''
  const firstPath = gridPath || first || fallbackMain
  const absoluteFirst = firstPath ? toAbsoluteMediaUrl(firstPath) : ''
  const absoluteLast = !selectedGrid && last ? toAbsoluteMediaUrl(last) : ''
  const prompt = buildStoryboardVideoPrompt(sb, {
    universal,
    preferClassicPrompt: universal && !universalOmni,
  }) || sb.polished_prompt || sb.image_prompt || sb.description || ''

  if (!prompt.trim()) {
    throw new Error(`分镜 #${sb.storyboard_number ?? sb.id} 缺少视频提示词`)
  }
  if (!universal && !absoluteFirst) {
    throw new Error(`分镜 #${sb.storyboard_number ?? sb.id} 缺少分镜图，无法生成视频`)
  }

  let referenceImageUrls
  if (universalOmni) {
    referenceImageUrls = [absoluteFirst, ...allReferences].filter(Boolean)
  } else if (universal) {
    referenceImageUrls = [...fallbackReferences, absoluteFirst, absoluteLast].filter(Boolean)
  } else {
    referenceImageUrls = [absoluteFirst, absoluteLast].filter(Boolean)
  }
  const createVideo = options.createVideo || ((body, reqOpts) => videosAPI.create(body, reqOpts))
  const res = await createVideo(buildStoryboardVideoRequest({
    dramaId: drama.id,
    storyboard: sb,
    prompt,
    universalOmni,
    firstFrameUrl: universalOmni ? '' : absoluteFirst,
    lastFrameUrl: universalOmni ? '' : absoluteLast,
    referenceImageUrls,
    style: genOpts.style,
    aspectRatio: genOpts.aspectRatio,
    resolution: genOpts.videoResolution,
    duration: sb.duration,
    videoReferenceImageId: selectedGrid?.id,
  }), submissionRequestOptions(signal))
  throwIfAborted(signal)
  if (res?.task_id) {
    const polled = await pollTaskSimple(res.task_id, pollTaskOptions(options))
    throwIfAborted(signal)
    if (polled.status !== 'completed') throw new Error(sanitizeCanvasError(polled.error, '视频生成失败'))
  }
  } catch (error) {
    rethrowUnlessAbort(error, '视频生成失败', signal)
  }
}

export async function runAudioStep(sb, options = {}) {
  const signal = options.signal
  throwIfAborted(signal)
  const text = (sb.dialogue || '').trim()
  if (!text) return { skipped: true, reason: '无对白' }
  try {
    const postRequest = options.postRequest || ((url, body, reqOpts) => request.post(url, body, reqOpts))
    await postRequest('/audio/extract', {
      storyboard_id: sb.id,
      text,
      tts_kind: 'dialogue',
    }, audioSubmissionRequestOptions(signal))
  } catch (error) {
    if (signal?.aborted || isAbortError(error, signal)) throwAborted(signal, error)
    if (isRequestTimeout(error)) {
      const uncertain = new Error('语音请求等待超时，服务端可能仍在合成并产生费用。请先刷新分镜状态，确认结果后再决定是否重试。')
      uncertain.code = 'SUBMISSION_OUTCOME_UNKNOWN'
      throw uncertain
    }
    rethrowUnlessAbort(error, '配音生成失败', signal)
  }
  throwIfAborted(signal)
  return { skipped: false }
}

/**
 * 对单个分镜按 pipeline 顺序执行生成
 * @param {'image'|'video'|'audio'}[] pipeline
 */
export async function runStoryboardPipeline(drama, storyboardId, pipeline, hooks = {}) {
  const signal = hooks.signal
  throwIfAborted(signal)
  const found = findStoryboardInDrama(drama, storyboardId)
  if (!found) throw new Error(`找不到分镜 ${storyboardId}`)
  let { storyboard: sb } = found
  const genOpts = {
    ...getDramaGenerationOptions(drama),
    ...(hooks.generationOptions || {}),
  }
  const steps = pipeline?.length ? pipeline : DEFAULT_PIPELINE
  const results = []

  for (const step of steps) {
    throwIfAborted(signal)
    hooks.onStepStart?.({ storyboardId, step, sb })
    throwIfAborted(signal)
    try {
      if (step === 'image') {
        await runImageStep(drama, sb, genOpts, hooks)
        throwIfAborted(signal)
        if (hooks.reloadStoryboard) {
          sb = (await hooks.reloadStoryboard(storyboardId, submissionRequestOptions(signal))) || sb
          throwIfAborted(signal)
        }
      } else if (step === 'video') {
        await runVideoStep(drama, sb, genOpts, hooks)
        throwIfAborted(signal)
        if (hooks.reloadStoryboard) {
          sb = (await hooks.reloadStoryboard(storyboardId, submissionRequestOptions(signal))) || sb
          throwIfAborted(signal)
        }
      } else if (step === 'audio') {
        const audioRes = await runAudioStep(sb, hooks)
        throwIfAborted(signal)
        results.push({ step, ...audioRes })
      }
      throwIfAborted(signal)
      hooks.onStepComplete?.({ storyboardId, step, sb })
    } catch (err) {
      if (isAbortError(err) || signal?.aborted) {
        throwAborted(signal, err)
      }
      throwIfAborted(signal)
      hooks.onStepError?.({ storyboardId, step, error: err })
      rethrowUnlessAbort(err, '生成失败', signal)
    }
  }
  return results
}

/** 按工作流组顺序执行（组内分镜按 storyboard_ids 顺序） */
export async function runWorkflowGroup(drama, group, hooks = {}) {
  const signal = hooks.signal
  throwIfAborted(signal)
  const pipeline = group.pipeline || DEFAULT_PIPELINE
  const ids = group.storyboard_ids || []
  const summary = { groupId: group.id, ok: [], failed: [] }

  for (const sbId of ids) {
    throwIfAborted(signal)
    hooks.onStoryboardStart?.({ group, storyboardId: sbId })
    throwIfAborted(signal)
    try {
      await runStoryboardPipeline(drama, sbId, pipeline, hooks)
      throwIfAborted(signal)
      summary.ok.push(sbId)
      throwIfAborted(signal)
      hooks.onStoryboardComplete?.({ group, storyboardId: sbId })
    } catch (err) {
      if (isAbortError(err) || signal?.aborted) {
        throwAborted(signal, err)
      }
      if (err?.code === 'SUBMISSION_OUTCOME_UNKNOWN') {
        err.storyboardId = sbId
        throw err
      }
      summary.failed.push({ storyboardId: sbId, error: sanitizeCanvasError(err, '生成失败') })
      throwIfAborted(signal)
      hooks.onStoryboardError?.({ group, storyboardId: sbId, error: err })
      if (hooks.stopOnError) break
    }
  }
  return summary
}
