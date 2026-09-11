import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  assetImageUrl,
  createDramaDetailLibraryImages,
  pollDramaDetailImageTask,
} from '../src/components/dramaDetail/dramaDetailResourceImages.js'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const pageSource = read('../src/views/DramaDetail.vue')
const helperSource = read('../src/components/dramaDetail/dramaDetailResourceImages.js')

test('资源图片地址优先走本地路径，空值返回空字符串', () => {
  assert.equal(assetImageUrl(null), '')
  assert.equal(assetImageUrl({}), '')
  assert.equal(assetImageUrl({ image_url: 'https://cdn.example/a.png' }), 'https://cdn.example/a.png')
  assert.equal(assetImageUrl({ local_path: '/covers/a.png', image_url: 'https://cdn.example/a.png' }), '/static/covers/a.png')
  assert.match(pageSource, /createDramaDetailLibraryImages\(/)
  assert.match(helperSource, /export function assetImageUrl\(/)
})

test('图片任务轮询在完成、失败和超时时给出中文结果', async () => {
  const completed = await pollDramaDetailImageTask({
    async get(id) {
      assert.equal(id, 'task-ok')
      return { data: { status: 'completed', result: { image_url: '/static/ok.png' } } }
    },
  }, 'task-ok', { attempts: 3, intervalMs: 1 })
  assert.equal(completed.result.image_url, '/static/ok.png')

  await assert.rejects(
    pollDramaDetailImageTask({
      async get() { return { status: 'failed', error: '模型不可用' } },
    }, 'task-fail', { attempts: 3, intervalMs: 1 }),
    { message: '模型不可用' },
  )

  await assert.rejects(
    pollDramaDetailImageTask({
      async get() { return { status: 'processing' } },
    }, 'task-wait', { attempts: 2, intervalMs: 1 }),
    { message: '生成超时' },
  )

  await assert.rejects(
    pollDramaDetailImageTask({ async get() { return {} } }, '', { attempts: 1, intervalMs: 1 }),
    { message: '未返回任务ID' },
  )
})

test('素材库上传成功会写回地址并刷新列表', async () => {
  const events = []
  const form = { id: 41, imgUploading: false }
  const { doUploadLibImg } = createDramaDetailLibraryImages({
    dramaId: 11,
    uploadAPI: {
      async uploadImage(file, extra) {
        events.push(['upload', file.name, extra.dramaId])
        return { data: { url: '/static/new.png', local_path: 'new.png' } }
      },
    },
    imagesAPI: {},
    taskAPI: {},
    ElMessage: {
      success(message) { events.push(['success', message]) },
      error(message) { events.push(['error', message]) },
    },
    toUserError: (error, fallback) => error?.message || fallback,
  })
  await doUploadLibImg(
    { target: { files: [{ name: 'a.png' }], value: 'keep' } },
    form,
    { async update(id, payload) { events.push(['update', id, payload]) } },
    () => events.push(['reload']),
  )
  assert.equal(form.image_url, '/static/new.png')
  assert.equal(form.imgUploading, false)
  assert.deepEqual(events.map((item) => item[0]), ['upload', 'update', 'reload', 'success'])
  assert.equal(events[0][2], 11)
  assert.notEqual(events[1][1], 11)
})
