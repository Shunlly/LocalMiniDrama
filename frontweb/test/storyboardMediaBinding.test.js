import test from 'node:test'
import assert from 'node:assert/strict'

import {
  getSbImagesList,
  resolveSbFirstImageRecord,
  resolveSbLastImageRecord,
  resolveSbMainImageRecord,
} from '../src/utils/storyboardMedia.js'
import { normalizeEntityId, parseStoryboardSceneId } from '../src/utils/canvasEntityIds.js'

function completed(id, extra = {}) {
  return {
    id,
    status: 'completed',
    frame_type: extra.frame_type || 'storyboard_first',
    local_path: extra.local_path || `frames/${id}.png`,
  }
}

test('分镜图片列表能按字符串/数字 storyboard id 取值，空数据返回空数组', () => {
  const imagesBySbId = {
    21: [completed(8), { id: 9, status: 'failed', local_path: 'frames/9.png' }],
  }
  assert.deepEqual(getSbImagesList(imagesBySbId, '21').map((item) => item.id), [8])
  assert.deepEqual(getSbImagesList(imagesBySbId, 21).map((item) => item.id), [8])
  assert.deepEqual(getSbImagesList({}, 21), [])
  assert.deepEqual(getSbImagesList(null, 21), [])
})

test('首尾帧绑定按图片 id 取值，字符串与数字视为同一张，不会命中其它图片 id', () => {
  const imagesBySbId = {
    7: [
      completed('31', { frame_type: 'storyboard_first' }),
      completed(32, { frame_type: 'storyboard_last', local_path: 'frames/32.png' }),
      completed(33, { frame_type: 'storyboard_first', local_path: 'frames/33.png' }),
    ],
  }
  const sb = {
    id: '7',
    first_frame_image_id: 31,
    last_frame_image_id: '32',
  }
  assert.equal(resolveSbFirstImageRecord(sb, imagesBySbId).id, '31')
  assert.equal(resolveSbLastImageRecord(sb, imagesBySbId).id, 32)
  assert.notEqual(resolveSbFirstImageRecord(sb, imagesBySbId).id, resolveSbLastImageRecord(sb, imagesBySbId).id)

  const mixed = {
    id: 7,
    first_frame_image_id: 99,
    local_path: 'frames/stale.png',
    image_url: '/static/frames/stale.png',
  }
  const fallback = resolveSbFirstImageRecord(mixed, imagesBySbId)
  assert.equal(fallback.frame_type, 'storyboard_first')
  assert.equal(fallback.id, '31')
})

test('主图绑定也不会把其它图片 id 当成当前首帧', () => {
  const imagesBySbId = {
    4: [completed(41), completed(42)],
  }
  const sb = { id: 4, first_frame_image_id: '42' }
  assert.equal(resolveSbMainImageRecord(sb, imagesBySbId).id, 42)
  assert.equal(resolveSbMainImageRecord({ id: 4 }, imagesBySbId).id, 41)
  assert.equal(resolveSbMainImageRecord(null, imagesBySbId), null)
})

test('实体 id 拒绝 0、负数和非整数，scene_id 不会和角色 id 混用', () => {
  assert.equal(normalizeEntityId(0), null)
  assert.equal(normalizeEntityId(-3), null)
  assert.equal(normalizeEntityId('12.5'), null)
  assert.equal(normalizeEntityId('12'), 12)
  assert.equal(parseStoryboardSceneId({ scene_id: '8', characters: [8] }), 8)
  assert.equal(parseStoryboardSceneId({ scene_id: 0, characters: [1] }), null)
})
