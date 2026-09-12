import test from 'node:test'
import assert from 'node:assert/strict'

import { h, nextTick } from 'vue'

import {
  buttonByText,
  click,
  createHostRenderer,
  loadCompiledSfc,
  mountHarness,
  textContent,
} from './helpers/vueComponentHarness.js'

const barUrl = new URL('../src/components/aiConfig/AiConfigDependencyErrorBar.vue', import.meta.url)
const AiConfigDependencyErrorBar = await loadCompiledSfc(barUrl, 'ai-config-dependency-error-bar')
const renderer = createHostRenderer()

function mountBar(initial = {}) {
  const events = []
  const mounted = mountHarness(renderer, () => h(AiConfigDependencyErrorBar, {
    configDependencyError: initial.error ?? '',
    staleDataHint: Boolean(initial.stale),
    loading: Boolean(initial.loading),
    retryConfigDependencies: () => events.push('retry'),
  }))
  return { ...mounted, events }
}

test('没有依赖错误时不渲染告警条', async () => {
  const harness = mountBar()
  try {
    await nextTick()
    assert.doesNotMatch(textContent(harness.root), /AI 配置依赖加载失败|写操作已暂停/)
    assert.equal(buttonByText(harness.root, '重新读取 AI 配置依赖'), undefined)
  } finally {
    harness.app.unmount()
  }
})

test('依赖失败展示中文告警，可重试；有缓存时说明写操作已暂停', async () => {
  const fresh = mountBar({
    error: 'AI 配置列表加载失败，请稍后重试',
  })
  try {
    await nextTick()
    assert.match(textContent(fresh.root), /AI 配置依赖加载失败/)
    assert.match(textContent(fresh.root), /AI 配置列表加载失败/)
    assert.doesNotMatch(textContent(fresh.root), /当前显示的是上次成功加载的数据/)
    const retry = buttonByText(fresh.root, '重新读取 AI 配置依赖')
    assert.ok(retry)
    assert.equal(retry.props['aria-label'], '重新读取 AI 配置依赖')
    assert.equal(textContent(retry).replace(/\s+/g, ' ').trim(), retry.props['aria-label'])
    click(retry)
    assert.deepEqual(fresh.events, ['retry'])
  } finally {
    fresh.app.unmount()
  }

  const stale = mountBar({
    error: 'AI 配置列表加载失败，请稍后重试',
    stale: true,
    loading: true,
  })
  try {
    await nextTick()
    assert.match(textContent(stale.root), /当前显示的是上次成功加载的数据，写操作已暂停/)
    const retry = buttonByText(stale.root, '重新读取 AI 配置依赖')
    assert.ok(retry)
    assert.equal(retry.props['data-loading'], true)
  } finally {
    stale.app.unmount()
  }
})
