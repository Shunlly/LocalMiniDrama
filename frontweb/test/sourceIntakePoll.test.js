import test from 'node:test'
import assert from 'node:assert/strict'

import { createSourceIntakePollController, createSourceIntakePollSession } from '../src/components/sourceIntake/sourceIntakePoll.js'

test('素材流程轮询在生命周期结束后立刻停，不会在空闲运行时开表', () => {
  const ticks = []
  const states = []
  const errors = []
  let active = true
  let runActive = false
  const poll = createSourceIntakePollController({
    isLifecycleActive: () => active,
    isRunActive: () => runActive,
    setPollState: (value) => states.push(value),
    setPollError: (value) => errors.push(value),
    refreshSelectedRun: () => ticks.push('tick'),
    intervalMs: 20,
  })
  poll.startPoll()
  assert.deepEqual(states, ['idle'])
  assert.deepEqual(errors, [''])
  runActive = true
  poll.startPoll()
  assert.equal(states.at(-1), 'polling')
  active = false
  poll.startPoll()
  poll.stopPoll()
  assert.deepEqual(ticks, [])
})

function ref(value) {
  return { value }
}

test('选中 run 结束后会停表并刷新快照，失败时进入可恢复错误', async () => {
  const selectedRun = ref({ id: 'run-1', status: 'running' })
  const pollState = ref('polling')
  const pollError = ref('')
  const events = []
  const session = createSourceIntakePollSession({
    sourceWorkflowLifecycle: { isActive: () => true },
    isRunActive: () => true,
    pollState,
    pollError,
    selectedRun,
    getRun: async (id) => ({ id, status: 'completed' }),
    isUserFacingAbort: () => false,
    toUserFacingError: (error, fallback) => fallback,
    refreshWorkflowSnapshot: async () => { events.push('snapshot') },
    emitRefresh: () => events.push('refresh'),
  })
  await session.refreshSelectedRun()
  assert.equal(selectedRun.value.status, 'completed')
  assert.equal(pollState.value, 'idle')
  assert.deepEqual(events, ['snapshot', 'refresh'])

  const failedRun = ref({ id: 'run-2', status: 'running' })
  const failedState = ref('polling')
  const failedError = ref('')
  const failed = createSourceIntakePollSession({
    sourceWorkflowLifecycle: { isActive: () => true },
    isRunActive: () => true,
    pollState: failedState,
    pollError: failedError,
    selectedRun: failedRun,
    getRun: async () => { throw new Error('down') },
    isUserFacingAbort: () => false,
    toUserFacingError: (_error, fallback) => fallback,
    refreshWorkflowSnapshot: async () => { events.push('should-not-snapshot') },
    emitRefresh: () => events.push('should-not-refresh'),
  })
  await failed.refreshSelectedRun()
  assert.equal(failedState.value, 'error')
  assert.match(failedError.value, /处理状态刷新失败/)
})

test('恢复轮询在仍活跃时重新开表，忽略错误时也会回到轮询', async () => {
  const selectedRun = ref({ id: 'run-3', status: 'running' })
  const pollState = ref('error')
  const pollError = ref('old')
  const session = createSourceIntakePollSession({
    sourceWorkflowLifecycle: { isActive: () => true },
    isRunActive: () => true,
    pollState,
    pollError,
    selectedRun,
    getRun: async (id) => ({ id, status: 'running' }),
    isUserFacingAbort: () => false,
    toUserFacingError: (_error, fallback) => fallback,
    refreshWorkflowSnapshot: async () => {},
    emitRefresh: () => {},
  })
  try {
    await session.resumePolling()
    assert.equal(pollState.value, 'polling')
    assert.equal(pollError.value, '')
  } finally {
    session.stopPoll()
  }
})
