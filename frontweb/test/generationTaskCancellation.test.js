import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { createPinia, setActivePinia } from 'pinia'

import { taskAPI } from '../src/api/task.js'
import { remainingExtractNamedFunction, remainingSourceBetween } from './helpers/remainingSourceBetween.js'
import { useGenerationTaskStore } from '../src/stores/generationTaskStore.js'

import {
  GEN_RESOURCE,
  findCompletedLocalAsset,
  isActiveTaskStatus,
  isCanceledOrCancellingTaskStatus,
  isCanceledTaskStatus,
  isInFlightTaskStatus,
  isInvalidTaskKey,
  isMarkedRunning,
  isOrphanedProcessingTask,
  listInFlightTasks,
  listInFlightTasksForEpisode,
  normalizeCancellingTask,
  normalizeFinishedTask,
  normalizeRunningTask,
  resolveFinishTaskKeys,
  sbImageResourceType,
  shouldPreserveCanceledTask,
  taskFailMessage,
  taskKey,
} from '../src/stores/generationTaskStore.helpers.js'
import {
  buildEpisodeBackendTaskRecovery,
  buildEpisodeRecoveryScope,
  buildPendingImageRecovery,
  buildPendingVideoRecovery,
  buildStoryGenerationRecovery,
} from '../src/stores/generationTaskStore.recovery.js'

const storeSource = readFileSync(new URL('../src/stores/generationTaskStore.js', import.meta.url), 'utf8')

test('远程取消不确定和耗尽时前端保持 cancelling 并继续轮询', () => {
  assert.match(storeSource, /REMOTE_CANCEL_RECONCILE_CODES = new Set\(\['REMOTE_CANCEL_UNCERTAIN', 'REMOTE_CANCEL_EXHAUSTED'\]\)/)
  const cancelBlock = remainingExtractNamedFunction(storeSource, 'cancelTask')
  assert.match(cancelBlock, /status: 'cancelling'/)
  assert.match(cancelBlock, /void pollTask\(taskId, meta, options\.onDone/)
  const reconcileBranch = remainingSourceBetween(
    cancelBlock,
    'if (REMOTE_CANCEL_RECONCILE_CODES',
    "return { status: 'cancelling'",
  )
  assert.doesNotMatch(reconcileBranch, /stopPollingTask\(taskId/)
})

test('资源级任务查询支持携带真实项目编号', async () => {
  const calls = []
  const originalGet = taskAPI.listByResource
  // 通过 remainingImported source 不够，直接断言导出函数会写入 drama_id
  const source = String(taskAPI.listByResource)
  assert.match(source, /params\.drama_id = String\(options\.drama_id\)/)
  assert.match(storeSource, /listByResource\(String\(episodeId\), \{ drama_id: dramaId \}\)/)
  assert.match(storeSource, /listByResource\(String\(resourceId\), \{ drama_id: dramaId \}\)/)
  assert.equal(typeof originalGet, 'function')
})
test('资源键、分镜图类型和无效 key 判定保持原语义', () => {
  assert.equal(taskKey({ dramaId: 1, episodeId: 2, resourceType: GEN_RESOURCE.SB_IMAGE, resourceId: 3 }), '1:2:sb_image:3')
  assert.equal(sbImageResourceType('last'), GEN_RESOURCE.SB_LAST_IMAGE)
  assert.equal(sbImageResourceType('FIRST'), GEN_RESOURCE.SB_FIRST_IMAGE)
  assert.equal(sbImageResourceType('normal'), GEN_RESOURCE.SB_IMAGE)
  assert.equal(sbImageResourceType(''), GEN_RESOURCE.SB_IMAGE)
  assert.equal(isInvalidTaskKey('1:2:sb_image:3'), false)
  assert.equal(isInvalidTaskKey('1:undefined:sb_image:3'), true)
  assert.equal(isInvalidTaskKey('1:2:sb_image:null'), true)
})

test('进行中集合包含 cancelling，isRunning 只认 running', () => {
  assert.equal(isActiveTaskStatus('pending'), true)
  assert.equal(isActiveTaskStatus('processing'), true)
  assert.equal(isActiveTaskStatus('running'), true)
  assert.equal(isActiveTaskStatus('cancelling'), true)
  assert.equal(isActiveTaskStatus('completed'), false)
  assert.equal(isInFlightTaskStatus('running'), true)
  assert.equal(isInFlightTaskStatus('cancelling'), true)
  assert.equal(isInFlightTaskStatus('pending'), false)
  assert.equal(isMarkedRunning({ status: 'running' }), true)
  assert.equal(isMarkedRunning({ status: 'cancelling' }), false)

  const tasks = new Map([
    ['a', { dramaId: 1, episodeId: 2, status: 'running' }],
    ['b', { dramaId: 1, episodeId: 2, status: 'cancelling' }],
    ['c', { dramaId: 1, episodeId: 3, status: 'completed' }],
    ['d', { dramaId: 9, episodeId: 2, status: 'running' }],
  ])
  const inFlight = listInFlightTasks(tasks)
  assert.deepEqual(inFlight.map((t) => t.status), ['running', 'cancelling', 'running'])
  assert.equal(listInFlightTasksForEpisode(inFlight, 1, 2).length, 2)
  assert.deepEqual(listInFlightTasksForEpisode(inFlight, null, 2), [])
})

test('任务项归一化、失败文案和结束 key 解析保持原语义', () => {
  const running = normalizeRunningTask({ dramaId: 1, resourceType: 'x' }, 'k1', 100)
  assert.equal(running.status, 'running')
  assert.equal(running.key, 'k1')
  assert.equal(running.startedAt, 100)
  const finished = normalizeFinishedTask(running, 'failed', 'boom', 200)
  assert.equal(finished.status, 'failed')
  assert.equal(finished.error, 'boom')
  assert.equal(finished.finishedAt, 200)
  const cancelling = normalizeCancellingTask(running, '', 'REMOTE_CANCEL_UNCERTAIN', { n: 1 }, 300)
  assert.equal(cancelling.status, 'cancelling')
  assert.equal(cancelling.error, '')
  assert.equal(cancelling.cancelCode, 'REMOTE_CANCEL_UNCERTAIN')
  assert.equal(cancelling.cancelObservedAt, 300)
  assert.equal(taskFailMessage(null), '任务失败')
  assert.equal(taskFailMessage({ message: ' 后端失败 ' }), '后端失败')
  assert.equal(taskFailMessage({ error: '连接失败: Network Error' }), '任务失败')
  assert.doesNotMatch(
    taskFailMessage({ error: '认证失败 Bearer sk-provider-secret-123456' }),
    /sk-provider-secret|Bearer /i,
  )

  const taskMap = new Map([
    ['1:2:sb_image:3', { taskId: 't-1', status: 'running' }],
    ['1:2:sb_video:3', { taskId: 't-1', status: 'running' }],
  ])
  assert.deepEqual(
    resolveFinishTaskKeys(taskMap, { dramaId: 1, episodeId: 2, resourceType: GEN_RESOURCE.SB_IMAGE, resourceId: 3, taskId: 't-1' }).sort(),
    ['1:2:sb_image:3', '1:2:sb_video:3'],
  )
})

test('孤儿任务过滤忽略 cancelling，本地资源完成判定看图片字段', () => {
  const stale = new Date(Date.now() - 1000).toISOString()
  assert.equal(isOrphanedProcessingTask({ status: 'processing', updated_at: stale }, 10), true)
  assert.equal(isOrphanedProcessingTask({ status: 'cancelling', updated_at: stale }, 10), false)
  assert.equal(isOrphanedProcessingTask({ status: 'processing' }, 10), false)
  assert.ok(findCompletedLocalAsset(
    { resourceType: GEN_RESOURCE.CHAR_IMAGE, resourceId: 8 },
    { characters: [{ id: '8', image_url: '/a.png' }] },
  ))
  assert.equal(findCompletedLocalAsset(
    { resourceType: GEN_RESOURCE.CHAR_IMAGE, resourceId: 8 },
    { characters: [{ id: 8 }] },
  ), null)
})

test('恢复元数据按分镜帧类型、提取任务和剧本任务归一化', () => {
  const scope = buildEpisodeRecoveryScope({
    dramaId: 11,
    episodeId: 22,
    dramaTitle: '短剧A',
    episodeNumber: 3,
    storyboards: [{ id: 5, storyboard_number: 7 }],
    characters: [{ id: 9, name: '李四' }],
    scenes: [{ id: 4, location: '码头' }],
    props: [],
  })
  assert.equal(scope.epLabel, '短剧A · 第3集')

  const lastFrame = buildPendingImageRecovery({
    status: 'processing',
    task_id: 'img-1',
    storyboard_id: 5,
    frame_type: 'last',
  }, scope)
  assert.equal(lastFrame.meta.resourceType, GEN_RESOURCE.SB_LAST_IMAGE)
  assert.equal(lastFrame.meta.label, '短剧A · 第3集 尾帧 #7')
  assert.equal(lastFrame.refreshKind, 'storyboard')

  const charImg = buildPendingImageRecovery({
    status: 'pending',
    task_id: 'img-2',
    character_id: 9,
  }, scope)
  assert.equal(charImg.meta.resourceType, GEN_RESOURCE.CHAR_IMAGE)
  assert.equal(charImg.meta.label, '短剧A · 第3集 角色图: 李四')
  assert.equal(charImg.refreshKind, 'drama')

  const video = buildPendingVideoRecovery({
    status: 'processing',
    task_id: 'vid-1',
    storyboard_id: 5,
  }, scope)
  assert.equal(video.meta.resourceType, GEN_RESOURCE.SB_VIDEO)
  assert.equal(video.meta.label, '短剧A · 第3集 分镜视频 #7')

  const merge = buildEpisodeBackendTaskRecovery({ status: 'processing', type: 'video_merge', id: 't-merge' }, scope)
  assert.equal(merge.meta.resourceType, GEN_RESOURCE.EPISODE_MERGE)
  assert.equal(merge.meta.label, '短剧A · 第3集 合成视频')
  assert.equal(merge.meta.taskId, 't-merge')

  const story = buildStoryGenerationRecovery({ id: 't-story' }, scope)
  assert.equal(story.meta.resourceType, GEN_RESOURCE.GENERATE_STORY)
  assert.equal(story.meta.resourceId, 11)
  assert.equal(story.meta.label, '短剧A 生成剧本')
})

test('canceled 拼写视为取消，取消后不得再标成成功', () => {
  assert.equal(isCanceledTaskStatus('cancelled'), true)
  assert.equal(isCanceledTaskStatus('canceled'), true)
  assert.equal(isCanceledTaskStatus('cancelling'), false)
  assert.equal(isCanceledTaskStatus('completed'), false)
  assert.equal(isCanceledOrCancellingTaskStatus('cancelled'), true)
  assert.equal(isCanceledOrCancellingTaskStatus('canceled'), true)
  assert.equal(isCanceledOrCancellingTaskStatus('cancelling'), true)
  assert.equal(isCanceledOrCancellingTaskStatus('completed'), false)
  assert.equal(shouldPreserveCanceledTask('cancelled', 'completed'), true)
  assert.equal(shouldPreserveCanceledTask('canceled', 'completed'), true)
  assert.equal(shouldPreserveCanceledTask('cancelling', 'completed'), true)
  assert.equal(shouldPreserveCanceledTask('cancelled', 'cancelled'), false)
  assert.equal(shouldPreserveCanceledTask('running', 'completed'), false)

  assert.match(storeSource, /isCanceledTaskStatus\(remote\.status\)/)
  assert.match(storeSource, /isCanceledTaskStatus\(t\.status\)/)
  assert.match(storeSource, /shouldPreserveCanceledTask\(existing\.status, status\)/)
  const attach = remainingExtractNamedFunction(storeSource, 'attachPollIfNeeded')
  assert.match(attach, /isCanceledTaskStatus\(t\.status\)/)
  assert.match(attach, /status: 'cancelled'/)
})

function createGenStore() {
  setActivePinia(createPinia())
  return useGenerationTaskStore()
}

function sampleMeta(taskId = 'task-cancel-1') {
  return {
    dramaId: 1,
    episodeId: 2,
    resourceType: GEN_RESOURCE.SB_IMAGE,
    resourceId: 3,
    taskId,
  }
}

function readTask(store, meta) {
  return store.tasks.get(taskKey(meta))
}

async function withTaskGet(impl, run) {
  const original = taskAPI.get
  taskAPI.get = impl
  try {
    return await run()
  } finally {
    taskAPI.get = original
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForTaskStatus(store, meta, allowed, timeoutMs = 500) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const current = readTask(store, meta)
    if (current && allowed.includes(current.status)) return current
    await delay(5)
  }
  return readTask(store, meta)
}

test('远程 canceled/cancelled/cancelling 不得 markDone 为成功', async () => {
  for (const remoteStatus of ['canceled', 'cancelled', 'cancelling']) {
    await withTaskGet(async () => ({ status: remoteStatus, error: '用户已取消' }), async () => {
      const genStore = createGenStore()
      const meta = sampleMeta('reconcile-' + remoteStatus)
      genStore.markRunning(meta)
      await genStore.reconcileRunningTasks()
      const current = readTask(genStore, meta)
      assert.ok(current)
      assert.notEqual(current.status, 'completed')
      if (remoteStatus === 'cancelling') {
        assert.ok(['running', 'cancelling'].includes(current.status))
      } else {
        assert.equal(current.status, 'cancelled')
      }
    })
  }

  for (const remoteStatus of ['canceled', 'cancelled']) {
    await withTaskGet(async () => ({ status: remoteStatus, message: '用户已取消' }), async () => {
      const genStore = createGenStore()
      const meta = sampleMeta('poll-' + remoteStatus)
      let onDone = 0
      const result = await genStore.pollTask(meta.taskId, meta, async () => { onDone += 1 }, {
        interval: 0,
        maxAttempts: 3,
      })
      assert.equal(result.status, 'cancelled')
      assert.equal(onDone, 0)
      assert.equal(readTask(genStore, meta)?.status, 'cancelled')
    })
  }

  for (const remoteStatus of ['canceled', 'cancelled']) {
    await withTaskGet(async () => ({ status: remoteStatus, message: '用户已取消' }), async () => {
      const genStore = createGenStore()
      const meta = sampleMeta('attach-' + remoteStatus)
      genStore.markRunning(meta)
      let onDone = 0
      const result = await genStore.attachPollIfNeeded(meta.taskId, meta, async () => { onDone += 1 }, {
        interval: 0,
        maxAttempts: 3,
      })
      assert.equal(result.status, 'cancelled')
      assert.equal(onDone, 0)
      assert.notEqual(readTask(genStore, meta)?.status, 'completed')
    })
  }

  await withTaskGet(async () => ({ status: 'cancelling' }), async () => {
    const genStore = createGenStore()
    const meta = sampleMeta('poll-cancelling')
    let onDone = 0
    const pending = genStore.pollTask(meta.taskId, meta, async () => { onDone += 1 }, {
      interval: 5,
      maxAttempts: 40,
    })
    const current = await waitForTaskStatus(genStore, meta, ['cancelling'])
    assert.equal(current?.status, 'cancelling')
    assert.equal(onDone, 0)
    genStore.stopPollingTask(meta.taskId, '测试结束', 'cancelled')
    const result = await pending
    assert.notEqual(result.status, 'completed')
    assert.equal(onDone, 0)
  })

  await withTaskGet(async () => ({ status: 'cancelling' }), async () => {
    const genStore = createGenStore()
    const meta = sampleMeta('attach-cancelling')
    genStore.markRunning(meta)
    let onDone = 0
    const pending = genStore.attachPollIfNeeded(meta.taskId, meta, async () => { onDone += 1 }, {
      interval: 5,
      maxAttempts: 40,
    })
    const current = await waitForTaskStatus(genStore, meta, ['running', 'cancelling'])
    assert.ok(['running', 'cancelling'].includes(current?.status))
    assert.notEqual(current?.status, 'completed')
    assert.equal(onDone, 0)
    genStore.stopPollingTask(meta.taskId, '测试结束', 'cancelled')
    const result = await pending
    assert.notEqual(result.status, 'completed')
    assert.equal(onDone, 0)
  })
})

test('已取消任务后到 completed 仍保持取消', async () => {
  const genStore = createGenStore()
  const meta = sampleMeta('task-keep-cancel')
  genStore.markRunning(meta)
  genStore.stopPollingTask(meta.taskId, '用户已取消', 'cancelled')
  assert.equal(readTask(genStore, meta).status, 'cancelled')
  genStore.markDone(meta)
  assert.equal(readTask(genStore, meta).status, 'cancelled')

  let onDone = 0
  await withTaskGet(async () => ({ status: 'completed', result: { image_url: '/should-not-apply.png' } }), async () => {
    const result = await genStore.attachPollIfNeeded(meta.taskId, meta, async () => { onDone += 1 }, {
      interval: 0,
      maxAttempts: 3,
    })
    assert.equal(result.status, 'cancelled')
  })
  assert.equal(onDone, 0)
  assert.equal(readTask(genStore, meta).status, 'cancelled')
})

test('取消中任务随后 completed 也不得标成成功', async () => {
  let n = 0
  await withTaskGet(async () => {
    n += 1
    if (n === 1) return { status: 'cancelling' }
    return { status: 'completed', result: { image_url: '/should-not-apply.png' } }
  }, async () => {
    const genStore = createGenStore()
    const meta = sampleMeta('task-cancelling-then-completed')
    let onDone = 0
    const result = await genStore.pollTask(meta.taskId, meta, async () => { onDone += 1 }, {
      interval: 0,
      maxAttempts: 5,
    })
    assert.equal(result.status, 'cancelled')
    assert.equal(onDone, 0)
    assert.equal(readTask(genStore, meta)?.status, 'cancelled')
  })
})
