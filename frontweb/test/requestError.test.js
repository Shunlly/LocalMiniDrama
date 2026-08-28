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

test('timeout abort is not treated as cancel and remains retryable', async () => {
  const reason = Object.assign(new Error('请求超时'), { code: 'ECONNABORTED', isTimeout: true })
  const aborted = Object.assign(new Error('canceled'), {
    name: 'CanceledError',
    code: 'ERR_CANCELED',
    config: { signal: { reason } },
  })
  assert.equal(isRequestTimeout(aborted), true)
  assert.equal(isRequestCanceled(aborted), false)
  assert.equal(shouldRetryRequest(aborted), true)
  assert.equal(
    describeServiceLoadError(aborted, { serviceLabel: 'AI 配置服务' }),
    '连接AI 配置服务超时，请稍后重试',
  )

  const canceled = Object.assign(new Error('aborted'), { name: 'AbortError', code: 'ERR_CANCELED' })
  assert.equal(isRequestCanceled(canceled), true)
  assert.equal(isRequestTimeout(canceled), false)
  assert.equal(shouldRetryRequest(canceled), false)

  const timeout = createTimeoutController(20)
  const abortError = Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' })
  try {
    await new Promise((_, reject) => {
      timeout.signal.addEventListener('abort', () => reject(abortError))
    })
    assert.fail('should abort')
  } catch (error) {
    assert.equal(timeout.didTimeout(), true)
    assert.equal(isRequestTimeout(error, timeout.signal), true)
    assert.equal(isRequestCanceled(error, timeout.signal), false)
    assert.equal(shouldRetryRequest(error, 1, timeout.signal), true)
  } finally {
    timeout.dispose()
  }

  let attempts = 0
  const result = await withRequestRetry(async () => {
    attempts += 1
    if (attempts === 1) throw aborted
    return 'recovered'
  }, { maxAttempts: 2, delayMs: 0 })
  assert.equal(result, 'recovered')
  assert.equal(attempts, 2)
})

test('withRequestRetry aborts its retry delay without another attempt', async () => {
  const controller = new AbortController()
  let attempts = 0
  const startedAt = Date.now()
  const pending = withRequestRetry(async () => {
    attempts += 1
    const error = new Error('timeout of 15000ms exceeded')
    error.code = 'ECONNABORTED'
    throw error
  }, { maxAttempts: 3, delayMs: 400, signal: controller.signal })

  await new Promise((resolve) => setTimeout(resolve, 20))
  controller.abort()
  await assert.rejects(pending, (error) => (
    isRequestCanceled(error, controller.signal)
    || error?.code === 'ERR_CANCELED'
    || error?.name === 'AbortError'
    || error?.name === 'CanceledError'
  ))
  assert.equal(attempts, 1)
  assert.ok(Date.now() - startedAt < 200, 'abort must clear the pending retry timer')
})
