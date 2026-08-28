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