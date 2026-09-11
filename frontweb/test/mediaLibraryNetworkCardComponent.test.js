import test from 'node:test'
import assert from 'node:assert/strict'

import { h, nextTick } from 'vue'

import {
  compileIconStub,
  createHostRenderer,
  loadCompiledSfc,
  mountHarness,
  textContent,
  vueUrl,
} from './helpers/vueComponentHarness.js'
import {
  networkItemImportability,
  networkItemSourceLabel,
  networkItemTitle,
  networkCardImageUrl,
  networkDimensions,
  safeExternalUrl,
} from '../src/components/mediaLibrary/mediaLibraryFormatters.js'

const cardUrl = new URL('../src/components/mediaLibrary/MediaLibraryNetworkCard.vue', import.meta.url)
const iconStubUrl = compileIconStub(['Files', 'ZoomIn'])
const MediaLibraryNetworkCard = await loadCompiledSfc(
  cardUrl,
  'media-library-network-card-component',
  new Map([
    ['vue', vueUrl],
    ['@element-plus/icons-vue', iconStubUrl],
  ]),
)

const renderer = createHostRenderer()

function mountCard(item) {
  const mounted = mountHarness(renderer, () => h(MediaLibraryNetworkCard, {
    item,
    index: 0,
    networkImportButtonText: '\u5bfc\u5165\u5230\u7d20\u6750\u4e2d\u5fc3',
    networkItemTitle,
    networkCardImageUrl,
    openNetworkPreview: () => {},
    networkDimensions,
    networkItemSourceLabel,
    networkItemImportability,
    safeExternalUrl,
    isNetworkImporting: () => false,
    importNetworkItem: () => {},
  }))
  return mounted
}

test('\u7f51\u7edc\u641c\u7d22\u7ed3\u679c\u4ecd\u5c55\u793a\u8bb8\u53ef\u4e0e\u4f5c\u8005', async () => {
  const harness = mountCard({
    title: '\u96e8\u5df7',
    author: 'Bai Juyi',
    license: 'CC BY-SA 4.0',
    license_url: 'https://creativecommons.org/licenses/by-sa/4.0/',
    source_url: 'https://commons.wikimedia.org/wiki/File:rain.jpg',
    source: 'commons',
    width: 800,
    height: 600,
    thumbnail_url: 'https://example.com/rain.jpg',
  })
  try {
    await nextTick()
    const copy = textContent(harness.root)
    assert.match(copy, /Bai Juyi/)
    assert.match(copy, /\u8bb8\u53ef\uff1aCC BY-SA 4.0/)
    assert.match(copy, /\u67e5\u770b\u8bb8\u53ef/)
    assert.match(copy, /\u67e5\u770b\u6765\u6e90/)
  } finally {
    harness.app.unmount()
  }
})

test('\u7f3a\u5c11\u8bb8\u53ef\u65f6\u663e\u793a\u4e2d\u6587\u539f\u56e0\u5e76\u7981\u6b62\u5bfc\u5165', async () => {
  const harness = mountCard({
    title: '\u6708\u5149',
    author: '',
    license: '',
    source: 'openverse',
  })
  try {
    await nextTick()
    const copy = textContent(harness.root)
    assert.match(copy, /\u4f5c\u8005\u672a\u77e5/)
    assert.match(copy, /\u672a\u6ce8\u660e\u8bb8\u53ef/)
    assert.match(copy, /\u8bb8\u53ef\u4fe1\u606f\u672a\u77e5\uff0c\u7981\u6b62\u5bfc\u5165/)
    assert.doesNotMatch(copy, /unlicensed|unknown author|No license/i)
  } finally {
    harness.app.unmount()
  }
})
