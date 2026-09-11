/**
 * 画布项目加载请求。只搬家，不改超时、取消和失败分类。
 */

export function coreCanvasRequestError(status) {
  const error = new Error('PROJECT_LOAD_FAILED')
  error.status = Number(status) || 0
  return error
}

export function canvasAbortError(reason) {
  if (reason?.name === 'AbortError') return reason
  if (typeof DOMException === 'function') return new DOMException('任务已取消', 'AbortError')
  const error = new Error('任务已取消')
  error.name = 'AbortError'
  return error
}

export function isCanvasAbortError(error, signal) {
  return error?.name === 'AbortError' || signal?.aborted
}

export async function requestCanvasProject(path, {
  method = 'GET',
  body,
  fetchImpl = globalThis.fetch,
  signal,
  timeout = 15000,
} = {}) {
  const controller = new AbortController()
  const onAbort = () => controller.abort(signal?.reason)
  signal?.addEventListener('abort', onAbort, { once: true })
  if (signal?.aborted) onAbort()
  const timeoutId = setTimeout(() => controller.abort(), Math.min(15000, Math.max(1, timeout)))
  let response
  try {
    response = await fetchImpl(`/api/v1${path}`, {
      method,
      credentials: 'same-origin',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  } catch (error) {
    if (signal?.aborted) throw canvasAbortError(signal.reason || error)
    throw coreCanvasRequestError(0)
  } finally {
    clearTimeout(timeoutId)
    signal?.removeEventListener('abort', onAbort)
  }

  let payload = null
  try {
    payload = response.status === 204 ? null : await response.json()
  } catch (_) {
    throw coreCanvasRequestError(response.status)
  }
  if (!response.ok || payload?.success === false) throw coreCanvasRequestError(response.status)
  return payload?.data !== undefined ? payload.data : payload
}

export const coreCanvasDramaAPI = {
  get(id, options) {
    return requestCanvasProject(`/dramas/${encodeURIComponent(id)}`, options || {})
  },
}

export function friendlyCanvasProjectLoadError(error) {
  const status = Number(error?.status || error?.response?.status)
  if (status === 404) return '该项目不存在，或已移入回收站。'
  if (status >= 500) return '本地服务暂时不可用，请稍后重试。'
  return '无法连接本地服务，请确认服务已经启动后重试。'
}
