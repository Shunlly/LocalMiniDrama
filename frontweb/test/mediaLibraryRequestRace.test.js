import test from 'node:test'
import assert from 'node:assert/strict'

import { createLatestMediaRequestGuard } from '../src/utils/mediaLibrary.js'

test('an out-of-order successful response cannot replace the latest media results', () => {
  const guard = createLatestMediaRequestGuard()
  const olderRequest = guard.begin()
  const latestRequest = guard.begin()
  let items = []

  assert.equal(guard.commit(latestRequest, () => { items = ['latest'] }), true)
  assert.equal(guard.commit(olderRequest, () => { items = ['older'] }), false)
  assert.deepEqual(items, ['latest'])
})

test('an out-of-order failure cannot clear results or stop the latest loading state', () => {
  const guard = createLatestMediaRequestGuard()
  const olderRequest = guard.begin()
  const latestRequest = guard.begin()
  let items = ['existing']
  let loading = true

  assert.equal(guard.commit(olderRequest, () => { items = [] }), false)
  assert.equal(guard.commit(olderRequest, () => { loading = false }), false)
  assert.deepEqual(items, ['existing'])
  assert.equal(loading, true)

  assert.equal(guard.commit(latestRequest, () => { items = ['latest'] }), true)
  assert.equal(guard.commit(latestRequest, () => { loading = false }), true)
  assert.deepEqual(items, ['latest'])
  assert.equal(loading, false)
})

test('the latest request can commit an error state and finish loading', () => {
  const guard = createLatestMediaRequestGuard()
  const requestId = guard.begin()
  let items = ['stale']
  let loading = true

  assert.equal(guard.commit(requestId, () => { items = [] }), true)
  assert.equal(guard.commit(requestId, () => { loading = false }), true)
  assert.deepEqual(items, [])
  assert.equal(loading, false)
})
