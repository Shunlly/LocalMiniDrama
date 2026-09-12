import test from 'node:test'
import assert from 'node:assert/strict'

import { createSourceIntakeRunControls } from '../src/components/sourceIntake/sourceIntakeRunControls.js'

function ref(value) {
  return { value }
}

function createControls(overrides = {}) {
  const messages = []
  const polls = []
  const selectedRun = ref({ id: 'run-1' })
  const retrying = ref(false)
  const pausing = ref(false)
  const resuming = ref(false)
  const cancelling = ref(false)
  const controls = createSourceIntakeRunControls({
    selectedRun,
    isActionBusy: () => false,
    getControlReasons: () => ({ retry: '', pause: '', resume: '', cancel: '' }),
    retrying,
    pausing,
    resuming,
    cancelling,
    retryRunApi: async (id) => ({ id: 'run-2' }),
    pauseRunApi: async (id, reason) => ({ id, status: 'paused', reason }),
    resumeRunApi: async (id) => ({ id, status: 'running' }),
    cancelRunApi: async (id, reason) => ({ id, status: 'cancelled', reason }),
    cancelReason: '用户已取消处理',
    pauseReason: '用户已暂停处理',
    isLifecycleActive: () => true,
    refreshAndConfirmRun: async () => true,
    markWorkflowRefreshUnconfirmed: () => polls.push('unconfirmed'),
    persistProcessStep: () => polls.push('process'),
    showWorkflowMessage: (type, message) => messages.push([type, message]),
    emitRefresh: () => polls.push('refresh'),
    startPoll: () => polls.push('start'),
    stopPoll: () => polls.push('stop'),
    captureProductionReadinessError: () => false,
    shouldIgnoreError: () => false,
    isUserFacingAbort: () => false,
    toUserFacingError: (error, fallback) => error?.message || fallback,
    ...overrides,
  })
  return { controls, messages, polls, selectedRun, retrying }
}

test('重试会确认新 run 并回到处理步骤', async () => {
  const { controls, messages, polls } = createControls()
  await controls.retryRun()
  assert.deepEqual(messages, [['success', '已提交重试']])
  assert.ok(polls.includes('process'))
  assert.ok(polls.includes('start'))
  assert.ok(polls.includes('refresh'))
})

test('重试确认失败时仍挂上返回的 run 并开始轮询', async () => {
  const { controls, polls, selectedRun } = createControls({
    refreshAndConfirmRun: async () => false,
    retryRunApi: async () => ({ id: 'run-orphan' }),
  })
  await controls.retryRun()
  assert.equal(selectedRun.value.id, 'run-orphan')
  assert.ok(polls.includes('unconfirmed'))
  assert.ok(polls.includes('start'))
})

test('暂停和取消会停表，恢复会重新开表', async () => {
  const paused = createControls()
  await paused.controls.pauseRun()
  assert.deepEqual(paused.messages[0], ['success', '已暂停'])
  assert.ok(paused.polls.includes('stop'))

  const cancelled = createControls()
  await cancelled.controls.cancelRun()
  assert.deepEqual(cancelled.messages[0], ['success', '已取消'])
  assert.ok(cancelled.polls.includes('stop'))

  const resumed = createControls()
  await resumed.controls.resumeRun()
  assert.deepEqual(resumed.messages[0], ['success', '已恢复'])
  assert.ok(resumed.polls.includes('start'))
})

test('没有选中 run 或忙时直接返回', async () => {
  const idle = createControls({ selectedRun: ref(null) })
  await idle.controls.retryRun()
  assert.deepEqual(idle.messages, [])
  const busy = createControls({ isActionBusy: () => true })
  await busy.controls.pauseRun()
  assert.deepEqual(busy.messages, [])
})

test('取消处理在用户放弃确认时不会真正取消', async () => {
  const cancelled = createControls({
    confirmCancel: async () => false,
    cancelRunApi: async () => {
      throw new Error('should not cancel')
    },
  })
  await cancelled.controls.cancelRun()
  assert.deepEqual(cancelled.messages, [])

  const confirmed = createControls({
    confirmCancel: async () => true,
  })
  await confirmed.controls.cancelRun()
  assert.deepEqual(confirmed.messages[0], ['success', '已取消'])
})
