import test from 'node:test'
import assert from 'node:assert/strict'

import { h, nextTick } from 'vue'

import {
  buttonByAriaLabel,
  compileIconStub,
  createHostRenderer,
  findAll,
  loadCompiledSfc,
  mountHarness,
  textContent,
  vueUrl,
} from './helpers/vueComponentHarness.js'
import { MEDIA_LIBRARY_DISABLE_REASON } from '../src/utils/mediaLibraryUserError.js'
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

function mountCard(item, options = {}) {
  const mounted = mountHarness(renderer, () => h(MediaLibraryNetworkCard, {
    item,
    index: options.index ?? 0,
    networkImportButtonText: '\u5bfc\u5165\u5230\u7d20\u6750\u4e2d\u5fc3',
    networkItemTitle,
    networkCardImageUrl,
    openNetworkPreview: () => {},
    networkDimensions,
    networkItemSourceLabel,
    networkItemImportability,
    safeExternalUrl,
    isNetworkImporting: options.isNetworkImporting || (() => false),
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
    assert.match(copy, /\u7f3a\u5c11\u53ef\u5ba1\u8ba1\u7684 HTTPS \u6765\u6e90\u94fe\u63a5|\u8bb8\u53ef\u4fe1\u606f\u672a\u77e5/)
    assert.doesNotMatch(copy, /unlicensed|unknown author|No license/i)
  } finally {
    harness.app.unmount()
  }
})

test('缺少许可时导入按钮 aria-describedby 指向当前卡片原因，不会写成 0 号卡片', async () => {
  const CARD_INDEX = 3
  assert.notEqual(CARD_INDEX, 0)
  const harness = mountCard({
    title: '月光',
    author: '',
    license: '',
    source: 'openverse',
  }, { index: CARD_INDEX })
  try {
    await nextTick()
    const imported = buttonByAriaLabel(harness.root, '导入到素材中心：月光')
    assert.ok(imported)
    assert.equal(imported.props.disabled, true)
    assert.equal(imported.props['aria-describedby'], `network-import-reason-${CARD_INDEX}`)
    const [reason] = findAll(harness.root, (node) => node.props.id === `network-import-reason-${CARD_INDEX}`)
    assert.ok(reason)
    assert.match(textContent(reason), /许可|来源/)
    assert.equal(findAll(harness.root, (node) => node.props.id === 'network-import-reason-0').length, 0)
  } finally {
    harness.app.unmount()
  }
})

test('导入中把中文原因挂到同一 id，可导入时不挂 describedby', async () => {
  const item = {
    title: '雨巷',
    author: 'Bai Juyi',
    license: 'CC BY-SA 4.0',
    license_url: 'https://creativecommons.org/licenses/by-sa/4.0/',
    source_url: 'https://commons.wikimedia.org/wiki/File:rain.jpg',
    source: 'commons',
  }
  const ready = mountCard(item)
  try {
    await nextTick()
    const imported = buttonByAriaLabel(ready.root, '导入到素材中心：雨巷')
    assert.ok(imported)
    assert.notEqual(imported.props.disabled, true)
    assert.equal(imported.props['aria-describedby'], undefined)
  } finally {
    ready.app.unmount()
  }

  const busy = mountCard(item, { index: 2, isNetworkImporting: () => true })
  try {
    await nextTick()
    const imported = buttonByAriaLabel(busy.root, '导入到素材中心：雨巷')
    assert.ok(imported)
    assert.equal(imported.props.disabled, true)
    assert.equal(imported.props['aria-describedby'], 'network-import-reason-2')
    const [reason] = findAll(busy.root, (node) => node.props.id === 'network-import-reason-2')
    assert.equal(textContent(reason).trim(), MEDIA_LIBRARY_DISABLE_REASON.importing)
  } finally {
    busy.app.unmount()
  }
})
