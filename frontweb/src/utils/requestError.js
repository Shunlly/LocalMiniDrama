import axios from 'axios'

export const DEFAULT_JSON_TIMEOUT_MS = 15_000
export const DEFAULT_DOWNLOAD_TIMEOUT_MS = 180_000
export const DEFAULT_POLL_TIMEOUT_MS = 15_000

function abortLikeError(error) {
  return error?.name === 'CanceledError' || error?.name === 'AbortError'
}

export function isRequestCanceled(error) {
  return error?.code === 'ERR_CANCELED'
    || abortLikeError(error)
    || axios.isCancel?.(error) === true
}

export function isRequestTimeout(error) {
  if (error?.isTimeout === true) return true
  if (error?.code === 'ECONNABORTED' || error?.code === 'ETIMEDOUT') return true
  return /timeout/i.test(String(error?.message || ''))
}

export function isRequestNetworkError(error) {
  if (error?.response) return false
  if (isRequestCanceled(error) || isRequestTimeout(error)) return false
  return error?.code === 'ERR_NETWORK' || /network error/i.test(String(error?.message || ''))
}

export function shouldRetryRequest(error) {
  if (isRequestTimeout(error)) return true
  if (isRequestCanceled(error)) return false
  const status = Number(error?.response?.status || error?.status)
  if (Number.isInteger(status) && status >= 400 && status < 500) return false
  if (Number.isInteger(status) && status >= 500) return true
  return isRequestNetworkError(error)
}

export function describeServiceLoadError(error, options = {}) {
  const serviceLabel = options.serviceLabel || '服务'
  const backendMessage = error?.response?.data?.error?.message
  if (backendMessage) return backendMessage
  const status = Number(error?.status || error?.response?.status)
  if (status === 404 && options.notFoundMessage) return options.notFoundMessage
  if (Number.isInteger(status) && status > 0) return `${serviceLabel}暂时不可用（HTTP ${status}）`
  if (isRequestTimeout(error)) return `连接${serviceLabel}超时，请稍后重试`
  if (isRequestCanceled(error)) return `${serviceLabel}请求已取消`
  return options.fallback || `无法连接${serviceLabel}，请检查服务是否已启动`
}

export function createTimeoutController(timeoutMs, parentSignal) {
  const controller = new AbortController()
  let timedOut = false
  const timeout = Math.max(1, Number(timeoutMs) || DEFAULT_JSON_TIMEOUT_MS)
  const timer = setTimeout(() => {
    timedOut = true
    const reason = Object.assign(new Error('请求超时'), { code: 'ECONNABORTED', isTimeout: true })
    controller.abort(reason)
  }, timeout)
  const onParentAbort = () => controller.abort(parentSignal?.reason)
  parentSignal?.addEventListener('abort', onParentAbort, { once: true })
  if (parentSignal?.aborted) onParentAbort()
  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    dispose() {
      clearTimeout(timer)
      parentSignal?.removeEventListener('abort', onParentAbort)
    },
  }
}

export async function withRequestRetry(task, options = {}) {
  if (typeof task !== 'function') throw new TypeError('withRequestRetry 需要可执行函数')
  const maxAttempts = Math.max(1, Number(options.maxAttempts) || 2)
  const delayMs = Math.max(0, Number(options.delayMs) || 400)
  const signal = options.signal
  const shouldRetry = typeof options.shouldRetry === 'function' ? options.shouldRetry : shouldRetryRequest
  let lastError = null

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (signal?.aborted) {
      const error = signal.reason instanceof Error ? signal.reason : new Error('请求已取消')
      if (!error.code) error.code = 'ERR_CANCELED'
      throw error
    }
    try {
      return await task(attempt)
    } catch (error) {
      lastError = error
      if (isRequestCanceled(error) || attempt >= maxAttempts || !shouldRetry(error, attempt)) throw error
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, delayMs * attempt)
        if (!signal) return
        const onAbort = () => {
          clearTimeout(timer)
          const abortError = signal.reason instanceof Error ? signal.reason : new Error('请求已取消')
          if (!abortError.code) abortError.code = 'ERR_CANCELED'
          reject(abortError)
        }
        if (signal.aborted) onAbort()
        else signal.addEventListener('abort', onAbort, { once: true })
      })
    }
  }
  throw lastError
}
