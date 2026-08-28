import { ElMessage } from './elementPlusFeedback.js'
import axios from 'axios'
import { logOperation } from './operationLog.js'
import {
  classifyRequestError,
  createRequestId,
  describeServiceLoadError,
  getRequestId,
  isRequestCanceled,
  REQUEST_ERROR_CATEGORY,
} from './requestError.js'

const request = axios.create({
  baseURL: '/api/v1',
  timeout: 600000,
  headers: { 'Content-Type': 'application/json' }
})

let requestErrorToastOwnerDepth = 0

export function runWithOwnedRequestErrorToast(operation) {
  requestErrorToastOwnerDepth += 1
  try {
    return operation()
  } finally {
    requestErrorToastOwnerDepth -= 1
  }
}

function readHeaderValue(headers, name) {
  if (!headers) return ''
  if (typeof headers.get === 'function') {
    return String(headers.get(name) || headers.get(name.toLowerCase()) || '').trim()
  }
  const direct = headers[name] || headers[name.toLowerCase()]
  if (Array.isArray(direct)) return String(direct[0] || '').trim()
  return String(direct || '').trim()
}

function setHeaderValue(headers, name, value) {
  if (!headers) return
  if (typeof headers.set === 'function') {
    headers.set(name, value)
    return
  }
  headers[name] = value
}

export function ensureRequestId(config) {
  const next = config || {}
  const existing = getRequestId({ config: next }, next)
  const requestId = existing || createRequestId()
  next.requestId = requestId
  if (!next.headers) next.headers = {}
  if (readHeaderValue(next.headers, 'x-request-id') !== requestId) {
    setHeaderValue(next.headers, 'X-Request-Id', requestId)
  }
  return next
}

export function shouldShowRequestErrorToast(error) {
  return error?.config?.suppressErrorToast !== true
    && !isRequestCanceled(error, error?.config?.signal)
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

function applyRequestFailure(error) {
  if (!error || typeof error !== 'object') return error
  const requestId = getRequestId(error) || error.config?.requestId || ''
  if (requestId) error.requestId = requestId
  error.category = classifyRequestError(error, error.config?.signal)
  return error
}

function userFacingFallback(error) {
  const category = error?.category || classifyRequestError(error, error?.config?.signal)
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
  if (/^(Network Error|canceled|timeout of \d+ms exceeded|Request failed with status code \d+)$/i.test(message)) {
    return undefined
  }
  return message
}

function logRequestFailure(error, userMessage) {
  const category = error?.category || classifyRequestError(error, error?.config?.signal)
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

request.interceptors.request.use(
  (config) => {
    if (requestErrorToastOwnerDepth > 0) config.suppressErrorToast = true
    ensureRequestId(config)
    if (config.signal?.aborted) {
      const error = Object.assign(
        config.signal.reason instanceof Error ? config.signal.reason : new Error('请求已取消'),
        { config },
      )
      if (!error.code) error.code = error.isTimeout ? 'ECONNABORTED' : 'ERR_CANCELED'
      applyRequestFailure(error)
      logRequestFailure(error, describeServiceLoadError(error, {
        serviceLabel: '服务',
        signal: config.signal,
      }))
    }
    return config
  },
  undefined,
  { synchronous: true },
)

function finalizeTransportError(error) {
  applyRequestFailure(error)
  // 提取后端实际错误信息（优先 API 返回的 message，而非 axios 通用 "status code 500"）
  const backendMsg = error.response?.data?.error?.message
  const userMsg = backendMsg || describeServiceLoadError(error, {
    serviceLabel: '服务',
    signal: error.config?.signal,
    fallback: userFacingFallback(error),
  })
  logRequestFailure(error, userMsg)
  let msg = userMsg
  if (
    error.requestId
    && (
      error.category === REQUEST_ERROR_CATEGORY.HTTP_5XX
      || error.category === REQUEST_ERROR_CATEGORY.TIMEOUT
      || error.category === REQUEST_ERROR_CATEGORY.NETWORK
    )
  ) {
    msg = `${userMsg}（请求号 ${error.requestId}）`
  }
  if (shouldShowRequestErrorToast(error)) ElMessage.error(msg)
  // 将真实错误信息写回 message，使组件 catch 块可直接用 e.message 获取可读内容
  if (backendMsg) error.message = backendMsg
  else if (userMsg && userMsg !== error.message) error.message = userMsg
  return Promise.reject(error)
}

request.interceptors.response.use(
  (response) => {
    // blob 类型直接返回原始数据，不做 JSON 解包
    if (response.config?.responseType === 'blob') {
      return response.data
    }
    const res = response.data
    const httpError = Number(response.status) >= 400
    if (!httpError && res?.success !== false) {
      return res.data !== undefined ? res.data : res
    }
    const error = Object.assign(new Error(res?.error?.message || '请求失败'), {
      config: response.config,
      response,
    })
    if (!httpError) {
      applyRequestFailure(error)
      logRequestFailure(error, error.message)
      return Promise.reject(error)
    }
    return finalizeTransportError(error)
  },
  (error) => finalizeTransportError(error),
)

export default request
