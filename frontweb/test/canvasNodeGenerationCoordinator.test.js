import test from 'node:test'
import assert from 'node:assert/strict'

import { createCanvasNodeGenerationCoordinator } from '../src/utils/canvasNodeGenerationCoordinator.js'

test('node generation coordinator admits one run and aborts it with billing-aware reason', () => {
  const coordinator = createCanvasNodeGenerationCoordinator()
  const first = coordinator.begin({ nodeId: 'sb:11', step: 'audio' })

  assert.ok(first)
  assert.equal(coordinator.hasActive(), true)
  assert.deepEqual(coordinator.getActiveInfo(), { nodeId: 'sb:11', step: 'audio' })
  assert.equal(coordinator.begin({ nodeId: 'sb:12', step: 'video' }), null)

  assert.equal(coordinator.stopWaiting('页面已离开，后台任务和计费可能继续'), true)
  assert.equal(first.signal.aborted, true)
  assert.match(first.signal.reason.message, /计费可能继续/)
  assert.equal(coordinator.hasActive(), false)
})

test('stale completion cannot clear a newer node generation', () => {
  const coordinator = createCanvasNodeGenerationCoordinator()
  const first = coordinator.begin({ nodeId: 'sb:11', step: 'image' })
  first.finish()
  const second = coordinator.begin({ nodeId: 'sb:12', step: 'video' })

  first.finish()

  assert.equal(coordinator.hasActive(), true)
  assert.deepEqual(coordinator.getActiveInfo(), { nodeId: 'sb:12', step: 'video' })
  second.finish()
  assert.equal(coordinator.hasActive(), false)
})
