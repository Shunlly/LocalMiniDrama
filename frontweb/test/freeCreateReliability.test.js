import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { compileScript, parse } from '@vue/compiler-sfc'

import {
  buildFreeCreateGenerationPayload,
  createFreeCreateTaskOwner,
  getFreeCreateAspectRatioOptions,
  getFreeCreateBusyDisabledReason,
  getFreeCreateCapabilityNotice,
  getFreeCreateEmptyResultCopy,
  getFreeCreateGenerateDisabledReason,
  getFreeCreateReadyMessage,
  getReferenceUploadBlockReason,
  normalizeFreeCreateAspectRatio,
  parseFreeCreateTaskResult,
  pollFreeCreateTask,
  shouldBlockFreeCreateUnload,
  toFreeCreateUserError,
} from '../src/utils/freeCreate.js'
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')

const freeCreatePageSource = read('../src/views/FreeCreate.vue')
const freeCreateHeaderSource = read('../src/components/freeCreate/FreeCreateHeader.vue')
const freeCreateInputSource = read('../src/components/freeCreate/FreeCreateInputPanel.vue')
const freeCreateResultSource = read('../src/components/freeCreate/FreeCreateResultPanel.vue')
const freeCreateWorkspaceSource = read('../src/composables/useFreeCreateWorkspace.js')
const freeCreateUtilsSource = read('../src/utils/freeCreate.js')
const freeCreateSource = [
  freeCreatePageSource,
  freeCreateHeaderSource,
  freeCreateInputSource,
  freeCreateResultSource,
  freeCreateWorkspaceSource,
  freeCreateUtilsSource,
].join('\n')
const taskApiSource = read('../src/api/task.js')
const videosApiSource = read('../src/api/videos.js')

test('FreeCreate script compiles without duplicate bindings', () => {
  for (const [filename, source] of [
    ['FreeCreate.vue', freeCreatePageSource],
    ['FreeCreateHeader.vue', freeCreateHeaderSource],
    ['FreeCreateInputPanel.vue', freeCreateInputSource],
    ['FreeCreateResultPanel.vue', freeCreateResultSource],
  ]) {
    const parsed = parse(source, { filename })
    assert.deepEqual(parsed.errors, [], filename)
    assert.doesNotThrow(() => compileScript(parsed.descriptor, { id: `free-create-${filename}` }))
  }
})

test('自由创作页把头、输入和结果区接到子组件', () => {
  assert.match(freeCreatePageSource, /import FreeCreateHeader from '@\/components\/freeCreate\/FreeCreateHeader\.vue'/)
  assert.match(freeCreatePageSource, /import FreeCreateInputPanel from '@\/components\/freeCreate\/FreeCreateInputPanel\.vue'/)
  assert.match(freeCreatePageSource, /import FreeCreateResultPanel from '@\/components\/freeCreate\/FreeCreateResultPanel\.vue'/)
  assert.match(freeCreatePageSource, /<FreeCreateHeader @go-back="goBack" \/>/)
  assert.match(freeCreatePageSource, /<FreeCreateInputPanel/)
  assert.match(freeCreatePageSource, /<FreeCreateResultPanel/)
  assert.match(freeCreatePageSource, /ref="inputPanelRef"/)
  assert.doesNotMatch(freeCreatePageSource, /class="page-header"/)
  assert.doesNotMatch(freeCreatePageSource, /class="input-panel"/)
  assert.doesNotMatch(freeCreatePageSource, /class="result-panel"/)
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
  assert.equal(getReferenceUploadBlockReason('error', 'Network Error', ''), '参考图上传失败，请重试或移除')
  assert.equal(getReferenceUploadBlockReason('error', 'api_key=sk-test 无效', ''), '参考图上传失败，请重试或移除')
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
    (freeCreateSource.match(/taskClient\.get\([^,]+, \{ suppressErrorToast: true \}\)/g) || []).length,
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
    /createFreeCreateTaskOwner\(\(taskId, body\) =>[\s\S]*taskClient\.cancel\(taskId, body, \{ suppressErrorToast: true \}\)/,
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
    /onBeforeRouteLeave\(async \(\) =>[\s\S]*return confirmFreeCreateLeave\(\)/,
  )
  assert.match(freeCreateSource, /window\.addEventListener\('beforeunload', handleBeforeUnload\)/)
  assert.match(freeCreateSource, /window\.removeEventListener\('beforeunload', handleBeforeUnload\)/)
})

test('FreeCreate parses completed task payloads and recognizes cancellation terminals', () => {
  assert.equal(
    (freeCreateSource.match(/parseFreeCreateTaskResult\(res\.result\)/g) || []).length,
    2,
  )
  assert.match(freeCreateSource, /\['cancelled', 'canceled'\]\.includes\(String\(status \|\| ''\)\.toLowerCase\(\)\)/)
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

function loadFreeCreateUserErrorHelper() {
  return { toFreeCreateUserError }
}

test('自由创作空态区分加载、失败和未配置，失败时可重新检查', () => {
  assert.match(freeCreateSource, /const emptyResultCopy = computed/)
  assert.match(freeCreateSource, /填写提示词后，生成结果会显示在这里/)
  assert.match(freeCreateSource, /暂时无法读取\$\{label\}服务配置，因此还不能生成。/)
  assert.match(freeCreateSource, /请先配置可用的\$\{label\}服务，生成结果会显示在这里/)
  assert.match(freeCreateSource, /v-if="generationCapability.status === 'error'"[\s\S]*重新检查服务/)
  assert.match(freeCreateSource, /v-if="generationCapability.status === 'error'"[\s\S]*@click="loadServiceConfigs"[\s\S]*重新检查/)
  assert.match(freeCreateSource, /results\.length === 0 && !generating/)
})

test('生成按钮禁用原因可见，而不是只写在 title 里', () => {
  assert.match(freeCreateSource, /class="generate-disabled-reason"/)
  assert.match(freeCreateSource, /data-testid="generate-disabled-reason"/)
  assert.match(freeCreateSource, /id="free-create-generate-reason"/)
  assert.match(
    freeCreateSource,
    /const generateDisabledReason = computed\(\(\) => getFreeCreateGenerateDisabledReason\(\{/,
  )
  assert.match(freeCreateSource, /export function getFreeCreateGenerateDisabledReason\(/)
  assert.match(freeCreateSource, /if \(!nonEmpty\(prompt\)\) return '请先填写提示词'/)
  assert.match(freeCreateSource, /mode\.value === 'video'[\s\S]*getReferenceUploadBlockReason/)
})

test('生成失败和取消后可以按原参数重试', () => {
  assert.match(freeCreateSource, /async function retryGeneration\(item\)/)
  assert.match(freeCreateSource, /async function runGeneration\(item\)/)
  assert.match(freeCreateSource, /item\.status === 'failed'[\s\S]*@click="retryGeneration\(item\)"[\s\S]*>\s*重试\s*<\/el-button>/)
  assert.match(freeCreateSource, /item\.status === 'cancelled'[\s\S]*@click="retryGeneration\(item\)"[\s\S]*>\s*重试\s*<\/el-button>/)
  assert.match(freeCreateSource, /referenceImageLocalPath: mode\.value === 'video' \? \(refImageLocalPath\.value \|\| null\) : null/)
  assert.match(freeCreateSource, /ElMessage\.warning\('请等待当前生成完成后再重试'\)/)
  assert.equal(
    (freeCreateSource.match(/freeCreateTaskOwner\.trackSubmission\(run,/g) || []).length,
    2,
  )
})

test('页面错误转义会吃掉英文技术信息，保留中文业务错误', () => {
  const { toFreeCreateUserError } = loadFreeCreateUserErrorHelper()
  assert.equal(toFreeCreateUserError('任务完成但未返回图片地址'), '任务完成但未返回图片地址')
  assert.equal(toFreeCreateUserError(new Error('Network Error')), '无法连接自由创作服务，请检查服务是否已启动')
  assert.equal(toFreeCreateUserError(new Error('timeout of 15000ms exceeded')), '连接自由创作服务超时，请稍后重试')
  assert.equal(toFreeCreateUserError(new Error('Internal Server Error')), '生成失败，请稍后重试')
  assert.equal(
    toFreeCreateUserError({ response: { status: 502, data: { error: { message: 'Bad Gateway' } } } }),
    '自由创作服务暂时不可用，请稍后重试',
  )
  assert.equal(
    toFreeCreateUserError({ response: { data: { error: { message: '当前模型额度不足' } } } }),
    '当前模型额度不足',
  )
  assert.match(freeCreateSource, /failResultItem\(item, e\)/)
  assert.match(freeCreateSource, /lastPollError = toFreeCreateUserError\(error, '任务状态读取失败'\)/)
  assert.doesNotMatch(freeCreateSource, /newItem\.error = e\.message \|\| '生成失败'/)
})

test('离开保护会确认取消生成，并登记到应用级卸载拦截', () => {
  assert.match(
    freeCreateSource,
    /FREE_CREATE_LEAVE_CONFIRM_MESSAGE = '正在生成，离开将取消当前任务。仍要离开吗？'/
  )
  assert.match(
    freeCreateSource,
    /window\.confirm\(FREE_CREATE_LEAVE_CONFIRM_MESSAGE\)/,
  )
  assert.match(
    freeCreateSource,
    /leaveProtection\?\.register\?\.\('free-create', \{[\s\S]*shouldBlockUnload:[\s\S]*confirmLeave:/,
  )
  assert.match(freeCreateSource, /unregisterLeaveProtection\?\.\(\)/)
  assert.match(
    freeCreateSource,
    /onBeforeRouteLeave\(async \(\) =>[\s\S]*return confirmFreeCreateLeave\(\)/,
  )
  assert.match(freeCreateSource, /window\.addEventListener\('beforeunload', handleBeforeUnload\)/)
})
test('能力说明只用显式中文，就绪详情不泄露密钥和英文异常', () => {
  assert.equal(
    getFreeCreateCapabilityNotice({ status: 'loading', serviceLabel: '视频' }),
    '正在检查视频服务…',
  )
  assert.equal(
    getFreeCreateCapabilityNotice({ status: 'error', serviceLabel: '图片' }),
    '无法读取图片服务配置',
  )
  assert.equal(
    getFreeCreateCapabilityNotice({ status: 'missing', issue: 'missing_config', serviceLabel: '图片' }),
    '尚未配置可用的图片服务',
  )
  assert.equal(
    getFreeCreateCapabilityNotice({ status: 'missing', issue: 'missing_credentials', serviceLabel: '视频' }),
    '视频服务缺少访问凭据',
  )
  assert.equal(
    getFreeCreateReadyMessage({ serviceLabel: '图片', name: '通义万相', model: 'wanx-v1' }),
    '图片服务已就绪：通义万相 / wanx-v1',
  )
  assert.equal(
    getFreeCreateReadyMessage({
      serviceLabel: '图片',
      name: 'api_key=sk-test',
      provider: 'Internal Server Error',
      model: 'https://evil.example/model',
    }),
    '图片服务已就绪',
  )
  assert.equal(
    toFreeCreateUserError({ response: { data: { error: { message: '当前 api_key=sk-test 无效' } } } }),
    '生成失败，请稍后重试',
  )
  assert.equal(
    toFreeCreateUserError('请访问 https://evil.example'),
    '生成失败，请稍后重试',
  )
  assert.match(freeCreateSource, /function warnGenerationUnavailable\(\)/)
  assert.match(freeCreateSource, /ElMessage\.warning\(toFreeCreateUserError\(/)
  assert.doesNotMatch(freeCreateSource, /ElMessage\.warning\(generationCapability\.value\.message\)/)
  assert.match(freeCreateSource, /getFreeCreateCapabilityNotice\(\{ status: 'error', serviceLabel \}\)/)
  assert.match(freeCreateSource, /getFreeCreateReadyMessage\(\{/)
})

test('自由创作按需加载消息反馈，不引入 Element Plus 全量入口', () => {
  assert.match(freeCreateSource, /import \{ ElMessage \} from '@\/utils\/elementPlusFeedback\.js'/)
  assert.doesNotMatch(freeCreateSource, /from 'element-plus'/)
})

test('自由创作提示词和风格输入有中文无障碍名称', () => {
  assert.match(freeCreateSource, /aria-label="提示词"/)
  assert.match(freeCreateSource, /aria-label="风格"/)
})

test('参考图上传禁用时给出中文原因', () => {
  assert.match(freeCreateSource, /正在上传参考图，请稍候/)
  assert.equal(
    (freeCreateSource.match(/:disabled="refImageUploadStatus === 'uploading'"\s*:title="refImageUploadStatus === 'uploading' \? '正在上传参考图，请稍候' : undefined"/g) || []).length,
    2,
  )
})

test('生成成功后提供保存到素材中心', () => {
  assert.match(freeCreateSource, /保存到素材中心/)
  assert.match(freeCreateSource, /saveItemToAssets/)
  assert.match(freeCreateSource, /assetsAPI/)
  assert.match(freeCreateSource, /restoreFreeCreateResults/)
})

test('结果区禁用按钮给出中文原因', () => {
  assert.match(
    freeCreateSource,
    /const resultBusyDisabledReason = computed\(\(\) => getFreeCreateBusyDisabledReason\(\{[\s\S]*cancelling: cancelling\.value[\s\S]*generating: generating\.value/,
  )
  assert.equal(
    (freeCreateSource.match(/:disabled="cancelling"\s*:title="cancelling \? resultBusyDisabledReason : undefined"/g) || []).length,
    2,
  )
  assert.equal(
    (freeCreateSource.match(/:disabled="generating \|\| cancelling"\s*:title="resultBusyDisabledReason \|\| undefined"/g) || []).length,
    4,
  )
  assert.match(
    freeCreateSource,
    /:title="cancelling \? resultBusyDisabledReason : undefined"[\s\S]*\{\{ generating \? '取消并清空' : '清空' \}\}/,
  )
  assert.match(
    freeCreateSource,
    /:title="cancelling \? resultBusyDisabledReason : undefined"[\s\S]*取消生成/,
  )
  assert.match(
    freeCreateSource,
    /:disabled="generating \|\| cancelling"[\s\S]*:title="resultBusyDisabledReason \|\| undefined"[\s\S]*@click="downloadItem\(item\)"/,
  )
  assert.match(freeCreateSource, /:title="\(generating \? resultBusyDisabledReason : generateDisabledReason\) \|\| undefined"/)
  assert.match(
    freeCreateSource,
    /const generateDisabledReason = computed\(\(\) => getFreeCreateGenerateDisabledReason\(\{/,
  )
})

test('自由创作空态、失败、取消和离开保护文案可直接断言', () => {
  assert.equal(getFreeCreateEmptyResultCopy({ status: 'ready', ready: true }), '填写提示词后，生成结果会显示在这里')
  assert.equal(
    getFreeCreateEmptyResultCopy({ status: 'error', serviceLabel: '图片' }),
    '暂时无法读取图片服务配置，因此还不能生成。',
  )
  assert.equal(getFreeCreateGenerateDisabledReason({ generating: false, capabilityReady: true, prompt: '' }), '请先填写提示词')
  assert.equal(getFreeCreateBusyDisabledReason({ cancelling: true }), '正在取消生成，请稍候')
  assert.equal(shouldBlockFreeCreateUnload({ uploading: true }), true)
  assert.equal(shouldBlockFreeCreateUnload({ hasActive: true }), true)
  assert.equal(shouldBlockFreeCreateUnload({}), false)
  assert.match(freeCreateHeaderSource, /aria-label="返回项目首页"/)
  assert.match(freeCreateHeaderSource, />\s*返回项目首页\s*</)
  assert.doesNotMatch(freeCreateHeaderSource, /返回项目列表/)
  assert.match(freeCreateHeaderSource, /<h1 class="page-title">自由创作<\/h1>/)
  assert.match(freeCreateHeaderSource, /<el-icon aria-hidden="true"><ArrowLeft \/><\/el-icon>/)
  assert.match(freeCreateHeaderSource, /<style scoped>[\s\S]*\.back-link:focus-visible[\s\S]*<\/style>/)
  assert.doesNotMatch(freeCreateHeaderSource.split('</style>').slice(1).join('</style>'), /\.back-link/)
  assert.match(freeCreateResultSource, /class="empty-result" role="status" aria-live="polite"/)
  assert.match(freeCreateResultSource, /role="group"[\s\S]*aria-label="空结果下一步"/)
  assert.match(freeCreateResultSource, /aria-label="去填写提示词"/)
  assert.match(freeCreateInputSource, />\s*重新检查生成能力\s*</)
  assert.match(freeCreateInputSource, />\s*前往 AI 配置\s*</)
  assert.match(freeCreatePageSource, /@focus-prompt="focusPrompt"/)
  assert.match(freeCreateResultSource, /item\.assetSaveError \? '重试保存' : '保存到素材中心'/
  )
})

test('轮询会把取消和失败写成中文终态', async () => {
  const cancelled = { type: 'image', url: null, status: 'processing', error: null }
  await pollFreeCreateTask({
    taskId: 'task-1',
    item: cancelled,
    run: {},
    maxMs: 20,
    intervalMs: 1,
    waitForPendingCancellation: async () => false,
    fetchTask: async () => ({ status: 'canceled', message: '用户已取消' }),
    resolveCompletedItem: async () => {},
    failResultItem(item, message) {
      item.status = 'failed'
      item.error = String(message)
    },
  })
  assert.equal(cancelled.status, 'cancelled')
  assert.equal(cancelled.error, '用户已取消')

  const failed = { type: 'image', url: null, status: 'processing', error: null }
  await pollFreeCreateTask({
    taskId: 'task-2',
    item: failed,
    run: {},
    maxMs: 20,
    intervalMs: 1,
    waitForPendingCancellation: async () => false,
    fetchTask: async () => ({ status: 'failed', message: '当前模型额度不足' }),
    resolveCompletedItem: async () => {},
    failResultItem(item, message) {
      item.status = 'failed'
      item.error = String(message)
    },
  })
  assert.equal(failed.status, 'failed')
  assert.equal(failed.error, '当前模型额度不足')
})
