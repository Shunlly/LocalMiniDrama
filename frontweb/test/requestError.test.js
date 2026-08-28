import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createTimeoutController,
  describeServiceLoadError,
  isRequestCanceled,
  isRequestNetworkError,
  isRequestTimeout,
  shouldRetryRequest,
  withRequestRetry,
} from '../src/utils/requestError.js'

test('request errors distinguish cancel, timeout, network and HTTP status', () => {
  assert.equal(isRequestCanceled({ code: 'ERR_CANCELED' }), true)
  assert.equal(isRequestCanceled({ name: 'AbortError' }), true)
  assert.equal(isRequestCanceled({ name: 'CanceledError' }), true)
  assert.equal(isRequestTimeout({ code: 'ECONNABORTED' }), true)
  assert.equal(isRequestTimeout({ message: 'timeout of 15000ms exceeded' }), true)
  assert.equal(isRequestNetworkError({ code: 'ERR_NETWORK' }), true)
  assert.equal(isRequestNetworkError({ code: 'ECONNABORTED' }), false)
  assert.equal(shouldRetryRequest({ code: 'ECONNABORTED' }), true)
  assert.equal(shouldRetryRequest({ response: { status: 500 } }), true)
  assert.equal(shouldRetryRequest({ response: { status: 404 } }), false)
  assert.equal(shouldRetryRequest({ code: 'ERR_CANCELED' }), false)
})

test('service load errors prefer backend copy and localize timeout/network', () => {
  assert.equal(
    describeServiceLoadError({ response: { data: { error: { message: '后端说明' } } } }, { serviceLabel: '项目服务' }),
    '后端说明',
  )
  assert.equal(
    describeServiceLoadError({ response: { status: 503 } }, { serviceLabel: '项目服务' }),
    '项目服务暂时不可用（HTTP 503）',
  )
  assert.equal(
    describeServiceLoadError({ code: 'ECONNABORTED' }, { serviceLabel: '素材服务' }),
    '连接素材服务超时，请稍后重试',
  )
  assert.equal(
    describeServiceLoadError({ message: 'Network Error' }, { serviceLabel: '项目服务' }),
    '无法连接项目服务，请检查服务是否已启动',
  )
  assert.equal(
    describeServiceLoadError({ status: 404 }, { serviceLabel: '项目服务', notFoundMessage: '该项目不存在' }),
    '该项目不存在',
  )
})

test('withRequestRetry retries timeout once then succeeds, and never retries cancel', async () => {
  let attempts = 0
  const result = await withRequestRetry(async () => {
    attempts += 1
    if (attempts === 1) {
      const error = new Error('timeout of 15000ms exceeded')
      error.code = 'ECONNABORTED'
      throw error
    }
    return 'ok'
  }, { maxAttempts: 2, delayMs: 0 })
  assert.equal(result, 'ok')
  assert.equal(attempts, 2)

  let canceledAttempts = 0
  await assert.rejects(
    withRequestRetry(async () => {
      canceledAttempts += 1
      const error = new Error('aborted')
      error.code = 'ERR_CANCELED'
      throw error
    }, { maxAttempts: 3, delayMs: 0 }),
    { code: 'ERR_CANCELED' },
  )
  assert.equal(canceledAttempts, 1)
})

test('timeout controller aborts after the budget and marks timeout', async () => {
  const timeout = createTimeoutController(20)
  try {
    await new Promise((_, reject) => {
      timeout.signal.addEventListener('abort', () => {
        reject(timeout.signal.reason || new Error('aborted'))
      })
    })
    assert.fail('should abort')
  } catch (error) {
    assert.equal(timeout.didTimeout(), true)
    assert.equal(isRequestTimeout(error), true)
  } finally {
    timeout.dispose()
  }
})
