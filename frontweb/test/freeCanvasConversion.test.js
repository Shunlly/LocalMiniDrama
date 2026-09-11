import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  parseFreeConversionTargetKey,
  describeFreeConversionOperation,
  buildStoryboardPrimaryMediaPatch,
  validateFreeConversionMedia,
} from '../src/utils/freeCanvasConversion.js'

test('转换键优先识别分镜主图和分镜视频，不会当成普通分镜', () => {
  assert.deepEqual(parseFreeConversionTargetKey('storyboard-image:12'), { type: 'storyboard-image', id: 12 })
  assert.deepEqual(parseFreeConversionTargetKey('storyboard-video:12'), { type: 'storyboard-video', id: 12 })
  assert.deepEqual(parseFreeConversionTargetKey('storyboard:12'), { type: 'storyboard', id: 12 })
  assert.equal(parseFreeConversionTargetKey('storyboard-image'), null)
})

test('分镜主图和视频补丁写入本地路径和静态地址', () => {
  assert.deepEqual(buildStoryboardPrimaryMediaPatch('projects/1/a.png', 'image'), {
    image_url: '/static/projects/1/a.png',
    local_path: 'projects/1/a.png',
  })
  assert.deepEqual(buildStoryboardPrimaryMediaPatch('projects/1/a.mp4', 'video'), {
    video_url: '/static/projects/1/a.mp4',
    video_local_path: 'projects/1/a.mp4',
  })
})

test('视频不能写入分镜主图，图片不能写入分镜视频', () => {
  assert.match(validateFreeConversionMedia({ mediaReference: 'a.mp4', isVideo: true, targetType: 'storyboard-image' }), /分镜视频/)
  assert.match(validateFreeConversionMedia({ mediaReference: 'a.png', isVideo: false, targetType: 'storyboard-video' }), /分镜主图/)
  assert.equal(validateFreeConversionMedia({ mediaReference: 'a.png', isVideo: false, targetType: 'storyboard-image' }), '')
  assert.equal(validateFreeConversionMedia({ mediaReference: 'a.mp4', isVideo: true, targetType: 'storyboard-video' }), '')
})

test('操作说明区分主图、视频和参考图', () => {
  assert.match(describeFreeConversionOperation({ mediaReference: 'a.png', targetType: 'storyboard-image' }), /主图/)
  assert.match(describeFreeConversionOperation({ mediaReference: 'a.mp4', targetType: 'storyboard-video' }), /视频/)
  assert.match(describeFreeConversionOperation({ mediaReference: 'a.png', targetType: 'storyboard' }), /参考图/)
})

test('画布转换目标源码包含分镜主图和分镜视频', () => {
  const source = readFileSync(new URL('../src/components/dramaCanvas/dramaCanvasDerivedState.js', import.meta.url), 'utf8')
  assert.match(source, /storyboard-image:\$\{storyboard\.id\}/)
  assert.match(source, /storyboard-video:\$\{storyboard\.id\}/)
  assert.match(source, /storyboard:\$\{storyboard\.id\}/)
})
