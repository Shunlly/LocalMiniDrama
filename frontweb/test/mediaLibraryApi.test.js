import test from 'node:test'
import assert from 'node:assert/strict'

import {
  createMediaLibraryAPI,
  importNetworkAssetAndConfirm,
} from '../src/api/mediaLibrary.js'

function networkItem() {
  return {
    title: '夜雨',
    source_url: 'https://commons.wikimedia.org/wiki/File:Safe.webm',
    thumbnail_url: 'https://cdn.test/thumb.jpg',
    download_url: 'https://cdn.test/video.webm',
    license: 'CC BY-SA 4.0',
    license_url: 'https://creativecommons.org/licenses/by-sa/4.0/',
    media_type: 'video',
  }
}

test('网络素材写入后按返回资产 ID 读取确认，不依赖列表筛选和分页', async () => {
  const calls = []
  const client = {
    async post(path, payload, options) {
      calls.push(['post', path, payload, options])
      return { id: 81, drama_id: 12, type: 'video', url: '/static/library/uploads/81.webm' }
    },
    async get(path, options) {
      calls.push(['get', path, options])
      return { id: 81, drama_id: 12, type: 'video', url: '/static/library/uploads/81.webm' }
    },
  }
  const api = createMediaLibraryAPI(client)
  const result = await importNetworkAssetAndConfirm({
    api,
    item: networkItem(),
    dramaId: 12,
    reload: async () => {
      calls.push(['reload'])
      return { status: 'failed', data: [] }
    },
  })

  assert.equal(result.confirmed, true)
  assert.deepEqual(calls.map(([name]) => name), ['post', 'get', 'reload'])
  assert.deepEqual(calls[0][1], '/assets/network-import')
  assert.equal(calls[0][2].drama_id, 12)
  assert.deepEqual(calls[1][1], '/assets/81')
  assert.equal(calls[1][2].suppressErrorToast, true)
  assert.equal(Object.hasOwn(calls[1][2], 'params'), false)
})

test('确认到不同资产 ID 或不同项目范围时不报告导入成功', async () => {
  for (const confirmedAsset of [
    { id: 82, drama_id: 12, type: 'video', url: '/static/82.webm' },
    { id: 81, drama_id: 99, type: 'video', url: '/static/81.webm' },
  ]) {
    const client = {
      async post() {
        return { id: 81, drama_id: 12, type: 'video', url: '/static/81.webm' }
      },
      async get() {
        return confirmedAsset
      },
    }
    const result = await importNetworkAssetAndConfirm({
      api: createMediaLibraryAPI(client),
      item: networkItem(),
      dramaId: 12,
    })
    assert.equal(result.confirmed, false)
  }
})

test('导入响应缺少正整数 ID 时仍刷新列表但不会伪报成功', async () => {
  let reloadCalls = 0
  let getCalls = 0
  const client = {
    async post() {
      return { id: 0, type: 'image', url: '/static/invalid.png' }
    },
    async get() {
      getCalls += 1
      return { id: 0 }
    },
  }
  const result = await importNetworkAssetAndConfirm({
    api: createMediaLibraryAPI(client),
    item: { ...networkItem(), media_type: 'image' },
    reload: async () => {
      reloadCalls += 1
      return { status: 'applied' }
    },
  })

  assert.equal(result.confirmed, false)
  assert.equal(result.confirmationError.code, 'MEDIA_ASSET_CONFIRMATION_MISSING')
  assert.equal(getCalls, 0)
  assert.equal(reloadCalls, 1)
})

test('无效项目 ID 不会被静默降级为全局素材导入', async () => {
  let importCalls = 0
  const api = createMediaLibraryAPI({
    async post() {
      importCalls += 1
      return { id: 1 }
    },
    async get() {
      return { id: 1, drama_id: 0 }
    },
  })

  await assert.rejects(
    importNetworkAssetAndConfirm({ api, item: networkItem(), dramaId: 0 }),
    (error) => error?.code === 'MEDIA_DRAMA_ID_INVALID',
  )
  assert.equal(importCalls, 0)
})

test('网络搜索 API 透传 AbortSignal，视频结果保留缩略图和播放地址', async () => {
  const signal = { aborted: false }
  const calls = []
  const client = {
    async get(path, options) {
      calls.push([path, options])
      return {
        items: [{
          ...networkItem(),
          width: '640',
          height: '360',
        }],
      }
    },
  }
  const result = await createMediaLibraryAPI(client).searchNetwork(
    { keyword: '夜雨', type: 'video' },
    { signal },
  )

  assert.equal(calls[0][1].signal, signal)
  assert.equal(result.items[0].media_type, 'video')
  assert.equal(result.items[0].thumbnail_url, networkItem().thumbnail_url)
  assert.equal(result.items[0].download_url, networkItem().download_url)
  assert.equal(result.items[0].width, 640)
  assert.equal(result.items[0].height, 360)
})
