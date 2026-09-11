import test from 'node:test'
import assert from 'node:assert/strict'

import { h, nextTick } from 'vue'

import {
  buttonByAriaLabel,
  click,
  compileIconStub,
  createHostRenderer,
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
    const retry = buttonByAriaLabel(failed.root, '重试导入该网络素材')
    assert.ok(retry)
    assert.notEqual(retry.props.disabled, true)
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
  } finally {
    blocked.app.unmount()
  }
})
