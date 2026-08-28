import { afterEach, beforeEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'

import { ElMessage } from '../src/utils/elementPlusFeedback.js'
import { getOperationLogs, resetOperationLogs } from '../src/utils/operationLog.js'
import request, { ensureRequestId, shouldShowRequestErrorToast } from '../src/utils/request.js'
import {
  classifyRequestError,
  createTimeoutController,
  describeServiceLoadError,
  getRequestId,
  isRequestCanceled,
  isRequestTimeout,
  REQUEST_ERROR_CATEGORY,
  shouldRetryRequest,
} from '../src/utils/requestError.js'

const originalError = ElMessage.error
const toasts = []

function httpLogs() {
  return getOperationLogs().filter((item) => item.operation === 'http_request')
}

function jsonAdapter(status, data, extraHeaders = {}) {
  return async (config) => ({
    config,
    status,
    statusText: status >= 400 ? 'Error' : 'OK',
    headers: {
      'x-request-id': config.requestId,
      ...extraHeaders,
    },
    data,
  })
}

describe('request observability', { concurrency: false }, () => {
beforeEach(() => {
  toasts.length = 0
  ElMessage.error = (msg) => {
    toasts.push(msg)
    return { close() {} }
  }
  resetOperationLogs()
})

afterEach(() => {
  ElMessage.error = originalError
})

test('ensureRequestId reuses a safe id and replaces unsafe values', () => {
  const reused = ensureRequestId({ headers: { 'X-Request-Id': 'trace-123:child' } })
  assert.equal(reused.requestId, 'trace-123:child')
  assert.equal(reused.headers['X-Request-Id'], 'trace-123:child')

  const replaced = ensureRequestId({ headers: { 'X-Request-Id': '../secret\r\nInjected: yes' } })
  assert.match(replaced.requestId, /^[A-Za-z0-9._:-]{1,128}$/)
  assert.notEqual(replaced.requestId, '../secret\r\nInjected: yes')
  assert.equal(replaced.headers['X-Request-Id'], replaced.requestId)
})

test('getRequestId prefers response envelope then header then config', () => {
  assert.equal(getRequestId({
    config: { requestId: 'from-config', headers: { 'X-Request-Id': 'from-header' } },
    response: {
      headers: { 'x-request-id': 'from-response-header' },
      data: { request_id: 'from-body', error: { request_id: 'from-error' } },
    },
  }), 'from-error')
  assert.equal(getRequestId({
    config: { requestId: 'from-config' },
    response: { headers: { 'x-request-id': 'from-response-header' }, data: {} },
  }), 'from-response-header')
  assert.equal(getRequestId({ config: { requestId: 'from-config' } }), 'from-config')
})

test('5xx failures keep requestId, classify as http_5xx, and toast in Chinese', async () => {
  await assert.rejects(
    request.get('/boom', {
      adapter: async (config) => ({
        config,
        status: 500,
        statusText: 'Error',
        headers: { 'x-request-id': config.requestId },
        data: {
          success: false,
          error: { code: 'INTERNAL_ERROR', message: '服务器内部错误', request_id: config.requestId },
          request_id: config.requestId,
        },
      }),
    }),
    (error) => {
      assert.equal(error.category, REQUEST_ERROR_CATEGORY.HTTP_5XX)
      assert.match(String(error.requestId || ''), /^[A-Za-z0-9._:-]{1,128}$/)
      assert.equal(error.message, '服务器内部错误')
      assert.equal(toasts.length, 1)
      assert.match(toasts[0], /服务器内部错误/)
      assert.match(toasts[0], new RegExp(`请求号 ${error.requestId}`))
      const logs = httpLogs()
      assert.equal(logs.length, 1)
      assert.equal(logs[0].operationId, error.requestId)
      assert.equal(logs[0].phase, 'error')
      assert.equal(logs[0].details.category, REQUEST_ERROR_CATEGORY.HTTP_5XX)
      assert.equal(logs[0].details.requestId, error.requestId)
      return true
    },
  )
})

test('4xx failures keep backend copy and do not treat cancel/timeout', async () => {
  await assert.rejects(
    request.post('/items', { name: '' }, {
      adapter: jsonAdapter(400, {
        success: false,
        error: { code: 'BAD_REQUEST', message: '名称不能为空' },
      }),
    }),
    (error) => {
      assert.equal(error.category, REQUEST_ERROR_CATEGORY.HTTP_4XX)
      assert.equal(error.message, '名称不能为空')
      assert.equal(toasts[0], '名称不能为空')
      assert.equal(isRequestCanceled(error), false)
      assert.equal(isRequestTimeout(error), false)
      assert.equal(shouldRetryRequest(error), false)
      return true
    },
  )
})

test('network failures toast Chinese copy and keep requestId in logs', async () => {
  await assert.rejects(
    request.get('/offline', {
      adapter: async (config) => {
        const error = new Error('Network Error')
        error.code = 'ERR_NETWORK'
        error.config = config
        throw error
      },
    }),
    (error) => {
      assert.equal(error.category, REQUEST_ERROR_CATEGORY.NETWORK)
      assert.match(String(error.requestId || ''), /^[A-Za-z0-9._:-]{1,128}$/)
      assert.equal(error.message, '无法连接服务，请检查服务是否已启动')
      assert.match(toasts[0], /无法连接服务，请检查服务是否已启动/)
      assert.match(toasts[0], /请求号/)
      assert.doesNotMatch(toasts[0], /Network Error/)
      const logs = httpLogs()
      assert.equal(logs[0].details.category, REQUEST_ERROR_CATEGORY.NETWORK)
      assert.equal(logs[0].operationId, error.requestId)
      return true
    },
  )
})

test('timeout abort stays retryable timeout, not cancel', async () => {
  const timeout = createTimeoutController(20)
  try {
    await assert.rejects(
      request.get('/slow', {
        signal: timeout.signal,
        adapter: async (config) => new Promise((_, reject) => {
          const onAbort = () => {
            const error = new Error('canceled')
            error.name = 'CanceledError'
            error.code = 'ERR_CANCELED'
            error.config = config
            reject(error)
          }
          if (config.signal?.aborted) onAbort()
          else config.signal.addEventListener('abort', onAbort, { once: true })
        }),
      }),
      (error) => {
        assert.equal(timeout.didTimeout(), true)
        assert.equal(classifyRequestError(error, timeout.signal), REQUEST_ERROR_CATEGORY.TIMEOUT)
        assert.equal(isRequestTimeout(error, timeout.signal), true)
        assert.equal(isRequestCanceled(error, timeout.signal), false)
        assert.equal(shouldRetryRequest(error, 1, timeout.signal), true)
        assert.equal(shouldShowRequestErrorToast(error), true)
        assert.match(toasts[0], /连接服务超时，请稍后重试/)
        assert.match(toasts[0], /请求号/)
        return true
      },
    )
  } finally {
    timeout.dispose()
  }
})

test('user cancel does not toast and is logged as cancel', async () => {
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(
    request.get('/x', {
      signal: controller.signal,
      adapter: jsonAdapter(200, { success: true, data: {} }),
    }),
    (error) => {
      assert.equal(classifyRequestError(error, controller.signal), REQUEST_ERROR_CATEGORY.CANCEL)
      assert.equal(shouldShowRequestErrorToast(error), false)
      assert.equal(toasts.length, 0)
      const logs = httpLogs()
      assert.equal(logs[0].phase, 'cancel')
      assert.equal(logs[0].details.category, REQUEST_ERROR_CATEGORY.CANCEL)
      assert.match(String(error.requestId || logs[0].operationId || ''), /^[A-Za-z0-9._:-]{1,128}$/)
      return true
    },
  )
})

test('business envelope failures keep requestId without double toast', async () => {
  await assert.rejects(
    request.get('/biz', {
      adapter: jsonAdapter(200, {
        success: false,
        error: { code: 'BAD_REQUEST', message: '名称不能为空', request_id: 'body-req' },
        request_id: 'body-req',
      }),
    }),
    (error) => {
      assert.equal(error.message, '名称不能为空')
      assert.equal(error.requestId, 'body-req')
      assert.equal(error.category, REQUEST_ERROR_CATEGORY.HTTP_4XX)
      assert.equal(toasts.length, 0)
      const logs = httpLogs()
      assert.equal(logs[0].operationId, 'body-req')
      return true
    },
  )
})

test('request failure logs do not record API keys', async () => {
  await assert.rejects(
    request.get('/secret', {
      headers: {
        Authorization: 'Bearer sk-secret-key-123456',
        'X-API-Key': 'sk-secret-key-123456',
      },
      adapter: async (config) => {
        const error = new Error('Network Error api_key=sk-secret-key-123456')
        error.code = 'ERR_NETWORK'
        error.config = config
        throw error
      },
    }),
    (error) => {
      const serialized = JSON.stringify(httpLogs())
      assert.doesNotMatch(serialized, /sk-secret-key-123456/)
      assert.doesNotMatch(serialized, /Bearer sk-secret/)
      assert.equal(error.category, REQUEST_ERROR_CATEGORY.NETWORK)
      return true
    },
  )
})

test('unknown failures keep actionable Chinese copy instead of generic network text', async () => {
  await assert.rejects(
    request.put('/dramas/1', {}, {
      adapter: async (config) => {
        const error = new Error('项目保存失败')
        error.config = config
        throw error
      },
    }),
    (error) => {
      assert.equal(error.category, REQUEST_ERROR_CATEGORY.UNKNOWN)
      assert.equal(error.message, '项目保存失败')
      assert.equal(toasts[0], '项目保存失败')
      assert.doesNotMatch(toasts[0], /无法连接服务/)
      return true
    },
  )
})

test('describeServiceLoadError keeps stable Chinese copy for timeout and network', () => {
  assert.equal(
    describeServiceLoadError({ code: 'ECONNABORTED' }, { serviceLabel: '素材服务' }),
    '连接素材服务超时，请稍后重试',
  )
  assert.equal(
    describeServiceLoadError({ message: 'Network Error' }, { serviceLabel: '项目服务' }),
    '无法连接项目服务，请检查服务是否已启动',
  )
})
})
