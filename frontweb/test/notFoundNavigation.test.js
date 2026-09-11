import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { isRecoverableNotFoundBackPath, resolveCatchallNotFoundLocation, resolveNotFoundFromPath, resolveNotFoundNavigation } from '../src/utils/notFoundNavigation.js'
import { APP_PATH_ALIASES, APP_VIEW_DEFINITIONS, getViewDefinition, isPersistableView } from '../src/router/views.js'

const notFoundSource = readFileSync(new URL('../src/views/NotFound.vue', import.meta.url), 'utf8')
const routerSource = readFileSync(new URL('../src/router/index.js', import.meta.url), 'utf8')
const appSource = readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8')

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
  assert.match(notFoundSource, />返回项目列表<\/el-button>/)
  assert.match(notFoundSource, /aria-label="返回上一页"/)
  assert.match(notFoundSource, /aria-label="返回项目列表"/)
  assert.match(notFoundSource, /router\.replace\(\{ name: 'list' \}\)/)
  assert.match(notFoundSource, /watch\(\(\) => route\.fullPath/)
  assert.doesNotMatch(notFoundSource, /router\.replace\('\/'\)/)
})

test('共享壳层去掉微信入口，旧素材地址转到素材中心', () => {
  assert.doesNotMatch(appSource, /微信我/)
  assert.doesNotMatch(appSource, /WeChat/i)
  for (const alias of APP_PATH_ALIASES) {
    const target = getViewDefinition(alias.view)
    assert.equal(target?.allowed, true, alias.path)
    assert.equal(isPersistableView(alias.view), true, alias.path)
    assert.match(
      routerSource,
      new RegExp(`path: '${alias.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'[\\s\\S]*redirect: '${target.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`),
    )
  }
})

test('失效地址和未知路径不会被当成可返回的上一页', () => {
  assert.deepEqual(resolveNotFoundNavigation({ back: '/missing-page' }, '/other-missing'), { type: 'home' })
  assert.deepEqual(resolveNotFoundNavigation({ back: '/film/abc' }, '/not-found?from=/film/abc'), { type: 'home' })
  assert.deepEqual(resolveNotFoundNavigation({ back: '/drama/0' }, '/not-found'), { type: 'home' })
  assert.deepEqual(resolveNotFoundNavigation({ back: '/film/12' }, '/not-found'), { type: 'back' })
  assert.deepEqual(resolveNotFoundNavigation({ back: '/film/12/canvas?episode=3' }, '/not-found'), { type: 'back' })
  assert.deepEqual(resolveNotFoundNavigation({ back: '/ai-config' }, '/not-found'), { type: 'back' })
  assert.deepEqual(resolveNotFoundNavigation({ back: '/backup' }, '/not-found'), { type: 'back' })
  assert.deepEqual(resolveNotFoundNavigation({ back: '/backup?returnTo=/' }, '/not-found'), { type: 'back' })
  assert.deepEqual(resolveNotFoundNavigation({ back: '/media' }, '/not-found'), { type: 'back' })
  assert.deepEqual(resolveNotFoundNavigation({ back: '/settings' }, '/not-found'), { type: 'back' })
  assert.deepEqual(resolveNotFoundNavigation({ back: '/drama/12/canvas' }, '/not-found'), { type: 'home' })
  assert.equal(isRecoverableNotFoundBackPath('/film/abc/canvas'), false)
  assert.equal(isRecoverableNotFoundBackPath('/drama/12/canvas'), false)
  for (const view of Object.values(APP_VIEW_DEFINITIONS)) {
    const sample = view.path.replace(':id', '12')
    assert.equal(isRecoverableNotFoundBackPath(sample), Boolean(view.allowed && view.persist), view.name)
  }
})

test('404 页会展示被拦截的原地址', () => {
  assert.equal(resolveNotFoundFromPath('/film/abc'), '/film/abc')
  assert.equal(resolveNotFoundFromPath(['/drama/12', '/evil']), '/drama/12')
  assert.equal(resolveNotFoundFromPath('https://example.com/'), '')
  assert.equal(resolveNotFoundFromPath('//evil.test'), '')
  assert.match(notFoundSource, /resolveNotFoundFromPath\(route\.query\.from\)/)
  assert.match(notFoundSource, /无法打开地址 \{\{ fromPath \}\}/)
})

test('直接打开未知地址会替换进 404，站内跳转则保留上一页', () => {
  assert.deepEqual(
    resolveCatchallNotFoundLocation('/missing-internal-page', '/'),
    { name: 'not-found', replace: false, query: { from: '/missing-internal-page' } },
  )
  assert.deepEqual(
    resolveCatchallNotFoundLocation('/ghost', ''),
    { name: 'not-found', replace: true, query: { from: '/ghost' } },
  )
  assert.deepEqual(
    resolveCatchallNotFoundLocation('/backup/../evil', '/backup'),
    { name: 'not-found', replace: false, query: { from: '/backup/../evil' } },
  )
})
