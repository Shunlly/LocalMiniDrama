import test from 'node:test'
import assert from 'node:assert/strict'

import { createCanvasHistory } from '../src/utils/canvasHistory.js'

test('canvas history coalesces repeated text commits into one undo step', () => {
  const history = createCanvasHistory({ content: '' }, { coalesceMs: 1000, now: () => 100 })

  history.commit({ content: 'A' }, 'text:free:text:1')
  history.commit({ content: 'AB' }, 'text:free:text:1')
  history.commit({ content: 'ABC' }, 'text:free:text:1')

  assert.deepEqual(history.present(), { content: 'ABC' })
  assert.equal(history.canUndo(), true)
  assert.deepEqual(history.undo(), { content: '' })
  assert.equal(history.canUndo(), false)
  assert.equal(history.canRedo(), true)
  assert.deepEqual(history.redo(), { content: 'ABC' })
})

test('canvas history keeps snapshots isolated, clears redo after commit, and respects its limit', () => {
  const initial = { nodes: [{ id: 'free:text:1', content: 'Initial' }] }
  const history = createCanvasHistory(initial, { limit: 2 })

  initial.nodes[0].content = 'Changed outside history'
  assert.deepEqual(history.present(), { nodes: [{ id: 'free:text:1', content: 'Initial' }] })

  history.commit({ nodes: [{ id: 'free:text:1', content: 'One' }] }, 'move')
  history.commit({ nodes: [{ id: 'free:text:1', content: 'Two' }] }, 'move')
  history.commit({ nodes: [{ id: 'free:text:1', content: 'Three' }] }, 'move')
  assert.deepEqual(history.undo(), { nodes: [{ id: 'free:text:1', content: 'Two' }] })
  assert.deepEqual(history.undo(), { nodes: [{ id: 'free:text:1', content: 'One' }] })
  assert.equal(history.canUndo(), false)

  history.redo()
  history.commit({ nodes: [{ id: 'free:text:1', content: 'Replacement' }] }, 'move')
  assert.equal(history.canRedo(), false)

  const present = history.present()
  present.nodes[0].content = 'Mutated return value'
  assert.deepEqual(history.present(), { nodes: [{ id: 'free:text:1', content: 'Replacement' }] })
  history.clear()
  assert.equal(history.canUndo(), false)
  assert.equal(history.canRedo(), false)
})
