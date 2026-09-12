import test from 'node:test'
import assert from 'node:assert/strict'

test('only the latest navigation completion clears the route loading state', async () => {
  const { createRouteLoadingState } = await import('../src/utils/routeLoadingState.js')
  const state = createRouteLoadingState()

  const first = state.begin()
  const second = state.begin()
  assert.equal(state.loading, true)
  assert.equal(state.complete(first), false)
  assert.equal(state.loading, true)
  assert.equal(state.complete(second), true)
  assert.equal(state.loading, false)
})
