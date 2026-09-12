import test from 'node:test'
import assert from 'node:assert/strict'
import {
  appendRequestIdHint,
  classifyRequestError,
  createTimeoutController,
  describeServiceLoadError,
  getRequestId,
  isRequestCanceled,
  isRequestNetworkError,
  isRequestTimeout,
  REQUEST_ERROR_CATEGORY,
  shouldRetryRequest,
  withRequestRetry,
  isSafeUserFacingMessage,
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
  assert.equal(isRequestCanceled({ code: 'ECONNABORTED' }), false)
  assert.equal(isRequestCanceled({ code: 'ECONNABORTED', isTimeout: true, name: 'AbortError' }), false)
  assert.equal(isRequestTimeout({ code: 'ERR_CANCELED' }), false)
  assert.equal(classifyRequestError({ code: 'ERR_CANCELED' }), REQUEST_ERROR_CATEGORY.CANCEL)
  assert.equal(classifyRequestError({ code: 'ECONNABORTED' }), REQUEST_ERROR_CATEGORY.TIMEOUT)
  assert.notEqual(classifyRequestError({ code: 'ERR_CANCELED' }), REQUEST_ERROR_CATEGORY.TIMEOUT)
  assert.notEqual(classifyRequestError({ code: 'ECONNABORTED' }), REQUEST_ERROR_CATEGORY.CANCEL)
  assert.equal(classifyRequestError({ code: 'ERR_NETWORK' }), REQUEST_ERROR_CATEGORY.NETWORK)
  assert.equal(classifyRequestError({ code: 'ECONNREFUSED' }), REQUEST_ERROR_CATEGORY.NETWORK)
  assert.equal(classifyRequestError({ response: { status: 404 } }), REQUEST_ERROR_CATEGORY.HTTP_4XX)
  assert.equal(classifyRequestError({ response: { status: 503 } }), REQUEST_ERROR_CATEGORY.HTTP_5XX)
})

test('service load errors prefer backend copy and localize timeout/network', () => {
  assert.equal(
    describeServiceLoadError({ response: { data: { error: { message: '后端说明' } } } }, { serviceLabel: '项目服务' }),
    '后端说明',
  )
  assert.equal(
    describeServiceLoadError({ response: { status: 503 } }, { serviceLabel: '项目服务' }),
    '项目服务暂时不可用，请稍后重试',
  )
  assert.equal(
    describeServiceLoadError({ response: { status: 401 } }, { serviceLabel: '项目服务' }),
    '项目服务认证失败，请检查密钥或登录状态',
  )
  assert.equal(
    describeServiceLoadError({ response: { status: 429 } }, { serviceLabel: '项目服务' }),
    '项目服务请求过于频繁，请稍后重试',
  )
  assert.equal(isSafeUserFacingMessage('项目服务暂时不可用（HTTP 503）'), false)
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

test('Failed to fetch 视为网络错误，英文 HTTP 500 和 drama_id 不会直出', () => {
  assert.equal(isRequestNetworkError({ message: 'Failed to fetch' }), true)
  assert.equal(isRequestNetworkError({ message: 'fetch failed' }), true)
  assert.equal(isRequestNetworkError({ message: 'socket hang up' }), true)
  assert.equal(classifyRequestError({ message: 'socket hang up' }), REQUEST_ERROR_CATEGORY.NETWORK)
  assert.equal(classifyRequestError({ message: 'Failed to fetch' }), REQUEST_ERROR_CATEGORY.NETWORK)
  assert.equal(
    describeServiceLoadError({ message: 'Failed to fetch' }, { serviceLabel: '项目服务' }),
    '无法连接项目服务，请检查服务是否已启动',
  )
  assert.equal(
    describeServiceLoadError(
      { response: { status: 500, data: { error: { message: 'Internal Server Error' } } } },
      { serviceLabel: '项目服务' },
    ),
    '项目服务暂时不可用，请稍后重试',
  )
  const dramaIdError = describeServiceLoadError(
    { response: { status: 400, data: { error: { message: '缺少 drama_id' } } } },
    { serviceLabel: '项目服务' },
  )
  assert.equal(dramaIdError, '项目服务请求无效，请检查后重试')
  assert.doesNotMatch(dramaIdError, /drama_id/)
  assert.equal(
    describeServiceLoadError({ name: 'AbortError', message: 'The user aborted a request.' }, { serviceLabel: '项目服务' }),
    '项目服务请求已取消',
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
  assert.equal(classifyRequestError(aborted), REQUEST_ERROR_CATEGORY.TIMEOUT)
  assert.equal(
    describeServiceLoadError(aborted, { serviceLabel: 'AI 配置服务' }),
    '连接AI 配置服务超时，请稍后重试',
  )

  const canceled = Object.assign(new Error('aborted'), { name: 'AbortError', code: 'ERR_CANCELED' })
  assert.equal(isRequestCanceled(canceled), true)
  assert.equal(isRequestTimeout(canceled), false)
  assert.equal(shouldRetryRequest(canceled), false)
  assert.equal(classifyRequestError(canceled), REQUEST_ERROR_CATEGORY.CANCEL)

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

test('4xx 业务中文错误保持原文，不会被当成无法连接服务', () => {
  const error = {
    status: 400,
    response: {
      status: 400,
      data: { success: false, error: { code: 'BAD_REQUEST', message: '名称不能为空' } },
    },
  }
  assert.equal(classifyRequestError(error), REQUEST_ERROR_CATEGORY.HTTP_4XX)
  assert.equal(describeServiceLoadError(error, { serviceLabel: '服务' }), '名称不能为空')
  assert.equal(isRequestCanceled(error), false)
  assert.equal(isRequestTimeout(error), false)
  assert.doesNotMatch(describeServiceLoadError(error), /无法连接服务/)
})

test('带 isTimeout 的 PROJECT_LOAD_FAILED 仍是超时而不是取消', () => {
  const error = Object.assign(new Error('PROJECT_LOAD_FAILED'), {
    status: 0,
    isTimeout: true,
    code: 'ECONNABORTED',
  })
  assert.equal(isRequestTimeout(error), true)
  assert.equal(isRequestCanceled(error), false)
  assert.equal(classifyRequestError(error), REQUEST_ERROR_CATEGORY.TIMEOUT)
  assert.equal(
    describeServiceLoadError(error, { serviceLabel: '服务' }),
    '连接服务超时，请稍后重试',
  )
})

test('appendRequestIdHint 仅在安全 requestId 时追加请求编号', () => {
  assert.equal(
    appendRequestIdHint('保存失败', { requestId: 'trace-ok-1' }),
    '保存失败（请求编号：trace-ok-1）',
  )
  assert.equal(appendRequestIdHint('保存失败', { requestId: '' }), '保存失败')
  assert.equal(appendRequestIdHint('保存失败', {}), '保存失败')
  assert.equal(appendRequestIdHint('', { requestId: 'trace-ok-1' }), '')
  assert.doesNotMatch(appendRequestIdHint('保存失败', { requestId: '' }), /（/)
  assert.equal(
    appendRequestIdHint('保存失败（请求编号：trace-ok-1）', { requestId: 'trace-ok-1' }),
    '保存失败（请求编号：trace-ok-1）',
  )
  assert.equal(
    getRequestId({ requestId: '../secret\r\nInjected: yes', config: { requestId: 'safe-trace-1' } }),
    'safe-trace-1',
  )
  assert.equal(
    appendRequestIdHint('保存失败', {
      requestId: '../secret\r\nInjected: yes',
      config: { requestId: 'safe-trace-1' },
    }),
    '保存失败（请求编号：safe-trace-1）',
  )
  assert.equal(
    appendRequestIdHint('保存失败', { requestId: '../secret\r\nInjected: yes' }),
    '保存失败',
  )
})

test('ECONNABORTED 的 AbortError 仍是超时，不会被 signal.aborted 改判成取消', () => {
  const reason = Object.assign(new Error('请求超时'), { code: 'ECONNABORTED', isTimeout: true })
  const signal = { aborted: true, reason }
  const abortError = Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' })
  assert.equal(isRequestTimeout(abortError, signal), true)
  assert.equal(isRequestCanceled(abortError, signal), false)
  assert.equal(shouldRetryRequest(abortError, 1, signal), true)
  assert.equal(classifyRequestError(abortError, signal), REQUEST_ERROR_CATEGORY.TIMEOUT)
  assert.match(describeServiceLoadError(abortError, { serviceLabel: '服务', signal }), /超时/)
  assert.doesNotMatch(describeServiceLoadError(abortError, { serviceLabel: '服务', signal }), /已取消/)
})

test('Image/Video 别名不会泄漏到超时文案，空名称按图片/视频分开', () => {
  assert.equal(
    describeServiceLoadError({ code: 'ECONNABORTED' }, { serviceLabel: 'Image' }),
    '连接图片服务超时，请稍后重试',
  )
  assert.equal(
    describeServiceLoadError({ code: 'ECONNABORTED' }, { serviceLabel: 'Video' }),
    '连接视频服务超时，请稍后重试',
  )
  assert.equal(
    describeServiceLoadError({ code: 'ECONNABORTED' }, { serviceLabel: 'Image provider' }),
    '连接图片服务超时，请稍后重试',
  )
  assert.equal(
    describeServiceLoadError({ code: 'ECONNABORTED' }, { serviceLabel: 'Video provider' }),
    '连接视频服务超时，请稍后重试',
  )
  assert.equal(
    describeServiceLoadError({ code: 'ECONNABORTED' }, { serviceLabel: '', operation: 'image request' }),
    '连接图片服务超时，请稍后重试',
  )
  assert.equal(
    describeServiceLoadError({ code: 'ECONNABORTED' }, { serviceLabel: '', operation: 'video request' }),
    '连接视频服务超时，请稍后重试',
  )
  assert.doesNotMatch(
    describeServiceLoadError({ code: 'ECONNABORTED' }, { serviceLabel: '', operation: 'image request' }),
    /视频服务|\bImage\b/,
  )
  assert.doesNotMatch(
    describeServiceLoadError({ code: 'ECONNABORTED' }, { serviceLabel: '', operation: 'video request' }),
    /图片服务|\bVideo\b/,
  )
  assert.equal(isSafeUserFacingMessage('Image 图片请求超时，请稍后重试'), false)
  assert.equal(isSafeUserFacingMessage('Video 视频请求超时，请稍后重试'), false)
  assert.equal(isSafeUserFacingMessage('图片服务 图片请求超时，请稍后重试'), true)
  const canceled = describeServiceLoadError(
    { code: 'ERR_CANCELED', name: 'CanceledError' },
    { serviceLabel: 'Video' },
  )
  assert.match(canceled, /已取消/)
  assert.doesNotMatch(canceled, /超时|\bVideo\b/)
})
