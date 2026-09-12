import test from 'node:test'
import assert from 'node:assert/strict'

import { createLatestRequestGuard } from '../src/utils/latestRequest.js'

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function runGuardedRequest(guard, state, request) {
  const generation = guard.begin()
  guard.commit(generation, () => {
    state.loading = true
    state.failed = false
  })

  return request.then(
    (value) => {
      guard.commit(generation, () => {
        state.result = value.result
        state.cache = value.cache
      })
    },
    () => {
      guard.commit(generation, () => {
        state.result = null
        state.cache = null
        state.failed = true
      })
    },
  ).finally(() => {
    guard.commit(generation, () => {
      state.loading = false
      state.cacheAt += 1
    })
  })
}

function createState() {
  return { result: null, cache: null, cacheAt: 0, loading: false, failed: false }
}

test('latest request guard ignores an older request that resolves after the latest', async () => {
  const guard = createLatestRequestGuard()
  const state = createState()
  const oldRequest = deferred()
  const latestRequest = deferred()

  const oldRun = runGuardedRequest(guard, state, oldRequest.promise)
  const latestRun = runGuardedRequest(guard, state, latestRequest.promise)
  latestRequest.resolve({ result: 'latest', cache: 'latest-cache' })
  await latestRun
  const latestState = structuredClone(state)

  oldRequest.resolve({ result: 'old', cache: 'old-cache' })
  await oldRun

  assert.deepEqual(state, latestState)
  assert.deepEqual(state, {
    result: 'latest',
    cache: 'latest-cache',
    cacheAt: 1,
    loading: false,
    failed: false,
  })
})

test('latest request guard ignores an older request that rejects after the latest', async () => {
  const guard = createLatestRequestGuard()
  const state = createState()
  const oldRequest = deferred()
  const latestRequest = deferred()

  const oldRun = runGuardedRequest(guard, state, oldRequest.promise)
  const latestRun = runGuardedRequest(guard, state, latestRequest.promise)
  latestRequest.resolve({ result: 'latest', cache: 'latest-cache' })
  await latestRun
  const latestState = structuredClone(state)

  oldRequest.reject(new Error('old request failed'))
  await oldRun

  assert.deepEqual(state, latestState)
  assert.equal(state.failed, false)
  assert.equal(state.loading, false)
  assert.equal(state.cache, 'latest-cache')
  assert.equal(state.cacheAt, 1)
})
