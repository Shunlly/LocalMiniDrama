import test from 'node:test'
import assert from 'node:assert/strict'

import { h, nextTick } from 'vue'

import {
  buttonByAriaLabel,
  click,
  compileIconStub,
  createHostRenderer,
  findByClass,
  loadCompiledSfc,
  mountHarness,
  textContent,
  vueUrl,
} from './helpers/vueComponentHarness.js'

const emptyUrl = new URL('../src/components/mediaLibrary/MediaLibraryNetworkEmpty.vue', import.meta.url)
const iconStubUrl = compileIconStub(['Files', 'Search'])
const MediaLibraryNetworkEmpty = await loadCompiledSfc(
  emptyUrl,
  'media-library-network-empty-component',
  new Map([
    ['vue', vueUrl],
    ['@element-plus/icons-vue', iconStubUrl],
  ]),
)

const renderer = createHostRenderer()

function mountEmpty(initial = {}) {
  const events = []
  const mounted = mountHarness(renderer, () => h(MediaLibraryNetworkEmpty, {
    networkLoading: Boolean(initial.networkLoading),
    networkError: initial.networkError ?? '',
    networkSearched: Boolean(initial.networkSearched),
    networkItems: initial.networkItems ?? [],
    searchNetworkMedia: () => events.push(['search']),
    clearNetworkSearch: () => events.push(['clear']),
  }))
  return { ...mounted, events }
}

test('未搜索空态说明会附带来源和许可信息', async () => {
  const harness = mountEmpty()
  try {
    await nextTick()
    const copy = textContent(harness.root)
    assert.match(copy, /搜索可导入的网络素材/)
    assert.match(copy, /许可/)
    assert.match(copy, /下一步：在上方输入关键词后点搜索/)
    assert.doesNotMatch(copy, /No data|Search results|Network Error/i)
    const [empty] = findByClass(harness.root, 'network-empty')
    assert.equal(empty.props.role, 'status')
    assert.equal(empty.props['aria-live'], 'polite')
    assert.equal(buttonByAriaLabel(harness.root, '重新搜索网络素材'), undefined)
  } finally {
    harness.app.unmount()
  }
})

test('没有结果时可以重新搜索或清除搜索，不漏英文', async () => {
  const harness = mountEmpty({ networkSearched: true, networkItems: [] })
  try {
    await nextTick()
    const copy = textContent(harness.root)
    assert.match(copy, /没有找到匹配的网络素材/)
    assert.doesNotMatch(copy, /No results|Clear search|canceled|AbortError/i)
    const [empty] = findByClass(harness.root, 'network-empty')
    assert.equal(empty.props.role, 'status')
    assert.equal(empty.props['aria-live'], 'polite')
    click(buttonByAriaLabel(harness.root, '重新搜索网络素材'))
    click(buttonByAriaLabel(harness.root, '清除网络素材搜索'))
    assert.deepEqual(harness.events, [['search'], ['clear']])
  } finally {
    harness.app.unmount()
  }
})
