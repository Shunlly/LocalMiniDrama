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
    clearNetworkSearch: () => events.push(['clear']),
  }))
  return { ...mounted, events }
}

test('\u672a\u641c\u7d22\u7a7a\u6001\u8bf4\u660e\u4f1a\u9644\u5e26\u6765\u6e90\u548c\u8bb8\u53ef\u4fe1\u606f', async () => {
  const harness = mountEmpty()
  try {
    await nextTick()
    const copy = textContent(harness.root)
    assert.match(copy, /\u641c\u7d22\u53ef\u5bfc\u5165\u7684\u7f51\u7edc\u7d20\u6750/)
    assert.match(copy, /\u8bb8\u53ef/)
    assert.doesNotMatch(copy, /No data|Search results|Network Error/i)
  } finally {
    harness.app.unmount()
  }
})

test('\u6ca1\u6709\u7ed3\u679c\u65f6\u6e05\u9664\u641c\u7d22\u662f\u4e2d\u6587\uff0c\u4e0d\u6f0f\u82f1\u6587', async () => {
  const harness = mountEmpty({ networkSearched: true, networkItems: [] })
  try {
    await nextTick()
    const copy = textContent(harness.root)
    assert.match(copy, /\u6ca1\u6709\u627e\u5230\u5339\u914d\u7684\u7f51\u7edc\u7d20\u6750/)
    assert.doesNotMatch(copy, /No results|Clear search|canceled|AbortError/i)
    click(buttonByAriaLabel(harness.root, '\u6e05\u9664\u7f51\u7edc\u7d20\u6750\u641c\u7d22'))
    assert.deepEqual(harness.events, [['clear']])
  } finally {
    harness.app.unmount()
  }
})
