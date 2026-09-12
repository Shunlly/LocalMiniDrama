import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  createAiConfigLeaveNavigation,
  preloadAiConfigReturnTarget,
  preloadProjectListPage,
} from '../src/composables/createAiConfigLeaveNavigation.js'

const helperSource = readFileSync(new URL('../src/composables/createAiConfigLeaveNavigation.js', import.meta.url), 'utf8')
const pageSource = readFileSync(new URL('../src/views/AiConfig.vue', import.meta.url), 'utf8')

test('AI config page preloads the list route and keeps named list replace', () => {
  assert.match(helperSource, /import\('@\/views\/FilmList\.vue'\)/)
  assert.match(helperSource, /if \(leaveConfirmed \|\| skipNextRouteGuard\) return true/)
  assert.match(helperSource, /leaveConfirmed = true/)
  assert.match(pageSource, /preloadProjectListPage\(\)/)
  assert.match(pageSource, /router\.replace\(returnTo\.value \|\| \{ name: 'list' \}\)/)
  assert.match(pageSource, /onBeforeRouteLeave\(leaveNavigation\.allowRouteLeave\)/)
})

test('preload helper maps return targets without loading Vue pages', () => {
  assert.equal(typeof preloadProjectListPage, 'function')
  assert.equal(typeof preloadAiConfigReturnTarget, 'function')
  assert.match(helperSource, /target\.startsWith\('\/free-create'\)/)
  assert.match(helperSource, /target\.startsWith\('\/film\/'\)/)
})

test('continue editing does not navigate and does not confirm leave', async () => {
  const calls = { close: 0, back: 0, backup: 0, preload: 0 }
  const nav = createAiConfigLeaveNavigation({
    async requestClose() {
      calls.close += 1
      return false
    },
    async preload() {
      calls.preload += 1
    },
    async navigateBack() {
      calls.back += 1
    },
    async navigateBackup() {
      calls.backup += 1
    },
  })

  assert.equal(await nav.goBack(), false)
  assert.equal(await nav.allowRouteLeave(), false)
  assert.deepEqual(calls, { close: 2, back: 0, backup: 0, preload: 0 })
  assert.equal(nav.isLeaveConfirmed(), false)
})

test('discarding unsaved changes navigates once and later guards skip the confirm', async () => {
  const calls = { close: 0, back: 0, preload: 0 }
  const nav = createAiConfigLeaveNavigation({
    async requestClose() {
      calls.close += 1
      return true
    },
    async preload() {
      calls.preload += 1
    },
    async navigateBack() {
      calls.back += 1
    },
    async navigateBackup() {},
  })

  assert.equal(await nav.goBack(), true)
  assert.equal(await nav.allowRouteLeave(), true)
  assert.equal(await nav.goBack(), true)
  assert.equal(calls.close, 1)
  assert.equal(calls.back, 2)
  assert.equal(nav.isLeaveConfirmed(), true)
  assert.equal(nav.isSkippingRouteGuard(), false)
})

test('failed navigation keeps the unsaved confirm but allows a retry', async () => {
  const calls = { close: 0, back: 0 }
  let fail = true
  const nav = createAiConfigLeaveNavigation({
    async requestClose() {
      calls.close += 1
      return true
    },
    async navigateBack() {
      calls.back += 1
      if (fail) throw new Error('replace-failed')
    },
    async navigateBackup() {},
  })

  await assert.rejects(() => nav.goBack(), /replace-failed/)
  assert.equal(nav.isLeaveConfirmed(), false)
  assert.equal(nav.isSkippingRouteGuard(), false)
  fail = false
  assert.equal(await nav.goBack(), true)
  assert.equal(calls.close, 2)
  assert.equal(calls.back, 2)
  assert.equal(nav.isLeaveConfirmed(), true)
  assert.equal(nav.isSkippingRouteGuard(), false)
})

test('preload hang does not block replace', async () => {
  const calls = { back: 0 }
  const nav = createAiConfigLeaveNavigation({
    async requestClose() { return true },
    preload() { return new Promise(() => {}) },
    async navigateBack() { calls.back += 1 },
    async navigateBackup() {},
  })
  const finished = await Promise.race([
    nav.goBack(),
    new Promise((resolve) => setTimeout(() => resolve('timeout'), 80)),
  ])
  assert.equal(finished, true)
  assert.equal(calls.back, 1)
})
