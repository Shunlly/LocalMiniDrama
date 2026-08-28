import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { ElMessage, ElMessageBox } from 'element-plus'

import {
  cancelPipelineTasksAroundRun,
  createPipelineAbortError,
  createPipelinePauseGate,
  runPipelineTaskWithRetry,
} from '../src/utils/filmPipelineControl.js'
import { DEFAULT_POLL_TIMEOUT_MS } from '../src/utils/requestError.js'
import { useFilmCreatePipelineRun } from '../src/composables/filmCreate/useFilmCreatePipelineRun.js'
import { useFilmCreateTaskCancel } from '../src/composables/filmCreate/useFilmCreateTaskCancel.js'
import { useFilmCreatePipelineStages } from '../src/composables/filmCreate/useFilmCreatePipelineStages.js'
import { useFilmCreateNavigationGuards } from '../src/composables/filmCreate/useFilmCreateNavigationGuards.js'

const pipelinePanelSource = readFileSync(
  new URL('../src/components/filmCreate/FilmCreatePipelinePanel.vue', import.meta.url),
  'utf8',
)

function refOf(value) {
  return { value }
}

function stubElementPlusFeedback() {
  const messages = []
  const originals = {
    warning: ElMessage.warning,
    error: ElMessage.error,
    success: ElMessage.success,
    info: ElMessage.info,
    confirm: ElMessageBox.confirm,
  }
  const record = (type) => (message, title, options) => {
    messages.push({ type, message, title, options })
    return { close() {} }
  }
  ElMessage.warning = record('warning')
  ElMessage.error = record('error')
  ElMessage.success = record('success')
  ElMessage.info = record('info')
  let confirmImpl = async () => {}
  ElMessageBox.confirm = async (message, title, options) => {
    messages.push({ type: 'confirm', message, title, options })
    return confirmImpl(message, title, options)
  }
  return {
    messages,
    setConfirm(next) { confirmImpl = next },
    last(type) { return messages.filter((item) => item.type === type).at(-1) },
    restore() {
      ElMessage.warning = originals.warning
      ElMessage.error = originals.error
      ElMessage.success = originals.success
      ElMessage.info = originals.info
      ElMessageBox.confirm = originals.confirm
    },
  }
}

function createPipelineRun(overrides = {}) {
  return useFilmCreatePipelineRun({
    store: { storyboards: [] },
    videoClipDuration: refOf(5),
    taskAPI: {
      async get() { return { status: 'completed' } },
      async cancel() {},
      ...overrides.taskAPI,
    },
    genStore: {
      markRunning() {},
      markDone() {},
      markFailed() {},
      stopPollingTask() {},
      ...overrides.genStore,
    },
    trackFilmCreateAction: overrides.trackFilmCreateAction || (() => {}),
    getStoryboardCountForApi: () => 0,
    ...overrides.deps,
  })
}

function installImmediateTimeouts() {
  const original = globalThis.setTimeout
  globalThis.setTimeout = (callback, _delay, ...args) => original(callback, 0, ...args)
  return () => { globalThis.setTimeout = original }
}

test('pipeline pause gate resumes every concurrent waiter', async () => {
  let paused = true
  let aborted = false
  const gate = createPipelinePauseGate({
    isPaused: () => paused,
    isAborted: () => aborted,
  })
  const resumed = []
  const waiters = [1, 2, 3].map(async (taskId) => {
    await gate.wait()
    resumed.push(taskId)
  })

  await Promise.resolve()
  assert.deepEqual(resumed, [])

  paused = false
  gate.release()
  await Promise.all(waiters)
  assert.deepEqual(resumed.sort(), [1, 2, 3])
})

test('pipeline pause gate releases waiters into the shared abort state', async () => {
  let paused = true
  let aborted = false
  const gate = createPipelinePauseGate({
    isPaused: () => paused,
    isAborted: () => aborted,
  })
  const waiter = gate.wait()

  await Promise.resolve()
  aborted = true
  paused = false
  gate.release()

  await assert.rejects(waiter, (error) => {
    assert.equal(error.pipelineAborted, true)
    assert.match(error.message, /全流程已取消/)
    return true
  })
})

test('pipeline retry never retries or records an abort as an ordinary failure', async () => {
  let attempts = 0
  let rests = 0
  let failures = 0

  await assert.rejects(
    runPipelineTaskWithRetry({
      task: async () => {
        attempts += 1
        throw createPipelineAbortError()
      },
      maxRetries: 3,
      rest: async () => { rests += 1 },
      isAborted: () => false,
      onFailure: () => { failures += 1 },
    }),
    (error) => error.pipelineAborted === true,
  )

  assert.equal(attempts, 1)
  assert.equal(rests, 0)
  assert.equal(failures, 0)
})

test('pipeline retry still aggregates ordinary failures after the configured attempts', async () => {
  let attempts = 0
  let rests = 0
  let capturedError = null

  const result = await runPipelineTaskWithRetry({
    task: async () => {
      attempts += 1
      throw new Error(`普通失败 ${attempts}`)
    },
    maxRetries: 2,
    rest: async () => { rests += 1 },
    isAborted: () => false,
    onFailure: (error) => { capturedError = error },
  })

  assert.equal(result, false)
  assert.equal(attempts, 2)
  assert.equal(rests, 1)
  assert.equal(capturedError?.message, '普通失败 2')
})

test('pipeline retry aborts between retry waits without recording an ordinary failure', async () => {
  let attempts = 0
  let aborted = false
  let failures = 0

  await assert.rejects(
    runPipelineTaskWithRetry({
      task: async () => {
        attempts += 1
        throw new Error('temporary')
      },
      maxRetries: 3,
      rest: async () => { aborted = true },
      isAborted: () => aborted,
      onFailure: () => { failures += 1 },
    }),
    (error) => error.pipelineAborted === true,
  )

  assert.equal(attempts, 1)
  assert.equal(failures, 0)
})

test('pipeline cancellation sweeps task ids that arrive before the owned run settles', async () => {
  let rejectRun
  const runPromise = new Promise((_resolve, reject) => { rejectRun = reject })
  const taskIds = new Set(['task-early'])
  const cancelCalls = []
  const cancellation = cancelPipelineTasksAroundRun({
    getTaskIds: () => taskIds,
    runPromise,
    cancelTask: async (taskId) => {
      cancelCalls.push(taskId)
      taskIds.delete(taskId)
    },
  })

  await Promise.resolve()
  taskIds.add('task-late')
  rejectRun(createPipelineAbortError())
  const result = await cancellation
  assert.equal(result.complete, true)
  assert.deepEqual(cancelCalls.sort(), ['task-early', 'task-late'].sort())
})

test('pipeline cancellation reports remaining task ids when remote cancel fails', async () => {
  let attempts = 0
  const result = await cancelPipelineTasksAroundRun({
    getTaskIds: () => new Set(['task-unreachable']),
    runPromise: Promise.resolve(),
    cancelTask: async () => {
      attempts += 1
      throw new Error('远端不可达')
    },
  })

  assert.equal(result.complete, false)
  assert.equal(attempts, 2)
  assert.deepEqual(result.failedTaskIds, ['task-unreachable'])
})

test('FilmCreate pauses inside polling and keeps ownership of the same task id', async () => {
  const restoreTimeouts = installImmediateTimeouts()
  const getCalls = []
  try {
    const run = createPipelineRun({
      taskAPI: {
        async get(taskId, options) {
          getCalls.push({ taskId, options })
          return { status: 'completed', result: { ok: true } }
        },
      },
    })

    run.pipelinePaused.value = true
    const pending = run.pollTaskWithPause('task-keep')
    for (let i = 0; i < 8 && getCalls.length === 0; i += 1) {
      await new Promise((resolve) => restoreTimeouts && setTimeout(resolve, 0))
    }
    assert.equal(run.pipelineOwnedTaskIds.has('task-keep'), true)
    assert.equal(getCalls.length, 0)

    run.onPipelineResume()
    const result = await pending
    assert.equal(getCalls.length, 1)
    assert.equal(getCalls[0].taskId, 'task-keep')
    assert.deepEqual(getCalls[0].options, {
      suppressErrorToast: true,
      timeout: DEFAULT_POLL_TIMEOUT_MS,
    })
    assert.equal(result.status, 'completed')
    assert.equal(result.paused, undefined)
  } finally {
    restoreTimeouts()
  }
})

test('FilmCreate cancellation waits for its owned run and never unlocks in the task button', async () => {
  const feedback = stubElementPlusFeedback()
  try {
    const cancelRemote = []
    const run = createPipelineRun({
      taskAPI: {
        async cancel(taskId, payload, options) {
          cancelRemote.push({ taskId, payload, options })
        },
      },
    })
    run.pipelineRunning.value = true
    run.pipelineOwnedTaskIds.add('owned-1')

    const { cancelActiveTask } = useFilmCreateTaskCancel({
      ElMessage,
      genStore: {
        stopPollingTask() {},
        getAllRunningTasks() {
          throw new Error('任务按钮取消不应扫全部运行中任务')
        },
        async cancelTask() {
          throw new Error('任务按钮取消不应改走 genStore.cancelTask')
        },
      },
      cancelPipelineRun: (...args) => run.cancelPipelineRun(...args),
      storyGenerating: refOf(false),
      scriptGenerating: refOf(false),
      universalOmniPolishAbort: refOf(false),
      batchImageStopping: refOf(false),
      batchVideoStopping: refOf(false),
    })

    await cancelActiveTask({ kind: 'pipeline' })
    assert.equal(run.pipelineAbortRequested.value, true)
    assert.deepEqual(cancelRemote.map((item) => item.taskId), ['owned-1'])
    assert.equal(cancelRemote[0].payload.reason, '用户停止全流程')
    assert.match(feedback.last('warning').message, /本地全流程已停止/)
    assert.doesNotMatch(feedback.last('warning').message, /取消远端任务|远端任务取消失败|取消剩余远端任务/)
  } finally {
    feedback.restore()
  }
})

test('FilmCreate routes retry and production launch through abort and cost gates', async () => {
  const feedback = stubElementPlusFeedback()
  try {
    const events = []
    const pipelineAbortRequested = refOf(true)
    const pipelineStarting = refOf(false)
    const pipelineRunning = refOf(false)
    const pipelineStopping = refOf(false)
    const activePipelineRunPromise = refOf(null)
    const pipelineErrorLog = refOf([])
    const pipelineCurrentStep = refOf('')
    const pipelineStepIndex = refOf(0)
    const pipelineStepTotal = refOf(10)
    const pipelineActiveTasks = new Set()
    const pipelineOwnedTaskIds = new Set()

    const stages = useFilmCreatePipelineStages({
      currentEpisodeId: refOf(22),
      dramaId: refOf(11),
      pipelineStarting,
      pipelineRunning,
      pipelineStopping,
      activePipelineRunPromise,
      pipelineAbortRequested,
      pipelineErrorLog,
      pipelineCurrentStep,
      pipelineStepIndex,
      pipelineStepTotal,
      pipelineActiveTasks,
      pipelineOwnedTaskIds,
      storyboardMediaActionReason: refOf(''),
      refreshProductionReadiness: async () => {
        events.push('readiness')
        assert.equal(pipelineAbortRequested.value, false)
        pipelineAbortRequested.value = true
        return { ready: true, reason: '' }
      },
      confirmProductionPipelineCost: async () => {
        events.push('cost')
        return true
      },
      executeOwnedPipelineRun: async () => {
        events.push('run')
      },
      trackFilmCreateAction(action) {
        events.push(action)
      },
    })

    await stages.startOneClickPipeline()
    assert.deepEqual(events, ['readiness'])

    events.length = 0
    pipelineAbortRequested.value = false
    const laterAbort = useFilmCreatePipelineStages({
      currentEpisodeId: refOf(22),
      dramaId: refOf(11),
      pipelineStarting: refOf(false),
      pipelineRunning: refOf(false),
      pipelineStopping: refOf(false),
      activePipelineRunPromise: refOf(null),
      pipelineAbortRequested,
      pipelineErrorLog,
      pipelineCurrentStep,
      pipelineStepIndex,
      pipelineStepTotal,
      pipelineActiveTasks,
      pipelineOwnedTaskIds,
      storyboardMediaActionReason: refOf(''),
      refreshProductionReadiness: async () => ({ ready: true, reason: '' }),
      confirmProductionPipelineCost: async () => {
        events.push('cost')
        pipelineAbortRequested.value = true
        return true
      },
      executeOwnedPipelineRun: async () => {
        events.push('run')
      },
      trackFilmCreateAction(action) {
        events.push(action)
      },
    })
    await laterAbort.startOneClickPipeline()
    assert.deepEqual(events, ['cost'])
  } finally {
    feedback.restore()
  }
})

test('pipeline panel blocks duplicate starts and exposes an explicit stop command', () => {
  assert.match(pipelinePanelSource, /starting: \{ type: Boolean, default: false \}/)
  assert.match(pipelinePanelSource, /stopping: \{ type: Boolean, default: false \}/)
  assert.match(pipelinePanelSource, /stopRequired: \{ type: Boolean, default: false \}/)
  assert.match(pipelinePanelSource, /'cancel'/)
  assert.match(pipelinePanelSource, /:disabled="Boolean\(productionReason\) \|\| starting"/)
  assert.match(pipelinePanelSource, /:loading="stopping"[\s\S]*@click="\$emit\('cancel'\)"/)
})

test('FilmCreate protects navigation and unload while pipeline work is active', async () => {
  const feedback = stubElementPlusFeedback()
  try {
    const pipelineOwnedTaskIds = new Set(['owned-nav'])
    const cancelCalls = []
    const markSavedCalls = []
    const guards = useFilmCreateNavigationGuards({
      pipelineStarting: refOf(false),
      pipelineRunning: refOf(true),
      pipelineStopping: refOf(false),
      activePipelineRunPromise: refOf(null),
      pipelineOwnedTaskIds,
      showAiConfigDialog: refOf(false),
      aiConfigContentRef: refOf(null),
      scriptDraftController: {
        hasPendingChanges: () => false,
        markSaved(value) { markSavedCalls.push(value) },
      },
      flushScriptDraft: async () => {},
      cancelPipelineRun: async () => {
        cancelCalls.push('cancel')
        return true
      },
    })

    assert.equal(guards.hasActivePipelineWork(), true)
    let prevented = false
    const event = {
      preventDefault() { prevented = true },
      returnValue: 'preset',
    }
    guards.handleBeforeUnload(event)
    assert.equal(prevented, true)
    assert.equal(event.returnValue, '')

    assert.equal(await guards.allowNavigationAfterDraftFlush(), true)
    assert.equal(cancelCalls.length, 1)
    assert.deepEqual(markSavedCalls, [])
    assert.match(feedback.last('confirm').message, /已提交的供应商任务和计费可能继续/)
    assert.doesNotMatch(feedback.last('confirm').message, /取消本流程已经提交的远端生成任务/)
  } finally {
    feedback.restore()
  }
})

test('FilmCreate describes pipeline stop as local-only and discloses provider billing risk', async () => {
  const feedback = stubElementPlusFeedback()
  try {
    const run = createPipelineRun()
    run.pipelineRunning.value = true
    run.pipelineOwnedTaskIds.add('owned-2')
    await run.cancelPipelineRun()
    assert.match(run.pipelineCurrentStep.value, /停止本地执行|本地全流程已停止/)
    assert.match(feedback.last('warning').message, /供应商任务和计费可能继续/)
    assert.doesNotMatch(feedback.last('warning').message, /取消远端任务|远端任务取消失败|取消剩余远端任务/)

    const guards = useFilmCreateNavigationGuards({
      pipelineStarting: refOf(false),
      pipelineRunning: refOf(true),
      pipelineStopping: refOf(false),
      activePipelineRunPromise: refOf(null),
      pipelineOwnedTaskIds: new Set(['owned-2']),
      showAiConfigDialog: refOf(false),
      aiConfigContentRef: refOf(null),
      scriptDraftController: {
        hasPendingChanges: () => false,
        markSaved() {},
      },
      flushScriptDraft: async () => {},
      cancelPipelineRun: async () => true,
    })
    await guards.confirmPipelineNavigation()
    assert.match(feedback.last('confirm').message, /已提交的供应商任务和计费可能继续/)
    assert.doesNotMatch(feedback.last('confirm').message, /取消本流程已经提交的远端生成任务/)
  } finally {
    feedback.restore()
  }
})
