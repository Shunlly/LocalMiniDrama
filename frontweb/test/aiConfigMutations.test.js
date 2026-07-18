import test from 'node:test'
import assert from 'node:assert/strict'

import { runAiConfigCreateBatch } from '../src/utils/aiConfigMutations.js'

test('AI config create batch reports all successes in input order without mutation', async () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  const before = structuredClone(items)
  const attempted = []

  const result = await runAiConfigCreateBatch(items, async (item) => {
    attempted.push(item.id)
  })

  assert.deepEqual(result, { success: 3, failed: 0 })
  assert.deepEqual(attempted, ['a', 'b', 'c'])
  assert.deepEqual(items, before)
})

test('AI config create batch continues after a failure and reports partial success', async () => {
  const items = [{ id: 'first' }, { id: 'broken' }, { id: 'last' }]
  const before = structuredClone(items)
  const attempted = []

  const result = await runAiConfigCreateBatch(items, async (item) => {
    attempted.push(item.id)
    if (item.id === 'broken') throw new Error('create failed')
  })

  assert.deepEqual(result, { success: 2, failed: 1 })
  assert.deepEqual(attempted, ['first', 'broken', 'last'])
  assert.deepEqual(items, before)
})

test('AI config create batch attempts every item when all creates fail', async () => {
  const items = [{ id: 1 }, { id: 2 }]
  const before = structuredClone(items)
  const attempted = []

  const result = await runAiConfigCreateBatch(items, async (item) => {
    attempted.push(item.id)
    throw new Error(`failed ${item.id}`)
  })

  assert.deepEqual(result, { success: 0, failed: 2 })
  assert.deepEqual(attempted, [1, 2])
  assert.deepEqual(items, before)
})
