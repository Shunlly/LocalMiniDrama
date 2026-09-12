import test from 'node:test'
import assert from 'node:assert/strict'

import {
  createAiConfigConnectionStatusStore,
  resolveAiConfigConnectionStatusScope,
} from '../src/utils/aiConfigConnectionStatusStore.js'

function createStorage() {
  const values = new Map()
  return {
    values,
    storage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    },
  }
}

test('connection status survives reload in one runtime scope without retaining sensitive configuration', () => {
  const { storage, values } = createStorage()
  const store = createAiConfigConnectionStatusStore({ storage, scope: 'runtime-a' })

  store.set(7, 'failed', '2026-07-20T08:00:00.000Z')
  const reloaded = createAiConfigConnectionStatusStore({ storage, scope: 'runtime-a' })

  assert.deepEqual(reloaded.forConfigs([{ id: 7 }, { id: 8 }]), {
    7: { status: 'failed', testedAt: '2026-07-20T08:00:00.000Z' },
  })
  const serialized = [...values.entries()].flat().join('\n')
  assert.doesNotMatch(serialized, /api[_-]?key|base[_-]?url|https?:\/\/|model|workflow/i)
})

test('runtime instance scope prevents numeric config ids contaminating another backend instance', () => {
  const { storage } = createStorage()
  createAiConfigConnectionStatusStore({ storage, scope: 'runtime-a' })
    .set(7, 'passed', '2026-07-20T08:00:00.000Z')

  assert.deepEqual(
    createAiConfigConnectionStatusStore({ storage, scope: 'runtime-b' }).forConfigs([{ id: 7 }]),
    {},
  )
})

test('health runtime instance is preferred and the injected runtime id is the safe fallback', async () => {
  assert.equal(await resolveAiConfigConnectionStatusScope({
    fetchImpl: async () => ({ ok: true, json: async () => ({ instance_id: 'backend-runtime-2' }) }),
    fallbackScope: 'frontend-runtime-1',
  }), 'backend-runtime-2')

  assert.equal(await resolveAiConfigConnectionStatusScope({
    fetchImpl: async () => { throw new Error('offline') },
    fallbackScope: 'frontend-runtime-1',
  }), 'frontend-runtime-1')
})

test('a throwing localStorage getter degrades to a usable in-memory store', () => {
  const globalObject = {}
  Object.defineProperty(globalObject, 'localStorage', {
    get() {
      throw new DOMException('blocked', 'SecurityError')
    },
  })

  let store
  assert.doesNotThrow(() => {
    store = createAiConfigConnectionStatusStore({ globalObject, scope: 'runtime-a' })
  })
  assert.doesNotThrow(() => store.set(3, 'passed', '2026-07-20T08:00:00.000Z'))
  assert.deepEqual(store.forConfigs([{ id: 3 }]), {
    3: { status: 'passed', testedAt: '2026-07-20T08:00:00.000Z' },
  })
})

test('forConfigs removes stale ids from persistent storage', () => {
  const { storage } = createStorage()
  const store = createAiConfigConnectionStatusStore({ storage, scope: 'runtime-a' })
  store.set(1, 'passed', '2026-07-20T08:00:00.000Z')
  store.set(2, 'failed', '2026-07-20T09:00:00.000Z')

  assert.deepEqual(store.forConfigs([{ id: 2 }]), {
    2: { status: 'failed', testedAt: '2026-07-20T09:00:00.000Z' },
  })
  assert.deepEqual(
    createAiConfigConnectionStatusStore({ storage, scope: 'runtime-a' }).forConfigs([{ id: 1 }, { id: 2 }]),
    { 2: { status: 'failed', testedAt: '2026-07-20T09:00:00.000Z' } },
  )
})

test('mutation invalidation is persisted for one or every configuration', () => {
  const { storage } = createStorage()
  const store = createAiConfigConnectionStatusStore({ storage, scope: 'runtime-a' })
  store.set(1, 'passed', '2026-07-20T08:00:00.000Z')
  store.set(2, 'failed', '2026-07-20T09:00:00.000Z')

  store.invalidate(1)
  assert.deepEqual(
    createAiConfigConnectionStatusStore({ storage, scope: 'runtime-a' }).forConfigs([{ id: 1 }, { id: 2 }]),
    { 2: { status: 'failed', testedAt: '2026-07-20T09:00:00.000Z' } },
  )

  store.invalidateAll()
  assert.deepEqual(
    createAiConfigConnectionStatusStore({ storage, scope: 'runtime-a' }).forConfigs([{ id: 2 }]),
    {},
  )
})
