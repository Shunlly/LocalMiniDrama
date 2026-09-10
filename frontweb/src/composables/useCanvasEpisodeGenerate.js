import { ref } from 'vue'
import { canvasUserError, isCanvasUserAbort } from '@/composables/useCanvasUserError'
import { ElMessage, ElMessageBox } from 'element-plus'
import { dramaAPI } from '@/api/drama'
import { storyboardsAPI } from '@/api/storyboards'
import { parseDramaMetadata } from '@/utils/canvasLayout'
import { getDramaGenerationOptions } from '@/utils/canvasWorkflow'
import { pollTaskSimple, runImageStep, runVideoStep } from '@/composables/useCanvasWorkflowRunner'
import { hasStoryboardImage, hasStoryboardVideo } from '@/utils/storyboardMedia'
import { CANVAS_NODE_STATUS_LABELS } from '@/composables/useCanvasNodeStatus'

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

function createAbortError(message = '任务已取消') {
  if (typeof DOMException === 'function') return new DOMException(message, 'AbortError')
  const error = new Error(message)
  error.name = 'AbortError'
  return error
}

/** 画布模式：当前集 AI 生成分镜 + 批量生图/生视频 */
export function useCanvasEpisodeGenerate(deps) {
  const {
    drama,
    filterEpisodeId,
    imagesBySbId,
    videosBySbId,
    refreshCanvas,
    nodeStatus,
  } = deps
  const notify = deps.ElMessage || ElMessage
  const confirmBox = deps.ElMessageBox || ElMessageBox
  const dramaApi = deps.dramaAPIImpl || dramaAPI
  const storyboardsApi = deps.storyboardsAPIImpl || storyboardsAPI

  const episodeGenerating = ref(false)
  const episodeGenProgress = ref('')
  let runController = null

  function beginRun() {
    runController = new AbortController()
    const parent = deps.signal
    if (parent) {
      if (parent.aborted) runController.abort(parent.reason)
      else {
        parent.addEventListener('abort', () => {
          runController?.abort(parent.reason)
        }, { once: true })
      }
    }
    return runController.signal
  }

  function endRun() {
    runController = null
  }

  function abortEpisodeGenerate(reason) {
    runController?.abort(reason || createAbortError('任务已取消'))
  }

  function getEpisode() {
    const epId = filterEpisodeId.value
    if (!epId) return null
    return (drama.value?.episodes || []).find((ep) => ep.id === epId) || null
  }

  function getStoryboardsForEpisode() {
    return getEpisode()?.storyboards || []
  }

  function buildStoryboardApiOptions() {
    const meta = parseDramaMetadata(drama.value?.metadata)
    const gen = getDramaGenerationOptions(drama.value)
    const ep = getEpisode()
    const scriptLen = (ep?.script_content || '').trim().length
    let videoDuration
    if (meta.video_clip_duration) {
      videoDuration = Number(meta.video_clip_duration)
    } else if (scriptLen > 0) {
      videoDuration = Math.max(10, Math.round(10 + (scriptLen / 600) * 60))
    }
    return {
      style: gen.style || undefined,
      aspect_ratio: gen.aspectRatio,
      video_duration: videoDuration,
      include_narration: !!meta.storyboard_include_narration,
      universal_omni_storyboard: !!meta.storyboard_universal_omni,
    }
  }

  function setSbBusy(sb, step, message) {
    const sbNodeId = `sb:${sb.id}`
    nodeStatus?.set(sbNodeId, { step, message })
    if (step === 'image') nodeStatus?.set(`sbimg:${sb.id}`, { step, message })
    if (step === 'video') nodeStatus?.set(`sbvid:${sb.id}`, { step, message })
  }

  function clearSbBusy(sb) {
    nodeStatus?.clear(`sb:${sb.id}`)
    nodeStatus?.clear(`sbimg:${sb.id}`)
    nodeStatus?.clear(`sbvid:${sb.id}`)
  }

  function clearEpisodeSbBusy() {
    for (const sb of getStoryboardsForEpisode()) clearSbBusy(sb)
  }

  function getGenOpts() {
    return {
      ...getDramaGenerationOptions(drama.value),
      imagesBySbId: imagesBySbId.value,
    }
  }

  function stepOptions(signal) {
    return {
      signal,
      getTask: deps.getTask,
      createImage: deps.createImage,
      createVideo: deps.createVideo,
      listAi: deps.listAi,
      ...(deps.pollOptions || {}),
    }
  }

  async function aiGenerateStoryboards() {
    const ep = getEpisode()
    if (!ep) {
      notify.warning('请先在顶栏选择某一集（AI 生成针对单集剧本）')
      return
    }
    if (!(ep.script_content || '').trim()) {
      notify.warning('当前集还没有剧本，请先编写或导入剧本')
      return
    }
    const existing = getStoryboardsForEpisode()
    if (existing.length > 0) {
      try {
        await confirmBox.confirm(
          `第 ${ep.episode_number || ''} 集已有 ${existing.length} 个分镜。重新生成可能追加或覆盖内容，是否继续？`,
          'AI 生成分镜',
          { type: 'warning', confirmButtonText: '继续生成' }
        )
      } catch {
        return
      }
    }

    const signal = beginRun()
    episodeGenerating.value = true
    episodeGenProgress.value = 'AI 正在根据剧本解析分镜…'
    for (const sb of existing) {
      setSbBusy(sb, 'generate_sb', CANVAS_NODE_STATUS_LABELS.generate_sb)
    }
    const refreshTimer = setInterval(() => refreshCanvas(true), 2000)
    try {
      const res = await dramaApi.generateStoryboard(ep.id, buildStoryboardApiOptions())
      const taskId = res?.task_id ?? (typeof res === 'string' ? res : null)
      if (taskId) {
        const polled = await pollTaskSimple(taskId, {
          signal,
          getTask: deps.getTask,
          ...(deps.pollOptions || {}),
        })
        if (polled.status !== 'completed') {
          throw new Error(sanitizeCanvasError(polled.error, '分镜生成失败'))
        }
        if (polled.result?.truncated) {
          notify.warning('AI 输出可能被截断，请检查分镜数量是否完整')
        }
      }
      await refreshCanvas(true)
      await storyboardsApi.batchInferParams(ep.id, false).catch(() => {})
      const count = getStoryboardsForEpisode().length
      notify.success(`分镜生成完成，共 ${count} 镜`)
    } catch (e) {
      if (isCanvasUserAbort(e) || signal.aborted) return
      notify.error(sanitizeCanvasError(e, 'AI 生成分镜失败'))
    } finally {
      clearInterval(refreshTimer)
      clearEpisodeSbBusy()
      episodeGenerating.value = false
      episodeGenProgress.value = ''
      endRun()
    }
  }

  async function batchGenerateImages() {
    const ep = getEpisode()
    if (!ep) {
      notify.warning('请先选择集数')
      return
    }
    const boards = getStoryboardsForEpisode()
    const todo = boards.filter(
      (sb) => sb.creation_mode !== 'universal' && !hasStoryboardImage(sb, imagesBySbId.value, drama.value)
    )
    if (!todo.length) {
      notify.info('当前集分镜均已有图片（全能模式分镜请直接生视频）')
      return
    }
    try {
      await confirmBox.confirm(
        `将为 ${todo.length} 个分镜依次生图，耗时可能较长，是否继续？`,
        '批量生成分镜图',
        { type: 'info', confirmButtonText: '开始' }
      )
    } catch {
      return
    }

    const signal = beginRun()
    episodeGenerating.value = true
    let ok = 0
    let failed = 0
    try {
      for (let i = 0; i < todo.length; i++) {
        if (signal.aborted) throw createAbortError(sanitizeAbortMessage(signal.reason))
        const sb = todo[i]
        episodeGenProgress.value = `批量生图 ${i + 1}/${todo.length}：分镜 #${sb.storyboard_number ?? sb.id}`
        setSbBusy(sb, 'image', `${CANVAS_NODE_STATUS_LABELS.image} ${i + 1}/${todo.length}`)
        try {
          await runImageStep(drama.value, sb, getGenOpts(), stepOptions(signal))
          ok++
          await refreshCanvas(true)
        } catch (e) {
          if (isCanvasUserAbort(e) || signal.aborted) throw createAbortError(sanitizeAbortMessage(signal.reason || e))
          failed++
          notify.error(`分镜 #${sb.storyboard_number ?? sb.id} 生图失败：${sanitizeCanvasError(e, '生成失败')}`)
        } finally {
          clearSbBusy(sb)
        }
      }
      if (failed === 0) notify.success(`批量生图完成，共 ${ok} 镜`)
      else notify.warning(`完成 ${ok} 镜，失败 ${failed} 镜`)
    } catch (e) {
      if (isCanvasUserAbort(e) || signal.aborted) return
      notify.error(sanitizeCanvasError(e, '批量生图失败'))
    } finally {
      episodeGenerating.value = false
      episodeGenProgress.value = ''
      endRun()
    }
  }

  async function batchGenerateVideos() {
    const ep = getEpisode()
    if (!ep) {
      notify.warning('请先选择集数')
      return
    }
    const boards = getStoryboardsForEpisode()
    const todo = boards.filter((sb) => !hasStoryboardVideo(sb, videosBySbId.value))
    if (!todo.length) {
      notify.info('当前集分镜均已有视频')
      return
    }
    try {
      await confirmBox.confirm(
        `将为 ${todo.length} 个分镜依次生视频，是否继续？`,
        '批量生成分镜视频',
        { type: 'info', confirmButtonText: '开始' }
      )
    } catch {
      return
    }

    const signal = beginRun()
    episodeGenerating.value = true
    let ok = 0
    let failed = 0
    try {
      for (let i = 0; i < todo.length; i++) {
        if (signal.aborted) throw createAbortError(sanitizeAbortMessage(signal.reason))
        const sb = todo[i]
        episodeGenProgress.value = `批量生视频 ${i + 1}/${todo.length}：分镜 #${sb.storyboard_number ?? sb.id}`
        setSbBusy(sb, 'video', `${CANVAS_NODE_STATUS_LABELS.video} ${i + 1}/${todo.length}`)
        try {
          await runVideoStep(drama.value, sb, getGenOpts(), stepOptions(signal))
          ok++
          await refreshCanvas(true)
        } catch (e) {
          if (isCanvasUserAbort(e) || signal.aborted) throw createAbortError(sanitizeAbortMessage(signal.reason || e))
          failed++
          notify.error(`分镜 #${sb.storyboard_number ?? sb.id} 生视频失败：${sanitizeCanvasError(e, '生成失败')}`)
        } finally {
          clearSbBusy(sb)
        }
      }
      if (failed === 0) notify.success(`批量生视频完成，共 ${ok} 镜`)
      else notify.warning(`完成 ${ok} 镜，失败 ${failed} 镜`)
    } catch (e) {
      if (isCanvasUserAbort(e) || signal.aborted) return
      notify.error(sanitizeCanvasError(e, '批量生视频失败'))
    } finally {
      episodeGenerating.value = false
      episodeGenProgress.value = ''
      endRun()
    }
  }

  return {
    episodeGenerating,
    episodeGenProgress,
    aiGenerateStoryboards,
    batchGenerateImages,
    batchGenerateVideos,
    abortEpisodeGenerate,
  }
}
