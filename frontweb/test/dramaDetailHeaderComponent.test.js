import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { h, nextTick, ref } from 'vue'

import {
  buttonByAriaLabel,
  buttonByText,
  click,
  compileIconStub,
  createHostRenderer,
  loadCompiledSfc,
  mountHarness,
  vueUrl,
} from './helpers/vueComponentHarness.js'

const headerSource = readFileSync(new URL('../src/components/dramaDetail/DramaDetailHeader.vue', import.meta.url), 'utf8')
const pageSource = readFileSync(new URL('../src/views/DramaDetail.vue', import.meta.url), 'utf8')
const headerUrl = new URL('../src/components/dramaDetail/DramaDetailHeader.vue', import.meta.url)
const iconStubUrl = compileIconStub(['ArrowLeft', 'Grid', 'Moon', 'Sunny', 'VideoPlay'])
const DramaDetailHeader = await loadCompiledSfc(
  headerUrl,
  'drama-detail-header-component',
  new Map([
    ['vue', vueUrl],
    ['@element-plus/icons-vue', iconStubUrl],
  ]),
)

const renderer = createHostRenderer()
const EPISODE_ID = 22

function mountHeader(initial = {}) {
  const props = ref({
    pageTitle: '剧集管理',
    isDark: false,
    isDramaReady: true,
    currentEpisodeId: null,
    ...initial,
  })
  const events = []
  const mounted = mountHarness(renderer, () => h(DramaDetailHeader, {
    ...props.value,
    onGoList: () => events.push('go-list'),
    onToggleTheme: () => events.push('toggle-theme'),
    onGoCreate: () => events.push('go-create'),
    onGoCanvasMode: () => events.push('go-canvas-mode'),
  }))
  return { ...mounted, events, props }
}

test('DramaDetail 把页头交给独立组件，Logo 读屏名称仍是返回项目列表', () => {
  assert.match(pageSource, /<DramaDetailHeader/)
  assert.match(pageSource, /@go-list="goList"/)
  assert.match(pageSource, /@go-create="goCreate"/)
  assert.match(pageSource, /@go-canvas-mode="goCanvasMode"/)
  assert.match(pageSource, /:current-episode-id="currentEpisodeId"/)
  assert.match(headerSource, /aria-label="返回项目列表"/)
  assert.match(headerSource, /emit\('go-list'\)/)
  assert.doesNotMatch(pageSource, /<header class="header">/)
})

test('无分集时进入制作和画布模式保留中文禁用原因', async () => {
  const harness = mountHeader({ isDramaReady: true, currentEpisodeId: null })
  try {
    await nextTick()
    const logo = buttonByAriaLabel(harness.root, '返回项目列表')
    assert.ok(logo, '缺少 Logo 返回项目列表')
    click(logo)
    const back = buttonByText(harness.root, '返回项目列表')
    assert.ok(back, '缺少返回项目列表按钮')
    assert.equal(back.props['aria-label'], '返回项目列表')
    assert.equal(buttonByText(harness.root, '返回列表'), undefined)
    click(back)
    assert.deepEqual(harness.events, ['go-list', 'go-list'])

    const create = buttonByText(harness.root, '进入制作')
    const canvas = buttonByText(harness.root, '画布模式')
    assert.ok(create, '缺少进入制作')
    assert.ok(canvas, '缺少画布模式')
    assert.equal(create.props.disabled, true)
    assert.equal(canvas.props.disabled, true)
    assert.equal(create.props['aria-label'], '进入制作不可用：请先新增一集')
    assert.equal(canvas.props['aria-label'], '画布模式不可用：请先新增一集')
    assert.equal(create.props['aria-describedby'], 'drama-header-episode-reason')
    assert.equal(canvas.props['aria-describedby'], 'drama-header-episode-reason')
  } finally {
    harness.app.unmount()
  }
})

test('有分集时进入制作和画布模式可点并回到页面方法', async () => {
  const harness = mountHeader({ isDramaReady: true, currentEpisodeId: EPISODE_ID })
  try {
    await nextTick()
    const create = buttonByText(harness.root, '进入制作')
    const canvas = buttonByText(harness.root, '画布模式')
    assert.equal(create.props.disabled, false)
    assert.equal(canvas.props.disabled, false)
    assert.equal(create.props['aria-label'], '进入制作')
    assert.equal(canvas.props['aria-label'], '画布模式')
    click(create)
    click(canvas)
    assert.deepEqual(harness.events, ['go-create', 'go-canvas-mode'])
  } finally {
    harness.app.unmount()
  }
})
