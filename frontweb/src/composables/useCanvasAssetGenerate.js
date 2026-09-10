import { canvasUserError, isCanvasUserAbort } from '@/composables/useCanvasUserError'
import { pollTaskSimple } from '@/composables/useCanvasWorkflowRunner'
import { characterAPI } from '@/api/characters'
import { sceneAPI } from '@/api/scenes'
import { propAPI } from '@/api/props'
import { assetImageUrl } from '@/utils/mediaUrl'
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

function rethrowAssetError(error, fallback, signal) {
  if (isCanvasUserAbort(error) || signal?.aborted) {
    throw createAbortError(sanitizeAbortMessage(signal?.aborted ? (signal.reason || error) : error))
  }
  const next = new Error(sanitizeCanvasError(error, fallback))
  if (error?.code) next.code = error.code
  throw next
}

async function pollUntilHasImage(findEntity, { maxAttempts = 120, interval = 2000, signal } = {}) {
  for (let i = 0; i < maxAttempts; i++) {
    throwIfAborted(signal)
    const entity = findEntity()
    if (entity && assetImageUrl(entity)) return true
    await waitForPoll(interval, signal)
  }
  return false
}

/**
 * 素材参考图生成（含轮询），并同步节点 busy 状态到卡片预览
 */
export async function generateAssetReferenceImage(ctx, options = {}) {
  const {
    kind,
    entity,
    nodeId,
    signal,
    pollOptions = {},
    characterAPIImpl = characterAPI,
    sceneAPIImpl = sceneAPI,
    propAPIImpl = propAPI,
    getTask,
  } = options
  const nodeStatus = ctx?.nodeStatus
  const drama = ctx?.drama?.value
  nodeStatus?.set(nodeId, { step: 'ref_image', message: CANVAS_NODE_STATUS_LABELS.ref_image })

  try {
    throwIfAborted(signal)
    let res
    if (kind === 'character') {
      res = await characterAPIImpl.generateImage(entity.id)
    } else if (kind === 'scene') {
      res = await sceneAPIImpl.generateImage({ scene_id: entity.id, drama_id: drama?.id })
    } else {
      res = await propAPIImpl.generateImage(entity.id)
    }
    throwIfAborted(signal)

    const taskId = res?.image_generation?.task_id ?? res?.task_id
    if (taskId) {
      const polled = await pollTaskSimple(taskId, { signal, getTask, ...pollOptions })
      throwIfAborted(signal)
      if (polled.status !== 'completed') {
        throw new Error(sanitizeCanvasError(polled.error, '参考图生成失败'))
      }
    } else {
      await ctx?.refreshDrama?.(true)
      const ok = await pollUntilHasImage(() => {
        const list = kind === 'character'
          ? ctx?.drama?.value?.characters
          : kind === 'scene'
            ? ctx?.drama?.value?.scenes
            : ctx?.drama?.value?.props
        return (list || []).find((x) => Number(x.id) === Number(entity.id))
      }, { signal, ...pollOptions })
      if (!ok) throw new Error('生成超时，请稍后刷新查看')
    }
    await ctx?.refresh?.(true)
    return { ok: true }
  } catch (error) {
    rethrowAssetError(error, '参考图生成失败', signal)
  } finally {
    nodeStatus?.clear(nodeId)
  }
}
