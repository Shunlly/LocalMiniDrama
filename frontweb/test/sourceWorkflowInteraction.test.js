import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { remainingExtractNamedFunction } from './helpers/remainingSourceBetween.js'
import { ElMessage as RawElMessage } from 'element-plus'
import request from '../src/utils/request.js'

import {
  buildSourceWorkflowState,
  localizeSourceIntakeFailure,
  selectInspectedWorkflowStep,
  MEDIA_AUTO_EXTRACTION_EXTENSIONS,
  SOURCE_INTAKE_MEDIA_HELP,
  SOURCE_MEDIA_EXTRACTION_CONFIG_GUIDANCE,
  SOURCE_MEDIA_URL_UPLOAD_HINT,
} from '../src/utils/sourceWorkflowState.js'
import * as sourceWorkflowController from '../src/utils/sourceImportOutcome.js'
import { toUserFacingError, isUserFacingAbort } from '../src/utils/userFacingError.js'

import { readSourceIntakeWorkflowSources } from './helpers/sourceIntakeWorkflowSources.js'

const source = readSourceIntakeWorkflowSources()

const completionVisibilityGateTokens = [
  ['loading', /\bloading\.value\b/],
  ['sourceFileReading', /\bsourceFileReading\.value\b/],
  ['sourceSaving', /\bsourceSaving\.value\b/],
  ['sourceListRefreshing', /\bsourceListRefreshing\.value\b/],
  ['workflowStarting', /\bworkflowStarting\.value\b/],
  ['readinessChecking', /\breadinessChecking\.value\b/],
  ['qaRunning', /\bqaRunning\.value\b/],
  ['qaRemediating', /\bremediating\.value\b/],
  ['pollRecovering', /\bpollState\.value === 'recovering'/],
  ['workflowActionBusy', /\bworkflowActionBusy\.value\b/],
  ['sourceOperationError', /\bsourceOperationError\.value\b/],
  ['sourceListRefreshError', /\bsourceListRefreshError\.value\b/],
  ['workflowDataError', /\bworkflowDataError\.value\b/],
  ['pollError', /\bpollError\.value\b/],
]

test('素材创建响应只使用真实 source 记录参与写后确认', () => {
  const extractCreatedStorySource = requireWorkflowHelper('extractCreatedStorySource')
  const sourceRecord = { id: 17, title: '已导入素材' }
  assert.equal(extractCreatedStorySource({ source: sourceRecord, items: [] }), sourceRecord)
  assert.equal(extractCreatedStorySource({ id: 17 }), null)
  assert.equal(source.includes('extractCreatedStorySource(await createSourceFromForm())'), true)
})

function extractComputedBooleanBody(sourceText, identifier) {
  const declaration = `const ${identifier} = computed(() => Boolean(`
  const start = sourceText.indexOf(declaration)
  assert.ok(start >= 0, `${identifier} must remain a Boolean computed gate`)
  const bodyStart = start + declaration.length
  const bodyEnd = sourceText.indexOf('\n))', bodyStart)
  assert.ok(bodyEnd > bodyStart, `${identifier} must close before the next computed value`)
  return sourceText.slice(bodyStart, bodyEnd)
}

function missingCompletionVisibilityGates(gateBody) {
  return completionVisibilityGateTokens
    .filter(([, pattern]) => !pattern.test(gateBody))
    .map(([name]) => name)
}

function assertCompletionVisibilityGates(gateBody) {
  assert.deepEqual(
    missingCompletionVisibilityGates(gateBody),
    [],
    'completion visibility gate must include every busy and error token',
  )
}

function requireWorkflowHelper(name) {
  assert.equal(typeof sourceWorkflowController[name], 'function', `${name} must be executable production code`)
  return sourceWorkflowController[name]
}

test('source workflow restores inspected step from the route and can restart cancelled runs', () => {
  assert.match(source, /function persistInspectedFlowStep\(stepId\)/)
  assert.match(source, /stepId && stepId !== liveStepId/)
  assert.match(source, /route\.query\.step/)
  assert.match(source, /resolveInspectedWorkflowStep\(flowState\.value/)
  assert.match(source, /const canRestartFromLatestSource = computed/)
  assert.match(source, /runState\.value\.status === 'cancelled' \|\| runState\.value\.status === 'failed'/)
  assert.match(source, /重新启动\$\{workflowModeShortLabel\}/)
  assert.match(source, /async function retryRun\(\)[\s\S]*refreshAndConfirmRun\(nextRun\.id\)/)
  assert.match(source, /controlActionReasons\.pause/)
  assert.match(source, /controlActionReasons\.cancel/)
})

test('source workflow separates actual progress from inspected history', () => {
  assert.match(source, /\{ 'is-current': flowState\.activeStepId === step\.id \}/)
  assert.match(source, /\{ 'is-selected': inspectedFlowStep\.id === step\.id \}/)
  assert.match(source, /:aria-current="flowState\.activeStepId === step\.id \? 'step' : undefined"/)
  assert.match(source, /:aria-pressed="inspectedFlowStep\.id === step\.id"/)
  assert.match(source, /const actualFlowStep = computed/)
  assert.match(source, /const inspectedFlowStep = computed/)
  assert.match(source, /watch\(\s*\(\) => flowState\.value\.activeStepId/)
})

test('source workflow details follow the inspected stage only', () => {
  assert.doesNotMatch(source, /activeFlowStep/)
  assert.match(source, /inspectedFlowStep\.id === 'intake'/)
  assert.match(source, /inspectedFlowStep\.id === 'process'/)
  assert.match(source, /inspectedFlowStep\.id === 'qa'/)
  assert.match(source, /inspectedFlowStep\.id === 'remediation'/)
})

test('selecting workflow history does not mutate the actual delivered stage', () => {
  assert.match(
    source,
    /selectedFlowStepId\.value = selectInspectedWorkflowStep\(\s*flowState\.value,\s*selectedFlowStepId\.value,\s*stepId,\s*\)/,
  )
  const delivered = buildSourceWorkflowState({
    sourceCount: 1,
    hasSourceInput: false,
    run: { id: 'run-complete', status: 'completed', mode: 'draft' },
    qa: { id: 8, run_id: 'run-complete', passed: true, score: 95, mode: 'draft', remediationActions: [] },
    timeline: { episodeCount: 2, trackCount: 8 },
    episodeCount: 2,
    actionReasons: {},
  })
  const inspectedStepId = selectInspectedWorkflowStep(delivered, 'delivery', 'intake')
  assert.equal(inspectedStepId, 'intake')
  assert.equal(delivered.activeStepId, 'delivery')
  assert.equal(selectInspectedWorkflowStep(delivered, inspectedStepId, 'unknown'), 'intake')
  assert.equal(delivered.activeStepId, 'delivery')
})

test('source workflow current and selected stages have distinct visual markers', () => {
  assert.match(source, /\.flow-step\.is-current\s*\{[\s\S]*?box-shadow:\s*inset 3px 0/)
  assert.match(source, /\.flow-step\.is-selected\s*\{[\s\S]*?outline:/)
  assert.match(source, /\.flow-step\.is-selected:focus-visible\s*\{[\s\S]*?outline:\s*2px solid var\(--el-color-primary\)/)
})

test('completed source workflow is compact, scoped, and keeps full history disclosed', () => {
  assert.match(source, /data-testid="source-workflow-complete"/)
  assert.match(source, /草稿结构已完成/)
  assert.match(source, /正式媒体已生成，交付检查已通过/)
  assert.match(source, /正式流程已结束，媒体产物仍需修复/)
  assert.match(source, />进入制作<\/el-button>/)
  assert.match(source, />查看分集<\/el-button>/)
  assert.match(source, /class="workflow-history-toggle"[\s\S]*?:aria-expanded="workflowHistoryExpanded"/)
  assert.match(source, /id="source-workflow-history"[\s\S]*?v-show="!compactCompletionVisible \|\| workflowHistoryExpanded"/)

  const summaryIndex = source.indexOf('data-testid="source-workflow-complete"')
  const historyIndex = source.indexOf('id="source-workflow-history"')
  const continueImportIndex = source.indexOf('继续导入故事素材')
  assert.ok(summaryIndex >= 0 && historyIndex > summaryIndex)
  assert.ok(continueImportIndex > historyIndex)
})

test('completed source workflow keeps its history visible while operations or errors need attention', () => {
  const gateBody = extractComputedBooleanBody(source, 'completionVisibilityBlocked')
  assertCompletionVisibilityGates(gateBody)

  for (const [name, token] of completionVisibilityGateTokens) {
    const mutatedGateBody = gateBody.replace(token, '')
    assert.deepEqual(missingCompletionVisibilityGates(mutatedGateBody), [name])
    assert.throws(() => assertCompletionVisibilityGates(mutatedGateBody))
  }

  assert.match(source, /flowState\.value\.complete && !completionVisibilityBlocked\.value/)
  assert.doesNotMatch(source, /flowState\.value\.complete && !loading\.value && !workflowDataError\.value/)
})

test('QA report selection returns only the exact selected-run owner', () => {
  const selectQaReportForRun = requireWorkflowHelper('selectQaReportForRun')
  const reports = [
    { id: 'qa-old', run_id: 'run-old' },
    { id: 'qa-current', run_id: 'run-current' },
  ]

  assert.equal(selectQaReportForRun(reports, 'run-current'), reports[1])
  assert.equal(selectQaReportForRun(reports, 'run-missing'), null)
  assert.equal(selectQaReportForRun([{ id: 'qa-string', run_id: '42' }], 42), null)
  assert.equal(selectQaReportForRun(reports, null), null)
})

test('remediation gate returns before any API or busy callback', async () => {
  const runGatedQaRemediation = requireWorkflowHelper('runGatedQaRemediation')
  const events = []
  let apiCalls = 0
  const report = { id: 'qa-current', run_id: 'run-current' }
  const remediate = async (reportId, payload) => {
    apiCalls += 1
    events.push(`api:${reportId}:${payload.target_episode_count}`)
    return { workflow_run: { id: 'repair-run' } }
  }

  const blocked = await runGatedQaRemediation({
    report,
    blockedReason: '当前处理仍在运行',
    payload: { target_episode_count: 8 },
    remediate,
    onStarted: () => events.push('started'),
  })
  assert.equal(blocked.status, 'blocked')
  assert.equal(apiCalls, 0)
  assert.deepEqual(events, [])

  const allowed = await runGatedQaRemediation({
    report,
    blockedReason: '',
    payload: { target_episode_count: 8 },
    remediate,
    onStarted: () => events.push('started'),
    onSucceeded: () => events.push('succeeded'),
    onFinished: () => events.push('finished'),
  })
  assert.equal(allowed.status, 'submitted')
  assert.equal(apiCalls, 1)
  assert.deepEqual(events, ['started', 'api:qa-current:8', 'succeeded', 'finished'])
})

test('post-create callback sync throws and async rejects settle without another create', async () => {
  const { runSourceImport } = sourceWorkflowController
  for (const [label, onCreated] of [
    ['sync throw', () => { throw new Error('同步页面回调失败') }],
    ['async reject', async () => { throw new Error('异步页面回调失败') }],
  ]) {
    let createCalls = 0
    let refreshCalls = 0
    let outcome
    await assert.doesNotReject(async () => {
      outcome = await runSourceImport({
        createSource: async () => {
          createCalls += 1
          return { id: `source-${label}` }
        },
        onCreated,
        loadSources: async () => { refreshCalls += 1 },
      })
    }, label)

    assert.equal(outcome.status, 'post_create_failed', label)
    assert.equal(outcome.refreshStatus, 'refreshed', label)
    assert.match(outcome.postCreateError.message, /页面回调失败/, label)
    assert.equal(createCalls, 1, label)
    assert.equal(refreshCalls, 1, label)
  }
})

test('import controller clears a stale refresh alert before create failure and settles a later success', async () => {
  const createSourceImportController = requireWorkflowHelper('createSourceImportController')
  let createMode = 'success'
  let refreshFails = true
  let input = '第一份素材'
  let refreshAlert = '旧刷新告警'
  let createError = ''
  let createCalls = 0
  let refreshCalls = 0
  let refreshEmits = 0
  let appliedSources = []
  const events = []
  const controller = createSourceImportController({
    createSource: async () => {
      createCalls += 1
      events.push('post')
      if (createMode === 'failed') throw new Error('创建请求失败')
      return { id: `source-${createCalls}` }
    },
    fetchSources: async () => {
      refreshCalls += 1
      events.push('get')
      if (refreshFails) throw new Error('列表读取失败')
      return [{ id: 'source-visible' }]
    },
    applySources: (value) => {
      events.push('apply')
      appliedSources = value
    },
    clearInput: () => {
      events.push('clear-input')
      input = ''
    },
    onImportStarted: () => { createError = '' },
    onCreated: () => events.push('created'),
    onCreateFailed: (error) => { createError = error.message },
    setRefreshAlert: (message) => { refreshAlert = message },
    emitRefresh: () => {
      events.push('emit')
      refreshEmits += 1
    },
  })

  const first = await controller.importSource()
  assert.equal(first.status, 'refresh_failed')
  assert.equal(input, '')
  assert.equal(refreshAlert, sourceWorkflowController.SOURCE_LIST_REFRESH_FAILED_MESSAGE)
  assert.equal(createCalls, 1)
  assert.equal(refreshCalls, 1)

  createMode = 'failed'
  input = '第二份素材'
  const second = await controller.importSource()
  assert.equal(second.status, 'create_failed')
  assert.equal(refreshAlert, '')
  assert.equal(createError, '创建请求失败')
  assert.equal(input, '第二份素材')
  assert.equal(createCalls, 2)
  assert.equal(refreshCalls, 1)

  createMode = 'success'
  refreshFails = false
  input = '第三份素材'
  events.length = 0
  const third = await controller.importSource()
  assert.equal(third.status, 'refreshed')
  assert.equal(refreshAlert, '')
  assert.equal(createError, '')
  assert.equal(input, '')
  assert.equal(createCalls, 3)
  assert.equal(refreshCalls, 2)
  assert.equal(refreshEmits, 1)
  assert.deepEqual(appliedSources, [{ id: 'source-visible' }])
  assert.ok(events.indexOf('post') < events.indexOf('clear-input'))
  assert.ok(events.indexOf('clear-input') < events.indexOf('get'))
  assert.ok(events.indexOf('get') < events.indexOf('emit'))
})

test('successful generic and recovery list loads clear alerts without creating again', async () => {
  const createSourceImportController = requireWorkflowHelper('createSourceImportController')
  let refreshFails = true
  let refreshAlert = ''
  let createCalls = 0
  let refreshCalls = 0
  let refreshEmits = 0
  const controller = createSourceImportController({
    createSource: async () => {
      createCalls += 1
      return { id: `source-${createCalls}` }
    },
    fetchSources: async () => {
      refreshCalls += 1
      if (refreshFails) throw new Error('列表读取失败')
      return [{ id: 'source-visible' }]
    },
    clearInput: () => {},
    setRefreshAlert: (message) => { refreshAlert = message },
    emitRefresh: () => { refreshEmits += 1 },
  })

  await controller.importSource()
  assert.equal(refreshAlert, sourceWorkflowController.SOURCE_LIST_REFRESH_FAILED_MESSAGE)

  refreshFails = false
  await controller.loadSources()
  assert.equal(refreshAlert, '')
  assert.equal(createCalls, 1)
  assert.equal(refreshEmits, 0)

  refreshFails = true
  await controller.importSource()
  assert.equal(refreshAlert, sourceWorkflowController.SOURCE_LIST_REFRESH_FAILED_MESSAGE)
  refreshFails = false
  const recovery = await controller.refreshSources()
  assert.equal(recovery.status, 'refreshed')
  assert.equal(refreshAlert, '')
  assert.equal(createCalls, 2)
  assert.equal(refreshCalls, 4)
  assert.equal(refreshEmits, 1)

  refreshAlert = '项目 A 告警'
  controller.reset()
  assert.equal(refreshAlert, '')
})

test('an older recovery failure cannot restore an alert after a newer generic refresh succeeds', async () => {
  const createSourceImportController = requireWorkflowHelper('createSourceImportController')
  const deferred = () => {
    let resolve
    let reject
    const promise = new Promise((resolvePromise, rejectPromise) => {
      resolve = resolvePromise
      reject = rejectPromise
    })
    return { promise, reject, resolve }
  }
  const olderRecovery = deferred()
  const newerGenericRefresh = deferred()
  let fetchCalls = 0
  let refreshAlert = ''
  const appliedSources = []
  const controller = createSourceImportController({
    createSource: async () => ({ id: 'source-created' }),
    fetchSources: async () => {
      fetchCalls += 1
      if (fetchCalls === 1) throw new Error('initial refresh failed')
      if (fetchCalls === 2) return olderRecovery.promise
      return newerGenericRefresh.promise
    },
    applySources: (sources) => { appliedSources.push(sources) },
    clearInput: () => {},
    setRefreshAlert: (message) => { refreshAlert = message },
  })

  await controller.importSource()
  assert.equal(refreshAlert, sourceWorkflowController.SOURCE_LIST_REFRESH_FAILED_MESSAGE)

  const olderRequest = controller.refreshSources()
  const newerRequest = controller.loadSources()
  newerGenericRefresh.resolve([{ id: 'latest-source' }])
  await newerRequest
  assert.equal(refreshAlert, '')
  assert.deepEqual(appliedSources, [[{ id: 'latest-source' }]])

  olderRecovery.reject(new Error('older recovery failed'))
  const olderOutcome = await olderRequest
  assert.equal(olderOutcome.status, 'refresh_failed')
  assert.equal(refreshAlert, '')
  assert.deepEqual(appliedSources, [[{ id: 'latest-source' }]])
})

test('an older successful list response cannot overwrite a newer applied list', async () => {
  const createSourceImportController = requireWorkflowHelper('createSourceImportController')
  const deferred = () => {
    let resolve
    const promise = new Promise((resolvePromise) => { resolve = resolvePromise })
    return { promise, resolve }
  }
  const olderRequest = deferred()
  const newerRequest = deferred()
  let fetchCalls = 0
  const appliedSources = []
  const controller = createSourceImportController({
    fetchSources: () => (++fetchCalls === 1 ? olderRequest.promise : newerRequest.promise),
    applySources: (sources) => { appliedSources.push(sources) },
  })

  const olderLoad = controller.loadSources()
  const newerLoad = controller.loadSources()
  newerRequest.resolve([{ id: 'latest-source' }])
  await newerLoad
  olderRequest.resolve([{ id: 'stale-source' }])
  await olderLoad

  assert.deepEqual(appliedSources, [[{ id: 'latest-source' }]])
})

test('reset invalidates an in-flight source list response before it can apply project A state', async () => {
  const createSourceImportController = requireWorkflowHelper('createSourceImportController')
  let resolveRequest
  const request = new Promise((resolve) => { resolveRequest = resolve })
  const appliedSources = []
  const alerts = []
  const controller = createSourceImportController({
    fetchSources: () => request,
    applySources: (sources) => { appliedSources.push(sources) },
    setRefreshAlert: (message) => { alerts.push(message) },
  })

  const pending = controller.loadSources()
  controller.reset()
  const alertsAfterReset = alerts.length
  resolveRequest([{ id: 'project-a-source', drama_id: 101 }])
  await pending

  assert.deepEqual(appliedSources, [])
  assert.equal(alerts.length, alertsAfterReset)
})

test('reset suppresses every callback from an in-flight successful project A import', async () => {
  const createSourceImportController = requireWorkflowHelper('createSourceImportController')
  let resolveCreate
  const createRequest = new Promise((resolve) => { resolveCreate = resolve })
  const events = []
  const controller = createSourceImportController({
    createSource: () => createRequest,
    fetchSources: async () => { events.push('fetch-sources'); return [] },
    applySources: () => events.push('apply-sources'),
    clearInput: () => events.push('clear-input'),
    onCreated: () => events.push('created'),
    onCreateFailed: () => events.push('create-failed'),
    setRefreshAlert: () => events.push('alert'),
    emitRefresh: () => events.push('refresh'),
  })

  const pending = controller.importSource({ dramaId: 101 })
  await Promise.resolve()
  controller.reset()
  events.length = 0
  resolveCreate({ id: 'project-a-source', drama_id: 101 })
  const outcome = await pending

  assert.equal(outcome.status, 'stale')
  assert.deepEqual(events, [])
})

test('reset suppresses failure callbacks from an in-flight project A import', async () => {
  const createSourceImportController = requireWorkflowHelper('createSourceImportController')
  let rejectCreate
  const createRequest = new Promise((_resolve, reject) => { rejectCreate = reject })
  const events = []
  const controller = createSourceImportController({
    createSource: () => createRequest,
    onCreateFailed: () => events.push('create-failed'),
    setRefreshAlert: () => events.push('alert'),
    emitRefresh: () => events.push('refresh'),
  })

  const pending = controller.importSource({ dramaId: 101 })
  await Promise.resolve()
  controller.reset()
  events.length = 0
  rejectCreate(new Error('project A failed after navigation'))
  const outcome = await pending

  assert.equal(outcome.status, 'stale')
  assert.deepEqual(events, [])
})

test('disposed source workflow lifecycle suppresses late polling and notification continuations', async () => {
  const createSourceWorkflowLifecycleGuard = requireWorkflowHelper('createSourceWorkflowLifecycleGuard')
  const lifecycle = createSourceWorkflowLifecycleGuard()
  let resolveRequest
  const request = new Promise((resolve) => { resolveRequest = resolve })
  const effects = []

  const pending = request.then(() => lifecycle.run(() => {
    effects.push('start-poll')
    effects.push('notify')
    effects.push('emit-refresh')
  }))
  lifecycle.dispose()
  resolveRequest()
  await pending

  assert.equal(lifecycle.isActive(), false)
  assert.deepEqual(effects, [])
  assert.match(source, /isLifecycleActive: \(\) => sourceWorkflowLifecycle\.isActive\(\)/)
  assert.match(source, /function startPoll\(\) \{\s*if \(!isLifecycleActive\(\)\)/)
  assert.match(source, /onBeforeUnmount\(\(\) => \{\s*sourceWorkflowLifecycle\.dispose\(\)\s*stopPoll\(\)/)
  assert.match(source, /await loadData\(\)\s*if \(!sourceWorkflowLifecycle\.isActive\(\)\) return/)
})

test('disposing the source workflow lifecycle closes messages already shown by that project', () => {
  const createSourceWorkflowLifecycleGuard = requireWorkflowHelper('createSourceWorkflowLifecycleGuard')
  const lifecycle = createSourceWorkflowLifecycleGuard()
  const closed = []

  lifecycle.run(() => ({ close: () => closed.push('source-a-message') }))
  lifecycle.dispose()
  lifecycle.dispose()

  assert.deepEqual(closed, ['source-a-message'])
})

test('source workflow disposal isolates message close failures', () => {
  const createSourceWorkflowLifecycleGuard = requireWorkflowHelper('createSourceWorkflowLifecycleGuard')
  const lifecycle = createSourceWorkflowLifecycleGuard()
  const closed = []

  lifecycle.run(() => ({ close: () => { throw new Error('close failed') } }))
  lifecycle.run(() => ({ close: () => closed.push('source-a-second-message') }))

  assert.doesNotThrow(() => lifecycle.dispose())
  assert.deepEqual(closed, ['source-a-second-message'])
})

test('source workflow API requests suppress the shared transport error toast at dispatch', async () => {
  const createSourceWorkflowLifecycleGuard = requireWorkflowHelper('createSourceWorkflowLifecycleGuard')
  const lifecycle = createSourceWorkflowLifecycleGuard()
  const api = lifecycle.guardApi({
    inspectRequest() {
      return request.get('/source-workflow-request-scope-probe', {
        adapter: async (config) => ({
          config,
          data: { success: true, data: config.suppressErrorToast === true },
          headers: {},
          status: 200,
          statusText: 'OK',
        }),
      })
    },
  })

  assert.equal(await api.inspectRequest(), true)
  lifecycle.dispose()
})

test('a deferred project A source request cannot create a global toast after disposal', async (t) => {
  const createSourceWorkflowLifecycleGuard = requireWorkflowHelper('createSourceWorkflowLifecycleGuard')
  const lifecycle = createSourceWorkflowLifecycleGuard()
  let releaseRequest
  const requestGate = new Promise((resolve) => { releaseRequest = resolve })
  const messages = []
  const originalRawError = RawElMessage.error
  RawElMessage.error = (message) => {
    messages.push(message)
    return { close() {} }
  }
  t.after(() => {
    RawElMessage.error = originalRawError
    lifecycle.dispose()
  })

  const api = lifecycle.guardApi({
    listForDrama() {
      return request.get('/dramas/101/story-sources', {
        adapter: async (config) => {
          await requestGate
          const error = new Error('project A source transport failed')
          error.config = config
          error.response = { data: { error: { message: '项目 A 素材读取失败' } } }
          throw error
        },
      })
    },
  })

  const pending = api.listForDrama().catch((error) => error)
  await Promise.resolve()
  lifecycle.dispose()
  releaseRequest()
  const error = await pending

  assert.equal(error.code, 'SOURCE_WORKFLOW_DISPOSED')
  assert.deepEqual(messages, [])
})

test('disposed source workflow lifecycle rejects launches instead of returning a fake success value', () => {
  const createSourceWorkflowLifecycleGuard = requireWorkflowHelper('createSourceWorkflowLifecycleGuard')
  const assertSourceWorkflowLifecycleActive = requireWorkflowHelper('assertSourceWorkflowLifecycleActive')
  const lifecycle = createSourceWorkflowLifecycleGuard()

  assert.doesNotThrow(() => assertSourceWorkflowLifecycleActive(lifecycle))
  lifecycle.dispose()
  assert.throws(
    () => assertSourceWorkflowLifecycleActive(lifecycle),
    (error) => error?.code === 'SOURCE_WORKFLOW_DISPOSED',
  )
})

test('post-create refresh failure blocks the success callback and offers read-only recovery', async () => {
  const createSourceImportController = requireWorkflowHelper('createSourceImportController')
  let input = '待导入素材'
  let refreshFails = true
  let refreshAlert = ''
  let createCalls = 0
  let refreshCalls = 0
  let refreshEmits = 0
  let successCallbacks = 0
  const controller = createSourceImportController({
    createSource: async () => {
      createCalls += 1
      return { id: 'source-created' }
    },
    fetchSources: async () => {
      refreshCalls += 1
      if (refreshFails) throw new Error('列表读取失败')
      return [{ id: 'source-created' }]
    },
    clearInput: () => { input = '' },
    onCreated: async () => { successCallbacks += 1 },
    setRefreshAlert: (message) => { refreshAlert = message },
    emitRefresh: () => { refreshEmits += 1 },
  })

  let outcome
  await assert.doesNotReject(async () => {
    outcome = await controller.importSource()
  })
  assert.equal(outcome.status, 'refresh_failed')
  assert.equal(input, '')
  assert.equal(refreshAlert, sourceWorkflowController.SOURCE_LIST_REFRESH_FAILED_MESSAGE)
  assert.match(refreshAlert, /服务端完成导入/)
  assert.match(refreshAlert, /请勿重复导入/)
  assert.equal(createCalls, 1)
  assert.equal(refreshCalls, 1)
  assert.equal(refreshEmits, 0)
  assert.equal(successCallbacks, 0)

  refreshFails = false
  const recoveryOutcome = await controller.refreshSources()
  assert.equal(recoveryOutcome.status, 'refreshed')
  assert.equal(refreshAlert, '')
  assert.equal(createCalls, 1)
  assert.equal(refreshCalls, 2)
  assert.equal(refreshEmits, 1)
})

test('post-create UI failure after a confirmed refresh remains a no-retry warning', async () => {
  const createSourceImportController = requireWorkflowHelper('createSourceImportController')
  let createCalls = 0
  let refreshAlert = ''
  const controller = createSourceImportController({
    createSource: async () => {
      createCalls += 1
      return { id: 'source-created' }
    },
    fetchSources: async () => [{ id: 'source-created' }],
    onCreated: async () => { throw new Error('页面状态更新失败') },
    setRefreshAlert: (message) => { refreshAlert = message },
  })

  const outcome = await controller.importSource()
  assert.equal(outcome.status, 'post_create_failed')
  assert.equal(outcome.refreshStatus, 'refreshed')
  assert.equal(refreshAlert, sourceWorkflowController.SOURCE_POST_CREATE_FAILED_MESSAGE)
  assert.equal(createCalls, 1)
})

test('workflow snapshots commit only the newest complete generation', async () => {
  const createSourceWorkflowSnapshotController = requireWorkflowHelper('createSourceWorkflowSnapshotController')
  const releases = []
  const applied = []
  const controller = createSourceWorkflowSnapshotController({
    fetchSnapshot: ({ generation }) => new Promise((resolve) => {
      releases[generation] = () => resolve({ generation, sources: [generation], runs: [generation], reports: [generation] })
    }),
    applySnapshot: async (snapshot) => { applied.push(snapshot) },
  })

  const older = controller.refresh({ dramaId: 1 })
  const newer = controller.refresh({ dramaId: 1 })
  releases[2]()
  assert.equal((await newer).status, 'applied')
  releases[1]()
  assert.equal((await older).status, 'stale')
  assert.deepEqual(applied.map((snapshot) => snapshot.generation), [2])
})

test('source workflow component wires the executable controller and keeps the alert accessible', () => {
  assert.match(source, /createSourceImportController/)
  assert.match(source, /selectQaReportForRun/)
  assert.match(source, /runGatedQaRemediation/)
  assert.match(source, /sourceImportController\.loadSources\(\)/)
  assert.match(source, /sourceImportController\.importSource\(/)
  assert.match(source, /sourceImportController\.refreshSources\(\)/)
  assert.match(source, /role="alert"[\s\S]*?aria-live="assertive"/)
  assert.match(source, /@refresh-imported-sources="refreshImportedSources"/)
  assert.match(source, /@click="\$emit\('refresh-imported-sources'\)"/)
  assert.match(source, />\s*刷新列表\s*<\/el-button>/)
  assert.match(source, /还没有 QA 结果/)
})

test('source QA issues hide English technical text and keep Chinese findings', () => {
  assert.match(source, /const displayedQaIssues = computed/)
  assert.match(source, /qaIssueDisplayMessage\(issue\?\.message\)/)
  assert.match(source, /toUserFacingError\(message, '该项检查未通过'\)/)
  assert.match(source, /const displayedQaRecommendations = computed/)
  assert.match(source, /toUserFacingError\(item, ''\)/)
  assert.match(source, /v-for="issue in displayedQaIssues"/)
  assert.match(source, /v-for="item in displayedQaRecommendations"/)
  assert.doesNotMatch(source, /v-for="issue in latestQa\.issues/)
  assert.equal(toUserFacingError('Network Error', '该项检查未通过'), '该项检查未通过')
  assert.equal(toUserFacingError('分镜缺少成片素材', '该项检查未通过'), '分镜缺少成片素材')
})

test('source intake allows PDF/image/audio/video upload and guides extraction failures to AI config', () => {
  const source = readSourceIntakeWorkflowSources()
  for (const extension of MEDIA_AUTO_EXTRACTION_EXTENSIONS) {
    assert.match(source, new RegExp(`['"]${extension.replace('.', '\\.')}['"]`), extension)
  }
  assert.match(source, /SOURCE_FILE_EXTENSIONS = Object\.freeze\(\[/)
  assert.match(source, /:source-file-accept="SOURCE_FILE_ACCEPT"/)
  assert.match(source, /:accept="sourceFileAccept"/)
  assert.match(source, /SOURCE_INTAKE_MEDIA_HELP/)
  assert.match(source, /TEXT_SOURCE_FILE_EXTENSIONS\.has\(extension\) && file\.size <= 2 \* 1024 \* 1024/)
  assert.match(source, /looksLikeBinaryMedia/)
  assert.match(source, /form\.text = await file\.text\(\)/)
  assert.match(source, /sourceIntakeAPI\.uploadForDrama/)
  assert.match(source, /isDeferredAutoExtractionSource\(rawSourceUrl\.value\)/)
  assert.match(source, /SOURCE_MEDIA_URL_UPLOAD_HINT/)
  assert.doesNotMatch(source, /暂不支持自动抽取/)
  assert.doesNotMatch(source, /SOURCE_AUTO_EXTRACTION_UNSUPPORTED_MESSAGE/)
  assert.doesNotMatch(source, /isDeferredAutoExtractionSource\(file\)/)
  assert.doesNotMatch(source, /isDeferredAutoExtractionSource\(sourceFile\.value\)/)
  assert.doesNotMatch(source, /service_type=ocr/)
  assert.match(source, /openAiConfigForExtraction/)
  assert.match(source, /open-extraction-ai-config/)
  assert.match(source, /resolveSourceIntakeExtractionNextStep/)
  assert.match(SOURCE_INTAKE_MEDIA_HELP, /图片识别/)
  assert.match(SOURCE_INTAKE_MEDIA_HELP, /语音转写/)
  assert.match(SOURCE_MEDIA_URL_UPLOAD_HINT, /本地文件上传/)
})

test('source workflow polling abort is ignored instead of reported as failure', () => {
  const shouldIgnoreSourceWorkflowPollError = requireWorkflowHelper('shouldIgnoreSourceWorkflowPollError')
  const createSourceWorkflowLifecycleGuard = requireWorkflowHelper('createSourceWorkflowLifecycleGuard')
  const lifecycle = createSourceWorkflowLifecycleGuard()
  const aborted = Object.assign(new Error('canceled'), { name: 'AbortError', code: 'ERR_CANCELED' })
  assert.equal(shouldIgnoreSourceWorkflowPollError(aborted, lifecycle), true)
  lifecycle.dispose()
  assert.equal(shouldIgnoreSourceWorkflowPollError(new Error('处理状态刷新失败'), lifecycle), true)
  const active = createSourceWorkflowLifecycleGuard()
  assert.equal(shouldIgnoreSourceWorkflowPollError(new Error('处理状态刷新失败'), active), false)
})

test('来源工作流失败不再直出 e.message，取消静默，QA 问题过滤英文和密钥', () => {
  assert.match(source, /import \{ toUserFacingError, isUserFacingAbort \} from '@\/utils\/userFacingError'/)
  assert.match(source, /if \(isUserFacingAbort\(error\)\) return ''/)
  assert.match(source, /if \(localized && localized !== raw\) return toUserFacingError\(localized, fallback\)/)
  assert.match(source, /return toUserFacingError\(error, fallback\)/)
  assert.match(source, /if \(isUserFacingAbort\(e\)\) return\s*sourceOperationError\.value = toUserFacingError\(e, '启动失败'\)/)
  assert.match(source, /toUserFacingError\(e, 'QA 审计失败'\)/)
  assert.match(source, /toUserFacingError\(e, '加载素材详情失败'\)/)
  assert.match(source, /toUserFacingError\(error, '自动修复失败'\)/)
  assert.match(source, /toUserFacingError\(error, '读取文本文件失败，请重新选择。'\)/)
  assert.match(source, /displayedQaIssues/)
  assert.match(source, /function qaIssueDisplayMessage\(message\) \{\s*return toUserFacingError\(message, '该项检查未通过'\)/)
  assert.doesNotMatch(source, /e\.message \|\| '启动失败'/)
  assert.doesNotMatch(source, /e\.message \|\| 'QA 审计失败'/)
  assert.doesNotMatch(source, /e\.message \|\| '加载素材详情失败'/)
  assert.doesNotMatch(source, /error\?\.message \|\| '自动修复失败'/)
  assert.doesNotMatch(source, /error\?\.message \|\| '读取文本文件失败/)
  assert.doesNotMatch(source, /latestQa\.issues\.slice\(0, 3\)/)
  assert.doesNotMatch(source, /describeServiceLoadError/)
})

test('来源工作流失败文案保留结构化中文，过滤英文异常和密钥', () => {
  assert.equal(toUserFacingError('缺少分集，或部分分集还没有剧本内容', ''), '缺少分集，或部分分集还没有剧本内容')
  assert.equal(toUserFacingError('ENOENT: no such file or directory', ''), '')
  assert.equal(toUserFacingError('Network Error', '启动失败'), '启动失败')
  assert.equal(toUserFacingError('authorization: Bearer sk-test 失败', ''), '')
  assert.equal(toUserFacingError('password=secret 配置错误', ''), '')
  assert.equal(toUserFacingError('client_secret=abc 调用失败', ''), '')
  assert.equal(toUserFacingError({ message: 'Failed to fetch' }, 'QA 审计失败'), 'QA 审计失败')
  assert.equal(isUserFacingAbort({ name: 'AbortError' }), true)
  assert.equal(isUserFacingAbort('cancel'), true)
})

test('源工作流空状态和失败文案保持简体中文', () => {
  const empty = buildSourceWorkflowState({
    sourceCount: 0,
    hasSourceInput: false,
    run: null,
    qa: null,
    timeline: null,
    episodeCount: 0,
    actionReasons: { import: '请先粘贴网页 URL、选择本地文件或输入原始素材。', start: '请先粘贴网页 URL、选择本地文件或输入原始素材。' },
  })
  assert.match(empty.sourceEmptyState.title, /还没有已导入/)
  assert.match(empty.sourceEmptyState.description, /网页、文件和文本/)
  assert.match(empty.sourceEmptyState.description, /图片识别/)
  assert.match(empty.sourceEmptyState.description, /语音转写/)
  assert.equal(localizeSourceIntakeFailure('Network Error'), SOURCE_MEDIA_EXTRACTION_CONFIG_GUIDANCE)
  assert.equal(localizeSourceIntakeFailure(''), '')
})

test('素材流程面板拆出完成横幅、步骤条、源文本、运行记录和详情抽屉', () => {
  assert.match(source, /from '@\/utils\/elementPlusFeedback\.js'/)
  assert.match(source, /from '@\/components\/sourceIntake\/SourceIntakeCompletionBanner\.vue'/)
  assert.match(source, /from '@\/components\/sourceIntake\/SourceIntakeStepper\.vue'/)
  assert.match(source, /from '@\/components\/sourceIntake\/SourceIntakeSourceTextPanel\.vue'/)
  assert.match(source, /from '@\/components\/sourceIntake\/SourceIntakeIntakeStageForm\.vue'/)
  assert.match(source, /from '@\/components\/sourceIntake\/SourceIntakeRunRecordsPanel\.vue'/)
  assert.match(source, /from '@\/components\/sourceIntake\/SourceIntakeSourceDetailDrawer\.vue'/)
  assert.match(source, /<SourceIntakeCompletionBanner/)
  assert.match(source, /<SourceIntakeStepper/)
  assert.match(source, /<SourceIntakeSourceTextPanel v-model:text="form\.text" \/>/)
  assert.match(source, /<SourceIntakeIntakeStageForm/)
  assert.match(source, /<SourceIntakeRunRecordsPanel/)
  assert.match(source, /<SourceIntakeSourceDetailDrawer/)
  assert.doesNotMatch(source, /from 'element-plus'/)
})

test('来源工作流空状态可操作，忙时按钮带中文禁用原因', () => {
  assert.match(source, /class="empty-stage-hint"/)
  assert.match(source, /可用上方「导入故事素材」或「导入并启动/)
  assert.match(source, /去导入素材/)
  assert.match(source, /去执行 QA/)
  assert.match(source, /检查结果已记录，暂无可以展示的说明/)
  assert.match(source, /暂无可以展示的修复建议/)
  assert.match(source, /暂无素材片段/)
  assert.match(source, /加载中…/)
  assert.doesNotMatch(source, /仅导入素材/)
  assert.match(source, /const sourceUploadBusyReason = computed/)
  assert.match(source, /const existingSourceLaunchReason = computed/)
  assert.match(source, /const refreshBusyReason = computed/)
  assert.match(source, /<ActionGate label="刷新" :reason="refreshBusyReason">/)
  assert.match(source, /:disabled="Boolean\(refreshBusyReason\)"/)
  assert.match(source, /:reason="existingSourceLaunchReason"/)
  assert.match(source, /:disabled="Boolean\(existingSourceLaunchReason\)"/)
  assert.match(source, /reasons\.import = reasons\.import \|\| sourceUploadBusyReason\.value/)
  assert.match(source, /:disabled="Boolean\(actionReasons\.import\)"/)
  assert.match(source, /:disabled="Boolean\(actionReasons\.start\)"/)
  assert.doesNotMatch(source, /Boolean\(actionReasons\.import\) \|\| sourceUploadBusy/)
})

test('素材流程时间格式化对无效日期不显示 Invalid Date', () => {
  const formatTime = new Function(
    `'use strict'; ${remainingExtractNamedFunction(source, 'formatTime')}; return formatTime;`,
  )()
  const formatted = formatTime('2026-09-11T08:00:00Z')
  assert.match(formatted, /2026/)
  assert.doesNotMatch(formatted, /Invalid Date/)
  assert.doesNotMatch(formatted, /T08:00:00Z/)
  for (const value of ['not-a-date', 'Invalid Date', '   ', 'foo']) {
    const result = formatTime(value)
    assert.equal(result, '', String(value))
    assert.notEqual(result, 'Invalid Date', String(value))
  }
  assert.equal(formatTime(''), '')
  assert.equal(formatTime(null), '')
  assert.equal(formatTime(undefined), '')
  assert.match(source, /formatTime\(selectedRun\.created_at\) \|\| '未知时间'/)
  assert.match(source, /formatTime\(sourceDetail\.source\.created_at\) \|\| '未知时间'/)
  assert.match(source, /if \(Number\.isNaN\(date\.getTime\(\)\)\) return ''/)
})


test('素材导入失败会给出前往 AI 配置的抽取下一步', () => {
  const form = readFileSync(new URL('../src/components/sourceIntake/SourceIntakeIntakeStageForm.vue', import.meta.url), 'utf8')
  assert.match(form, /下一步/)
  assert.match(form, /open-extraction-ai-config/)
  assert.match(form, /resolveSourceIntakeExtractionNextStep/)
  assert.match(form, /extractionNextStep.extraHint/)
  assert.doesNotMatch(form, /service_type=ocr/)
  const panel = readFileSync(new URL('../src/components/SourceIntakeWorkflowPanel.vue', import.meta.url), 'utf8')
  assert.match(panel, /@open-extraction-ai-config="openAiConfigForExtraction"/)
  const steps = readFileSync(new URL('../src/components/sourceIntake/sourceIntakeFlowSteps.js', import.meta.url), 'utf8')
  assert.match(steps, /function openAiConfigForExtraction\(serviceType\)/)
  assert.match(steps, /function openAiConfigForReadiness\(\)/)
})

test('处理失败会给出前往 AI 配置的抽取下一步', () => {
  const bindings = readFileSync(new URL('../src/components/sourceIntake/sourceIntakeWorkspaceBindings.js', import.meta.url), 'utf8')
  assert.match(bindings, /displayedRunError,\s*extractionNextStep,\s*productionLaunchReason,/)
  assert.match(bindings, /displayedRunError,\s*extractionNextStep,\s*controlActionReasons,/)
  const records = readFileSync(new URL('../src/components/sourceIntake/SourceIntakeRunRecordsPanel.vue', import.meta.url), 'utf8')
  assert.match(records, /process-extraction-next-step/)
  assert.match(records, /open-extraction-ai-config/)
  const panel = readFileSync(new URL('../src/components/SourceIntakeWorkflowPanel.vue', import.meta.url), 'utf8')
  assert.match(panel, /<SourceIntakeProcessStageCard[\s\S]*@open-extraction-ai-config="openAiConfigForExtraction"/)
})
