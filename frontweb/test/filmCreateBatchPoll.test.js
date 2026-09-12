import test from 'node:test'
import assert from 'node:assert/strict'

import { recordBatchPollFailure } from '../src/composables/filmCreate/filmCreateBatchPoll.js'
import { hasActiveMediaGenerationWork } from '../src/composables/filmCreate/filmCreateActiveMediaWork.js'
import { hasActiveMediaGenerationWork as reexported } from '../src/composables/filmCreate/useFilmCreateBatchGeneration.js'

function refOf(value) {
  return { value }
}

test('批量轮询取消不记为失败，超时和失败收成中文', () => {
  const stoppingErrors = refOf([])
  const stoppingProgress = refOf({ failed: 0 })
  assert.equal(recordBatchPollFailure(
    stoppingErrors,
    stoppingProgress,
    { id: 9, storyboard_number: 2 },
    { status: 'cancelled', error: 'canceled by user' },
    refOf(true),
  ), false)
  assert.deepEqual(stoppingErrors.value, [])
  assert.equal(stoppingProgress.value.failed, 0)

  const cancelErrors = refOf([])
  const cancelProgress = refOf({ failed: 0 })
  assert.equal(recordBatchPollFailure(
    cancelErrors,
    cancelProgress,
    { id: 9, storyboard_number: 2 },
    { status: 'canceled', error: 'canceled by user' },
    refOf(false),
  ), true)
  assert.equal(cancelErrors.value[0], '#2: 操作已取消')
  assert.equal(cancelProgress.value.failed, 1)

  const timeoutErrors = refOf([])
  const timeoutProgress = refOf({ failed: 0 })
  assert.equal(recordBatchPollFailure(
    timeoutErrors,
    timeoutProgress,
    { id: 11, storyboard_number: 3 },
    { status: 'timeout', error: 'timeout of 15000ms' },
    refOf(false),
  ), true)
  assert.match(timeoutErrors.value[0], /超时/)
  assert.doesNotMatch(timeoutErrors.value[0], /timeout of/)
  assert.equal(timeoutProgress.value.failed, 1)

  const failedErrors = refOf([])
  const failedProgress = refOf({ failed: 0 })
  assert.equal(recordBatchPollFailure(
    failedErrors,
    failedProgress,
    { id: 12, storyboard_number: 4 },
    { status: 'failed', error: 'Network Error' },
    refOf(false),
  ), true)
  assert.match(failedErrors.value[0], /生成失败/)
  assert.doesNotMatch(failedErrors.value[0], /Network Error/)
})

test('进行中媒体任务仍从批量 composable 再导出', () => {
  assert.equal(hasActiveMediaGenerationWork, reexported)
  assert.equal(hasActiveMediaGenerationWork({ batchImageRunning: true }), true)
  assert.equal(hasActiveMediaGenerationWork({ generatingSbVideoIds: new Set() }), false)
})
