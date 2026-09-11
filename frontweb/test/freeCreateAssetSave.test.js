import test from 'node:test'
import assert from 'node:assert/strict'
import { effectScope, nextTick } from 'vue'

import {
  applyGeneratedMediaToItem,
  buildFreeCreateAssetPayload,
  describeAssetScopeMismatch,
  extractFreeCreateLocalPath,
  FREE_CREATE_ASSET_KEYWORD,
  FREE_CREATE_RESULT_STORAGE_KEY,
  getFreeCreateSaveAriaLabel,
  getFreeCreateSaveDisabledReason,
  mergeFreeCreateResults,
  positiveFreeCreateId,
  readFreeCreateHistory,
  resolveFreeCreateAssetDramaId,
  restoreFreeCreateResults,
  resultFromAsset,
  saveFreeCreateResultToAssets,
  serializeFreeCreateHistory,
  writeFreeCreateHistory,
} from '../src/components/freeCreate/freeCreateAssetSave.js'
import { useFreeCreateWorkspace } from '../src/composables/useFreeCreateWorkspace.js'
import { ensureWindowShim } from './helpers/vueRouterHarness.js'

ensureWindowShim()
if (!globalThis.document) {
  const element = () => ({
    style: {},
    classList: { add() {}, remove() {} },
    setAttribute() {},
    appendChild() {},
    removeChild() {},
    addEventListener() {},
    removeEventListener() {},
  })
  globalThis.document = {
    body: element(),
    documentElement: element(),
    createElement: () => element(),
    createElementNS: () => element(),
    querySelector: () => null,
    getElementById: () => null,
    addEventListener() {},
    removeEventListener() {},
  }
}

function createMemoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial))
  return {
    getItem(key) {
      return data.has(key) ? data.get(key) : null
    },
    setItem(key, value) {
      data.set(key, String(value))
    },
    raw: data,
  }
}

test('本地路径从静态地址解析，不把素材编号当成项目编号', () => {
  assert.equal(extractFreeCreateLocalPath('/static/library/images/a.png'), 'library/images/a.png')
  assert.equal(extractFreeCreateLocalPath('https://cdn.example/static/library/images/a.png'), 'library/images/a.png')
  assert.equal(positiveFreeCreateId(99), 99)
  assert.equal(positiveFreeCreateId('12'), 12)
  assert.notEqual(positiveFreeCreateId(99), positiveFreeCreateId(12))
  assert.equal(
    describeAssetScopeMismatch({ id: 99, drama_id: 12 }, 12),
    '',
  )
  assert.equal(
    describeAssetScopeMismatch({ id: 12, drama_id: 99 }, 12),
    '素材保存失败：返回结果不属于当前项目',
  )
  assert.equal(
    describeAssetScopeMismatch({ id: 99, drama_id: 12 }, null),
    '素材保存失败：返回结果不属于全局素材库',
  )
})

test('当前项目只认 drama_id 或影片 returnTo，不把素材 id 当项目 id', () => {
  assert.equal(resolveFreeCreateAssetDramaId({ query: { drama_id: '12' } }), 12)
  assert.equal(resolveFreeCreateAssetDramaId({ query: { returnTo: '/film/12/canvas' } }), 12)
  assert.equal(resolveFreeCreateAssetDramaId({ query: { returnTo: '/drama/12' } }), 12)
  assert.equal(resolveFreeCreateAssetDramaId({ query: { drama_id: '99', returnTo: '/film/12' } }), 99)
  assert.equal(resolveFreeCreateAssetDramaId({ query: { asset_id: '12', id: '12' } }), null)
  assert.equal(resolveFreeCreateAssetDramaId({ query: {} }), null)
})

test('保存载荷写入全局或当前项目，并带上本地文件路径', () => {
  const globalPayload = buildFreeCreateAssetPayload({
    type: 'image',
    prompt: '海边灯塔',
    url: '/static/library/images/lighthouse.png',
    localPath: 'library/images/lighthouse.png',
    imageGenId: 8,
  }, null)
  assert.equal(Object.prototype.hasOwnProperty.call(globalPayload, 'drama_id'), false)
  assert.equal(globalPayload.local_path, 'library/images/lighthouse.png')
  assert.equal(globalPayload.type, 'image')
  assert.match(globalPayload.name, /自由创作：海边灯塔/)
  assert.equal(globalPayload.image_gen_id, 8)

  const projectPayload = buildFreeCreateAssetPayload({
    type: 'video',
    prompt: '夜雨',
    url: '/static/projects/0012_20240101_demo/videos/rain.mp4',
    videoGenId: 5,
  }, 12)
  assert.equal(projectPayload.drama_id, 12)
  assert.notEqual(projectPayload.drama_id, 5)
  assert.equal(projectPayload.video_gen_id, 5)
  assert.equal(projectPayload.type, 'video')
})

test('没有本地文件时不能保存，并给出中文原因', () => {
  const item = { type: 'image', url: 'https://cdn.example/remote.png', prompt: '云' }
  assert.equal(getFreeCreateSaveDisabledReason(item), '该结果还没有可保存的本地文件')
  assert.match(getFreeCreateSaveAriaLabel(item), /保存到素材中心不可用：该结果还没有可保存的本地文件/)
  assert.throws(
    () => buildFreeCreateAssetPayload(item, null),
    /该结果还没有可保存的本地文件/,
  )
})

test('保存成功后会按素材编号从列表确认，且项目编号不能与素材编号互换', async () => {
  const created = {
    id: 99,
    drama_id: 12,
    name: '自由创作：灯塔',
    type: 'image',
    url: '/static/library/images/a.png',
    local_path: 'library/images/a.png',
  }
  const calls = []
  const assetsApi = {
    async create(payload) {
      calls.push(['create', payload])
      assert.equal(payload.drama_id, 12)
      assert.notEqual(payload.drama_id, 99)
      return created
    },
    async get(id) {
      calls.push(['get', id])
      assert.equal(id, 99)
      assert.notEqual(id, 12)
      return created
    },
    async list(params) {
      calls.push(['list', params])
      assert.equal(params.keyword, FREE_CREATE_ASSET_KEYWORD)
      assert.equal(params.drama_id, 12)
      return { items: [created] }
    },
  }
  const saved = await saveFreeCreateResultToAssets({
    type: 'image',
    prompt: '灯塔',
    url: '/static/library/images/a.png',
    localPath: 'library/images/a.png',
  }, { assetsApi, dramaId: 12 })
  assert.equal(saved.id, 99)
  assert.equal(saved.drama_id, 12)
  assert.notEqual(saved.id, saved.drama_id)
  assert.deepEqual(calls.map((item) => item[0]), ['create', 'get', 'list'])
})

test('刷新后能从素材列表和任务结果恢复，不依赖内存里的 url', async () => {
  const storage = createMemoryStorage()
  writeFreeCreateHistory(storage, [{
    type: 'image',
    prompt: '灯塔',
    status: 'completed',
    taskId: 'task-image-1',
    imageGenId: 8,
  }, {
    type: 'video',
    prompt: '夜雨',
    status: 'completed',
    taskId: 'task-video-1',
    videoGenId: 5,
  }])

  const restored = await restoreFreeCreateResults({
    storage,
    dramaId: null,
    assetsApi: {
      async get(id) {
        assert.equal(id, 42)
        return {
          id: 42,
          drama_id: null,
          name: '自由创作：灯塔',
          type: 'image',
          url: '/static/library/images/a.png',
          local_path: 'library/images/a.png',
        }
      },
      async list() {
        return {
          items: [{
            id: 42,
            name: '自由创作：灯塔',
            type: 'image',
            url: '/static/library/images/a.png',
            local_path: 'library/images/a.png',
          }],
        }
      },
    },
    imagesApi: {
      async list() {
        return {
          items: [{
            id: 8,
            prompt: '灯塔',
            status: 'completed',
            task_id: 'task-image-1',
            image_url: '/static/library/images/a.png',
            local_path: 'library/images/a.png',
          }],
        }
      },
    },
    videosApi: {
      async get(id) {
        assert.equal(id, 5)
        return {
          id: 5,
          prompt: '夜雨',
          status: 'completed',
          task_id: 'task-video-1',
          local_path: 'library/videos/rain.mp4',
          video_url: '/static/library/videos/rain.mp4',
        }
      },
    },
    taskApi: {
      async get(taskId) {
        if (taskId === 'task-image-1') {
          return {
            id: 'task-image-1',
            status: 'completed',
            result: { image_generation_id: 8, image_url: '/static/library/images/a.png' },
          }
        }
        return {
          id: 'task-video-1',
          status: 'completed',
          result: { video_generation_id: 5, local_path: 'library/videos/rain.mp4' },
        }
      },
    },
  })

  assert.equal(restored.length >= 2, true)
  const image = restored.find((item) => item.type === 'image')
  const video = restored.find((item) => item.type === 'video')
  assert.equal(image.assetId, 42)
  assert.equal(image.url, '/static/library/images/a.png')
  assert.equal(video.videoGenId, 5)
  assert.equal(video.url, '/static/library/videos/rain.mp4')
})

test('历史索引只保存可找回的编号，不把生成结果只留在内存', () => {
  const serialized = serializeFreeCreateHistory([{
    type: 'image',
    prompt: '灯塔',
    status: 'completed',
    url: '/static/library/images/a.png',
    localPath: 'library/images/a.png',
    taskId: 'task-1',
    imageGenId: 8,
    assetId: 42,
    assetDramaId: 12,
  }])
  assert.equal(serialized[0].assetId, 42)
  assert.equal(serialized[0].imageGenId, 8)
  assert.equal(serialized[0].taskId, 'task-1')
  assert.notEqual(serialized[0].assetId, serialized[0].assetDramaId)
})

test('工作区保存到全局素材后，刷新能从素材列表找回', async () => {
  const storage = createMemoryStorage()
  const created = {
    id: 77,
    name: '自由创作：港口',
    type: 'image',
    url: '/static/library/images/port.png',
    local_path: 'library/images/port.png',
  }
  const assetsApi = {
    async create(payload) {
      assert.equal(Object.prototype.hasOwnProperty.call(payload, 'drama_id'), false)
      return created
    },
    async get(id) {
      assert.equal(id, 77)
      return created
    },
    async list() {
      return { items: [created] }
    },
  }
  const scope = effectScope()
  const workspace = scope.run(() => useFreeCreateWorkspace({
    router: { push() {}, resolve: () => ({ fullPath: '/free-create' }) },
    route: { query: {} },
    assetsApi,
    imagesApi: { async list() { return { items: [] } }, async create() { return {} } },
    videosApi: { async list() { return { items: [] } }, async get() { return {} }, async create() { return {} } },
    taskApi: { async get() { return {} }, async cancel() { return {} } },
    uploadApi: { async uploadImage() { return {} } },
    aiApi: { async list() { return [] } },
    generationSettingsApi: { async get() { return {} } },
    storage,
  }))
  try {
    workspace.results.value = [{
      type: 'image',
      prompt: '港口',
      status: 'completed',
      url: '/static/library/images/port.png',
      localPath: 'library/images/port.png',
      taskId: 'task-port',
      savingAsset: false,
      assetSaveError: '',
    }]
    await nextTick()
    const saved = await workspace.saveItemToAssets(workspace.results.value[0])
    assert.equal(saved, true)
    assert.equal(workspace.results.value[0].assetId, 77)
    const persisted = JSON.parse(storage.getItem(FREE_CREATE_RESULT_STORAGE_KEY))
    assert.equal(persisted[0].assetId, 77)

    const reloadScope = effectScope()
    const reloaded = reloadScope.run(() => useFreeCreateWorkspace({
      router: { push() {}, resolve: () => ({ fullPath: '/free-create' }) },
      route: { query: {} },
      assetsApi,
      imagesApi: { async list() { return { items: [] } }, async create() { return {} } },
      videosApi: { async list() { return { items: [] } }, async get() { return {} }, async create() { return {} } },
      taskApi: { async get() { return {} }, async cancel() { return {} } },
      uploadApi: { async uploadImage() { return {} } },
      aiApi: { async list() { return [] } },
      generationSettingsApi: { async get() { return {} } },
      storage: createMemoryStorage(),
    }))
    try {
      await reloaded.mount()
      assert.equal(reloaded.results.value.some((item) => item.assetId === 77), true)
      assert.equal(reloaded.results.value[0].url, '/static/library/images/port.png')
    } finally {
      reloadScope.stop()
    }
  } finally {
    scope.stop()
  }
})

test('合并结果时素材编号和项目编号保持独立', () => {
  const merged = mergeFreeCreateResults([{
    type: 'image',
    prompt: '灯塔',
    status: 'completed',
    url: '/static/library/images/a.png',
    localPath: 'library/images/a.png',
    imageGenId: 8,
    assetId: 42,
    assetDramaId: 12,
    updatedAt: '2026-01-02T00:00:00.000Z',
  }, {
    type: 'image',
    prompt: '灯塔',
    status: 'completed',
    url: '/static/library/images/a.png',
    localPath: 'library/images/a.png',
    imageGenId: 8,
    updatedAt: '2026-01-01T00:00:00.000Z',
  }])
  assert.equal(merged.length, 1)
  assert.equal(merged[0].assetId, 42)
  assert.equal(merged[0].assetDramaId, 12)
  assert.notEqual(merged[0].assetId, merged[0].assetDramaId)
})

test('生成完成会把本地路径写回结果项', () => {
  const item = { type: 'image', url: null }
  applyGeneratedMediaToItem(item, {
    url: '/static/library/images/a.png',
    localPath: 'library/images/a.png',
    imageGenId: 8,
    taskId: 'task-1',
  })
  assert.equal(item.localPath, 'library/images/a.png')
  assert.equal(item.imageGenId, 8)
  assert.equal(item.taskId, 'task-1')
})
