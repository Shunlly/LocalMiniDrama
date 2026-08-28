import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildSourceWorkflowState,
  getNewWorkflowRunReason,
  getSourceWorkflowActionReasons,
  getSourceWorkflowBusyReason,
  resolveInspectedWorkflowStep,
  SOURCE_AUTO_EXTRACTION_UNSUPPORTED_MESSAGE,
  SOURCE_WORKFLOW_CANCEL_REASON,
  SOURCE_WORKFLOW_PAUSE_REASON,
  isDeferredAutoExtractionSource,
  localizeSourceIntakeFailure,
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
    qa: { id: 3, run_id: 'run-2', passed: false, issueCount: 2, canRemediate: true, remediationActions: [{ code: 'retry' }] },
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
    qa: { id: 4, run_id: 'run-3', passed: true, score: 92, mode: 'draft', remediationActions: [] },
    timeline: { episodeCount: 2, trackCount: 8 },
    episodeCount: 2,
    actionReasons: {},
  })
  assert.equal(delivered.activeStepId, 'delivery')
  assert.equal(delivered.complete, true)
  assert.equal(delivered.steps.find((step) => step.id === 'qa').summary, '草稿结构检查 通过，评分 92')
})

test('workflow state ignores an older QA report for processing, failed and completed runs', () => {
  const oldQa = {
    id: 10,
    run_id: 'run-old',
    passed: false,
    score: 17,
    issueCount: 3,
    canRemediate: true,
    remediationActions: [{ code: 'retry-old-step' }],
  }
  const cases = [
    { status: 'processing', process: 'active', qa: 'pending' },
    { status: 'failed', process: 'error', qa: 'pending' },
    { status: 'completed', process: 'done', qa: 'ready' },
  ]

  for (const expected of cases) {
    const state = buildSourceWorkflowState({
      sourceCount: 1,
      hasSourceInput: false,
      run: { id: `run-new-${expected.status}`, status: expected.status },
      qa: oldQa,
      timeline: null,
      episodeCount: 0,
      actionReasons: {},
    })
    const processStep = state.steps.find((step) => step.id === 'process')
    const qaStep = state.steps.find((step) => step.id === 'qa')
    const remediationStep = state.steps.find((step) => step.id === 'remediation')

    assert.equal(processStep.status, expected.process, expected.status)
    assert.equal(qaStep.status, expected.qa, expected.status)
    assert.equal(remediationStep.status, 'pending', expected.status)
    assert.doesNotMatch(qaStep.summary, /17|3 个问题/, expected.status)
    assert.equal(state.complete, false, expected.status)
  }
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
    qa: { id: 9, run_id: 'run-5', passed: true, canRemediate: false },
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

test('automatic remediation requires a completed run and a matching QA owner', () => {
  const matchingFailedQa = {
    id: 12,
    run_id: 'run-current',
    passed: false,
    canRemediate: true,
  }

  for (const runState of [
    { id: 'run-current', status: 'processing', active: true },
    { id: 'run-current', status: 'paused' },
    { id: 'run-current', status: 'failed' },
    { id: 'run-current', status: 'cancelled' },
  ]) {
    const reasons = getSourceWorkflowActionReasons({
      hasSourceInput: true,
      runState,
      qa: matchingFailedQa,
    })
    assert.notEqual(reasons.remediate, '', runState.status)
  }

  const wrongOwner = getSourceWorkflowActionReasons({
    hasSourceInput: true,
    runState: { id: 'run-current', status: 'completed' },
    qa: { ...matchingFailedQa, run_id: 'run-old' },
  })
  assert.match(wrongOwner.remediate, /当前运行/)

  const idTypeMismatch = getSourceWorkflowActionReasons({
    hasSourceInput: true,
    runState: { id: 42, status: 'completed' },
    qa: { ...matchingFailedQa, run_id: '42' },
  })
  assert.match(idTypeMismatch.remediate, /当前运行/)

  const matchingOwner = getSourceWorkflowActionReasons({
    hasSourceInput: true,
    runState: { id: 'run-current', status: 'completed' },
    qa: matchingFailedQa,
  })
  assert.equal(matchingOwner.remediate, '')
})

test('workflow state reads current and failed steps from raw run payloads', () => {
  const processing = buildSourceWorkflowState({
    sourceCount: 1,
    hasSourceInput: false,
    run: {
      id: 'run-raw',
      status: 'processing',
      current_step: 'storyboard_draft',
      steps: [
        { step_key: 'source_intake', status: 'completed' },
        { step_key: 'adaptation_plan', status: 'completed' },
        { step_key: 'storyboard_draft', status: 'processing' },
      ],
    },
    qa: null,
    timeline: null,
    episodeCount: 0,
    actionReasons: {},
  })
  assert.equal(processing.activeStepId, 'process')
  assert.match(processing.activeStep.summary, /分镜草稿/)

  const listedOnly = buildSourceWorkflowState({
    sourceCount: 1,
    hasSourceInput: false,
    run: {
      id: 'run-list',
      status: 'processing',
      current_step: 'video_generation',
    },
    qa: null,
    timeline: null,
    episodeCount: 0,
    actionReasons: {},
  })
  assert.match(listedOnly.activeStep.summary, /分镜视频/)

  const failed = buildSourceWorkflowState({
    sourceCount: 1,
    hasSourceInput: false,
    run: {
      id: 'run-failed',
      status: 'failed',
      current_step: 'video_generation',
      steps: [
        { step_key: 'image_generation', status: 'completed' },
        { step_key: 'video_generation', status: 'failed' },
      ],
    },
    qa: null,
    timeline: null,
    episodeCount: 0,
    actionReasons: {},
  })
  assert.equal(failed.activeStepId, 'process')
  assert.match(failed.steps.find((step) => step.id === 'process').summary, /分镜视频/)
})

test('inspected workflow step stays on history unless the user was following the live stage', () => {
  const delivered = buildSourceWorkflowState({
    sourceCount: 1,
    hasSourceInput: false,
    run: { id: 'run-complete', status: 'completed', mode: 'draft' },
    qa: { id: 8, run_id: 'run-complete', passed: true, score: 95, mode: 'draft', remediationActions: [] },
    timeline: { episodeCount: 2, trackCount: 8 },
    episodeCount: 2,
    actionReasons: {},
  })
  assert.equal(
    resolveInspectedWorkflowStep(delivered, {
      selectedStepId: 'intake',
      previousActiveStepId: 'delivery',
      requestedStepId: 'intake',
    }),
    'intake',
  )
  assert.equal(
    resolveInspectedWorkflowStep(delivered, {
      selectedStepId: 'delivery',
      previousActiveStepId: 'qa',
    }),
    'delivery',
  )
  assert.equal(
    resolveInspectedWorkflowStep(delivered, {
      selectedStepId: 'process',
      previousActiveStepId: 'delivery',
    }),
    'process',
  )
})

test('延后的 OCR/转写入口给出中文说明而不是英文失败', () => {
  assert.equal(isDeferredAutoExtractionSource({ name: 'a.pdf', type: 'application/pdf' }), true)
  assert.equal(isDeferredAutoExtractionSource({ name: 'a.png', type: 'image/png' }), true)
  assert.equal(isDeferredAutoExtractionSource({ name: 'a.mp3', type: 'audio/mpeg' }), true)
  assert.equal(isDeferredAutoExtractionSource({ name: 'a.mp4', type: 'video/mp4' }), true)
  assert.equal(isDeferredAutoExtractionSource({ name: 'story.txt', type: 'text/plain' }), false)
  assert.equal(
    localizeSourceIntakeFailure(new Error('Tesseract OCR failed'), { filename: 'scan.png' }),
    SOURCE_AUTO_EXTRACTION_UNSUPPORTED_MESSAGE,
  )
  assert.equal(
    localizeSourceIntakeFailure('extracted video audio is empty'),
    SOURCE_AUTO_EXTRACTION_UNSUPPORTED_MESSAGE,
  )
  assert.equal(localizeSourceIntakeFailure('素材列表加载失败'), '素材列表加载失败')
})

test('取消的流程不当成失败，失败才可重试', () => {
  const cancelled = buildSourceWorkflowState({
    sourceCount: 1,
    hasSourceInput: false,
    run: { id: 'run-cancelled', status: 'canceled' },
    qa: null,
    timeline: null,
    episodeCount: 0,
    actionReasons: {},
  })
  const processStep = cancelled.steps.find((step) => step.id === 'process')
  assert.equal(processStep.status, 'ready')
  assert.match(processStep.summary, /已取消/)
  assert.notEqual(processStep.status, 'error')

  const failedReasons = getSourceWorkflowActionReasons({
    hasSourceInput: true,
    runState: { id: 'run-4', status: 'failed' },
  })
  assert.equal(failedReasons.retry, '')
  assert.match(failedReasons.pause, /仅运行中的处理可以暂停/)
  assert.match(failedReasons.cancel, /仅运行中的处理可以取消/)

  const busy = getSourceWorkflowBusyReason({ pausing: true })
  assert.match(busy, /正在暂停处理/)
  assert.equal(localizeSourceIntakeFailure('User cancelled from Source Intake panel'), SOURCE_WORKFLOW_CANCEL_REASON)
  assert.equal(localizeSourceIntakeFailure('User paused from Source Intake panel'), SOURCE_WORKFLOW_PAUSE_REASON)
  const aborted = Object.assign(new Error('canceled'), { name: 'AbortError', code: 'ERR_CANCELED' })
  assert.equal(localizeSourceIntakeFailure(aborted), '')
})
