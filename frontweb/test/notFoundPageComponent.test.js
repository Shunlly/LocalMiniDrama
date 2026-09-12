import test from 'node:test'
import assert from 'node:assert/strict'

import { h, nextTick } from 'vue'

import {
  buttonByAriaLabel,
  buttonByText,
  click,
  compileIconStub,
  createHostRenderer,
  findAll,
  hasClass,
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
    assert.match(textContent(harness.root), /可以回到项目列表继续制作/)
    assert.doesNotMatch(textContent(harness.root), /可以返回上一页，或回到项目列表继续制作/)
    click(home)
    assert.deepEqual(harness.router.calls, [['replace', { name: 'list' }]])
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
    assert.match(textContent(harness.root), /可以返回上一页，或回到项目列表继续制作/)
    click(home)
    assert.deepEqual(harness.router.calls, [['replace', { name: 'list' }]])
  } finally {
    harness.app.unmount()
    resetVueRouterHarness()
  }
})

test('制作页深链接失效时展示中文原因和下一步', async () => {
  const harness = mountNotFound({
    query: { from: '/film/abc' },
    fullPath: '/not-found?from=/film/abc',
  })
  try {
    await nextTick()
    const home = buttonByText(harness.root, '返回项目列表')
    assert.ok(home)
    assert.equal(home.props['aria-label'], '返回项目列表')
    assert.match(textContent(harness.root), /无法打开地址 \/film\/abc/)
    assert.match(textContent(harness.root), /制作页深链接已失效/)
    assert.match(textContent(harness.root), /项目编号不正确，无法进入制作/)
    assert.match(textContent(harness.root), /下一步：回到项目列表，从项目卡片重新打开制作页。/)
    assert.equal(buttonByText(harness.root, '返回上一页'), undefined)
    click(home)
    assert.deepEqual(harness.router.calls, [['replace', { name: 'list' }]])
  } finally {
    harness.app.unmount()
    resetVueRouterHarness()
  }
})

test('详情深链接失效时展示中文原因和下一步', async () => {
  const harness = mountNotFound({
    query: { from: '/drama/0' },
    fullPath: '/not-found?from=/drama/0',
  })
  try {
    await nextTick()
    assert.match(textContent(harness.root), /无法打开地址 \/drama\/0/)
    assert.match(textContent(harness.root), /项目详情深链接已失效/)
    assert.match(textContent(harness.root), /下一步：回到项目列表，从项目卡片重新进入详情。/)
    const home = buttonByText(harness.root, '返回项目列表')
    assert.ok(home)
    assert.equal(home.props['aria-label'], '返回项目列表')
  } finally {
    harness.app.unmount()
    resetVueRouterHarness()
  }
})

test('未知路径进入命名 404 后说明地址不在应用里', async () => {
  const harness = mountNotFound({
    name: 'not-found-catchall',
    fullPath: '/this-page-does-not-exist',
    query: {},
  })
  try {
    await nextTick()
    assert.match(textContent(harness.root), /无法打开地址 \/this-page-does-not-exist/)
    assert.match(textContent(harness.root), /这个地址不在应用里/)
    assert.match(textContent(harness.root), /可以回到项目列表继续制作/)
    const home = buttonByText(harness.root, '返回项目列表')
    assert.ok(home)
    click(home)
    assert.deepEqual(harness.router.calls, [['replace', { name: 'list' }]])
  } finally {
    harness.app.unmount()
    resetVueRouterHarness()
  }
})

test('装饰 404 数字对读屏隐藏，主标题仍是页面不存在', async () => {
  const harness = mountNotFound({
    name: 'not-found-catchall',
    fullPath: '/this-page-does-not-exist',
  })
  try {
    await nextTick()
    const status = findAll(harness.root, (node) => hasClass(node, 'status-code'))[0]
    assert.ok(status)
    assert.equal(status.props['aria-hidden'], 'true')
    assert.equal(textContent(status).trim(), '404')
    const title = findAll(harness.root, (node) => node.props?.id === 'not-found-title')[0]
    assert.ok(title)
    assert.match(textContent(title), /页面不存在/)
    assert.doesNotMatch(textContent(title), /HTTP\s*\d{3}/)
    const home = buttonByAriaLabel(harness.root, '返回项目列表')
    assert.ok(home)
    assert.equal(textContent(home).replace(/\s+/g, ' ').trim(), '返回项目列表')
  } finally {
    harness.app.unmount()
    resetVueRouterHarness()
  }
})
