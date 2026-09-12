import test from 'node:test'
import assert from 'node:assert/strict'

import {
  createOperationId,
  getOperationLogs,
  installOperationLogSink,
  logOperation,
  resetOperationLogs,
  runLoggedOperation,
} from '../src/utils/operationLog.js'

test('操作日志记录开始/成功/失败/取消，并脱敏敏感字段', async () => {
  resetOperationLogs()
  const captured = []
  const restore = installOperationLogSink((record) => captured.push(record))
  try {
    logOperation({
      operation: 'demo',
      operationId: 'op-1',
      phase: 'start',
      api_key: 'sk-secret-placeholder',
    })
    const ok = await runLoggedOperation('demo_run', async () => 'done', { scene: 'unit' })
    assert.equal(ok, 'done')
    await assert.rejects(
      () => runLoggedOperation('demo_fail', async () => {
        throw new Error('boom')
      }),
      /boom/,
    )
    await assert.rejects(
      () => runLoggedOperation('demo_cancel', async () => {
        throw Object.assign(new Error('全流程已取消'), { pipelineAborted: true })
      }),
      /全流程已取消/,
    )
  } finally {
    restore()
  }

  const logs = getOperationLogs()
  assert.equal(logs[0].operation, 'demo')
  assert.equal(logs[0].phase, 'start')
  assert.equal(logs[0].details.api_key, '[已脱敏]')
  assert.deepEqual(captured.map((item) => item.phase), logs.map((item) => item.phase))
  assert.equal(logs.some((item) => item.operation === 'demo_run' && item.phase === 'success'), true)
  assert.equal(logs.some((item) => item.operation === 'demo_fail' && item.phase === 'error' && item.error === 'boom'), true)
  assert.equal(logs.some((item) => item.operation === 'demo_cancel' && item.phase === 'cancel'), true)
  assert.ok(createOperationId('pipeline').startsWith('pipeline-'))
})

test('操作日志继续记录 category 和 requestId', () => {
  resetOperationLogs()
  logOperation({
    operation: 'http_request',
    operationId: 'trace-ok-1',
    phase: 'error',
    status: 'http_5xx',
    category: 'http_5xx',
    requestId: 'trace-ok-1',
    error: '服务器内部错误',
  })
  const rec = getOperationLogs()[0]
  assert.equal(rec.operation, 'http_request')
  assert.equal(rec.operationId, 'trace-ok-1')
  assert.equal(rec.details.category, 'http_5xx')
  assert.equal(rec.details.requestId, 'trace-ok-1')
  assert.equal(rec.error, '服务器内部错误')
})

test('缺少 operationId 时会自动补操作编号，取消不会记成成功', async () => {
  resetOperationLogs()
  logOperation({ operation: 'film_create', phase: 'start', action: 'pipeline_stop_start' })
  const start = getOperationLogs()[0]
  assert.match(String(start.operationId || ''), /^film_create-/)

  await assert.rejects(
    () => runLoggedOperation('demo_canceled_error', async () => {
      throw Object.assign(new Error('canceled'), { name: 'CanceledError', code: 'ERR_CANCELED' })
    }),
    /canceled/,
  )
  const cancelRec = getOperationLogs().find((item) => item.operation === 'demo_canceled_error' && item.phase !== 'start')
  assert.equal(cancelRec.phase, 'cancel')
  assert.equal(cancelRec.status, 'cancelled')
  assert.notEqual(cancelRec.phase, 'success')

  await assert.rejects(
    () => runLoggedOperation('demo_timeout_error', async () => {
      throw Object.assign(new Error('timeout of 15000ms exceeded'), { code: 'ECONNABORTED', isTimeout: true })
    }),
    /timeout/,
  )
  const timeoutRec = getOperationLogs().find((item) => item.operation === 'demo_timeout_error' && item.phase !== 'start')
  assert.equal(timeoutRec.phase, 'error')
  assert.notEqual(timeoutRec.phase, 'cancel')
})

test('缺省 operationId 不回落 requestId，请求编号单独保留', () => {
  resetOperationLogs()
  logOperation({
    operation: 'http_request',
    phase: 'error',
    requestId: 'trace-req-1',
    error: '服务器内部错误',
  })
  const rec = getOperationLogs()[0]
  assert.match(String(rec.operationId || ''), /^http_request-/)
  assert.notEqual(rec.operationId, 'trace-req-1')
  assert.equal(rec.details.requestId, 'trace-req-1')
})
