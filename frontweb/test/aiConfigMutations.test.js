import test from 'node:test'
import assert from 'node:assert/strict'

import {
  confirmAiConfigBulkKeyResult,
  confirmAiConfigMutationInList,
  confirmAiConfigMutationResult,
  isAiConfigBulkKeyResult,
  runAiConfigCreateBatch,
} from '../src/utils/aiConfigMutations.js'

test('AI config create batch reports all successes in input order without mutation', async () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  const before = structuredClone(items)
  const attempted = []

  const result = await runAiConfigCreateBatch(items, async (item) => {
    attempted.push(item.id)
    return { id: item.id }
  })

  assert.deepEqual(result, {
    success: 3,
    failed: 0,
    created: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
  })
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
    return { id: item.id }
  })

  assert.deepEqual(result, { success: 2, failed: 1, created: [{ id: 'first' }, { id: 'last' }] })
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

  assert.deepEqual(result, { success: 0, failed: 2, created: [] })
  assert.deepEqual(attempted, [1, 2])
  assert.deepEqual(items, before)
})

test('single AI config confirmation compares the server snapshot and opaque revision, not local form state', () => {
  const payload = {
    service_type: 'video',
    provider: 'minimax',
    api_protocol: 'minimax',
    name: '合成测试配置',
    base_url: 'https://api.minimaxi.com/v1/',
    endpoint: '/video_generation',
    query_endpoint: '/query/video_generation/{taskId}',
    model: [' MiniMax-Hailuo-2.3 ', 'MiniMax-Hailuo-2.3'],
    default_model: ' MiniMax-Hailuo-2.3 ',
    priority: 10,
    is_default: true,
    api_key: 'fixture-key-new',
  }
  const server = {
    id: 41,
    ...payload,
    base_url: 'https://api.minimaxi.com/v1',
    model: ['MiniMax-Hailuo-2.3'],
    default_model: 'MiniMax-Hailuo-2.3',
    api_key: '********',
    api_key_set: true,
    updated_at: '2026-08-02T00:00:00.001Z',
  }
  const confirmation = confirmAiConfigMutationResult(server, payload)
  assert.deepEqual(confirmation, {
    id: 41,
    updated_at: '2026-08-02T00:00:00.001Z',
    api_key_set: true,
  })
  assert.equal(confirmAiConfigMutationResult({ ...server, provider: 'openai' }, payload), null)
  assert.equal(confirmAiConfigMutationResult({ ...server, updated_at: '' }, payload), null)
  assert.equal(confirmAiConfigMutationInList(confirmation, [server]), true)
  assert.equal(confirmAiConfigMutationInList(confirmation, [{ ...server, updated_at: 'later' }]), false)
})

test('masked single edits preserve the prior credential state without comparing or exposing the secret', () => {
  const payload = {
    service_type: 'text',
    provider: 'openai_compatible',
    api_protocol: 'openai',
    name: '编辑测试',
    base_url: 'https://provider.example/v1',
    model: ['model-a'],
    default_model: 'model-a',
    api_key: '********',
  }
  const server = {
    id: 8,
    ...payload,
    api_key: '********',
    api_key_set: true,
    updated_at: '2026-08-02T00:00:00.002Z',
  }
  assert.ok(confirmAiConfigMutationResult(server, payload, { api_key_set: true }))
  assert.equal(confirmAiConfigMutationResult(server, payload, { api_key_set: false }), null)
  assert.equal(JSON.stringify(confirmAiConfigMutationResult(server, payload, { api_key_set: true })).includes('fixture'), false)
})

test('bulk key confirmation requires one server revision per updated config', () => {
  const result = {
    updated: 2,
    confirmations: [
      { id: 1, updated_at: '2026-08-02T00:00:00.010Z', api_key_set: true },
      { id: 2, updated_at: '2026-08-02T00:00:00.011Z', api_key_set: true },
    ],
  }
  const list = [
    { id: '1', updated_at: '2026-08-02T00:00:00.010Z', api_key_set: true },
    { id: 2, updated_at: '2026-08-02T00:00:00.011Z', api_key_set: true },
  ]
  assert.equal(isAiConfigBulkKeyResult(result), true)
  assert.equal(confirmAiConfigBulkKeyResult(result, list), true)
  assert.equal(confirmAiConfigBulkKeyResult(result, [{ ...list[0] }, { ...list[1], updated_at: 'stale' }]), false)
  assert.equal(isAiConfigBulkKeyResult({ updated: 1, confirmations: [] }), false)
})
