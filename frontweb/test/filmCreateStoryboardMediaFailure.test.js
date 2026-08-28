/** 分镜媒体失败链路：用真实 composable/util 覆盖失败、取消、缓存和 ID 不相等反例；Vue 接线只保留少量源码匹配。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ref } from 'vue'

import {
  createStoryboardMediaStateController,
  isStoryboardMediaStateError,
  submitStoryboardVideoAfterAccepted,
} from '../src/utils/storyboardMedia.js'
import { useFilmCreateActionDisabledReasons } from '../src/composables/filmCreate/useFilmCreateActionDisabledReasons.js'
import {
  DRAMA_ID,
  EPISODE_ID,
  MIXED_STORYBOARD_ID,
  OTHER_EPISODE_ID,
  STORYBOARD_ID,
  createBatch,
  createErrorMediaAssert,
  createImageGen,
  createLinked,
  createMediaHarness,
  createPipelineRun,
  createPipelineStages,
  createProjectLoadHarness,
  createRecovery,
  createRouteSyncHarness,
  createStoryboard,
  createVideoGen,
  failMediaImages,
  jsonResponse,
  primeMediaReady,
  stubFeedback,
} from './helpers/storyboardMediaFailureHarness.js'

const filmCreateSource = readFileSync(new URL('../src/views/FilmCreate.vue', import.meta.url), 'utf8')
const resourcePanelSource = readFileSync(new URL('../src/components/filmCreate/FilmCreateResourcePanel.vue', import.meta.url), 'utf8')

const originalFetch = globalThis.fetch
const originalConsoleError = console.error
const originalConsoleWarn = console.warn

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

test.before(() => {
  globalThis.fetch = async (input) => {
    throw new Error(`测试禁止真实网络请求：${String(input)}`)
  }
  console.error = () => {}
  console.warn = () => {}
})

test.after(() => {
  globalThis.fetch = originalFetch
  console.error = originalConsoleError
  console.warn = originalConsoleWarn
})

test('制作页仍把媒体失败横幅和关联重绘闸接到中文入口', () => {
  assert.match(
    filmCreateSource,
    /v-if="projectDependencyWarning \|\| storyboardMediaLoadError"[\s\S]*storyboardMediaLoadError[\s\S]*@click="retryProjectDependencies"/,
  )
  assert.match(
    resourcePanelSource,
    /<ActionGate :reason="storyboardMediaActionReason" label="重新生成关联分镜图">/,
  )
  assert.doesNotMatch(filmCreateSource, /let storyboardMediaLoadRequestId =/)
})

test('分镜媒体加载把缓存交给竞态控制器，且 dramaId 与 episodeId 不相等', async () => {
  const media = createMediaHarness()
  media.store.storyboards = [
    createStoryboard({ id: STORYBOARD_ID, episode_id: EPISODE_ID }),
    createStoryboard({ id: MIXED_STORYBOARD_ID, episode_id: DRAMA_ID, storyboard_number: 2 }),
  ]
  await primeMediaReady(media, [STORYBOARD_ID, MIXED_STORYBOARD_ID])
  assert.equal(media.api.storyboardMediaLoadState.value, 'ready')
  assert.equal(media.listCalls[0].payload.storyboard_id, STORYBOARD_ID)
  assert.notEqual(media.listCalls[0].payload.storyboard_id, DRAMA_ID)
  assert.equal(media.listCalls[0].context.projectId, DRAMA_ID)
  assert.equal(media.listCalls[0].context.episodeId, EPISODE_ID)
  assert.notEqual(media.listCalls[0].context.projectId, media.listCalls[0].context.episodeId)
  assert.equal(media.api.sbImages.value[STORYBOARD_ID][0].id, `img-${STORYBOARD_ID}`)

  const missing = await media.api.loadSingleStoryboardMedia(STORYBOARD_ID)
  assert.equal(missing.stale, true)
  const mixed = await media.api.loadSingleStoryboardMedia(
    MIXED_STORYBOARD_ID,
    media.api.currentStoryboardMediaContext(),
  )
  assert.equal(mixed.stale, true)

  media.api.resetStoryboardMediaContext(DRAMA_ID, OTHER_EPISODE_ID)
  const switched = await media.api.loadSingleStoryboardMedia(
    STORYBOARD_ID,
    { projectId: DRAMA_ID, episodeId: EPISODE_ID },
  )
  assert.equal(switched.stale, true)
})

test('取消中的媒体查询不记 unknown，失败保留缓存并用中文阻断计费', async () => {
  const media = createMediaHarness()
  await primeMediaReady(media)
  assert.equal(media.api.storyboardMediaLoadState.value, 'ready')

  const pending = { images: [], videos: [] }
  let imageRound = 0
  let videoRound = 0
  media.setImagesList(async () => {
    imageRound += 1
    if (imageRound === 1) {
      const hang = deferred()
      pending.images.push(hang)
      return hang.promise
    }
    return { items: [{ id: 'fresh-img' }] }
  })
  media.setVideosList(async () => {
    videoRound += 1
    if (videoRound === 1) {
      const hang = deferred()
      pending.videos.push(hang)
      return hang.promise
    }
    return { items: [{ id: 'fresh-vid' }] }
  })

  const first = media.api.loadStoryboardMedia()
  while (pending.images.length === 0 || pending.videos.length === 0) {
    await new Promise((resolve) => setImmediate(resolve))
  }
  const second = media.api.loadStoryboardMedia()
  await second
  pending.images[0].reject(new Error('aborted'))
  pending.videos[0].reject(new Error('aborted'))
  const firstResult = await first
  assert.equal(firstResult.stale, true)
  assert.equal(media.api.storyboardMediaLoadState.value, 'ready')
  assert.notEqual(media.api.storyboardMediaLoadState.value, 'unknown')
  assert.equal(media.api.sbImages.value[STORYBOARD_ID][0].id, 'fresh-img')

  const failed = await failMediaImages(media)
  assert.equal(failed.failedCount > 0, true)
  assert.equal(media.api.storyboardMediaLoadState.value, 'error')
  assert.equal(media.api.sbImages.value[STORYBOARD_ID][0].id, 'fresh-img')
  assert.match(media.api.storyboardMediaLoadError.value, /已保留上次成功读取的内容/)
  assert.match(media.api.storyboardMediaActionReason.value, /分镜图片或视频读取失败/)
  assert.throws(
    () => media.api.assertStoryboardMediaReady(),
    (error) => isStoryboardMediaStateError(error) && /请先重试加载素材/.test(error.message),
  )
  await assert.rejects(
    () => media.api.loadStoryboardMedia({ failClosed: true }),
    (error) => isStoryboardMediaStateError(error),
  )
  media.currentEpisodeId.value = OTHER_EPISODE_ID
  assert.match(media.api.storyboardMediaActionReason.value, /分镜图片和视频状态尚未就绪/)
})

test('付费入口在媒体失败时 fail closed，异步预检后会再检查一次', async () => {
  const feedback = stubFeedback()
  try {
    const media = createMediaHarness()
    await primeMediaReady(media)
    const reasons = useFilmCreateActionDisabledReasons({
      dramaId: ref(DRAMA_ID),
      currentEpisodeId: ref(EPISODE_ID),
      charactersGenerating: ref(false),
      propsExtracting: ref(false),
      scenesExtracting: ref(false),
      pipelineRunning: ref(false),
      storyboardMediaActionReason: media.api.storyboardMediaActionReason,
      productionReadinessReason: ref(''),
      storyboardGenerating: ref(false),
      universalOmniPolishRunning: ref(false),
      batchImageRunning: ref(false),
      batchVideoRunning: ref(false),
      videoCapabilityReason: ref(''),
      storyboards: ref(media.store.storyboards),
      assetVideoUrl: (url) => url,
      getSbVideo: () => '',
      videoStatus: ref('idle'),
    })
    await failMediaImages(media)
    assert.match(reasons.batchActionDisabledReason.value, /分镜图片或视频读取失败/)
    assert.match(reasons.productionPipelineActionDisabledReason.value, /分镜图片或视频读取失败/)

    const blockedBatch = createBatch({
      storyboardMediaActionReason: media.api.storyboardMediaActionReason,
    })
    await blockedBatch.api.startBatchImageGeneration()
    await blockedBatch.api.startBatchVideoGeneration()
    assert.equal(blockedBatch.imageCreates.length, 0)
    assert.equal(blockedBatch.videoCreates.length, 0)

    const blockedStages = createPipelineStages({
      storyboardMediaActionReason: media.api.storyboardMediaActionReason,
      executeOwnedPipelineRun: async () => {
        throw new Error('不应启动完整 pipeline')
      },
      confirmProductionPipelineCost: async () => {
        throw new Error('不应弹出计费确认')
      },
      refreshProductionReadiness: async () => {
        throw new Error('不应检查制作能力')
      },
    })
    await blockedStages.api.startOneClickPipeline()
    await blockedStages.api.startRepairPipeline()
    assert.equal(blockedStages.ownedRuns.length, 0)
    assert.match(feedback.last('warning').message, /分镜图片或视频读取失败/)

    const readyMedia = createMediaHarness()
    await primeMediaReady(readyMedia)
    const recheckBatch = createBatch({
      storyboardMediaActionReason: readyMedia.api.storyboardMediaActionReason,
      refreshVideoGenerationCapability: async () => {
        await failMediaImages(readyMedia)
        return { ready: true, config: { id: 1 } }
      },
    })
    await recheckBatch.api.startBatchVideoGeneration()
    assert.equal(recheckBatch.videoCreates.length, 0)
    assert.match(feedback.last('warning').message, /分镜图片或视频读取失败/)

    const pipelineMedia = createMediaHarness()
    await primeMediaReady(pipelineMedia)
    const recheckStages = createPipelineStages({
      storyboardMediaActionReason: pipelineMedia.api.storyboardMediaActionReason,
      refreshProductionReadiness: async () => {
        await failMediaImages(pipelineMedia)
        return { ready: true, reason: '' }
      },
      confirmProductionPipelineCost: async () => {
        throw new Error('不应弹出计费确认')
      },
      executeOwnedPipelineRun: async () => {
        throw new Error('不应启动完整 pipeline')
      },
    })
    await recheckStages.api.startOneClickPipeline()
    await recheckStages.api.startRepairPipeline()
    assert.equal(recheckStages.ownedRuns.length, 0)

    const confirmMedia = createMediaHarness()
    await primeMediaReady(confirmMedia)
    const confirmStages = createPipelineStages({
      storyboardMediaActionReason: confirmMedia.api.storyboardMediaActionReason,
      confirmProductionPipelineCost: async () => {
        await failMediaImages(confirmMedia)
        return true
      },
      executeOwnedPipelineRun: async () => {
        throw new Error('不应启动完整 pipeline')
      },
    })
    await confirmStages.api.startOneClickPipeline()
    await confirmStages.api.startRepairPipeline()
    assert.equal(confirmStages.ownedRuns.length, 0)

    const textStages = createPipelineStages({
      storyboardMediaActionReason: ref('分镜图片或视频读取失败，请先重试加载素材'),
    })
    await textStages.api.startTextFrameworkPipeline()
    assert.equal(textStages.ownedRuns.length, 1)
    assert.equal(textStages.ownedRuns[0].requireStoryboardMedia, undefined)

    const ownedStages = createPipelineStages({})
    await ownedStages.api.startOneClickPipeline()
    await ownedStages.api.startRepairPipeline()
    assert.equal(ownedStages.ownedRuns[0].requireStoryboardMedia, true)
    assert.equal(ownedStages.ownedRuns[1].requireStoryboardMedia, true)
  } finally {
    feedback.restore()
  }
})

test('批量 worker 与流水线重试遇到媒体失败会停，而不是聚合成普通失败', async () => {
  const feedback = stubFeedback()
  try {
    const blocked = createErrorMediaAssert()
    const failClosedLoads = []
    const emptyImages = createBatch({
      sbImages: ref({}),
      storyboardMediaActionReason: ref(''),
      loadStoryboardMedia: async (opts = {}) => {
        failClosedLoads.push(opts)
        if (opts.failClosed) blocked.assertReady()
        return { failedCount: 0 }
      },
    })
    await assert.rejects(
      () => emptyImages.api.startBatchImageGeneration(),
      (error) => isStoryboardMediaStateError(error),
    )
    assert.deepEqual(failClosedLoads, [{ failClosed: true }])
    assert.equal(emptyImages.imageCreates.length, 0)

    const worker = createBatch({
      storyboardMediaActionReason: ref(''),
      assertStoryboardMediaReady: () => blocked.assertReady(),
    })
    await assert.rejects(
      () => worker.api.startBatchImageGeneration(),
      (error) => isStoryboardMediaStateError(error),
    )
    assert.equal(worker.imageCreates.length, 0)
    assert.equal(worker.batchImageErrors.value.length, 0)

    const videoWorker = createBatch({
      storyboardMediaActionReason: ref(''),
      assertStoryboardMediaReady: () => blocked.assertReady(),
    })
    await assert.rejects(
      () => videoWorker.api.startBatchVideoGeneration(),
      (error) => isStoryboardMediaStateError(error),
    )
    assert.equal(videoWorker.videoCreates.length, 0)
    assert.equal(videoWorker.storyboardUpdates.length, 0)
    assert.equal(videoWorker.sbSelectedVideoId.value[STORYBOARD_ID], 99)
    assert.equal(videoWorker.batchVideoErrors.value.length, 0)

    const pipeline = createPipelineRun(ref(''))
    let retryCalls = 0
    await assert.rejects(
      () => pipeline.pipelineWithRetry('分镜图', async () => {
        retryCalls += 1
        blocked.assertReady()
      }),
      (error) => isStoryboardMediaStateError(error),
    )
    assert.equal(retryCalls, 1)
  } finally {
    feedback.restore()
  }
})

test('所有分镜 Provider 写入前都会同步断言，失败时不发起计费请求', async () => {
  const feedback = stubFeedback()
  try {
    const blocked = createErrorMediaAssert()
    const image = createImageGen({
      assertStoryboardMediaReady: () => blocked.assertReady(),
    })
    await image.api.onGenerateSbImage(image.sb)
    await image.api.onGenerateSbFrameImage(image.sb, 'first')
    assert.equal(image.createCalls.length, 0)
    assert.equal(image.updateCalls.length, 2)

    const video = createVideoGen({
      assertStoryboardMediaReady: () => blocked.assertReady(),
    })
    await video.api.onGenerateSbVideo(video.sb)
    assert.equal(video.createCalls.length, 0)
    assert.equal(video.updateCalls.length, 0)
    assert.equal(video.sbSelectedVideoId.value[STORYBOARD_ID], 99)

    const linked = createLinked({
      assertStoryboardMediaReady: () => blocked.assertReady(),
    })
    await linked.api.onRegenAffectedSbImages('char-5', [createStoryboard()])
    assert.equal(linked.createCalls.length, 0)

    const imageStages = createPipelineStages({
      storyboardMediaActionReason: ref(''),
      assertStoryboardMediaReady: () => blocked.assertReady(),
      executeOwnedPipelineRun: async (run) => run(),
      hasSbImage: () => false,
    })
    await imageStages.api.runOneClickPipeline(false)
    assert.equal(imageStages.imageCreates.length, 0)
    assert.equal(imageStages.videoCreates.length, 0)
    assert.match(imageStages.errors.at(-1).message, /读取失败|尚未就绪|请先重试加载素材/)

    const videoStages = createPipelineStages({
      storyboardMediaActionReason: ref(''),
      assertStoryboardMediaReady: () => blocked.assertReady(),
      executeOwnedPipelineRun: async (run) => run(),
      hasSbImage: () => true,
    })
    await videoStages.api.runOneClickPipeline(false)
    assert.equal(videoStages.videoCreates.length, 0)

    const repairStages = createPipelineStages({
      storyboardMediaActionReason: ref(''),
      assertStoryboardMediaReady: () => blocked.assertReady(),
      executeOwnedPipelineRun: async (run) => run(),
      hasSbImage: () => false,
    })
    await repairStages.api.runRepairPipeline()
    assert.equal(repairStages.imageCreates.length, 0)
    assert.equal(repairStages.videoCreates.length, 0)

    const repairVideoStages = createPipelineStages({
      storyboardMediaActionReason: ref(''),
      assertStoryboardMediaReady: () => blocked.assertReady(),
      executeOwnedPipelineRun: async (run) => run(),
      hasSbImage: () => true,
    })
    await repairVideoStages.api.runRepairPipeline()
    assert.equal(repairVideoStages.videoCreates.length, 0)
  } finally {
    feedback.restore()
  }
})

test('关联分镜重绘在入口、确认后和循环内都会阻断，媒体错误不计入普通失败', async () => {
  const feedback = stubFeedback()
  try {
    const blocked = createErrorMediaAssert()
    const boards = [
      createStoryboard({ storyboard_number: 1 }),
      createStoryboard({ id: STORYBOARD_ID + 1, storyboard_number: 2 }),
    ]

    const entry = createLinked({
      assertStoryboardMediaReady: () => blocked.assertReady(),
    })
    await entry.api.onRegenAffectedSbImages('char-5', boards)
    assert.equal(entry.createCalls.length, 0)
    assert.equal(feedback.messages.filter((item) => item.type === 'confirm').length, 0)

    let readyCalls = 0
    const afterConfirm = createLinked({
      assertStoryboardMediaReady() {
        readyCalls += 1
        if (readyCalls >= 2) blocked.assertReady()
      },
    })
    await afterConfirm.api.onRegenAffectedSbImages('char-5', boards)
    assert.equal(afterConfirm.createCalls.length, 0)
    assert.equal(feedback.last('confirm') != null, true)

    readyCalls = 0
    const inLoop = createLinked({
      assertStoryboardMediaReady() {
        readyCalls += 1
        if (readyCalls >= 3) blocked.assertReady()
      },
    })
    await inLoop.api.onRegenAffectedSbImages('char-5', boards)
    assert.equal(inLoop.createCalls.length, 0)

    readyCalls = 0
    const secondBoard = createLinked({
      assertStoryboardMediaReady() {
        readyCalls += 1
        if (readyCalls >= 4) blocked.assertReady()
      },
    })
    await secondBoard.api.onRegenAffectedSbImages('char-5', boards)
    assert.equal(secondBoard.createCalls.length, 1)
    assert.equal(secondBoard.createCalls[0].drama_id, DRAMA_ID)
    assert.notEqual(secondBoard.createCalls[0].drama_id, EPISODE_ID)
    assert.equal(secondBoard.regenSbImagesForAsset.size, 0)
    assert.match(feedback.last('warning').message, /读取失败|尚未就绪|请先重试加载素材/)
  } finally {
    feedback.restore()
  }
})

test('单条生图轮询和任务恢复都捕获原始上下文，切集后视为 stale', async () => {
  const feedback = stubFeedback()
  try {
    const media = createMediaHarness()
    await primeMediaReady(media)
    let doneResult
    const image = createImageGen({
      assertStoryboardMediaReady: () => media.api.assertStoryboardMediaReady(),
      storyboardMediaActionReason: media.api.storyboardMediaActionReason,
      captureStoryboardMediaRefresh: media.api.captureStoryboardMediaRefresh,
      pollTask: async (taskId, onDone, meta) => {
        assert.equal(meta.dramaId, DRAMA_ID)
        assert.equal(meta.episodeId, EPISODE_ID)
        assert.notEqual(meta.dramaId, meta.episodeId)
        media.currentEpisodeId.value = OTHER_EPISODE_ID
        media.api.resetStoryboardMediaContext(DRAMA_ID, OTHER_EPISODE_ID)
        doneResult = await onDone()
        return { status: 'completed' }
      },
    })
    await image.api.onGenerateSbImage(image.sb)
    assert.equal(image.createCalls[0].drama_id, DRAMA_ID)
    assert.notEqual(image.createCalls[0].drama_id, EPISODE_ID)
    assert.equal(doneResult.stale, true)

    const recoveryMedia = createMediaHarness()
    await primeMediaReady(recoveryMedia)
    let recovered
    const recovery = createRecovery(recoveryMedia, {
      async onRecover(payload) {
        recoveryMedia.currentEpisodeId.value = OTHER_EPISODE_ID
        recoveryMedia.api.resetStoryboardMediaContext(DRAMA_ID, OTHER_EPISODE_ID)
        recovered = await payload.callbacks.onStoryboardMedia(STORYBOARD_ID)
        await payload.callbacks.onDramaRefresh()
      },
    })
    await recovery.api.recoverAndSyncEpisodeTasks(EPISODE_ID)
    assert.equal(recovered.stale, true)
    assert.equal(recoveryMedia.loadDramaCalls[0].expectedContext.projectId, DRAMA_ID)
    assert.equal(recoveryMedia.loadDramaCalls[0].expectedContext.episodeId, EPISODE_ID)
    assert.notEqual(recoveryMedia.loadDramaCalls[0].expectedContext.episodeId, OTHER_EPISODE_ID)
  } finally {
    feedback.restore()
  }
})

test('项目加载先对齐当前集上下文再请求媒体，切集和路由会重置控制器', async () => {
  const feedback = stubFeedback()
  try {
    const media = createMediaHarness()
    media.api.resetStoryboardMediaContext(DRAMA_ID, OTHER_EPISODE_ID)
    const load = createProjectLoadHarness(media)
    globalThis.fetch = async (url) => {
      assert.match(String(url), /\/api\/v1\/dramas\/11$/)
      assert.doesNotMatch(String(url), /\/dramas\/22/)
      return jsonResponse(200, {
        success: true,
        data: {
          id: DRAMA_ID,
          title: '项目甲',
          genre: '都市',
          style: 'realistic',
          metadata: {
            style_prompt_en: 'photorealistic keep',
            story_generation_draft: '项目草稿',
          },
          episodes: [
            {
              id: DRAMA_ID,
              episode_number: 1,
              title: '串数据集',
              script_content: '不该被选中',
              storyboards: [{ id: MIXED_STORYBOARD_ID, episode_id: DRAMA_ID }],
            },
            {
              id: EPISODE_ID,
              episode_number: 2,
              title: '正确集',
              script_content: '正确剧本',
              storyboards: [{ id: STORYBOARD_ID, episode_id: EPISODE_ID }],
            },
          ],
        },
      })
    }
    const result = await load.api.loadDrama()
    assert.equal(result, true)
    const ensureIdx = load.contextEvents.findIndex((event) => event.type === 'ensure')
    const mediaIdx = load.contextEvents.findIndex((event) => event.type === 'media')
    assert.ok(ensureIdx >= 0)
    assert.ok(mediaIdx > ensureIdx)
    assert.equal(load.contextEvents[mediaIdx].context.projectId, DRAMA_ID)
    assert.equal(load.contextEvents[mediaIdx].context.episodeId, EPISODE_ID)
    assert.notEqual(load.contextEvents[mediaIdx].context.projectId, load.contextEvents[mediaIdx].context.episodeId)
    assert.equal(media.listCalls[0].context.episodeId, EPISODE_ID)
    assert.equal(media.listCalls[0].payload.storyboard_id, STORYBOARD_ID)

    load.api.applySelectedEpisode({
      id: OTHER_EPISODE_ID,
      title: '另一集',
      script_content: '另一集剧本',
    })
    assert.equal(media.api.storyboardMediaStateController.getSnapshot().context.episodeId, OTHER_EPISODE_ID)
    assert.notEqual(media.api.storyboardMediaStateController.getSnapshot().context.episodeId, DRAMA_ID)

    const routed = createMediaHarness()
    await primeMediaReady(routed)
    const { scope, sync } = createRouteSyncHarness(routed)
    try {
      sync.applyRouteToStore()
      const ctx = routed.api.storyboardMediaStateController.getSnapshot().context
      assert.equal(ctx.projectId, DRAMA_ID)
      assert.equal(ctx.episodeId, null)
    } finally {
      scope.stop()
    }
  } finally {
    feedback.restore()
    globalThis.fetch = async (input) => {
      throw new Error(`测试禁止真实网络请求：${String(input)}`)
    }
  }
})

test('流水线 requireStoryboardMedia 时暂停检查会阻断，纯文本框架不会', async () => {
  const reason = ref('分镜图片或视频读取失败，请先重试加载素材')
  const required = createPipelineRun(reason)
  await assert.rejects(
    () => required.executeOwnedPipelineRun(async () => {
      await required.checkPause()
    }, { requireStoryboardMedia: true }),
    (error) => /分镜图片或视频读取失败/.test(error.message),
  )

  const optional = createPipelineRun(reason)
  let ran = false
  await optional.executeOwnedPipelineRun(async () => {
    await optional.checkPause()
    ran = true
  })
  assert.equal(ran, true)

  const feedback = stubFeedback()
  try {
    const stages = createPipelineStages({
      storyboardMediaActionReason: reason,
      executeOwnedPipelineRun: async (run) => run(),
    })
    await stages.api.runOneClickPipeline(false)
    assert.match(stages.errors[0].message, /分镜图片或视频读取失败/)
    assert.equal(stages.imageCreates.length, 0)

    const repair = createPipelineStages({
      storyboardMediaActionReason: ref(''),
      loadDrama: async () => {
        repair.storyboardMediaActionReason.value = '分镜图片或视频读取失败，请先重试加载素材'
      },
      executeOwnedPipelineRun: async (run) => run(),
    })
    await repair.api.runRepairPipeline()
    assert.match(repair.errors[0].message, /分镜图片或视频读取失败/)
    assert.equal(repair.imageCreates.length, 0)

    const textOnly = createPipelineStages({
      storyboardMediaActionReason: reason,
      executeOwnedPipelineRun: async (run) => run(),
    })
    await textOnly.api.runOneClickPipeline(true)
    assert.equal(textOnly.imageCreates.length, 0)
    assert.equal(textOnly.errors.length, 0)
    assert.match(feedback.last('success').message, /文本框架/)
  } finally {
    feedback.restore()
  }
})

test('a late media failure leaves the selected video untouched and prevents all writes', async () => {
  const context = { projectId: 7, episodeId: 71 }
  const controller = createStoryboardMediaStateController()
  controller.setContext(context)
  const initial = controller.beginFull([101])
  for (const request of initial) controller.commitSuccess(request, [])

  let providerWrites = 0
  let backendClearWrites = 0
  let selectedVideoId = 99
  let releaseSubmission
  const submissionGate = new Promise((resolve) => { releaseSubmission = resolve })
  const submission = submitStoryboardVideoAfterAccepted({
    createVideo: async () => {
      await submissionGate
      controller.assertReady(context)
      providerWrites += 1
      return { task_id: 'should-not-exist' }
    },
    clearSelection: () => { selectedVideoId = null },
    clearPersistedSelection: async () => { backendClearWrites += 1 },
  })

  const lateRefresh = controller.beginSingle(101, {
    expectedContext: context,
    storyboardIds: [101],
  })
  controller.commitFailure(
    lateRefresh.find((request) => request.endpoint === 'images'),
    new Error('late image failure'),
  )
  controller.commitSuccess(
    lateRefresh.find((request) => request.endpoint === 'videos'),
    [],
  )
  releaseSubmission()

  await assert.rejects(submission, (error) => isStoryboardMediaStateError(error))
  assert.equal(providerWrites, 0)
  assert.equal(backendClearWrites, 0)
  assert.equal(selectedVideoId, 99)
})

test('media query cancellation is not recorded as unknown and keeps cached items', () => {
  const dramaId = 11
  const episodeId = 22
  assert.notEqual(dramaId, episodeId)
  const controller = createStoryboardMediaStateController()
  controller.setContext({ projectId: dramaId, episodeId })
  const first = controller.beginFull([101])
  for (const request of first) controller.commitSuccess(request, [{ id: 'cached' }])
  assert.equal(controller.getSnapshot().status, 'ready')
  assert.equal(controller.getSnapshot().media.images[101][0].id, 'cached')

  const firstRefresh = controller.beginFull([101])
  const secondRefresh = controller.beginFull([101])
  assert.equal(controller.commitFailure(firstRefresh.find((request) => request.endpoint === 'images')), false)
  for (const request of secondRefresh) controller.commitSuccess(request, [{ id: 'fresh' }])
  assert.equal(controller.getSnapshot().status, 'ready')
  assert.equal(controller.getSnapshot().media.images[101][0].id, 'fresh')
})

test('unknown media blocks paid writes with Chinese reason and preserves cache on failure', () => {
  const dramaId = 11
  const episodeId = 22
  assert.notEqual(dramaId, episodeId)
  const controller = createStoryboardMediaStateController()
  controller.setContext({ projectId: dramaId, episodeId })
  const first = controller.beginFull([7])
  for (const request of first) controller.commitSuccess(request, [{ id: 'keep' }])

  const refresh = controller.beginFull([7])
  controller.commitFailure(refresh.find((request) => request.endpoint === 'images'))
  controller.commitSuccess(refresh.find((request) => request.endpoint === 'videos'), [{ id: 'v1' }])
  assert.equal(controller.getSnapshot().status, 'error')
  assert.equal(controller.getSnapshot().media.images[7][0].id, 'keep')
  assert.match(controller.actionReason({ projectId: dramaId, episodeId }), /分镜图片或视频读取失败/)
  assert.throws(
    () => controller.assertReady({ projectId: dramaId, episodeId }),
    (error) => isStoryboardMediaStateError(error) && /请先重试加载素材/.test(error.message),
  )
  assert.match(controller.actionReason({ projectId: dramaId, episodeId: 99 }), /分镜图片和视频状态尚未就绪/)
})
