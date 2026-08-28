import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolveNotFoundNavigation } from '../src/utils/notFoundNavigation.js'

const notFoundSource = readFileSync(new URL('../src/views/NotFound.vue', import.meta.url), 'utf8')

test('没有可用历史时 404 页回到项目列表', () => {
  assert.deepEqual(resolveNotFoundNavigation(null, '/not-found'), { type: 'home' })
  assert.deepEqual(resolveNotFoundNavigation({ back: null }, '/not-found'), { type: 'home' })
  assert.deepEqual(resolveNotFoundNavigation({ back: '/not-found' }, '/not-found?from=/film/abc'), { type: 'home' })
  assert.deepEqual(resolveNotFoundNavigation({ back: 'https://example.com/' }, '/not-found'), { type: 'home' })
})

test('同源站且非 404 的上一页允许返回', () => {
  assert.deepEqual(resolveNotFoundNavigation({ back: '/' }, '/not-found?from=/film/abc'), { type: 'back' })
  assert.deepEqual(resolveNotFoundNavigation({ back: '/media-library' }, '/not-found'), { type: 'back' })
})

test('404 页焦点落在标题并按历史决定主按钮', () => {
  assert.match(notFoundSource, /resolveNotFoundNavigation\(router\.options\.history\.state, route\.fullPath\)/)
  assert.match(notFoundSource, /ref="titleRef" tabindex="-1"/)
  assert.match(notFoundSource, /titleRef\.value\?\.focus/)
  assert.match(notFoundSource, /v-if="canGoBack"[\s\S]*返回上一页/)
  assert.match(notFoundSource, /type="primary"[\s\S]*项目列表/)
})
