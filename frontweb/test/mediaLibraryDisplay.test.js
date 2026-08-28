import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  formatMediaSize,
  getMediaItemFileSize,
  normalizeMediaItem,
  buildMediaLibraryNetworkImportFeedback,
} from '../src/utils/mediaLibrary.js'
import { createMediaLibraryAPI } from '../src/api/mediaLibrary.js'

const mediaLibrarySource = readFileSync(new URL('../src/views/MediaLibrary.vue', import.meta.url), 'utf8')

test('素材卡片大小优先读取后端 file_size，兼容仅有 size 的旧载荷', () => {
  const fromBackend = normalizeMediaItem({
    id: 9,
    url: '/static/library/a.png',
    file_size: 2048,
  })
  assert.equal(fromBackend.file_size, 2048)
  assert.equal(fromBackend.size, undefined)
  assert.equal(getMediaItemFileSize(fromBackend), 2048)
  assert.equal(formatMediaSize(getMediaItemFileSize(fromBackend)), '2 KB')
  assert.equal(formatMediaSize(fromBackend.size), '')

  const fromLegacySize = normalizeMediaItem({
    id: 10,
    url: '/static/library/b.png',
    size: 4096,
  })
  assert.equal(fromLegacySize.file_size, 4096)
  assert.equal(getMediaItemFileSize(fromLegacySize), 4096)
  assert.equal(getMediaItemFileSize({ file_size: 0, size: 99 }), 0)
  assert.equal(getMediaItemFileSize({ file_size: 'nope', size: 1024 }), 1024)
  assert.equal(getMediaItemFileSize({}), null)
})

test('素材列表 API 正规化后保留 file_size，不会改写成 size', async () => {
  const api = createMediaLibraryAPI({
    async get() {
      return { items: [{ id: 1, url: '/static/a.png', file_size: 2048, type: 'image' }] }
    },
  })
  const result = await api.list()
  assert.equal(result.items[0].file_size, 2048)
  assert.equal(result.items[0].size, undefined)
  assert.equal(formatMediaSize(getMediaItemFileSize(result.items[0])), '2 KB')
})

test('MediaLibrary 列表卡片和预览用 file_size 辅助函数而不是 item.size', () => {
  assert.match(mediaLibrarySource, /getMediaItemFileSize as mediaItemFileSize/)
  assert.match(mediaLibrarySource, /class="media-meta">\{\{ formatSize\(mediaItemFileSize\(item\)\) \}\}<\/span>/)
  assert.match(mediaLibrarySource, /大小：<\/span>\{\{ formatSize\(mediaItemFileSize\(previewItem\)\) \}\}<\/div>/)
  assert.doesNotMatch(mediaLibrarySource, /formatSize\(item\.size\)/)
  assert.doesNotMatch(mediaLibrarySource, /formatSize\(previewItem\?\.size\)/)
})

test('网络导入失败反馈区分写入失败和列表未确认', () => {
  const failed = buildMediaLibraryNetworkImportFeedback({
    status: 'failed',
    item: { title: '夜雨' },
    detail: '网络素材服务暂时不可用（HTTP 503）',
  })
  assert.equal(failed.tone, 'error')
  assert.equal(failed.title, '网络素材导入失败')
  assert.match(failed.detail, /夜雨/)
  assert.match(failed.detail, /未能写入素材库/)
  assert.match(failed.detail, /HTTP 503/)

  const unconfirmed = buildMediaLibraryNetworkImportFeedback({
    status: 'unconfirmed',
    item: { title: '夜雨' },
  })
  assert.equal(unconfirmed.tone, 'error')
  assert.equal(unconfirmed.title, '网络素材导入未确认')
  assert.match(unconfirmed.detail, /请勿重复导入/)
  assert.match(unconfirmed.detail, /本地素材/)
})

test('MediaLibrary 网络导入失败会留下常驻页内反馈', () => {
  assert.match(mediaLibrarySource, /buildMediaLibraryNetworkImportFeedback/)
  assert.match(mediaLibrarySource, /v-if="networkImportFeedback"/)
  assert.match(mediaLibrarySource, /networkImportFeedback\.tone === 'error' \? 'alert' : 'status'/)
  assert.match(mediaLibrarySource, /networkImportFeedback\.value = buildMediaLibraryNetworkImportFeedback\(\{/)
  assert.match(mediaLibrarySource, /status: 'unconfirmed'/)
  assert.match(mediaLibrarySource, /status: 'failed'/)
})
