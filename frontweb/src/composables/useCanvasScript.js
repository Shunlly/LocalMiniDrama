import { ref } from 'vue'
import { canvasUserError, isCanvasUserAbort } from '@/composables/useCanvasUserError'
import { ElMessage } from 'element-plus'
import { dramaAPI } from '@/api/drama'
import { generationAPI } from '@/api/generation'
import { propAPI } from '@/api/props'
import { pollTaskSimple } from '@/composables/useCanvasWorkflowRunner'
import { getDramaGenerationOptions } from '@/utils/canvasWorkflow'
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

function throwIfAborted(signal) {
  if (!signal?.aborted) return
  throw createAbortError(sanitizeAbortMessage(signal.reason))
}

export function scriptNodeId(episodeId) {
  return `script:${episodeId}`
}

function buildEpisodesPayload(drama, episodeId, patch) {
  return (drama?.episodes || []).map((ep, i) => {
    const base = {
      episode_number: ep.episode_number ?? i + 1,
      title: ep.title || `第${ep.episode_number ?? i + 1}集`,
      script_content: ep.script_content || '',
      description: ep.description ?? null,
      duration: ep.duration ?? 0,
    }
    if (Number(ep.id) === Number(episodeId)) {
      return { ...base, ...patch }
    }
    return base
  })
}

function rethrowScriptError(error, fallback, signal) {
  if (isCanvasUserAbort(error) || signal?.aborted) {
    throw createAbortError(sanitizeAbortMessage(signal?.aborted ? (signal.reason || error) : error))
  }
  const next = new Error(sanitizeCanvasError(error, fallback))
  if (error?.code) next.code = error.code
  throw next
}

/** 画布：剧本编辑 + 从剧本提取角色/场景/道具 */
export function useCanvasScript(deps) {
  const { drama, dramaId, refreshCanvas, nodeStatus } = deps
  const notify = deps.ElMessage || ElMessage
  const dramaApi = deps.dramaAPIImpl || dramaAPI
  const generationApi = deps.generationAPIImpl || generationAPI
  const propApi = deps.propAPIImpl || propAPI
  const scriptBusy = ref(false)

  function resolveSignal(options) {
    return options?.signal || deps.signal
  }

  function setScriptBusy(episodeId, step, message) {
    nodeStatus?.set(scriptNodeId(episodeId), { step, message })
  }

  function clearScriptBusy(episodeId) {
    nodeStatus?.clear(scriptNodeId(episodeId))
  }

  async function runExtractTask(taskId, label, signal) {
    throwIfAborted(signal)
    if (!taskId) {
      await refreshCanvas(true)
      return
    }
    const polled = await pollTaskSimple(taskId, {
      signal,
      getTask: deps.getTask,
      ...(deps.pollOptions || {}),
    })
    throwIfAborted(signal)
    if (polled.status !== 'completed') {
      throw new Error(sanitizeCanvasError(polled.error, `${label}失败`))
    }
    await refreshCanvas(true)
  }

  async function saveScript(episodeId, { scriptContent, title } = {}, options = {}) {
    const did = dramaId.value
    const d = drama.value
    const signal = resolveSignal(options)
    if (!did || !d || !episodeId) throw new Error('缺少项目或集数')

    scriptBusy.value = true
    setScriptBusy(episodeId, 'save_script', CANVAS_NODE_STATUS_LABELS.save_script)
    try {
      throwIfAborted(signal)
      const payload = buildEpisodesPayload(d, episodeId, {
        script_content: (scriptContent || '').trim(),
        title: (title || '').trim() || undefined,
      })
      await dramaApi.saveEpisodes(did, payload)
      throwIfAborted(signal)
      await refreshCanvas(true)
      notify.success('剧本已保存')
    } catch (error) {
      rethrowScriptError(error, '保存失败', signal)
    } finally {
      scriptBusy.value = false
      clearScriptBusy(episodeId)
    }
  }

  async function _extractCharacters(episodeId, scriptContent, signal) {
    throwIfAborted(signal)
    const did = dramaId.value
    const outline = (scriptContent || '').trim() || undefined
    const res = await generationApi.generateCharacters(did, {
      episode_id: episodeId,
      outline,
    })
    await runExtractTask(res?.task_id, '提取角色', signal)
  }

  async function _extractScenes(episodeId, signal) {
    throwIfAborted(signal)
    const style = getDramaGenerationOptions(drama.value).style || undefined
    const res = await dramaApi.extractBackgrounds(episodeId, {
      model: undefined,
      style,
      language: 'zh',
    })
    await runExtractTask(res?.task_id, '提取场景', signal)
  }

  async function _extractProps(episodeId, signal) {
    throwIfAborted(signal)
    const res = await propApi.extractFromScript(episodeId)
    await runExtractTask(res?.task_id, '提取道具', signal)
  }

  function requireScriptContent(episodeId, scriptContent) {
    const fromArg = String(scriptContent || '').trim()
    if (fromArg) return fromArg
    const episode = (drama.value?.episodes || []).find((item) => Number(item.id) === Number(episodeId))
    const saved = String(episode?.script_content || '').trim()
    if (saved) return saved
    throw new Error('请先填写剧本内容')
  }

  async function extractCharacters(episodeId, scriptContent, options = {}) {
    const signal = resolveSignal(options)
    if (!dramaId.value || !episodeId) throw new Error('请先选择集数')
    scriptBusy.value = true
    setScriptBusy(episodeId, 'extract_chars', CANVAS_NODE_STATUS_LABELS.extract_chars)
    try {
      const content = requireScriptContent(episodeId, scriptContent)
      await _extractCharacters(episodeId, content, signal)
      notify.success('角色提取完成')
    } catch (error) {
      rethrowScriptError(error, '提取角色失败', signal)
    } finally {
      scriptBusy.value = false
      clearScriptBusy(episodeId)
    }
  }

  async function extractScenes(episodeId, options = {}) {
    const signal = resolveSignal(options)
    if (!episodeId) throw new Error('请先选择集数')
    scriptBusy.value = true
    setScriptBusy(episodeId, 'extract_scenes', CANVAS_NODE_STATUS_LABELS.extract_scenes)
    try {
      requireScriptContent(episodeId)
      await _extractScenes(episodeId, signal)
      notify.success('场景提取完成')
    } catch (error) {
      rethrowScriptError(error, '提取场景失败', signal)
    } finally {
      scriptBusy.value = false
      clearScriptBusy(episodeId)
    }
  }

  async function extractProps(episodeId, options = {}) {
    const signal = resolveSignal(options)
    if (!episodeId) throw new Error('请先选择集数')
    scriptBusy.value = true
    setScriptBusy(episodeId, 'extract_props', CANVAS_NODE_STATUS_LABELS.extract_props)
    try {
      requireScriptContent(episodeId)
      await _extractProps(episodeId, signal)
      notify.success('道具提取完成')
    } catch (error) {
      rethrowScriptError(error, '提取道具失败', signal)
    } finally {
      scriptBusy.value = false
      clearScriptBusy(episodeId)
    }
  }

  async function extractAll(episodeId, scriptContent, options = {}) {
    const signal = resolveSignal(options)
    if (!episodeId) throw new Error('请先选择集数')
    const content = (scriptContent || '').trim()
    if (!content) throw new Error('请先填写剧本内容')

    scriptBusy.value = true
    let didWork = false
    try {
      throwIfAborted(signal)
      if ((drama.value?.characters || []).length === 0) {
        setScriptBusy(episodeId, 'extract_chars', '1/3 提取角色…')
        await _extractCharacters(episodeId, content, signal)
        didWork = true
      }
      throwIfAborted(signal)
      if ((drama.value?.scenes || []).length === 0) {
        setScriptBusy(episodeId, 'extract_scenes', '2/3 提取场景…')
        await _extractScenes(episodeId, signal)
        didWork = true
      }
      throwIfAborted(signal)
      if ((drama.value?.props || []).length === 0) {
        setScriptBusy(episodeId, 'extract_props', '3/3 提取道具…')
        await _extractProps(episodeId, signal)
        didWork = true
      }

      if (!didWork) {
        notify.info('角色、场景、道具均已存在，无需重复提取')
      } else {
        notify.success(
          `提取完成：${(drama.value?.characters || []).length} 角色 · ${(drama.value?.scenes || []).length} 场景 · ${(drama.value?.props || []).length} 道具`
        )
      }
    } catch (e) {
      if (isCanvasUserAbort(e) || signal?.aborted) return
      rethrowScriptError(e, '提取失败', signal)
    } finally {
      scriptBusy.value = false
      clearScriptBusy(episodeId)
    }
  }

  return {
    scriptBusy,
    saveScript,
    extractCharacters,
    extractScenes,
    extractProps,
    extractAll,
  }
}
