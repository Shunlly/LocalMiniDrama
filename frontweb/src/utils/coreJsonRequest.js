import { ElMessage } from './elementPlusFeedback.js'
import { logOperation } from './operationLog.js'
import { ensureRequestId, shouldShowRequestErrorToast } from './request.js'
import {
  annotateRequestFailure,
  createTimeoutController,
  DEFAULT_JSON_TIMEOUT_MS,
  describeServiceLoadError,
  getRequestId,
  isRequestCanceled,
  isRequestTimeout,
  isSafeUserFacingMessage,
  REQUEST_ERROR_CATEGORY,
} from './requestError.js'
import { toUserFacingError } from './userFacingError.js'

export function coreRequestError(status, message = 'PROJECT_LOAD_FAILED') {
  const error = new Error(message)
  error.status = Number(status) || 0
  return error
}

function requestLogPath(config) {
  return String(config?.url || '').split('?')[0]
}

function redactLogText(value) {
  return String(value || '')
    .replace(/\bsk-[A-Za-z0-9._-]{6,}\b/gi, '[已脱敏]')
    .replace(/\b(Bearer|Basic|Token)\s+\S+/gi, '$1 [已脱敏]')
    .replace(/\b(api[_-]?key|access[_-]?key|secret|password|token)\s*[:=]\s*\S+/gi, '$1=[已脱敏]')
}

function readBackendMessage(error) {
  const message = error?.response?.data?.error?.message
  return typeof message === 'string' && message.trim() ? message.trim() : ''
}

function userFacingFallback(error) {
  const category = error?.category
  if (
    category === REQUEST_ERROR_CATEGORY.NETWORK
    || category === REQUEST_ERROR_CATEGORY.TIMEOUT
    || category === REQUEST_ERROR_CATEGORY.CANCEL
    || category === REQUEST_ERROR_CATEGORY.HTTP_4XX
    || category === REQUEST_ERROR_CATEGORY.HTTP_5XX
  ) {
    return undefined
  }
  const message = String(error?.message || '').trim()
  if (!message) return undefined
  if (/^(Network Error|canceled|timeout of \d+ms exceeded|Request failed with status code \d+|PROJECT_LOAD_FAILED|Failed to fetch|fetch failed|Load failed|HTTP\s*\d+)$/i.test(message)) {
    return undefined
  }
  return message
}

function logFetchRequestFailure(error, userMessage) {
  const category = error?.category
  const requestId = error?.requestId || getRequestId(error) || ''
  logOperation({
    operation: 'http_request',
    operationId: requestId || null,
    phase: category === REQUEST_ERROR_CATEGORY.CANCEL ? 'cancel' : 'error',
    status: category,
    category,
    requestId: requestId || null,
    method: error?.config?.method ? String(error.config.method).toUpperCase() : undefined,
    url: requestLogPath(error?.config),
    httpStatus: Number(error?.response?.status || error?.status || 0) || null,
    error: redactLogText(userMessage || error?.message || ''),
  })
}

function toastFetchRequestFailure(error, userMessage) {
  if (!shouldShowRequestErrorToast(error)) return
  try {
    ElMessage.error(userMessage)
  } catch (_) {
    // Node 测试或无 DOM 时不能阻断失败分类与日志。
  }
}

export function prepareFetchRequest(config = {}) {
  const headers = { ...(config.headers || {}) }
  return ensureRequestId({
    suppressErrorToast: true,
    ...config,
    headers,
  })
}

export function finalizeFetchRequestFailure(error, options = {}) {
  if (!error || typeof error !== 'object') return error
  if (options.config) error.config = options.config
  const signal = options.signal || error.config?.signal
  annotateRequestFailure(error, signal)
  const requestId = getRequestId(error) || error.config?.requestId || ''
  if (requestId) error.requestId = requestId
  const backendMsg = readBackendMessage(error)
  const described = describeServiceLoadError(error, {
    serviceLabel: options.serviceLabel || '服务',
    signal,
    fallback: userFacingFallback(error),
  })
  const userMsg = toUserFacingError(error, described, {
    serviceLabel: options.serviceLabel || '服务',
    signal,
  })
  logFetchRequestFailure(error, userMsg)
  toastFetchRequestFailure(error, userMsg)
  if (isSafeUserFacingMessage(backendMsg)) error.message = backendMsg
  else if (backendMsg && !isSafeUserFacingMessage(error.message)) error.message = 'PROJECT_LOAD_FAILED'
  return error
}

function decorateFetchTransportError(error, { didTimeout, signal }) {
  const next = coreRequestError(0)
  if (didTimeout || isRequestTimeout(error, signal)) {
    next.isTimeout = true
    next.code = 'ECONNABORTED'
  } else if (isRequestCanceled(error, signal) || signal?.aborted) {
    next.name = 'AbortError'
    next.code = 'ERR_CANCELED'
  } else {
    next.code = 'ERR_NETWORK'
  }
  if (error instanceof Error) next.cause = error
  return next
}

function attachHttpContext(error, { status, payload, response, config }) {
  const httpStatus = Number(status || response?.status || 0)
  if (Number.isInteger(httpStatus) && httpStatus > 0) error.status = httpStatus
  error.config = config
  if (response) {
    error.response = {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
      data: payload,
    }
  }
  return error
}

export async function requestCoreJson(path, {
  method = 'GET',
  body,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_JSON_TIMEOUT_MS,
  signal,
  suppressErrorToast = true,
} = {}) {
  const timeout = createTimeoutController(timeoutMs, signal)
  const headers = {
    Accept: 'application/json',
    ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
  }
  const config = prepareFetchRequest({
    method,
    url: `/api/v1${path}`,
    headers,
    signal: timeout.signal,
    suppressErrorToast,
  })

  const failTransport = (error) => finalizeFetchRequestFailure(
    decorateFetchTransportError(error, {
      didTimeout: timeout.didTimeout(),
      signal: timeout.signal,
    }),
    { config, signal: timeout.signal },
  )

  const failHttp = (status, payload, response) => {
    const backendMsg = typeof payload?.error?.message === 'string' ? payload.error.message.trim() : ''
    const error = coreRequestError(status, backendMsg || 'PROJECT_LOAD_FAILED')
    attachHttpContext(error, { status, payload, response, config })
    return finalizeFetchRequestFailure(error, { signal: timeout.signal })
  }

  try {
    if (timeout.signal.aborted) {
      throw failTransport(timeout.signal.reason || new Error('请求已取消'))
    }

    let response
    try {
      response = await fetchImpl(config.url, {
        method,
        credentials: 'same-origin',
        signal: timeout.signal,
        headers: config.headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
    } catch (error) {
      throw failTransport(error)
    }

    let payload = null
    try {
      payload = response.status === 204 ? null : await response.json()
    } catch (_) {
      throw failHttp(response.status, null, response)
    }
    if (!response.ok || payload?.success === false) {
      throw failHttp(response.status, payload, response)
    }
    return payload?.data !== undefined ? payload.data : payload
  } finally {
    timeout.dispose()
  }
}
