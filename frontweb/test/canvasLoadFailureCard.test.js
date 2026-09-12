import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { h, nextTick, ref } from 'vue'

import {
  buttonByText,
  click,
  createHostRenderer,
  findByClass,
  loadCompiledSfc,
  mountHarness,
  textContent,
  vueUrl,
} from './helpers/vueComponentHarness.js'

const cardUrl = new URL('../src/components/dramaCanvas/CanvasLoadFailureCard.vue', import.meta.url)
const viewSource = readFileSync(new URL('../src/views/DramaCanvas.vue', import.meta.url), 'utf8')
const bindingsSource = readFileSync(new URL('../src/components/dramaCanvas/dramaCanvasControlBindings.js', import.meta.url), 'utf8')
const cardSource = readFileSync(cardUrl, 'utf8')

const canvasExperienceCopyUrl = new URL('../src/components/dramaCanvas/canvasExperienceCopy.js', import.meta.url)
const CanvasLoadFailureCard = await loadCompiledSfc(
  cardUrl,
  'canvas-load-failure-card',
  new Map([
    ['vue', vueUrl],
    ['./canvasExperienceCopy.js', canvasExperienceCopyUrl.href],
  ]),
)

const renderer = createHostRenderer()

function mountCard(initialProps = {}) {
  const retries = []
  const listReturns = []
  const cardRef = ref(null)
  const props = {
    loading: false,
    error: '画布服务暂时不可用',
    notFound: false,
    retryCanvasProjectLoad: () => retries.push(true),
    goProjectList: () => listReturns.push(true),
    goListMode: () => listReturns.push('list-mode'),
    dramaId: 12,
    ...initialProps,
  }
  const harness = mountHarness(renderer, () => h(CanvasLoadFailureCard, {
    ref: cardRef,
    ...props,
  }))
  return { ...harness, cardRef, listReturns, retries }
}

test('DramaCanvas 把加载失败面交给独立卡片，并保留重试与返回列表入口', () => {
  assert.match(viewSource, /<CanvasLoadFailureCard/)
  assert.match(viewSource, /v-if="canvasLoadState === 'error'"/)
  assert.match(viewSource, /ref="canvasLoadFailureRef"/)
  assert.match(viewSource, /v-bind="loadFailureBindings"/)
  assert.match(bindingsSource, /retryCanvasProjectLoad: ctx.retryCanvasProjectLoad/)
  assert.match(bindingsSource, /goProjectList: ctx.goProjectList/)
  assert.match(bindingsSource, /goListMode: ctx.goListMode/)
  assert.match(cardSource, /aria-label="返回列表模式"/)
  assert.match(cardSource, /@click="retryCanvasProjectLoad">重试加载/)
  assert.match(cardSource, /canvas-load-actions[\s\S]*@click="goProjectList">返回项目列表/)
  assert.match(cardSource, /defineExpose\(\{\s*focus:/)
})

test('加载失败卡展示错误详情，并区分项目不存在与可重试', async () => {
  const missing = mountCard({
    error: '项目不存在',
    notFound: true,
  })
  try {
    const copy = textContent(missing.root)
    assert.match(copy, /项目加载失败/)
    assert.match(copy, /当前画布暂时无法打开/)
    assert.match(copy, /项目不存在/)
    assert.match(copy, /项目可能已移入回收站或已删除/)
    assert.equal(findByClass(missing.root, 'canvas-load-failure')[0].props.role, 'alert')
  } finally {
    missing.app.unmount()
  }

  const retryable = mountCard({
    error: '连接画布服务超时，请稍后重试',
    notFound: false,
  })
  try {
    assert.match(textContent(retryable.root), /请确认本地服务可用后，在当前页面直接重试/)
  } finally {
    retryable.app.unmount()
  }
})

test('重试加载和返回项目列表会调用父级传入的动作', async () => {
  const harness = mountCard({ loading: true })
  try {
    const retry = buttonByText(harness.root, '重试加载')
    const listMode = buttonByText(harness.root, '返回列表模式')
    const back = buttonByText(harness.root, '返回项目列表')
    assert.ok(retry, '缺少重试加载按钮')
    assert.ok(listMode, '缺少返回列表模式按钮')
    assert.ok(back, '缺少返回项目列表按钮')
    assert.equal(retry.props['data-loading'], true)
    click(retry)
    click(listMode)
    click(back)
    assert.deepEqual(harness.retries, [true])
    assert.deepEqual(harness.listReturns, ['list-mode', true])
  } finally {
    harness.app.unmount()
  }
})

test('组件 focus 会转发到失败主区域，兼容加载 composable 的焦点恢复', async () => {
  const harness = mountCard()
  try {
    await nextTick()
    const main = findByClass(harness.root, 'canvas-load-failure')[0]
    let focused = 0
    main.focus = () => { focused += 1 }
    assert.equal(typeof harness.cardRef.value?.focus, 'function')
    harness.cardRef.value.focus()
    assert.equal(focused, 1)
  } finally {
    harness.app.unmount()
  }
})

test('英文技术错误不会直接展示，回落到中文下一步', async () => {
  const harness = mountCard({ error: 'Failed to fetch' })
  try {
    await nextTick()
    const copy = textContent(harness.root)
    assert.match(copy, /当前画布暂时无法打开/)
    assert.doesNotMatch(copy, /Failed to fetch/)
  } finally {
    harness.app.unmount()
  }
})
