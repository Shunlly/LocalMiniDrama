import test from 'node:test'
import assert from 'node:assert/strict'
import * as freeCanvasMedia from '../src/utils/freeCanvasMedia.js'

import {
  buildFreeCanvasAssetReferencePatch,
  buildFreeCanvasStoryboardMediaItems,
  freeCanvasMediaUrl,
  normalizeFreeCanvasMediaPath,
  resolveFreeCanvasMediaPath,
} from '../src/utils/freeCanvasMedia.js'

test('asset reference changes synchronize dual ids and canonical media fields', () => {
  const node = {
    type: 'image',
    assetId: 1,
    asset_ref: 1,
    content: 'dramas/7/old.png',
    storageKey: 'dramas/7/old.png',
  }
  const assets = new Map([['2', { id: 2, type: 'image', local_path: '/static/dramas/7/new.png' }]])

  assert.deepEqual(buildFreeCanvasAssetReferencePatch(node, 2, assets), {
    assetId: 2,
    asset_ref: 2,
    content: 'dramas/7/new.png',
    storageKey: 'dramas/7/new.png',
  })
  assert.deepEqual(buildFreeCanvasAssetReferencePatch(node, null, assets), {
    assetId: undefined,
    asset_ref: undefined,
  })
})

test('free canvas media library lists only local storyboard images and videos with project context', () => {
  const drama = {
    episodes: [{
      id: 10,
      title: '第 1 集',
      storyboards: [{ id: 20, title: '雨夜重逢', storyboard_number: 3 }],
    }],
  }
  const items = buildFreeCanvasStoryboardMediaItems(drama, {
    imagesBySbId: {
      20: [
        { id: 30, local_path: 'projects/1/images/frame.png', image_url: '/static/projects/1/images/frame.png' },
        { id: 31, image_url: 'https://example.test/remote.png' },
      ],
    },
    videosBySbId: {
      20: [{ id: 40, local_path: 'projects/1/videos/shot.mp4' }],
    },
  })

  assert.deepEqual(items.map((item) => ({
    id: item.id,
    type: item.type,
    storyboardId: item.storyboardId,
    storageKey: item.storageKey,
    label: item.label,
  })), [
    {
      id: 'storyboard-image:30',
      type: 'image',
      storyboardId: 20,
      storageKey: 'projects/1/images/frame.png',
      label: '第 1 集 · 雨夜重逢 · 图片 1',
    },
    {
      id: 'storyboard-video:40',
      type: 'video',
      storyboardId: 20,
      storageKey: 'projects/1/videos/shot.mp4',
      label: '第 1 集 · 雨夜重逢 · 视频 1',
    },
  ])
})

test('free canvas media resolves a normalized local node path before its asset fallback', () => {
  const assets = new Map([['7', { id: 7, local_path: 'library/fallback.png' }]])
  const node = {
    asset_ref: 7,
    storageKey: '/static/dramas/12/reference image.png',
  }

  assert.equal(resolveFreeCanvasMediaPath(node, assets), 'dramas/12/reference image.png')
  assert.equal(freeCanvasMediaUrl(node, assets), '/static/dramas/12/reference%20image.png')
})

test('free canvas media falls back to a referenced project asset', () => {
  const assets = new Map([['asset-2', { id: 'asset-2', local_path: 'library/镜头 1.mp4' }]])

  assert.equal(
    resolveFreeCanvasMediaPath({ asset_ref: 'asset-2' }, assets),
    'library/镜头 1.mp4',
  )
  assert.equal(
    freeCanvasMediaUrl({ asset_ref: 'asset-2' }, assets),
    '/static/library/%E9%95%9C%E5%A4%B4%201.mp4',
  )
})

test('free canvas media rejects remote, absolute, traversal, and control-character paths', () => {
  for (const unsafe of [
    'https://example.com/image.png',
    'data:image/png;base64,abc',
    'blob:runtime',
    '/etc/passwd',
    '../other-project/image.png',
    'dramas/1/../../dramas/2/image.png',
    'C:\\temp\\image.png',
    'dramas/1/image.png\u0000.jpg',
  ]) {
    assert.equal(normalizeFreeCanvasMediaPath(unsafe), '')
  }
})

test('save-as-asset eligibility accepts only unresolved local image and video nodes', () => {
  assert.equal(typeof freeCanvasMedia.getFreeCanvasAssetSaveEligibility, 'function')
  const eligibility = freeCanvasMedia.getFreeCanvasAssetSaveEligibility
  const context = {
    projectId: 7,
    inventory: [
      { projectId: 7, type: 'image', storageKey: 'dramas/7/frame.png' },
      { drama_id: 7, type: 'video', local_path: '/static/dramas/7/shot.mp4' },
    ],
  }
  assert.deepEqual(eligibility({ type: 'image', storageKey: 'dramas/7/frame.png' }, context), {
    eligible: true,
    path: 'dramas/7/frame.png',
    reason: '',
  })
  assert.equal(eligibility({ type: 'video', local_path: '/static/dramas/7/shot.mp4' }, context).eligible, true)

  for (const node of [
    { type: 'text', storageKey: 'dramas/7/note.txt' },
    { type: 'config', storageKey: 'dramas/7/frame.png' },
    { type: 'reference', storageKey: 'dramas/7/frame.png' },
    { type: 'image', content: 'https://example.test/frame.png' },
    { type: 'video', content: 'blob:runtime' },
    { type: 'image' },
    { type: 'image', asset_ref: 9, storageKey: 'dramas/7/frame.png' },
  ]) {
    const result = eligibility(node, context)
    assert.equal(result.eligible, false, JSON.stringify(node))
    assert.ok(result.reason, JSON.stringify(node))
  }
})

test('save-as-asset eligibility rejects editable content even when it names known local media', () => {
  const result = freeCanvasMedia.getFreeCanvasAssetSaveEligibility(
    { type: 'image', content: 'dramas/7/frame.png' },
    {
      projectId: 7,
      inventory: [{ projectId: 7, type: 'image', storageKey: 'dramas/7/frame.png' }],
    },
  )

  assert.equal(result.eligible, false)
  assert.ok(result.reason)
})

test('save-as-asset eligibility rejects cross-project and stale inventory records', () => {
  const node = { type: 'video', storageKey: 'dramas/8/shot.mp4' }
  const crossProject = freeCanvasMedia.getFreeCanvasAssetSaveEligibility(node, {
    projectId: 7,
    inventory: [{ projectId: 8, type: 'video', storageKey: 'dramas/8/shot.mp4' }],
  })
  const stale = freeCanvasMedia.getFreeCanvasAssetSaveEligibility(node, {
    projectId: 7,
    inventory: [{ projectId: 7, type: 'video', storageKey: 'dramas/7/other.mp4' }],
  })

  assert.equal(crossProject.eligible, false)
  assert.equal(stale.eligible, false)
  assert.ok(crossProject.reason)
  assert.ok(stale.reason)
})

test('storyboard media inventory carries project scope and excludes unknown refresh results', () => {
  const drama = {
    id: 7,
    episodes: [{ id: 10, storyboards: [{ id: 20, title: '镜头' }] }],
  }
  const context = {
    imagesBySbId: { 20: [{ id: 30, local_path: 'dramas/7/frame.png' }] },
    videosBySbId: {},
    mediaStatusBySbId: { 20: { state: 'ready' } },
  }

  assert.deepEqual(buildFreeCanvasStoryboardMediaItems(drama, context).map((item) => item.projectId), [7])
  assert.deepEqual(buildFreeCanvasStoryboardMediaItems(drama, {
    ...context,
    mediaStatusBySbId: { 20: { state: 'unknown', preservedData: true } },
  }), [])
})

test('media drag payload parsing requires versioned current-project identity without a path', () => {
  const createPayload = freeCanvasMedia.createFreeCanvasMediaDragPayload
  const parsePayload = freeCanvasMedia.parseFreeCanvasMediaDragPayload
  const payload = createPayload?.(
    { id: 44, drama_id: 7, type: 'image', local_path: 'dramas/7/frame.png' },
    { projectId: 7, kind: 'project-asset' },
  )

  assert.deepEqual(payload, {
    version: 1,
    projectId: 7,
    kind: 'project-asset',
    mediaId: '44',
  })
  assert.deepEqual(parsePayload?.(JSON.stringify(payload), 7), payload)
  assert.equal(parsePayload?.(JSON.stringify({ ...payload, projectId: 8 }), 7) ?? null, null)
  assert.equal(parsePayload?.('{bad json', 7) ?? null, null)
  assert.equal(parsePayload?.(JSON.stringify({ ...payload, version: 2 }), 7) ?? null, null)
})

test('asset discovery filters keyword and media type without losing source items', () => {
  assert.equal(typeof freeCanvasMedia.filterFreeCanvasAssetItems, 'function')
  const items = [
    { id: 1, type: 'image', name: '雨夜门廊' },
    { id: 2, type: 'video', label: '街道追逐' },
    { id: 3, type: 'image', location: '医院走廊' },
  ]

  assert.deepEqual(
    freeCanvasMedia.filterFreeCanvasAssetItems(items, { query: '雨夜', type: 'image' }).map((item) => item.id),
    [1],
  )
  assert.deepEqual(
    freeCanvasMedia.filterFreeCanvasAssetItems(items, { query: '街道', type: 'video' }).map((item) => item.id),
    [2],
  )
  assert.deepEqual(items.map((item) => item.id), [1, 2, 3])
})
