import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildSourceWorkflowState,
  getNewWorkflowRunReason,
  getSourceWorkflowActionReasons,
} from '../src/utils/sourceWorkflowState.js'

test('workflow state marks intake as active draft and exposes source empty-state CTAs', () => {
  const actionReasons = getSourceWorkflowActionReasons({
    hasSourceInput: true,
    runState: {},
    qa: {},
  })
  const state = buildSourceWorkflowState({
    sourceCount: 0,
    hasSourceInput: true,
    run: null,
    qa: null,
    timeline: null,
    episodeCount: 0,
    actionReasons,
  })

  assert.equal(state.activeStepId, 'intake')
  assert.equal(state.activeStep.summary, '当前输入已就绪，保存后可进入处理')
  assert.equal(state.sourceEmptyState.primaryAction.label, '仅导入素材')
  assert.equal(state.sourceEmptyState.secondaryAction.disabledReason, '')
})

test('workflow state promotes process, qa, remediation and delivery in sequence', () => {
  const processing = buildSourceWorkflowState({
    sourceCount: 1,
    hasSourceInput: false,
    run: {
      id: 'run-1',
      status: 'processing',
      activeStep: { step_key: 'adaptation_plan' },
    },
    qa: null,
    timeline: null,
    episodeCount: 0,
    actionReasons: {},
  })
  assert.equal(processing.activeStepId, 'process')
  assert.match(processing.activeStep.summary, /adaptation_plan|改编计划/)

  const qaBlocked = buildSourceWorkflowState({
    sourceCount: 1,
    hasSourceInput: false,
    run: { id: 'run-2', status: 'completed' },
    qa: { id: 3, passed: false, issueCount: 2, canRemediate: true, remediationActions: [{ code: 'retry' }] },
    timeline: null,
    episodeCount: 1,
    actionReasons: {},
  })
  assert.equal(qaBlocked.activeStepId, 'remediation')
  assert.equal(qaBlocked.steps.find((step) => step.id === 'remediation').status, 'active')

  const delivered = buildSourceWorkflowState({
    sourceCount: 1,
    hasSourceInput: false,
    run: { id: 'run-3', status: 'completed', mode: 'draft' },
    qa: { id: 4, passed: true, score: 92, mode: 'draft', remediationActions: [] },
    timeline: { episodeCount: 2, trackCount: 8 },
    episodeCount: 2,
    actionReasons: {},
  })
  assert.equal(delivered.activeStepId, 'delivery')
  assert.equal(delivered.complete, true)
  assert.equal(delivered.steps.find((step) => step.id === 'qa').summary, '草稿结构检查 通过，评分 92')
  const selectedFlowStepId = 'intake'
  const inspectedStep = delivered.steps.find((step) => step.id === selectedFlowStepId)
  assert.equal(inspectedStep.id, 'intake')
  assert.equal(delivered.activeStepId, 'delivery')
})

test('workflow action reasons explain disabled controls', () => {
  const missingInput = getSourceWorkflowActionReasons({
    hasSourceInput: false,
    runState: {},
    qa: {},
  })
  assert.match(missingInput.start, /先粘贴网页 URL/)

  const failedRun = getSourceWorkflowActionReasons({
    hasSourceInput: true,
    runState: { id: 'run-4', status: 'failed', canRetry: true },
    qa: {},
  })
  assert.match(failedRun.qa, /重试失败步骤/)

  const qaPassed = getSourceWorkflowActionReasons({
    hasSourceInput: true,
    runState: { id: 'run-5', status: 'completed' },
    qa: { id: 9, passed: true, canRemediate: false },
  })
  assert.match(qaPassed.remediate, /无需自动修复/)

  const activeRun = getSourceWorkflowActionReasons({
    hasSourceInput: true,
    runState: { id: 'run-6', status: 'processing', active: true },
    qa: {},
  })
  assert.match(activeRun.start, /已有处理流程运行中/)
  assert.match(getNewWorkflowRunReason({ status: 'paused' }), /恢复或取消/)
})
