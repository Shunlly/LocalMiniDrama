import test from 'node:test'
import assert from 'node:assert/strict'

import { h, nextTick } from 'vue'

import {
  buttonByAriaLabel,
  click,
  compileIconStub,
  createHostRenderer,
  dataModule,
  findAll,
  findByClass,
  loadCompiledSfc,
  mountHarness,
  textContent,
  vueUrl,
} from './helpers/vueComponentHarness.js'
import { MEDIA_LIBRARY_DISABLE_REASON } from '../src/utils/mediaLibraryUserError.js'

const panelUrl = new URL('../src/components/mediaLibrary/MediaLibraryNetworkPanel.vue', import.meta.url)
const iconStubUrl = compileIconStub(['Search', 'Refresh'])
const childStubUrl = dataModule(`
  import { defineComponent, h } from ${JSON.stringify(vueUrl)}
  export default defineComponent({
    name: 'MediaLibraryNetworkChildStub',
    setup() {
      return () => h('div', { 'data-stub': 'network-child' })
    },
  })
`)
const MediaLibraryNetworkPanel = await loadCompiledSfc(
  panelUrl,
  'media-library-network-panel-component',
  new Map([
    ['vue', vueUrl],
    ['@element-plus/icons-vue', iconStubUrl],
    ['./MediaLibraryNetworkCard.vue', childStubUrl],
    ['./MediaLibraryNetworkEmpty.vue', childStubUrl],
  ]),
)

const renderer = createHostRenderer()

function noop() {}

function mountPanel(initial = {}) {
  const events = []
  const mounted = mountHarness(renderer, () => h(MediaLibraryNetworkPanel, {
    networkSource: initial.networkSource ?? 'all',
    'onUpdate:networkSource': noop,
    networkMediaType: initial.networkMediaType ?? 'all',
    'onUpdate:networkMediaType': noop,
    networkKeyword: initial.networkKeyword ?? '雨巷',
    'onUpdate:networkKeyword': noop,
    networkImportTargetLabel: '全局素材库',
    networkSearchAnnouncement: initial.networkSearchAnnouncement ?? '',
    networkLoading: Boolean(initial.networkLoading),
    networkSearchDisableReason: initial.networkSearchDisableReason ?? '',
    networkError: initial.networkError ?? '',
    networkNotice: initial.networkNotice ?? '',
    networkItems: initial.networkItems ?? [],
    networkSearched: Boolean(initial.networkSearched),
    networkImportButtonText: '导入到素材中心',
    handleNetworkSourceChange: () => events.push(['source']),
    handleNetworkTypeChange: () => events.push(['type']),
    searchNetworkMedia: () => events.push(['search']),
    networkItemKey: () => 'k',
    networkItemTitle: () => '',
    networkCardImageUrl: () => '',
    openNetworkPreview: noop,
    networkDimensions: () => '',
    networkItemSourceLabel: () => '',
    networkItemImportability: () => ({ allowed: true, reason: '' }),
    safeExternalUrl: () => '',
    isNetworkImporting: () => false,
    importNetworkItem: noop,
    clearNetworkSearch: () => events.push(['clear']),
    cancelNetworkSearch: () => events.push(['cancel']),
  }))
  return { ...mounted, events }
}

test('无关键词时搜索禁用原因挂到 aria-describedby，不出现取消按钮', async () => {
  const reason = MEDIA_LIBRARY_DISABLE_REASON.keywordRequired
  const harness = mountPanel({
    networkKeyword: '   ',
    networkSearchDisableReason: reason,
  })
  try {
    await nextTick()
    const search = buttonByAriaLabel(harness.root, reason)
    assert.ok(search)
    assert.equal(search.props.disabled, true)
    assert.equal(search.props['aria-describedby'], 'media-network-search-reason')
    const [node] = findAll(harness.root, (item) => item.props.id === 'media-network-search-reason')
    assert.equal(textContent(node).trim(), reason)
    assert.equal(buttonByAriaLabel(harness.root, '取消网络素材搜索'), undefined)
  } finally {
    harness.app.unmount()
  }
})

test('搜索中显示取消按钮，点取消立刻交给页面，公告是 live region', async () => {
  const harness = mountPanel({
    networkLoading: true,
    networkSearchDisableReason: MEDIA_LIBRARY_DISABLE_REASON.searching,
    networkSearchAnnouncement: '正在搜索：雨巷',
  })
  try {
    await nextTick()
    const search = buttonByAriaLabel(harness.root, '正在搜索网络素材')
    assert.ok(search)
    assert.equal(search.props.disabled, true)
    assert.equal(search.props['aria-describedby'], 'media-network-search-reason')
    const cancel = buttonByAriaLabel(harness.root, '取消网络素材搜索')
    assert.ok(cancel)
    click(cancel)
    assert.deepEqual(harness.events, [['cancel']])
    const [announcement] = findAll(harness.root, (node) => (
      node.props.role === 'status'
      && node.props['aria-live'] === 'polite'
      && node.props['aria-atomic'] === 'true'
    ))
    assert.ok(announcement)
    assert.match(textContent(announcement), /正在搜索：雨巷/)
  } finally {
    harness.app.unmount()
  }
})

test('网络说明是 polite live region', async () => {
  const harness = mountPanel({
    networkNotice: '部分来源没有缩略图',
  })
  try {
    await nextTick()
    const [notice] = findByClass(harness.root, 'network-state')
    assert.ok(notice)
    assert.equal(notice.props.role, 'status')
    assert.equal(notice.props['aria-live'], 'polite')
    assert.match(textContent(notice), /部分来源没有缩略图/)
  } finally {
    harness.app.unmount()
  }
})
test('搜索失败展示中文下一步并可重试', async () => {
  const harness = mountPanel({
    networkError: '暂时无法搜索网络素材，请稍后重试',
  })
  try {
    await nextTick()
    const copy = textContent(harness.root)
    assert.match(copy, /网络素材搜索失败/)
    assert.match(copy, /暂时无法搜索网络素材，请稍后重试/)
    assert.match(copy, /下一步：请检查网络后点「重试」/)
    assert.doesNotMatch(copy, /Network Error|Failed to fetch|AbortError/i)
    const retry = buttonByAriaLabel(harness.root, '重试搜索网络素材')
    assert.ok(retry)
    click(retry)
    assert.deepEqual(harness.events, [['search']])
  } finally {
    harness.app.unmount()
  }
})
