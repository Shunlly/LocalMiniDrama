import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { h, nextTick, ref } from 'vue'

import {
  buttonByText,
  click,
  compileIconStub,
  createHostRenderer,
  loadCompiledSfc,
  mountHarness,
  textContent,
  vueUrl,
} from './helpers/vueComponentHarness.js'

const loadSource = readFileSync(new URL('../src/components/dramaDetail/DramaDetailLoadState.vue', import.meta.url), 'utf8')
const pageSource = readFileSync(new URL('../src/views/DramaDetail.vue', import.meta.url), 'utf8')
const loadAndNavSource = readFileSync(new URL('../src/components/dramaDetail/dramaDetailLoadAndNav.js', import.meta.url), 'utf8')
const loadUrl = new URL('../src/components/dramaDetail/DramaDetailLoadState.vue', import.meta.url)
const iconStubUrl = compileIconStub(['ArrowLeft', 'Loading', 'Refresh', 'WarningFilled'])
const DramaDetailLoadState = await loadCompiledSfc(
  loadUrl,
  'drama-detail-load-state-component',
  new Map([
    ['vue', vueUrl],
    ['@element-plus/icons-vue', iconStubUrl],
  ]),
)

const renderer = createHostRenderer()

function mountLoad(initial = {}) {
  const props = ref({
    state: 'loading',
    errorText: '',
    notFound: false,
    pending: false,
    ...initial,
  })
  const events = []
  const mounted = mountHarness(renderer, () => h(DramaDetailLoadState, {
    ...props.value,
    onRetry: () => events.push('retry'),
    onGoList: () => events.push('go-list'),
  }))
  return { ...mounted, events, props }
}

test('DramaDetail 把加载/失败态交给独立组件并保留重试与返回项目列表', () => {
  assert.match(pageSource, /<DramaDetailLoadState/)
  assert.match(pageSource, /ref="dramaLoadFailureRef"/)
  assert.match(pageSource, /@retry="retryDramaLoad"/)
  assert.match(pageSource, /@go-list="goList"/)
  assert.match(pageSource, /createDramaDetailLoadAndNav\(/)
  assert.match(loadAndNavSource, /dramaLoadFailureRef\.value\?\.focus\(\)/)
  assert.match(loadSource, /role="alert"/)
  assert.match(loadSource, /正在加载项目/)
  assert.match(loadSource, /返回项目列表/)
  assert.match(loadSource, /focus: \(\) => errorSectionRef\.value\?\.focus\?\.\(\)/)
})

test('加载中显示中文状态，失败主按钮是返回项目列表', async () => {
  const loading = mountLoad({ state: 'loading' })
  try {
    await nextTick()
    assert.match(textContent(loading.root), /正在加载项目/)
    assert.match(textContent(loading.root), /正在读取剧集、分集和制作资源/)
    assert.equal(buttonByText(loading.root, '返回项目列表'), undefined)
  } finally {
    loading.app.unmount()
  }

  const failed = mountLoad({
    state: 'error',
    errorText: '项目服务暂时不可用，请稍后重试',
    notFound: false,
  })
  try {
    await nextTick()
    assert.match(textContent(failed.root), /暂时无法加载项目/)
    const home = buttonByText(failed.root, '返回项目列表')
    const retry = buttonByText(failed.root, '重试加载')
    assert.ok(home, '缺少返回项目列表')
    assert.ok(retry, '缺少重试加载')
    click(home)
    click(retry)
    assert.deepEqual(failed.events, ['go-list', 'retry'])
  } finally {
    failed.app.unmount()
  }
})

test('项目不存在时只保留返回项目列表', async () => {
  const harness = mountLoad({
    state: 'error',
    errorText: '项目不存在或已删除',
    notFound: true,
  })
  try {
    await nextTick()
    assert.match(textContent(harness.root), /项目不存在/)
    assert.ok(buttonByText(harness.root, '返回项目列表'))
    assert.equal(buttonByText(harness.root, '重试加载'), undefined)
  } finally {
    harness.app.unmount()
  }
})
