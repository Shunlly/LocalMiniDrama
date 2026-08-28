import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { compileScript, parse } from '@vue/compiler-sfc'

import {
  buildFreeCreateGenerationPayload,
  createFreeCreateTaskOwner,
  getFreeCreateAspectRatioOptions,
  getReferenceUploadBlockReason,
  normalizeFreeCreateAspectRatio,
  parseFreeCreateTaskResult,
} from '../src/utils/freeCreate.js'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')

const freeCreateSource = read('../src/views/FreeCreate.vue')
const taskApiSource = read('../src/api/task.js')
const videosApiSource = read('../src/api/videos.js')

test('FreeCreate script compiles without duplicate bindings', () => {
  const parsed = parse(freeCreateSource, { filename: 'FreeCreate.vue' })
  assert.deepEqual(parsed.errors, [])
  assert.doesNotThrow(() => compileScript(parsed.descriptor, { id: 'free-create-reliability' }))
})

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

test('task results accept JSON strings and objects but reject malformed payloads', () => {
  const objectResult = { image_url: 'https://cdn.example/image.png' }

  assert.deepEqual(
    parseFreeCreateTaskResult('{"video_generation_id":42}'),
    { video_generation_id: 42 },
  )
  assert.strictEqual(parseFreeCreateTaskResult(objectResult), objectResult)
  assert.deepEqual(parseFreeCreateTaskResult(null), {})
  assert.throws(() => parseFreeCreateTaskResult('{broken'), /任务结果格式无效/)
  assert.throws(() => parseFreeCreateTaskResult('[]'), /任务结果格式无效/)
})

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

test('task owner waits for a pending submission before cancelling its task', async () => {
  const submission = deferred()
  const cancelCalls = []
  const owner = createFreeCreateTaskOwner(async (...args) => {
    cancelCalls.push(args)
  })
  const run = owner.begin({ item: { status: 'processing' } })
  const trackedSubmission = owner.trackSubmission(run, submission.promise)
  const cancellation = owner.cancel('用户离开自由创作页面')

  await Promise.resolve()
  assert.equal(cancelCalls.length, 0)
  assert.equal(owner.hasActive(), true)

  submission.resolve({ task_id: 'task-after-submit' })
  await trackedSubmission
  assert.equal(await cancellation, true)
  assert.deepEqual(cancelCalls, [[
    'task-after-submit',
    { reason: '用户离开自由创作页面' },
  ]])
  assert.equal(owner.hasActive(), false)
})

test('task owner retains the generation lock when cancellation fails', async () => {
  let shouldFail = true
  const owner = createFreeCreateTaskOwner(async () => {
    if (shouldFail) throw new Error('取消服务暂不可用')
  })
  const run = owner.begin()
  await owner.trackSubmission(run, Promise.resolve({ task_id: 'task-cancel-retry' }))

  await assert.rejects(owner.cancel('用户取消生成'), /取消服务暂不可用/)
  assert.equal(owner.hasActive(), true)
  assert.equal(owner.isActive(run), true)
  assert.throws(() => owner.begin(), /已有生成任务正在进行/)

  shouldFail = false
  assert.equal(await owner.cancel('用户取消生成'), true)
  assert.equal(owner.hasActive(), false)
})

test('task owner cancels a rejected pre-id submission without a remote request', async () => {
  const submission = deferred()
  let cancelCalls = 0
  const owner = createFreeCreateTaskOwner(async () => {
    cancelCalls += 1
  })
  const run = owner.begin()
  const trackedSubmission = owner.trackSubmission(run, submission.promise)
  const cancellation = owner.cancel('用户取消生成')

  submission.reject(new Error('提交失败'))
  await assert.rejects(trackedSubmission, /提交失败/)
  assert.equal(await cancellation, true)
  assert.equal(cancelCalls, 0)
  assert.equal(owner.hasActive(), false)
})

test('FreeCreate polls image and video jobs through the shared task API', () => {
  assert.match(freeCreateSource, /import \{ taskAPI \} from '@\/api\/task'/)
  assert.equal(
    (freeCreateSource.match(/taskAPI\.get\(taskId, \{ suppressErrorToast: true \}\)/g) || []).length,
    2,
  )
  assert.doesNotMatch(freeCreateSource, /imagesAPI\.getTask/)
  assert.doesNotMatch(freeCreateSource, /await import\('@\/api\/task'\)/)
})

test('task API forwards request options so owned polling can aggregate errors', () => {
  assert.match(
    taskApiSource,
    /get\(taskId, options\)[\s\S]*request\.get\(`\/tasks\/\$\{taskId\}`, options \|\| \{\}\)/,
  )
  assert.match(
    taskApiSource,
    /cancel\(taskId, body, options\)[\s\S]*request\.post\(`\/tasks\/\$\{taskId\}\/cancel`, body \|\| \{\}, options \|\| \{\}\)/,
  )
})

test('FreeCreate owns, cancels, and releases exactly one remote generation task', () => {
  assert.match(
    freeCreateSource,
    /createFreeCreateTaskOwner\(\(taskId, body\) =>[\s\S]*taskAPI\.cancel\(taskId, body, \{ suppressErrorToast: true \}\)/,
  )
  assert.equal(
    (freeCreateSource.match(/freeCreateTaskOwner\.trackSubmission\(run,/g) || []).length,
    2,
  )
  assert.match(freeCreateSource, /activeTaskId\.value = run\.taskId/)
  assert.match(
    freeCreateSource,
    /async function clearResults\(\)[\s\S]*await cancelActiveGeneration\('用户清空生成结果'\)/,
  )
  assert.match(
    freeCreateSource,
    /onBeforeRouteLeave\(async \(\) =>[\s\S]*return cancelActiveGeneration\('用户离开自由创作页面'\)/,
  )
  assert.match(freeCreateSource, /window\.addEventListener\('beforeunload', handleBeforeUnload\)/)
  assert.match(freeCreateSource, /window\.removeEventListener\('beforeunload', handleBeforeUnload\)/)
})

test('FreeCreate parses completed task payloads and recognizes cancellation terminals', () => {
  assert.equal(
    (freeCreateSource.match(/parseFreeCreateTaskResult\(res\.result\)/g) || []).length,
    2,
  )
  assert.match(freeCreateSource, /\['cancelled', 'canceled'\]\.includes\(status\)/)
  assert.match(freeCreateSource, /item\.status = 'cancelled'/)
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
