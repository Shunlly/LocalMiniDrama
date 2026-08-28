import axios from 'axios'

export const DEFAULT_JSON_TIMEOUT_MS = 15_000
export const DEFAULT_DOWNLOAD_TIMEOUT_MS = 180_000
export const DEFAULT_POLL_TIMEOUT_MS = 15_000
export const DEFAULT_CONNECTION_TEST_TIMEOUT_MS = 20_000

export const REQUEST_ERROR_CATEGORY = {
  CANCEL: 'cancel',
  TIMEOUT: 'timeout',
  NETWORK: 'network',
  HTTP_4XX: 'http_4xx',
  HTTP_5XX: 'http_5xx',
  UNKNOWN: 'unknown',
}

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/
const NETWORK_ERROR_CODES = new Set([
  'ERR_NETWORK',
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ERR_INTERNET_DISCONNECTED',
  'ERR_FAILED',
])

function abortLikeError(error) {
  return error?.name === 'CanceledError' || error?.name === 'AbortError'
}

function timeoutLikeError(error) {
  if (!error || typeof error !== 'object') return false
  if (error.isTimeout === true) return true
  if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') return true
  return /timeout/i.test(String(error.message || ''))
}

function timeoutFromAbortSignal(signal) {
  return timeoutLikeError(signal?.reason)
}

export function isRequestTimeout(error, signal) {
  return timeoutLikeError(error)
    || timeoutLikeError(error?.cause)
    || timeoutFromAbortSignal(error?.config?.signal)
    || timeoutFromAbortSignal(signal)
}

export function isRequestCanceled(error, signal) {
  if (isRequestTimeout(error, signal)) return false
  return error?.code === 'ERR_CANCELED'
    || abortLikeError(error)
    || axios.isCancel?.(error) === true
}

export function isRequestNetworkError(error, signal) {
  if (error?.response) return false
  if (isRequestCanceled(error, signal) || isRequestTimeout(error, signal)) return false
  const code = String(error?.code || '')
  if (NETWORK_ERROR_CODES.has(code)) return true
  return /network error/i.test(String(error?.message || ''))
}

function readHeaderValue(headers, name) {
  if (!headers) return ''
  if (typeof headers.get === 'function') {
    return String(headers.get(name) || headers.get(name.toLowerCase()) || '').trim()
  }
  const direct = headers[name] || headers[name.toLowerCase()] || headers['X-Request-Id'] || headers['x-request-id']
  if (Array.isArray(direct)) return String(direct[0] || '').trim()
  return String(direct || '').trim()
}

function readErrorEnvelope(error) {
  const data = error?.response?.data
  if (!data || typeof data !== 'object') return {}
  return data
}

export function createRequestId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID()
  return 'req-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10)
}

export function getRequestId(error, config) {
  const cfg = config || error?.config || {}
  const envelope = readErrorEnvelope(error)
  const candidates = [
    error?.requestId,
    envelope?.error?.request_id,
    envelope?.request_id,
    readHeaderValue(error?.response?.headers, 'x-request-id'),
    readHeaderValue(cfg.headers, 'x-request-id'),
    cfg.requestId,
  ]
  for (const value of candidates) {
    const text = String(value || '').trim()
    if (REQUEST_ID_PATTERN.test(text)) return text
  }
  return ''
}

function httpStatusOf(error) {
  const status = Number(error?.response?.status || error?.status)
  return Number.isInteger(status) && status > 0 ? status : 0
}

export function classifyRequestError(error, signal) {
  // 超时 abort 仍是可重试超时，必须先于取消判断。
  if (isRequestTimeout(error, signal)) return REQUEST_ERROR_CATEGORY.TIMEOUT
  if (isRequestCanceled(error, signal)) return REQUEST_ERROR_CATEGORY.CANCEL
  const status = httpStatusOf(error)
  if (status >= 500) return REQUEST_ERROR_CATEGORY.HTTP_5XX
  if (status >= 400) return REQUEST_ERROR_CATEGORY.HTTP_4XX
  const envelope = readErrorEnvelope(error)
  if (envelope?.success === false) {
    const code = String(envelope?.error?.code || '')
    if (code === 'INTERNAL_ERROR') return REQUEST_ERROR_CATEGORY.HTTP_5XX
    return REQUEST_ERROR_CATEGORY.HTTP_4XX
  }
  if (isRequestNetworkError(error, signal)) return REQUEST_ERROR_CATEGORY.NETWORK
  return REQUEST_ERROR_CATEGORY.UNKNOWN
}

export function shouldRetryRequest(error, attempt, signal) {
  if (isRequestTimeout(error, signal)) return true
  if (isRequestCanceled(error, signal)) return false
  const status = Number(error?.response?.status || error?.status)
  if (Number.isInteger(status) && status >= 400 && status < 500) return false
  if (Number.isInteger(status) && status >= 500) return true
  return isRequestNetworkError(error, signal)
}

export function describeServiceLoadError(error, options = {}) {
  const serviceLabel = options.serviceLabel || '服务'
  const signal = options.signal
  const backendMessage = error?.response?.data?.error?.message
  if (backendMessage) return backendMessage
  const status = Number(error?.status || error?.response?.status)
  if (status === 404 && options.notFoundMessage) return options.notFoundMessage
  if (Number.isInteger(status) && status > 0) return `${serviceLabel}暂时不可用（HTTP ${status}）`
  if (isRequestTimeout(error, signal)) return `连接${serviceLabel}超时，请稍后重试`
  if (isRequestCanceled(error, signal)) return `${serviceLabel}请求已取消`
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

export function annotateRequestFailure(error, signal) {
  if (!error || typeof error !== 'object') return error
  const category = classifyRequestError(error, signal)
  if (category === REQUEST_ERROR_CATEGORY.TIMEOUT) error.isTimeout = true
  error.category = category
  const requestId = getRequestId(error)
  if (requestId) error.requestId = requestId
  return error
}

function annotateRequestError(error, signal) {
  return annotateRequestFailure(error, signal)
}

export async function withRequestRetry(task, options = {}) {
  if (typeof task !== 'function') throw new TypeError('withRequestRetry 需要可执行函数')
  const maxAttempts = Math.max(1, Number(options.maxAttempts) || 2)
  const delayMs = Math.max(0, Number(options.delayMs) || 400)
  const signal = options.signal
  const shouldRetry = typeof options.shouldRetry === 'function'
    ? options.shouldRetry
    : (error, attempt) => shouldRetryRequest(error, attempt, signal)
  let lastError = null

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (signal?.aborted) {
      const error = annotateRequestError(
        signal.reason instanceof Error ? signal.reason : new Error('请求已取消'),
        signal,
      )
      if (!error.code) error.code = error.isTimeout ? 'ECONNABORTED' : 'ERR_CANCELED'
      throw error
    }
    try {
      return await task(attempt)
    } catch (error) {
      lastError = annotateRequestError(error, signal)
      if (isRequestCanceled(lastError, signal) || attempt >= maxAttempts || !shouldRetry(lastError, attempt)) {
        throw lastError
      }
      await new Promise((resolve, reject) => {
        let settled = false
        const onAbort = () => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          const abortError = annotateRequestError(
            signal.reason instanceof Error ? signal.reason : new Error('请求已取消'),
            signal,
          )
          if (!abortError.code) abortError.code = abortError.isTimeout ? 'ECONNABORTED' : 'ERR_CANCELED'
          reject(abortError)
        }
        const timer = setTimeout(() => {
          if (settled) return
          settled = true
          signal?.removeEventListener('abort', onAbort)
          resolve()
        }, delayMs * attempt)
        if (!signal) return
        if (signal.aborted) onAbort()
        else signal.addEventListener('abort', onAbort, { once: true })
      })
    }
  }
  throw lastError
}
