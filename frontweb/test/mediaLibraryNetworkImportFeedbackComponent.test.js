import test from 'node:test'
import assert from 'node:assert/strict'

import { h, nextTick } from 'vue'

import {
  buttonByAriaLabel,
  click,
  compileIconStub,
  createHostRenderer,
  findAll,
  loadCompiledSfc,
  mountHarness,
  textContent,
  vueUrl,
} from './helpers/vueComponentHarness.js'
import { MEDIA_LIBRARY_DISABLE_REASON } from '../src/utils/mediaLibraryUserError.js'
import { networkItemImportability } from '../src/components/mediaLibrary/mediaLibraryFormatters.js'

const feedbackUrl = new URL('../src/components/mediaLibrary/MediaLibraryNetworkImportFeedback.vue', import.meta.url)
const iconStubUrl = compileIconStub(['Refresh'])
const MediaLibraryNetworkImportFeedback = await loadCompiledSfc(
  feedbackUrl,
  'media-library-network-import-feedback-component',
  new Map([
    ['vue', vueUrl],
    ['@element-plus/icons-vue', iconStubUrl],
  ]),
)

const renderer = createHostRenderer()
const RAIN = { title: '雨巷', source_url: 'https://example.com/rain', license: 'CC BY 4.0', license_url: 'https://example.com/license' }
const MOON = { title: '月光', source_url: 'https://example.com/moon' }

function mountFeedback(initial = {}) {
  const events = []
  const importing = initial.importingItem || null
  const mounted = mountHarness(renderer, () => h(MediaLibraryNetworkImportFeedback, {
    networkImportFeedback: initial.feedback ?? null,
    networkImportRetryItem: Object.prototype.hasOwnProperty.call(initial, 'retryItem') ? initial.retryItem : null,
    isNetworkImporting: (item) => item === importing,
    networkItemImportability,
    importNetworkItem: (item) => events.push(['import', item.title]),
    showLocalLibrary: initial.showLocalLibrary || (() => events.push(['show-local'])),
  }))
  return { ...mounted, events }
}

test('没有导入反馈时不渲染横幅', async () => {
  const harness = mountFeedback()
  try {
    await nextTick()
    assert.doesNotMatch(textContent(harness.root), /网络素材导入失败|重试导入/)
    assert.equal(buttonByAriaLabel(harness.root, '重试导入该网络素材'), undefined)
  } finally {
    harness.app.unmount()
  }
})

test('失败反馈可重试，导入中或缺少许可时禁用按钮', async () => {
  const failed = mountFeedback({
    feedback: { tone: 'error', title: '网络素材导入失败', detail: '雨巷导入失败，请稍后重试' },
    retryItem: RAIN,
  })
  try {
    await nextTick()
    assert.match(textContent(failed.root), /网络素材导入失败/)
    assert.match(textContent(failed.root), /雨巷导入失败/)
    assert.match(textContent(failed.root), /下一步：请点「重试导入」/)
    const retry = buttonByAriaLabel(failed.root, '重试导入该网络素材')
    assert.ok(retry)
    assert.notEqual(retry.props.disabled, true)
    assert.equal(retry.props['aria-describedby'], undefined)
    assert.equal(findAll(failed.root, (node) => node.props.id === 'media-network-import-retry-reason').length, 0)
    click(retry)
    assert.deepEqual(failed.events, [['import', '雨巷']])
  } finally {
    failed.app.unmount()
  }

  const busy = mountFeedback({
    feedback: { tone: 'error', title: '网络素材导入失败', detail: '雨巷导入失败' },
    retryItem: RAIN,
    importingItem: RAIN,
  })
  try {
    await nextTick()
    const retry = buttonByAriaLabel(busy.root, '重试导入该网络素材')
    assert.ok(retry)
    assert.equal(retry.props.disabled, true)
    assert.equal(retry.props.title, MEDIA_LIBRARY_DISABLE_REASON.importing)
    assert.equal(retry.props['aria-describedby'], 'media-network-import-retry-reason')
    const [busyReason] = findAll(busy.root, (node) => node.props.id === 'media-network-import-retry-reason')
    assert.equal(textContent(busyReason).trim(), MEDIA_LIBRARY_DISABLE_REASON.importing)
    assert.equal(retry.props['data-loading'], true)
  } finally {
    busy.app.unmount()
  }

  const blocked = mountFeedback({
    feedback: { tone: 'error', title: '网络素材导入失败', detail: '月光缺少许可' },
    retryItem: MOON,
  })
  try {
    await nextTick()
    const retry = buttonByAriaLabel(blocked.root, '重试导入该网络素材')
    assert.ok(retry)
    assert.equal(retry.props.disabled, true)
    assert.match(String(retry.props.title || ''), /许可|来源/)
    assert.equal(retry.props['aria-describedby'], 'media-network-import-retry-reason')
    const [blockedReason] = findAll(blocked.root, (node) => node.props.id === 'media-network-import-retry-reason')
    assert.match(textContent(blockedReason), /许可|来源/)
  } finally {
    blocked.app.unmount()
  }
})

test('只有失败反馈没有重试项时不渲染重试原因 id', async () => {
  const harness = mountFeedback({
    feedback: { tone: 'error', title: '网络素材导入失败', detail: '雨巷导入失败' },
    retryItem: null,
  })
  try {
    await nextTick()
    assert.match(textContent(harness.root), /网络素材导入失败/)
    assert.match(textContent(harness.root), /下一步：请切回“本地素材”后重试加载/)
    assert.equal(buttonByAriaLabel(harness.root, '重试导入该网络素材'), undefined)
    assert.equal(findAll(harness.root, (node) => node.props.id === 'media-network-import-retry-reason').length, 0)
    const local = buttonByAriaLabel(harness.root, '查看本地素材')
    assert.ok(local)
    assert.match(textContent(local), /查看本地素材/)
    click(local)
    assert.deepEqual(harness.events, [['show-local']])
  } finally {
    harness.app.unmount()
  }
})

test('导入未确认反馈给出查看本地素材的下一步', async () => {
  const harness = mountFeedback({
    feedback: { tone: 'error', title: '网络素材导入未确认', detail: '「雨巷」服务端已导入但列表未确认，请勿重复导入。请切回“本地素材”后重试加载。' },
    retryItem: null,
  })
  try {
    await nextTick()
    assert.match(textContent(harness.root), /网络素材导入未确认/)
    assert.match(textContent(harness.root), /下一步：请切回“本地素材”后重试加载/)
    const local = buttonByAriaLabel(harness.root, '查看本地素材')
    assert.ok(local)
    assert.equal(local.props['aria-label'], '查看本地素材')
    click(local)
    assert.deepEqual(harness.events, [['show-local']])
  } finally {
    harness.app.unmount()
  }
})
