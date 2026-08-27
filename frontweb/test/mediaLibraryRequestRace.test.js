import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import * as mediaLibrary from '../src/utils/mediaLibrary.js'

const {
  createLatestMediaRequestGuard,
  getMediaLibraryDramaId,
  getNetworkAssetCardImageUrl,
  getNetworkAssetImportability,
  getNetworkAssetPreviewUrl,
  hasPendingMediaLibraryOperations,
  importNetworkAssetAndConfirm,
  mergeMediaLibraryNetworkRoute,
  normalizeMediaLibraryNetworkRoute,
  runMediaOperationOnce,
} = mediaLibrary
const mediaLibrarySource = readFileSync(new URL('../src/views/MediaLibrary.vue', import.meta.url), 'utf8')

test('an out-of-order successful response cannot replace the latest media results', () => {
  const guard = createLatestMediaRequestGuard()
  const olderRequest = guard.begin()
  const latestRequest = guard.begin()
  let items = []

  assert.equal(guard.commit(latestRequest, () => { items = ['latest'] }), true)
  assert.equal(guard.commit(olderRequest, () => { items = ['older'] }), false)
  assert.deepEqual(items, ['latest'])
})

test('an out-of-order failure cannot clear results or stop the latest loading state', () => {
  const guard = createLatestMediaRequestGuard()
  const olderRequest = guard.begin()
  const latestRequest = guard.begin()
  let items = ['existing']
  let loading = true

  assert.equal(guard.commit(olderRequest, () => { items = [] }), false)
  assert.equal(guard.commit(olderRequest, () => { loading = false }), false)
  assert.deepEqual(items, ['existing'])
  assert.equal(loading, true)

  assert.equal(guard.commit(latestRequest, () => { items = ['latest'] }), true)
  assert.equal(guard.commit(latestRequest, () => { loading = false }), true)
  assert.deepEqual(items, ['latest'])
  assert.equal(loading, false)
})

test('the latest request can commit an error state and finish loading', () => {
  const guard = createLatestMediaRequestGuard()
  const requestId = guard.begin()
  let items = ['stale']
  let loading = true

  assert.equal(guard.commit(requestId, () => { items = [] }), true)
  assert.equal(guard.commit(requestId, () => { loading = false }), true)
  assert.deepEqual(items, [])
  assert.equal(loading, false)
})

test('media selection is limited to ids visible in the latest results', () => {
  assert.equal(typeof mediaLibrary.getVisibleSelectedMediaIds, 'function')

  const selectedIds = new Set([11, 12, 13])
  const visibleItems = [{ id: 12 }, { id: 14 }]

  assert.deepEqual(
    mediaLibrary.getVisibleSelectedMediaIds(selectedIds, visibleItems),
    [12],
  )
  assert.deepEqual(
    mediaLibrary.getVisibleSelectedMediaIds(selectedIds, []),
    [],
  )
})

test('initial media read failures preserve pure navigation while upload keeps it locked', () => {
  assert.equal(typeof mediaLibrary.mediaLibraryAccessState, 'function')

  assert.deepEqual(mediaLibrary.mediaLibraryAccessState({
    loading: false,
    uploading: false,
    hasSuccessfulLoad: false,
    loadError: 'offline',
    itemCount: 0,
  }), {
    navigationLocked: false,
    showEntryStrip: true,
    writeLocked: true,
  })
  assert.deepEqual(mediaLibrary.mediaLibraryAccessState({
    loading: false,
    uploading: true,
    hasSuccessfulLoad: true,
    loadError: '',
    itemCount: 2,
  }), {
    navigationLocked: true,
    showEntryStrip: true,
    writeLocked: false,
  })
})

test('media entry navigation uses its own upload-only lock in the component', () => {
  assert.match(mediaLibrarySource, /v-if="mediaAccessState\.showEntryStrip"\s+class="entry-strip"/)
  assert.match(mediaLibrarySource, /<el-button[^>]*:disabled="mediaAccessState\.navigationLocked"[^>]*@click="goNewProject"[^>]*>[\s\S]*?新建项目/)
  assert.match(mediaLibrarySource, /class="entry-action"[\s\S]*:disabled="mediaAccessState\.navigationLocked"[\s\S]*aria-label="选择项目后导入网页 URL"/)
  assert.match(mediaLibrarySource, /function goNewProject\(\) \{\s*if \(mediaAccessState\.value\.navigationLocked\) return/)
  assert.match(mediaLibrarySource, /function goSourceImport\(\) \{\s*if \(mediaAccessState\.value\.navigationLocked\) return/)
})

test('successful reloads reconcile selection and batch deletion snapshots visible ids', () => {
  assert.match(
    mediaLibrarySource,
    /const visibleSelectedIds = getVisibleSelectedMediaIds\(selectedIds, nextItems\)[\s\S]*selectedIds\.clear\(\)[\s\S]*visibleSelectedIds\.forEach\(\(id\) => selectedIds\.add\(id\)\)/,
  )

  const batchDeleteStart = mediaLibrarySource.indexOf('async function batchDelete')
  const batchDeleteEnd = mediaLibrarySource.indexOf('\nonMounted', batchDeleteStart)
  const batchDeleteSource = mediaLibrarySource.slice(batchDeleteStart, batchDeleteEnd)
  assert.match(batchDeleteSource, /const idsToDelete = getVisibleSelectedMediaIds\(selectedIds, mediaItems\.value\)/)
  assert.match(batchDeleteSource, /for \(const id of idsToDelete\)/)
  assert.doesNotMatch(batchDeleteSource, /for \(const id of selectedIds\)/)
})

test('network imports derive project scope only from a sanitized film return path', () => {
  assert.equal(getMediaLibraryDramaId('/film/12?episode=4'), 12)
  assert.equal(getMediaLibraryDramaId('/film/15/canvas?focus=sb:2'), 15)
  assert.equal(getMediaLibraryDramaId('/drama/12'), null)
  assert.equal(getMediaLibraryDramaId('https://evil.test/film/12'), null)
  assert.equal(getMediaLibraryDramaId('/film/0'), null)
})

test('网络导入按资产 ID 确认持久化，列表筛选和分页不影响成功语义', async () => {
  const events = []
  const confirmed = await importNetworkAssetAndConfirm({
    item: {
      source_url: 'https://commons.wikimedia.org/wiki/File:Safe.png',
      license: 'CC BY-SA 4.0',
      license_url: 'https://creativecommons.org/licenses/by-sa/4.0/',
    },
    dramaId: 12,
    importAsset: async (payload) => {
      events.push(['import', payload])
      return { id: 81 }
    },
    confirmAsset: async (id) => {
      events.push(['confirm', id])
      return { id }
    },
    reload: async () => {
      events.push(['reload'])
      return { status: 'applied', data: [] }
    },
  })
  assert.equal(confirmed.confirmed, true)
  assert.equal(events[0][1].drama_id, 12)
  assert.deepEqual(events.map(([event]) => event), ['import', 'confirm', 'reload'])

  const unconfirmed = await importNetworkAssetAndConfirm({
    item: {
      source_url: 'https://commons.wikimedia.org/wiki/File:Safe.png',
      license: 'CC BY-SA 4.0',
      license_url: 'https://creativecommons.org/licenses/by-sa/4.0/',
    },
    dramaId: null,
    importAsset: async (payload) => {
      assert.equal(Object.hasOwn(payload, 'drama_id'), false)
      return { id: 82 }
    },
    confirmAsset: async () => { throw new Error('读取失败') },
    reload: async () => ({ status: 'failed' }),
  })
  assert.equal(unconfirmed.confirmed, false)
  assert.equal(unconfirmed.asset.id, 82)

  const filteredOut = await importNetworkAssetAndConfirm({
    item: {
      source_url: 'https://commons.wikimedia.org/wiki/File:Safe.png',
      license: 'CC BY-SA 4.0',
      license_url: 'https://creativecommons.org/licenses/by-sa/4.0/',
    },
    importAsset: async () => ({ id: 83 }),
    confirmAsset: async () => ({ id: 83 }),
    reload: async () => ({ status: 'applied', data: [{ id: 12 }] }),
  })
  assert.equal(filteredOut.confirmed, true)
})

test('网络视频卡片使用缩略图，弹窗只使用可播放下载地址', async () => {
  const video = {
    media_type: 'video',
    thumbnail_url: 'https://cdn.test/thumb.jpg',
    download_url: 'https://cdn.test/video.webm',
  }
  assert.equal(getNetworkAssetCardImageUrl(video), video.thumbnail_url)
  assert.equal(getNetworkAssetPreviewUrl(video), video.download_url)
  assert.equal(getNetworkAssetPreviewUrl({ media_type: 'video', thumbnail_url: video.thumbnail_url }), '')
  assert.equal(getNetworkAssetPreviewUrl({
    media_type: 'image',
    thumbnail_url: video.thumbnail_url,
    download_url: 'https://cdn.test/image.png',
  }), 'https://cdn.test/image.png')

  const start = mediaLibrarySource.indexOf('function networkCardImageUrl')
  const end = mediaLibrarySource.indexOf('\nfunction networkPlaybackUrl', start)
  assert.ok(start >= 0 && end > start)
  const harness = await import(`data:text/javascript;charset=utf-8,${encodeURIComponent(`
    const getNetworkAssetCardImageUrl = (item) => String(item?.thumbnail_url || item?.download_url || '').trim()
    ${mediaLibrarySource.slice(start, end)}
    export function run(item) { return networkCardImageUrl(item) }
  `)}`)
  assert.equal(harness.run(video), video.thumbnail_url)
  assert.equal(harness.run({ media_type: 'video', download_url: video.download_url }), '')
  assert.equal(harness.run({ media_type: 'image', download_url: 'https://cdn.test/image.png' }), 'https://cdn.test/image.png')

  assert.match(
    mediaLibrarySource,
    /<img[\s\S]*?v-if="networkCardImageUrl\(item\)"[\s\S]*?:src="networkCardImageUrl\(item\)"/,
  )
  assert.match(
    mediaLibrarySource,
    /function networkCardImageUrl\(item\) \{[\s\S]*?item\?\.media_type === 'video'[\s\S]*?item\?\.thumbnail_url[\s\S]*?getNetworkAssetCardImageUrl\(item\)/,
  )
  assert.match(mediaLibrarySource, /v-if="networkCardImageUrl\(item\)"/)
  assert.match(mediaLibrarySource, /class="network-thumb-placeholder"/)
  assert.match(mediaLibrarySource, /v-if="networkPreviewItem\?\.media_type === 'video'"[\s\S]*?:src="networkPlaybackUrl\(networkPreviewItem\)"/)
})

test('切换网络素材类型会立即失效旧请求、清空结果并按当前关键词重搜', () => {
  assert.match(mediaLibrarySource, /@change="handleNetworkTypeChange"/)
  assert.match(
    mediaLibrarySource,
    /function handleNetworkTypeChange\(\) \{[\s\S]*?invalidateNetworkSearch\(\)[\s\S]*?if \(networkKeyword\.value\.trim\(\)\) searchNetworkMedia\(\)/,
  )
})

test('网络素材缺少可审计许可时失败关闭，不会调用导入 API', async () => {
  assert.deepEqual(getNetworkAssetImportability({
    source_url: 'https://commons.wikimedia.org/wiki/File:Unknown.png',
  }), { allowed: false, reason: '许可信息未知，禁止导入' })
  assert.equal(getNetworkAssetImportability({
    source_url: 'https://commons.wikimedia.org/wiki/File:Unknown.png',
    license: 'CC BY 4.0',
  }).allowed, false)
  assert.equal(getNetworkAssetImportability({
    source_url: 'http://commons.wikimedia.org/wiki/File:Unsafe.png',
    license: 'CC BY 4.0',
    license_url: 'https://creativecommons.org/licenses/by/4.0/',
  }).allowed, false)

  let importCalls = 0
  await assert.rejects(
    importNetworkAssetAndConfirm({
      item: { source_url: 'https://commons.wikimedia.org/wiki/File:Unknown.png' },
      importAsset: async () => { importCalls += 1 },
      confirmAsset: async () => ({}),
      reload: async () => ({ status: 'applied' }),
    }),
    (error) => error?.code === 'NETWORK_ASSET_NOT_AUDITABLE',
  )
  assert.equal(importCalls, 0)
})

test('网络搜索页签、关键词和类型可安全写入并恢复 URL', () => {
  const query = mergeMediaLibraryNetworkRoute(
    { returnTo: '/film/12', untouched: 'yes' },
    { mode: 'network', keyword: '  雨夜  ', type: 'image' },
  )
  assert.deepEqual(query, {
    returnTo: '/film/12',
    untouched: 'yes',
    source: 'network',
    network_q: '雨夜',
    network_type: 'image',
  })
  assert.deepEqual(normalizeMediaLibraryNetworkRoute(query), {
    mode: 'network',
    keyword: '雨夜',
    type: 'image',
  })
  assert.deepEqual(normalizeMediaLibraryNetworkRoute({
    source: 'invalid',
    network_q: 'bad\u0000query',
    network_type: 'audio',
  }), { mode: 'local', keyword: '', type: 'all' })
})

test('上传或网络导入未完成时都阻止离开', () => {
  assert.equal(hasPendingMediaLibraryOperations(false, new Set()), false)
  assert.equal(hasPendingMediaLibraryOperations(true, new Set()), true)
  assert.equal(hasPendingMediaLibraryOperations(false, new Set(['commons:1'])), true)
  assert.match(mediaLibrarySource, /hasPendingMediaLibraryOperations\(uploading\.value, networkImportingKeys\)/)
  assert.match(mediaLibrarySource, /网络素材正在导入/)
})

test('network source uses the canonical type parameter and prevents duplicate import clicks', () => {
  assert.match(mediaLibrarySource, /params.type = networkMediaType.value/)
  assert.doesNotMatch(mediaLibrarySource, /params.media_type = networkMediaType.value/)
  assert.match(mediaLibrarySource, /api: mediaLibraryAPI/)
  assert.match(mediaLibrarySource, /服务端已导入但列表未确认，请勿重复导入/)
})

test('网络搜索切换会中止旧请求并让旧请求的所有回调失效', () => {
  assert.match(mediaLibrarySource, /networkAbortController\?\.abort\(\)/)
  assert.match(mediaLibrarySource, /signal: abortController\.signal/)
  assert.match(mediaLibrarySource, /function invalidateNetworkSearch\(\) \{[\s\S]*?networkRequestGuard\.begin\(\)[\s\S]*?networkItems\.value = \[\]/)
})

test('network import guard admits only one concurrent operation per source key', async () => {
  const activeKeys = new Set()
  let release
  const pending = new Promise((resolve) => { release = resolve })
  let calls = 0
  const first = runMediaOperationOnce(activeKeys, 'commons:1', async () => {
    calls += 1
    await pending
    return 'done'
  })
  const duplicate = await runMediaOperationOnce(activeKeys, 'commons:1', async () => {
    calls += 1
  })
  assert.deepEqual(duplicate, { started: false })
  assert.equal(calls, 1)
  release()
  assert.deepEqual(await first, { started: true, value: 'done' })
  assert.equal(activeKeys.size, 0)
})
