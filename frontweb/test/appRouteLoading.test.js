import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8')

test('app keeps the active route visible while accessible route loading is pending', () => {
  assert.match(
    source,
    /<router-view(?![^>]*v-if)[^>]*>[\s\S]*?<component[^>]*:key="projectRouteInstanceKey\(matchedRoute\)"[^>]*\/>[\s\S]*?<\/router-view>\s*<div v-if="routeLoading"/,
  )
  assert.match(source, /v-if="routeLoading"[\s\S]*?role="status"[\s\S]*?aria-live="assertive"/)
  assert.match(source, /createRouteLoadingState/)
  assert.match(source, /const navigationTokens = new WeakMap\(\)/)
  assert.match(source, /const removeBeforeEach = router\.beforeEach\(\(to\) => \{[\s\S]*?navigationTokens\.set\(to, routeLoadingState\.begin\(\)\)/)
  assert.match(source, /const removeAfterEach = router\.afterEach\(\(to\) => \{[\s\S]*?routeLoadingState\.complete\(navigationTokens\.get\(to\)\)/)
  assert.match(source, /\.route-loading \{[\s\S]*?pointer-events: auto/)
  assert.match(source, /onBeforeUnmount\(\(\) => \{[\s\S]*?removeBeforeEach\(\)[\s\S]*?removeAfterEach\(\)[\s\S]*?removeOnError\(\)/)
})
