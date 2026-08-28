import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { createRouteLoadingState } from '../src/utils/routeLoadingState.js'

const source = readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8')

test('app keeps the active route visible while accessible route loading is pending', () => {
  const state = createRouteLoadingState()
  const first = state.begin()
  const second = state.begin()
  assert.equal(state.loading, true)
  assert.equal(state.complete(first), false)
  assert.equal(state.loading, true)
  assert.equal(state.complete(second), true)
  assert.equal(state.loading, false)

  assert.match(
    source,
    /<router-view(?![^>]*v-if)[^>]*>[\s\S]*?<component[^>]*:key="projectRouteInstanceKey\(matchedRoute\)"[^>]*\/>[\s\S]*?<\/router-view>\s*<div v-if="routeLoading"/,
  )
  assert.match(source, /v-if="routeLoading"[\s\S]*?role="status"[\s\S]*?aria-live="assertive"/)
  assert.match(source, /createRouteLoadingState/)
  assert.match(source, /const navigationTokens = new WeakMap\(\)/)
  assert.match(source, /pointer-events: auto/)
})

test('route loading overlay traps tab focus while navigation is pending', () => {
  assert.match(source, /aria-modal="true"/)
  assert.match(source, /tabindex="-1"/)
  assert.match(source, /@keydown="onRouteLoadingKeydown"/)
  assert.match(source, /routeLoadingRef\.value\?\.focus\(\{ preventScroll: true \}\)/)
})
