import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  classifyNotFoundPath,
  isRecoverableNotFoundBackPath,
  resolveCatchallNotFoundLocation,
  resolveNotFoundCopy,
  resolveNotFoundDisplayPath,
  resolveNotFoundFromPath,
  resolveNotFoundNavigation,
} from '../src/utils/notFoundNavigation.js'
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
  assert.match(notFoundSource, /resolveNotFoundDisplayPath\(route\)/)
  assert.match(notFoundSource, /resolveNotFoundCopy\(fromPath\.value, \{ canGoBack: canGoBack\.value \}\)/)
  assert.match(notFoundSource, /ref="titleRef" tabindex="-1"/)
  assert.match(notFoundSource, /aria-describedby="not-found-reason not-found-next-step"/)
  assert.match(notFoundSource, /id="not-found-reason"/)
  assert.match(notFoundSource, /id="not-found-next-step"/)
  assert.match(notFoundSource, /\{\{ copy\.reason \}\}/)
  assert.match(notFoundSource, /\{\{ copy\.nextStep \}\}/)
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
  assert.equal(resolveNotFoundDisplayPath({ query: { from: '/film/abc' } }), '/film/abc')
  assert.equal(resolveNotFoundDisplayPath({ name: 'not-found-catchall', fullPath: '/ghost-page', query: {} }), '/ghost-page')
  assert.equal(resolveNotFoundDisplayPath({ name: 'not-found', fullPath: '/not-found', query: {} }), '')
  assert.match(notFoundSource, /resolveNotFoundDisplayPath\(route\)/)
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
    resolveCatchallNotFoundLocation('/this-page-does-not-exist', ''),
    { name: 'not-found', replace: true, query: { from: '/this-page-does-not-exist' } },
  )
  assert.deepEqual(
    resolveCatchallNotFoundLocation('/backup/../evil', '/backup'),
    { name: 'not-found', replace: false, query: { from: '/backup/../evil' } },
  )
  assert.equal(resolveCatchallNotFoundLocation('/ghost', '/film/12').name, 'not-found')
  assert.notEqual(resolveCatchallNotFoundLocation('/ghost', '/film/12').name, 'not-found-catchall')
})

test('制作页和详情深链接失效时给出中文原因和下一步', () => {
  assert.equal(classifyNotFoundPath('/film/abc').kind, 'film')
  assert.equal(classifyNotFoundPath('/film/abc').validId, false)
  assert.equal(classifyNotFoundPath('/film/12').kind, 'film')
  assert.equal(classifyNotFoundPath('/film/12').validId, true)
  assert.equal(classifyNotFoundPath('/film/abc/canvas').kind, 'film-canvas')
  assert.equal(classifyNotFoundPath('/drama/0').kind, 'drama-detail')
  assert.equal(classifyNotFoundPath('/drama/abc').kind, 'drama-detail')
  assert.equal(classifyNotFoundPath('/this-page-does-not-exist').kind, 'unknown')
  assert.equal(classifyNotFoundPath('/film/12/extra').kind, 'film-unknown')
  assert.equal(classifyNotFoundPath('/drama/12/settings').kind, 'drama-unknown')

  const filmCopy = resolveNotFoundCopy('/film/abc')
  assert.equal(filmCopy.title, '页面不存在')
  assert.equal(filmCopy.kind, 'film')
  assert.match(filmCopy.reason, /无法打开地址 \/film\/abc/)
  assert.match(filmCopy.reason, /制作页深链接已失效/)
  assert.match(filmCopy.reason, /项目编号不正确/)
  assert.match(filmCopy.nextStep, /下一步：回到项目列表，从项目卡片重新打开制作页。/)

  const dramaCopy = resolveNotFoundCopy('/drama/0')
  assert.match(dramaCopy.reason, /无法打开地址 \/drama\/0/)
  assert.match(dramaCopy.reason, /项目详情深链接已失效/)
  assert.match(dramaCopy.nextStep, /下一步：回到项目列表，从项目卡片重新进入详情。/)

  const canvasCopy = resolveNotFoundCopy('/film/abc/canvas?episode=3')
  assert.match(canvasCopy.reason, /画布深链接已失效/)
  assert.match(canvasCopy.nextStep, /下一步：回到项目列表，打开有效项目后再进入画布。/)

  const unknownCopy = resolveNotFoundCopy('/this-page-does-not-exist')
  assert.match(unknownCopy.reason, /这个地址不在应用里/)
  assert.equal(unknownCopy.nextStep, '可以回到项目列表继续制作。')

  const genericCopy = resolveNotFoundCopy('')
  assert.equal(genericCopy.reason, '地址可能已失效，或项目编号不正确。')
  assert.equal(genericCopy.nextStep, '可以回到项目列表继续制作。')

  const backCopy = resolveNotFoundCopy('/missing-page', { canGoBack: true })
  assert.match(backCopy.reason, /无法打开地址 \/missing-page/)
  assert.equal(backCopy.nextStep, '可以返回上一页，或回到项目列表继续制作。')

  const filmBackCopy = resolveNotFoundCopy('/film/abc', { canGoBack: true })
  assert.match(filmBackCopy.nextStep, /^可以返回上一页。下一步：/)
})
