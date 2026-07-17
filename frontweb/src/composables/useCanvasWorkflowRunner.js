import { taskAPI } from '@/api/task'
import { imagesAPI } from '@/api/images'
import { videosAPI } from '@/api/videos'
import { aiAPI } from '@/api/ai'
import { storyboardsAPI } from '@/api/storyboards'
import request from '@/utils/request'
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

async function pollTaskSimple(taskId, options = {}) {
  if (!taskId) return { status: 'failed', error: '缺少 task_id' }
  const maxAttempts = options.maxAttempts ?? 450
  const interval = options.interval ?? 2000
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, interval))
    try {
      const t = await taskAPI.get(taskId)
      if (t.status === 'completed') return { status: 'completed', result: t.result }
      if (t.status === 'failed') {
        return { status: 'failed', error: t.error?.message || t.error || '任务失败' }
      }
    } catch (e) {
      if (i === maxAttempts - 1) return { status: 'failed', error: e.message || '轮询失败' }
    }
  }
  return { status: 'timeout', error: '任务超时' }
}

export async function runImageStep(drama, sb, genOpts) {
  const prompt = sb.polished_prompt || sb.image_prompt || sb.description || sb.action || ''
  if (!prompt.trim()) throw new Error(`分镜 #${sb.storyboard_number ?? sb.id} 缺少图片提示词`)
  const references = collectStoryboardReferenceUrls(drama, sb, { toAbsolute: toAbsoluteMediaUrl })
  const res = await imagesAPI.create({
    storyboard_id: sb.id,
    drama_id: drama.id,
    prompt,
    style: genOpts.style || undefined,
    aspect_ratio: genOpts.aspectRatio,
    reference_images: references.length ? references : undefined,
  })
  if (res?.task_id) {
    const polled = await pollTaskSimple(res.task_id)
    if (polled.status !== 'completed') throw new Error(polled.error || '分镜图生成失败')
  }
}

async function resolveProfessionalFramePrompt(sb, frameKind) {
  const frameType = frameKind === 'last' ? 'last' : 'first'
  const readCached = async () => {
    const result = await storyboardsAPI.getFramePrompts(sb.id)
    const row = (result?.frame_prompts || []).find((item) => item.frame_type === frameType)
    return String(row?.prompt || '').trim()
  }
  try {
    const cached = await readCached()
    if (cached) return cached
    const created = await storyboardsAPI.generateFramePrompt(sb.id, { frame_type: frameType })
    if (created?.task_id) {
      const polled = await pollTaskSimple(created.task_id)
      if (polled.status !== 'completed') throw new Error(polled.error || '帧提示词生成失败')
      const fromTask = String(polled.result?.response?.single_frame?.prompt || '').trim()
      if (fromTask) return fromTask
    }
    const generated = await readCached()
    if (generated) return generated
  } catch (_) {
    // Local projects can still use a deterministic prompt when text AI is unavailable.
  }
  if (frameKind === 'last') {
    return [sb.result, sb.action, sb.video_prompt, '尾帧静止画面，保持首帧构图与人物站位'].filter(Boolean).join('，')
  }
  return String(sb.polished_prompt || sb.image_prompt || sb.description || sb.action || '').trim()
}

export async function runFrameImageStep(drama, sb, genOpts, frameKind) {
  const kind = frameKind === 'last' ? 'last' : 'first'
  const prompt = await resolveProfessionalFramePrompt(sb, kind)
  if (!prompt) throw new Error(`分镜 #${sb.storyboard_number ?? sb.id} 缺少${kind === 'last' ? '尾帧' : '首帧'}提示词`)
  const imagesBySbId = genOpts?.imagesBySbId || {}
  const firstRecord = resolveSbFirstImageRecord(sb, imagesBySbId)
  const firstReference = kind === 'last' ? imageRecordUrl(firstRecord) : ''
  if (kind === 'last' && !firstReference) {
    throw new Error(`分镜 #${sb.storyboard_number ?? sb.id} 请先生成首帧`)
  }
  const entityReferences = collectStoryboardReferenceUrls(drama, sb, { toAbsolute: toAbsoluteMediaUrl })
  const frameReferences = [firstReference, ...entityReferences].filter(Boolean).slice(0, 10)
  const result = await imagesAPI.create({
    storyboard_id: sb.id,
    drama_id: drama.id,
    prompt,
    style: genOpts.style || undefined,
    frame_type: kind === 'last' ? 'storyboard_last' : 'storyboard_first',
    aspect_ratio: genOpts.aspectRatio,
    reference_images: frameReferences.length ? frameReferences : undefined,
    use_first_frame_layout_lock: kind === 'last' ? true : undefined,
  })
  if (result?.task_id) {
    const polled = await pollTaskSimple(result.task_id)
    if (polled.status !== 'completed') throw new Error(polled.error || `${kind === 'last' ? '尾帧' : '首帧'}生成失败`)
  }
}

export async function runVideoStep(drama, sb, genOpts) {
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
      const configs = await aiAPI.list('video')
      const enabled = (Array.isArray(configs) ? configs : []).filter((item) => item?.is_active !== false)
      activeVideoConfig = enabled.find((item) => item?.is_default) || enabled[0] || null
    } catch (_) {
      activeVideoConfig = null
    }
  }
  const universalOmni = universal && videoConfigSupportsOmni(activeVideoConfig)
  if (selectedGrid && !videoConfigSupportsGridReference(activeVideoConfig)) {
    throw new Error('当前视频模型未声明支持宫格整图参考，请在 AI 配置中启用 supports_grid_reference')
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
  const res = await videosAPI.create(buildStoryboardVideoRequest({
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
  }))
  if (res?.task_id) {
    const polled = await pollTaskSimple(res.task_id)
    if (polled.status !== 'completed') throw new Error(polled.error || '视频生成失败')
  }
}

export async function runAudioStep(sb) {
  const text = (sb.dialogue || '').trim()
  if (!text) return { skipped: true, reason: '无对白' }
  await request.post('/audio/extract', {
    storyboard_id: sb.id,
    text,
    tts_kind: 'dialogue',
  })
  return { skipped: false }
}

/**
 * 对单个分镜按 pipeline 顺序执行生成
 * @param {'image'|'video'|'audio'}[] pipeline
 */
export async function runStoryboardPipeline(drama, storyboardId, pipeline, hooks = {}) {
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
    hooks.onStepStart?.({ storyboardId, step, sb })
    try {
      if (step === 'image') {
        await runImageStep(drama, sb, genOpts)
        if (hooks.reloadStoryboard) {
          sb = (await hooks.reloadStoryboard(storyboardId)) || sb
        }
      } else if (step === 'video') {
        await runVideoStep(drama, sb, genOpts)
        if (hooks.reloadStoryboard) {
          sb = (await hooks.reloadStoryboard(storyboardId)) || sb
        }
      } else if (step === 'audio') {
        const audioRes = await runAudioStep(sb)
        results.push({ step, ...audioRes })
      }
      hooks.onStepComplete?.({ storyboardId, step, sb })
    } catch (err) {
      hooks.onStepError?.({ storyboardId, step, error: err })
      throw err
    }
  }
  return results
}

/** 按工作流组顺序执行（组内分镜按 storyboard_ids 顺序） */
export async function runWorkflowGroup(drama, group, hooks = {}) {
  const pipeline = group.pipeline || DEFAULT_PIPELINE
  const ids = group.storyboard_ids || []
  const summary = { groupId: group.id, ok: [], failed: [] }

  for (const sbId of ids) {
    hooks.onStoryboardStart?.({ group, storyboardId: sbId })
    try {
      await runStoryboardPipeline(drama, sbId, pipeline, hooks)
      summary.ok.push(sbId)
      hooks.onStoryboardComplete?.({ group, storyboardId: sbId })
    } catch (err) {
      summary.failed.push({ storyboardId: sbId, error: err.message || String(err) })
      hooks.onStoryboardError?.({ group, storyboardId: sbId, error: err })
      if (hooks.stopOnError) break
    }
  }
  return summary
}
