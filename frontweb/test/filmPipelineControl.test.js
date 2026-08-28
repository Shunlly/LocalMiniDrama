import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  cancelPipelineTasksAroundRun,
  createPipelineAbortError,
  createPipelinePauseGate,
  runPipelineTaskWithRetry,
} from '../src/utils/filmPipelineControl.js'

const filmCreateSource = readFileSync(new URL('../src/views/FilmCreate.vue', import.meta.url), 'utf8')
const pipelineRunSource = readFileSync(
  new URL('../src/composables/filmCreate/useFilmCreatePipelineRun.js', import.meta.url),
  'utf8',
)
const pipelineStagesSource = readFileSync(
  new URL('../src/composables/filmCreate/useFilmCreatePipelineStages.js', import.meta.url),
  'utf8',
)
const pipelinePanelSource = readFileSync(
  new URL('../src/components/filmCreate/FilmCreatePipelinePanel.vue', import.meta.url),
  'utf8',
)
const source = pipelineRunSource + '\n' + pipelineStagesSource + '\n' + filmCreateSource

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start + startMarker.length)
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`)
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`)
  return source.slice(start, end)
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
  assert.deepEqual(cancelCalls, ['task-early'])
  taskIds.add('task-late')
  rejectRun(createPipelineAbortError())

  const result = await cancellation
  assert.equal(result.complete, true)
  assert.deepEqual(cancelCalls, ['task-early', 'task-late'])
  assert.deepEqual(result.failedTaskIds, [])
  assert.equal(result.runError?.pipelineAborted, true)
})

test('pipeline cancellation reports a remote task that still fails after the final sweep', async () => {
  const taskIds = new Set(['task-unreachable'])
  let attempts = 0
  const result = await cancelPipelineTasksAroundRun({
    getTaskIds: () => taskIds,
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

test('FilmCreate pauses inside polling and keeps ownership of the same task id', () => {
  const pollSource = sourceBetween(
    source,
    'async function pollTaskWithPause',
    'function onPipelineResume',
  )

  assert.match(pollSource, /pipelineOwnedTaskIds\.add\(taskId\)/)
  assert.match(pollSource, /await pipelinePauseGate\.wait\(\)/)
  assert.match(pollSource, /taskAPI\.get\(taskId, \{ suppressErrorToast: true, timeout: DEFAULT_POLL_TIMEOUT_MS \}\)/)
  assert.doesNotMatch(pollSource, /resolve\(\{ paused: true \}\)/)
})

test('FilmCreate cancellation waits for its owned run and never unlocks in the task button', () => {
  const cancelTaskSource = sourceBetween(
    filmCreateSource,
    'async function cancelActiveTask',
    'const sbCharacterIds',
  )
  const cancelRunSource = sourceBetween(
    source,
    'async function cancelPipelineRun',
    'async function pollTaskWithPause',
  )

  assert.match(cancelTaskSource, /await cancelPipelineRun\(\)/)
  assert.doesNotMatch(cancelTaskSource, /pipelineRunning\.value = false/)
  assert.match(cancelRunSource, /pipelineAbortRequested\.value = true/)
  assert.match(cancelRunSource, /pipelinePauseGate\.release\(\)/)
  assert.match(cancelRunSource, /const runPromise = activePipelineRunPromise\.value/)
  assert.match(cancelRunSource, /cancelPipelineTasksAroundRun\(\{/)
  assert.match(cancelRunSource, /pipelineOwnedTaskIds/)
  assert.doesNotMatch(cancelRunSource, /genStore\.getAllRunningTasks\(\)/)
})

test('FilmCreate routes retry and production launch through abort and cost gates', () => {
  const startSource = sourceBetween(
    source,
    'async function startOneClickPipeline',
    'async function startTextFrameworkPipeline',
  )
  assert.match(source, /runPipelineTaskWithRetry\(\{/)
  assert.match(source, /const pipelineStarting = ref\(false\)/)
  assert.match(source, /const pipelineStopping = ref\(false\)/)
  assert.match(
    source,
    /async function startOneClickPipeline\(\)[\s\S]*await confirmProductionPipelineCost\(\)[\s\S]*await executeOwnedPipelineRun/,
  )
  assert.equal((startSource.match(/pipelineAbortRequested\.value = false/g) || []).length, 1)
  assert.ok(startSource.indexOf('pipelineAbortRequested.value = false') < startSource.indexOf('await refreshProductionReadiness()'))
  assert.ok(startSource.indexOf('if (pipelineAbortRequested.value) return') < startSource.indexOf('await confirmProductionPipelineCost()'))
  assert.ok(startSource.lastIndexOf('if (pipelineAbortRequested.value) return') < startSource.indexOf('await executeOwnedPipelineRun'))
})

test('pipeline panel blocks duplicate starts and exposes an explicit stop command', () => {
  assert.match(pipelinePanelSource, /starting: \{ type: Boolean, default: false \}/)
  assert.match(pipelinePanelSource, /stopping: \{ type: Boolean, default: false \}/)
  assert.match(pipelinePanelSource, /stopRequired: \{ type: Boolean, default: false \}/)
  assert.match(pipelinePanelSource, /'cancel'/)
  assert.match(pipelinePanelSource, /:disabled="Boolean\(productionReason\) \|\| starting"/)
  assert.match(pipelinePanelSource, /:loading="stopping"[\s\S]*@click="\$emit\('cancel'\)"/)
})

test('FilmCreate protects navigation and unload while pipeline work is active', () => {
  assert.match(
    filmCreateSource,
    /function hasActivePipelineWork\(\)[\s\S]*pipelineStarting\.value[\s\S]*pipelineRunning\.value[\s\S]*pipelineStopping\.value/,
  )
  assert.match(
    filmCreateSource,
    /async function confirmPipelineNavigation\(\)[\s\S]*ElMessageBox\.confirm[\s\S]*return cancelPipelineRun\(\)/,
  )
  assert.match(
    filmCreateSource,
    /async function allowNavigationAfterDraftFlush\(\)[\s\S]*await confirmPipelineNavigation\(\)[\s\S]*scriptDraftController\.markSaved\(null\)/,
  )
  assert.match(
    filmCreateSource,
    /function handleBeforeUnload\(event\)[\s\S]*hasActivePipelineWork\(\)/,
  )
})

test('FilmCreate describes pipeline stop as local-only and discloses provider billing risk', () => {
  const cancelRunSource = sourceBetween(
    source,
    'async function cancelPipelineRun',
    'async function pollTaskWithPause',
  )
  const navigationSource = sourceBetween(
    filmCreateSource,
    'async function confirmPipelineNavigation',
    'async function allowNavigationAfterDraftFlush',
  )

  assert.doesNotMatch(cancelRunSource, /取消远端任务|远端任务取消失败|取消剩余远端任务/)
  assert.doesNotMatch(navigationSource, /取消本流程已经提交的远端生成任务/)
  assert.match(cancelRunSource, /停止本地执行/)
  assert.match(navigationSource, /已提交的供应商任务和计费可能继续/)
})
