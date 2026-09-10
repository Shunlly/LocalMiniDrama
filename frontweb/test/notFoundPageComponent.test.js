import test from 'node:test'
import assert from 'node:assert/strict'

import { h, nextTick } from 'vue'

import {
  buttonByAriaLabel,
  buttonByText,
  click,
  compileIconStub,
  createHostRenderer,
  loadCompiledSfc,
  mountHarness,
  textContent,
  vueUrl,
} from './helpers/vueComponentHarness.js'
import {
  compileVueRouterStub,
  installVueRouterHarness,
  resetVueRouterHarness,
} from './helpers/vueRouterHarness.js'

const pageUrl = new URL('../src/views/NotFound.vue', import.meta.url)
const iconStubUrl = compileIconStub(['ArrowLeft', 'HomeFilled'])
const routerStubUrl = compileVueRouterStub()
const NotFoundPage = await loadCompiledSfc(
  pageUrl,
  'not-found-page-component',
  new Map([
    ['vue', vueUrl],
    ['vue-router', routerStubUrl],
    ['@element-plus/icons-vue', iconStubUrl],
  ]),
)

const renderer = createHostRenderer()

function mountNotFound(initial = {}) {
  const router = installVueRouterHarness({
    name: initial.name || 'not-found',
    fullPath: initial.fullPath || '/not-found',
    query: initial.query || {},
    back: Object.prototype.hasOwnProperty.call(initial, 'back') ? initial.back : null,
  })
  const mounted = mountHarness(renderer, () => h(NotFoundPage))
  return { ...mounted, router }
}

test('没有上一页时，主按钮可见文案和读屏名称都是返回项目列表', async () => {
  const harness = mountNotFound()
  try {
    await nextTick()
    const home = buttonByText(harness.root, '返回项目列表')
    assert.ok(home)
    assert.equal(home.props['aria-label'], '返回项目列表')
    assert.equal(buttonByAriaLabel(harness.root, '返回项目列表'), home)
    assert.equal(buttonByText(harness.root, '项目列表'), undefined)
    assert.equal(buttonByText(harness.root, '返回上一页'), undefined)
    assert.match(textContent(harness.root), /页面不存在/)
    click(home)
    assert.deepEqual(harness.router.calls, [['replace', '/']])
  } finally {
    harness.app.unmount()
    resetVueRouterHarness()
  }
})

test('有可返回上一页时，返回项目列表仍然保留独立读屏名称', async () => {
  const harness = mountNotFound({
    back: '/film/12',
    query: { from: '/missing-page' },
    fullPath: '/not-found?from=/missing-page',
  })
  try {
    await nextTick()
    const back = buttonByText(harness.root, '返回上一页')
    const home = buttonByText(harness.root, '返回项目列表')
    assert.ok(back)
    assert.ok(home)
    assert.equal(back.props['aria-label'], '返回上一页')
    assert.equal(home.props['aria-label'], '返回项目列表')
    assert.notEqual(back.props['aria-label'], home.props['aria-label'])
    assert.match(textContent(harness.root), /无法打开地址 \/missing-page/)
    click(home)
    assert.deepEqual(harness.router.calls, [['replace', '/']])
  } finally {
    harness.app.unmount()
    resetVueRouterHarness()
  }
})
