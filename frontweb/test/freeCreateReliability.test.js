import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  buildFreeCreateGenerationPayload,
  getFreeCreateAspectRatioOptions,
  getReferenceUploadBlockReason,
  normalizeFreeCreateAspectRatio,
} from '../src/utils/freeCreate.js'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')

const freeCreateSource = read('../src/views/FreeCreate.vue')
const videosApiSource = read('../src/api/videos.js')

test('video aspect ratios stay within the supported set', () => {
  assert.deepEqual(
    getFreeCreateAspectRatioOptions('video').map((option) => option.value),
    ['16:9', '9:16', '1:1'],
  )
  assert.deepEqual(
    getFreeCreateAspectRatioOptions('image').map((option) => option.value),
    ['16:9', '9:16', '1:1', '4:3'],
  )
  assert.equal(normalizeFreeCreateAspectRatio('video', '4:3'), '16:9')
  assert.equal(normalizeFreeCreateAspectRatio('video', '9：16'), '9:16')
  assert.equal(normalizeFreeCreateAspectRatio('image', '4:3'), '4:3')
})

test('generation payload blocks broken uploads and normalizes reference media', () => {
  assert.equal(getReferenceUploadBlockReason('uploading', '', ''), '参考图正在上传，请等待上传完成')
  assert.equal(getReferenceUploadBlockReason('error', '上传失败', ''), '上传失败')
  assert.equal(getReferenceUploadBlockReason('success', '', ''), '参考图上传结果无效，请重试或移除')

  const body = buildFreeCreateGenerationPayload({
    mode: 'video',
    prompt: '  镜头缓慢推进  ',
    style: ' cinematic ',
    aspectRatio: '4:3',
    duration: '8',
    referenceUploadStatus: 'success',
    referenceImageLocalPath: 'uploads/reference/frame.png',
  })
  assert.deepEqual(body, {
    prompt: '镜头缓慢推进',
    style: 'cinematic',
    aspect_ratio: '16:9',
    duration: 8,
    first_frame_url: '/static/uploads/reference/frame.png',
    image_url: '/static/uploads/reference/frame.png',
  })

  assert.throws(
    () => buildFreeCreateGenerationPayload({
      mode: 'video',
      prompt: 'x',
      aspectRatio: '1:1',
      referenceUploadStatus: 'error',
      referenceUploadError: '请重试',
    }),
    /请重试/,
  )
})

test('FreeCreate keeps retry and ratio controls keyboard operable', () => {
  assert.match(
    freeCreateSource,
    /<el-radio-group[\s\S]*v-if="mode === 'video'"[\s\S]*aria-label="视频画面比例"[\s\S]*class="aspect-ratio-group"/,
  )
  assert.match(freeCreateSource, /<el-radio-button[\s\S]*v-for="option in aspectRatioOptions"/)
  assert.match(freeCreateSource, />\s*重试上传\s*<\/el-button>/)
  assert.match(freeCreateSource, />\s*移除\s*<\/el-button>/)
  assert.match(
    freeCreateSource,
    /watch\(mode, \(nextMode\) => \{\s*aspectRatio\.value = normalizeFreeCreateAspectRatio\(nextMode, aspectRatio\.value\)\s*\}, \{ immediate: true \}\)/,
  )
  assert.match(videosApiSource, /get\(id\)\s*\{\s*return request\.get\(`\/videos\/\$\{id\}`\)\s*\}/)
})
