import test from 'node:test'
import assert from 'node:assert/strict'

import { SOURCE_WORKFLOW_REFRESH_UNCONFIRMED_MESSAGE } from '../src/utils/sourceImportOutcome.js'
import { createSourceIntakeQaActions } from '../src/components/sourceIntake/sourceIntakeQaActions.js'

function ref(value) {
  return { value }
}

function createActions(overrides = {}) {
  const messages = []
  const qaRunning = ref(false)
  const remediating = ref(false)
  const remediationStatus = ref('')
  const actions = createSourceIntakeQaActions({
    qaRunning,
    remediating,
    remediationStatus,
    getDramaId: () => 4,
    getSelectedRunId: () => 'run-1',
    getRunMode: () => 'draft',
    getLatestQa: () => ({ id: 'qa-1' }),
    getRemediateReason: () => '',
    getRemediatePayload: () => ({ target_episode_count: 6, style: '雨夜' }),
    auditQa: async (payload) => payload,
    remediateQaApi: async () => ({ workflow_run: { id: 'fix-1' }, actions_taken: [{ code: 'retry-media' }] }),
    isLifecycleActive: () => true,
    refreshWorkflowSnapshot: async () => ({ status: 'applied' }),
    refreshAndConfirmRun: async () => true,
    markWorkflowRefreshUnconfirmed: () => messages.push(['unconfirmed']),
    refreshUnconfirmedMessage: SOURCE_WORKFLOW_REFRESH_UNCONFIRMED_MESSAGE,
    showWorkflowMessage: (type, message) => messages.push([type, message]),
    isUserFacingAbort: () => false,
    toUserFacingError: (error, fallback) => error?.message || fallback,
    ...overrides,
  })
  return { actions, messages, qaRunning, remediating, remediationStatus }
}

test('QA 审计成功后刷新快照并给出中文成功提示', async () => {
  const audits = []
  const { actions, messages } = createActions({
    auditQa: async (payload) => { audits.push(payload); return payload },
  })
  await actions.runQaAudit()
  assert.deepEqual(audits[0], { drama_id: 4, run_id: 'run-1', mode: 'draft' })
  assert.deepEqual(messages, [['success', 'QA 审计已完成']])
})

test('一键修复在确认到新运行后展示动作码', async () => {
  const { actions, messages, remediationStatus } = createActions()
  await actions.remediateQa()
  assert.equal(remediationStatus.value, '已启动修复：retry-media')
  assert.deepEqual(messages, [['success', '已启动自动修复流程']])
})

test('修复后快照未确认时留下刷新告警，被拦截时不打接口', async () => {
  const calls = []
  const blocked = createActions({
    getRemediateReason: () => '当前处理仍在运行',
    remediateQaApi: async () => { calls.push('api') },
  })
  await blocked.actions.remediateQa()
  assert.deepEqual(calls, [])
  assert.equal(blocked.remediationStatus.value, '')

  const unconfirmed = createActions({
    refreshAndConfirmRun: async () => false,
  })
  await unconfirmed.actions.remediateQa()
  assert.equal(unconfirmed.remediationStatus.value, SOURCE_WORKFLOW_REFRESH_UNCONFIRMED_MESSAGE)
  assert.deepEqual(unconfirmed.messages, [['unconfirmed']])
})
