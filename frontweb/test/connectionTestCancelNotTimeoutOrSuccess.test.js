import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { describeConnectionTestError } from '../src/utils/aiConfigConnectionTest.js'
import { isUserFacingAbort } from '../src/utils/userFacingError.js'
import { isRequestTimeout } from '../src/utils/requestError.js'
import { remainingExtractNamedFunction } from './helpers/remainingSourceBetween.js'

const contentSource = readFileSync(new URL('../src/components/AIConfigContent.vue', import.meta.url), 'utf8')
const openTestSource = remainingExtractNamedFunction(contentSource, 'openTest')

function canceledError() {
  return Object.assign(new Error('canceled'), {
    name: 'CanceledError',
    code: 'ERR_CANCELED',
  })
}

function timeoutAbortError() {
  return Object.assign(new Error('The operation was aborted.'), {
    name: 'AbortError',
    isTimeout: true,
    code: 'ECONNABORTED',
  })
}

test('连接测试取消不得收成超时或成功', () => {
  const abortSignal = { aborted: true }
  const cancelled = describeConnectionTestError(canceledError(), abortSignal, 'text')
  assert.equal(cancelled.title, '连接测试已取消')
  assert.notEqual(cancelled.title, '连接测试超时')
  assert.doesNotMatch(cancelled.title, /通过|成功/)
  assert.doesNotMatch(cancelled.detail, /超时|通过|成功/)
  assert.equal(isUserFacingAbort(canceledError(), abortSignal), true)
  assert.equal(isRequestTimeout(canceledError(), abortSignal), false)
})

test('连接测试超时 abort 仍是超时，不能当成取消后的静默成功', () => {
  const reason = Object.assign(new Error('请求超时'), { code: 'ECONNABORTED', isTimeout: true })
  const signal = { aborted: true, reason }
  const timeoutAbort = timeoutAbortError()
  assert.equal(isRequestTimeout(timeoutAbort, signal), true)
  assert.equal(isUserFacingAbort(timeoutAbort, signal), false)
  const described = describeConnectionTestError(timeoutAbort, signal, 'text')
  assert.equal(described.title, '连接测试超时')
  assert.notEqual(described.title, '连接测试已取消')
  assert.doesNotMatch(described.title, /通过|成功/)
})

test('openTest 取消后直接返回，不记成功、超时或失败', () => {
  const abortIdx = openTestSource.indexOf('isUserFacingAbort(e, controller.signal)')
  const returnIdx = openTestSource.indexOf('return', abortIdx)
  const failedIdx = openTestSource.indexOf("connectionStatusStore.set(row.id, 'failed'")
  const successIdx = openTestSource.indexOf("phase: 'success'")
  assert.ok(abortIdx >= 0, 'openTest 必须识别用户取消')
  assert.ok(returnIdx > abortIdx, '取消后必须 return')
  assert.ok(failedIdx > returnIdx, '取消 return 必须发生在记失败之前')
  assert.ok(successIdx >= 0 && successIdx < abortIdx, '成功日志只应出现在 try 成功路径')

  const abortBlock = openTestSource.slice(abortIdx, returnIdx + 'return'.length)
  assert.doesNotMatch(abortBlock, /testResult\.value = true/)
  assert.doesNotMatch(abortBlock, /testResult\.value = false/)
  assert.doesNotMatch(abortBlock, /phase: 'success'/)
  assert.doesNotMatch(abortBlock, /phase: 'error'/)
  assert.doesNotMatch(abortBlock, /连接测试通过/)
  assert.doesNotMatch(abortBlock, /连接测试超时/)
  assert.doesNotMatch(abortBlock, /connectionStatusStore\.set\(row\.id, 'passed'/)
  assert.doesNotMatch(abortBlock, /connectionStatusStore\.set\(row\.id, 'failed'/)
  assert.match(abortBlock, /testResultAnnouncement\.value = ''/)
})
