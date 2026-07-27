import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ElMessage as RawElMessage } from 'element-plus'
import request from '../src/utils/request.js'

import {
  buildSourceWorkflowState,
  selectInspectedWorkflowStep,
} from '../src/utils/sourceWorkflowState.js'
import * as sourceWorkflowController from '../src/utils/sourceImportOutcome.js'

const source = readFileSync(
  new URL('../src/components/SourceIntakeWorkflowPanel.vue', import.meta.url),
  'utf8',
)

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
  assert.match(source, /function startPoll\(\) \{\s*if \(!sourceWorkflowLifecycle\.isActive\(\)\)/)
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

test('post-create UI failure shows a no-retry warning and offers read-only recovery', async () => {
  const createSourceImportController = requireWorkflowHelper('createSourceImportController')
  let input = '待导入素材'
  let refreshFails = true
  let refreshAlert = ''
  let createCalls = 0
  let refreshCalls = 0
  let refreshEmits = 0
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
    onCreated: async () => { throw new Error('页面状态更新失败') },
    setRefreshAlert: (message) => { refreshAlert = message },
    emitRefresh: () => { refreshEmits += 1 },
  })

  let outcome
  await assert.doesNotReject(async () => {
    outcome = await controller.importSource()
  })
  assert.equal(outcome.status, 'post_create_failed')
  assert.equal(outcome.refreshStatus, 'refresh_failed')
  assert.equal(input, '')
  assert.equal(refreshAlert, sourceWorkflowController.SOURCE_POST_CREATE_FAILED_MESSAGE)
  assert.match(refreshAlert, /已导入/)
  assert.match(refreshAlert, /请勿重复导入/)
  assert.equal(createCalls, 1)
  assert.equal(refreshCalls, 1)
  assert.equal(refreshEmits, 0)

  refreshFails = false
  const recoveryOutcome = await controller.refreshSources()
  assert.equal(recoveryOutcome.status, 'refreshed')
  assert.equal(refreshAlert, '')
  assert.equal(createCalls, 1)
  assert.equal(refreshCalls, 2)
  assert.equal(refreshEmits, 1)
})

test('source workflow component wires the executable controller and keeps the alert accessible', () => {
  assert.match(source, /createSourceImportController/)
  assert.match(source, /selectQaReportForRun/)
  assert.match(source, /runGatedQaRemediation/)
  assert.match(source, /sourceImportController\.loadSources\(\)/)
  assert.match(source, /sourceImportController\.importSource\(/)
  assert.match(source, /sourceImportController\.refreshSources\(\)/)
  assert.match(source, /role="alert"[\s\S]*?aria-live="assertive"/)
  assert.match(source, /@click="refreshImportedSources"[\s\S]*?>\s*刷新列表\s*<\/el-button>/)
  assert.match(source, /等待当前运行 QA/)
})
