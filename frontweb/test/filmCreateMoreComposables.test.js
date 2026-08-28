import test from 'node:test'
import assert from 'node:assert/strict'

import { effectScope, nextTick, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'

import { useFilmCreateProjectLoad } from '../src/composables/filmCreate/useFilmCreateProjectLoad.js'
import { useFilmCreateRouteSync } from '../src/composables/filmCreate/useFilmCreateRouteSync.js'
import { useFilmCreateBatchGeneration } from '../src/composables/filmCreate/useFilmCreateBatchGeneration.js'
import { useFilmCreateEpisodeCompose } from '../src/composables/filmCreate/useFilmCreateEpisodeCompose.js'
import { useFilmCreateResourceGenerate } from '../src/composables/filmCreate/useFilmCreateResourceGenerate.js'
import { useFilmCreateMediaPreview } from '../src/composables/filmCreate/useFilmCreateMediaPreview.js'
import { useFilmCreateScriptPersistence } from '../src/composables/filmCreate/useFilmCreateScriptPersistence.js'
import { useFilmCreateUniversalSegment } from '../src/composables/filmCreate/useFilmCreateUniversalSegment.js'
import {
  batchGenerationDisabledReason,
  composeVideoDisabledReason,
} from '../src/utils/filmCreateActionState.js'
import { trackFilmCreateAction } from '../src/utils/filmCreateActionLog.js'
import {
  getOperationLogs,
  installOperationLogSink,
  resetOperationLogs,
} from '../src/utils/operationLog.js'

const DRAMA_ID = 11
const EPISODE_ID = 22
const OTHER_EPISODE_ID = 33
const STORYBOARD_ID = 77

const originalFetch = globalThis.fetch
const originalImage = globalThis.Image

function refOf(value) {
  return { value }
}

function assertDistinctIds(dramaId, episodeId) {
  assert.notEqual(dramaId, episodeId)
}

function assertChinese(text) {
  assert.match(String(text || ''), /[\u4e00-\u9fff]/)
}

function forbiddenApi(name) {
  return new Proxy({}, {
    get(_target, prop) {
      return async () => {
        throw new Error(`${name}.${String(prop)} 不应被调用`)
      }
    },
  })
}

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function stubElementPlusFeedback() {
  const messages = []
  const originals = {
    warning: ElMessage.warning,
    error: ElMessage.error,
    success: ElMessage.success,
    info: ElMessage.info,
  }
  const record = (type) => (message) => {
    messages.push({ type, message })
    return { close() {} }
  }
  ElMessage.warning = record('warning')
  ElMessage.error = record('error')
  ElMessage.success = record('success')
  ElMessage.info = record('info')
  return {
    messages,
    last(type) {
      return messages.filter((item) => item.type === type).at(-1)
    },
    restore() {
      ElMessage.warning = originals.warning
      ElMessage.error = originals.error
      ElMessage.success = originals.success
      ElMessage.info = originals.info
    },
  }
}

function createStore(overrides = {}) {
  const store = {
    dramaId: DRAMA_ID,
    drama: null,
    currentEpisode: null,
    scriptContent: '',
    storyboards: [],
    props: [],
    setDrama(drama) {
      store.drama = drama
      if (drama?.id != null) store.dramaId = drama.id
    },
    setCurrentEpisode(episode) {
      store.currentEpisode = episode
    },
    setScriptContent(content) {
      store.scriptContent = content
    },
    reset() {
      store.dramaId = null
      store.drama = null
      store.currentEpisode = null
      store.scriptContent = ''
      store.storyboards = []
    },
    setVideoStatus() {},
    setVideoProgress() {},
    getVideoStatus() { return 'idle' },
    ...overrides,
  }
  return store
}

test.beforeEach(() => {
  globalThis.fetch = async (url) => {
    throw new Error(`不应请求 ${String(url)}`)
  }
})

test.afterEach(() => {
  globalThis.fetch = originalFetch
  globalThis.Image = originalImage
})

function createProjectLoad(overrides = {}) {
  assertDistinctIds(DRAMA_ID, EPISODE_ID)
  const recoverCalls = []
  const contextCalls = []
  const store = overrides.store || createStore()
  const projectLoadError = overrides.projectLoadError || refOf('')
  const projectLoadNotFound = overrides.projectLoadNotFound || refOf(false)
  const projectLoadState = overrides.projectLoadState || refOf('idle')
  const scriptTitle = overrides.scriptTitle || refOf('')
  const selectedEpisodeId = overrides.selectedEpisodeId || refOf(EPISODE_ID)
  const api = useFilmCreateProjectLoad({
    store,
    dramaId: overrides.dramaId || refOf(DRAMA_ID),
    currentEpisodeId: overrides.currentEpisodeId || refOf(EPISODE_ID),
    projectLifecycle: { guardApi(next) { return next } },
    episodeSwitchController: {
      async select(id) { return { changed: true, episode: { id } } },
    },
    syncEpisodeRouteQuery() {},
    resetStoryboardMediaContext() {},
    ensureStoryboardMediaContext(dramaId, episodeId) {
      contextCalls.push({ dramaId, episodeId })
    },
    storyboardMediaStateController: { isCurrentContext() { return true } },
    syncStoryboardStateFromEpisode() {},
    markScriptDraftSaved() {},
    loadStoryboardMedia: async () => ({}),
    recoverAndSyncEpisodeTasks: async (episodeId) => { recoverCalls.push(episodeId) },
    loadPipelineConcurrency: async () => {},
    refreshVideoGenerationCapability: async () => ({}),
    refreshProductionReadiness: async () => ({}),
    scriptTitle,
    selectedEpisodeId,
    savedCurrentEpisodeNumber: refOf(2),
    storyInput: refOf(''),
    storyStyle: refOf(''),
    storyType: refOf(''),
    generationStyle: refOf(''),
    projectAspectRatio: refOf('16:9'),
    videoClipDuration: refOf(5),
    storyboardIncludeNarration: refOf(false),
    storyboardUniversalOmni: refOf(false),
    storyboardUseFirstLastFrame: refOf(false),
    lastFrameUseFirstLayoutLock: refOf(true),
    gridMode: refOf('grid'),
    projectLoadState,
    projectLoadPending: refOf(false),
    projectLoadError,
    projectLoadNotFound,
    projectDependencyWarning: refOf(''),
    projectDependencyLoading: refOf(false),
    projectLoadFailureRef: refOf({ focus() {} }),
    scriptDraftController: { dispose() {} },
    ...overrides.deps,
  })
  return {
    api,
    store,
    recoverCalls,
    contextCalls,
    projectLoadError,
    projectLoadNotFound,
    projectLoadState,
    scriptTitle,
    selectedEpisodeId,
  }
}

test('project load skips the request without dramaId and reports a Chinese 404', async () => {
  const feedback = stubElementPlusFeedback()
  const fetchCalls = []
  try {
    const missing = createProjectLoad({ store: createStore({ dramaId: null }) })
    const skipped = await missing.api.loadDrama()
    assert.equal(skipped, false)
    assert.equal(fetchCalls.length, 0)

    globalThis.fetch = async (url, init = {}) => {
      fetchCalls.push({ url: String(url), method: init.method || 'GET' })
      return jsonResponse(404, { success: false })
    }
    const failed = createProjectLoad()
    const result = await failed.api.loadDrama()
    assert.equal(result, false)
    assert.equal(fetchCalls.length, 1)
    assert.match(fetchCalls[0].url, /\/api\/v1\/dramas\/11$/)
    assert.doesNotMatch(fetchCalls[0].url, /\/dramas\/22/)
    assert.equal(failed.projectLoadNotFound.value, true)
    assert.equal(failed.projectLoadError.value, '该项目不存在，或已移入回收站。')
    assertChinese(failed.projectLoadError.value)
    assert.equal(failed.store.drama.id, DRAMA_ID)
    assert.notEqual(failed.store.drama.id, EPISODE_ID)
  } finally {
    feedback.restore()
  }
})

test('project load keeps dramaId and episodeId from mixing when they differ', async () => {
  const feedback = stubElementPlusFeedback()
  const fetchCalls = []
  try {
    globalThis.fetch = async (url) => {
      fetchCalls.push(String(url))
      assert.match(String(url), /\/dramas\/11/)
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
            story_style: '轻松',
            aspect_ratio: '16:9',
            video_clip_duration: 8,
          },
          episodes: [
            { id: DRAMA_ID, episode_number: 1, title: '串数据集', script_content: '不该被选中' },
            { id: EPISODE_ID, episode_number: 2, title: '正确集', script_content: '正确剧本' },
          ],
        },
      })
    }
    const loaded = createProjectLoad()
    const result = await loaded.api.loadDrama()
    assert.equal(result, true)
    assert.equal(loaded.store.drama.id, DRAMA_ID)
    assert.equal(loaded.store.currentEpisode.id, EPISODE_ID)
    assert.notEqual(loaded.store.currentEpisode.id, loaded.store.drama.id)
    assert.equal(loaded.scriptTitle.value, '正确集')
    assert.equal(loaded.store.scriptContent, '正确剧本')
    assert.equal(loaded.selectedEpisodeId.value, EPISODE_ID)
    assert.deepEqual(loaded.recoverCalls, [EPISODE_ID])
    assert.deepEqual(loaded.contextCalls, [{ dramaId: DRAMA_ID, episodeId: EPISODE_ID }])
    assert.equal(fetchCalls.some((url) => url.includes(`/dramas/${EPISODE_ID}`)), false)
  } finally {
    feedback.restore()
  }
})

function createRouteSync(overrides = {}) {
  const replaces = []
  const selects = []
  const loadCalls = []
  const selectedEpisodeId = overrides.selectedEpisodeId || ref(EPISODE_ID)
  const dramaId = overrides.dramaId || ref(DRAMA_ID)
  const route = overrides.route || reactive({
    params: { id: String(DRAMA_ID) },
    query: { episode: String(EPISODE_ID) },
  })
  const store = overrides.store || createStore()
  const sync = useFilmCreateRouteSync({
    route,
    router: {
      replace(target) {
        replaces.push(target)
        return Promise.resolve()
      },
    },
    store,
    dramaId,
    invalidateProjectLoads() {},
    resetStoryboardMediaContext() {},
    loadDrama(options) {
      loadCalls.push({
        options,
        dramaId: store.dramaId,
        selectedEpisodeId: selectedEpisodeId.value,
      })
    },
    projectLoadError: refOf(''),
    projectLoadNotFound: refOf(false),
    projectDependencyWarning: refOf(''),
    projectLoadPending: refOf(false),
    projectDependencyLoading: refOf(false),
    projectLoadState: refOf('idle'),
    selectedEpisodeId,
    savedCurrentEpisodeNumber: refOf(1),
    storyInput: refOf(''),
    scriptTitle: refOf(''),
    storyStyle: refOf(''),
    storyType: refOf(''),
    scriptLanguage: refOf('zh'),
    scriptStoryboardStyle: refOf(''),
    generationStyle: refOf(''),
    markScriptDraftSaved() {},
    onEpisodeSelect(id) { selects.push(id) },
    ...overrides.deps,
  })
  return { sync, replaces, selects, loadCalls, selectedEpisodeId, dramaId, route, store }
}

test('route sync updates the query when the current episode differs', async () => {
  assertDistinctIds(DRAMA_ID, EPISODE_ID)
  const scope = effectScope()
  try {
    const ctx = scope.run(() => createRouteSync({
      route: reactive({
        params: { id: String(DRAMA_ID) },
        query: { episode: String(DRAMA_ID), tab: 'script' },
      }),
    }))
    ctx.sync.syncEpisodeRouteQuery(EPISODE_ID)
    assert.equal(ctx.replaces.length, 1)
    assert.equal(ctx.replaces[0].query.episode, String(EPISODE_ID))
    assert.notEqual(ctx.replaces[0].query.episode, String(DRAMA_ID))
    assert.equal(ctx.replaces[0].query.tab, 'script')

    ctx.sync.syncEpisodeRouteQuery(EPISODE_ID)
    assert.equal(ctx.replaces.length, 2)
    assert.equal(ctx.replaces[1].query.episode, String(EPISODE_ID))

    ctx.route.query.episode = String(OTHER_EPISODE_ID)
    await nextTick()
    await nextTick()
    assert.deepEqual(ctx.selects, [OTHER_EPISODE_ID])
    assert.notEqual(OTHER_EPISODE_ID, ctx.selectedEpisodeId.value)
  } finally {
    scope.stop()
  }
})

function createBatchGeneration(overrides = {}) {
  const imageCreates = []
  const batchImageStopping = overrides.batchImageStopping || refOf(false)
  const storyboardMediaActionReason = overrides.storyboardMediaActionReason || refOf('')
  const api = useFilmCreateBatchGeneration({
    currentEpisodeId: overrides.currentEpisodeId || refOf(EPISODE_ID),
    dramaId: overrides.dramaId || refOf(DRAMA_ID),
    store: overrides.store || createStore({
      storyboards: overrides.storyboards || [],
    }),
    pipelineRunning: refOf(false),
    pipelineConcurrency: refOf(overrides.concurrency || 1),
    pipelineVideoConcurrency: refOf(1),
    storyboardMediaActionReason,
    batchImageRunning: refOf(false),
    batchImageStopping,
    batchImageErrors: refOf([]),
    batchImageProgress: refOf({ current: 0, total: 0, failed: 0 }),
    batchVideoRunning: refOf(false),
    batchVideoStopping: refOf(false),
    batchVideoErrors: refOf([]),
    batchVideoProgress: refOf({ current: 0, total: 0, failed: 0 }),
    sbImages: refOf(overrides.sbImages || { keep: [] }),
    sbVideos: refOf(overrides.sbVideos || { keep: [] }),
    sbSelectedImgId: refOf({}),
    sbSelectedVideoId: refOf({}),
    gridMode: refOf('single'),
    storyboardUseFirstLastFrame: refOf(false),
    videoFrameContiguity: refOf(false),
    projectAspectRatio: refOf('16:9'),
    videoResolution: refOf('720p'),
    generatingSbVideoIds: new Set(),
    loadStoryboardMedia: async () => {
      throw new Error('loadStoryboardMedia 不应被调用')
    },
    hasSbImage: overrides.hasSbImage || (() => true),
    isSbUniversalMode: () => false,
    ensureProfessionalFramePrompt: async () => {
      throw new Error('ensureProfessionalFramePrompt 不应被调用')
    },
    assertStoryboardMediaReady() {},
    imagesAPI: overrides.imagesAPI || {
      async create(payload) {
        imageCreates.push(payload)
        return { task_id: `img-${payload.storyboard_id}` }
      },
    },
    videosAPI: forbiddenApi('videosAPI'),
    storyboardsAPI: forbiddenApi('storyboardsAPI'),
    uploadAPI: forbiddenApi('uploadAPI'),
    pollTask: async () => ({ status: 'completed' }),
    captureStoryboardMediaRefresh: () => async () => {},
    refreshStoryboardMediaForCurrentContext: async () => {},
    restoreSelectionsFromBackend() {},
    getSelectedStyle: () => 'realistic',
    getSbVideoReferenceGrid: () => null,
    sbCanSubmitVideo: () => false,
    getSbFirstFrameUrl: () => '',
    collectSbSceneOnlyReferenceAbsoluteUrls: () => [],
    collectSbOmniReferenceAbsoluteUrls: () => [],
    getSbPrimaryReferenceAbsoluteUrl: () => '',
    toAbsoluteImageUrl: (url) => url,
    assetImageUrl: () => '',
    recordHasPlayableVideoUrl: () => false,
    buildStoryboardVideoReferencePayload: async () => ({}),
    buildSbVideoPromptForApi: () => '',
    getSbVideoDurationForApi: () => 5,
    captureVideoLastFrame: async () => null,
    buildSbGenMeta: () => ({}),
    refreshVideoGenerationCapability: overrides.refreshVideoGenerationCapability || (async () => ({
      ready: true,
      config: { id: 1 },
    })),
    canUseUniversalOmniVideoApi: () => false,
    ...overrides.deps,
  })
  return { api, imageCreates, batchImageStopping, storyboardMediaActionReason }
}

test('batch generation reports Chinese empty-list and disable reasons', async () => {
  const feedback = stubElementPlusFeedback()
  try {
    const empty = createBatchGeneration({
      store: createStore({ storyboards: [] }),
    })
    await empty.api.startBatchImageGeneration()
    assert.equal(empty.imageCreates.length, 0)
    assert.equal(feedback.last('info').message, '所有分镜均已有图片，无需重新生成')
    assertChinese(feedback.last('info').message)

    await empty.api.startBatchVideoGeneration()
    assert.equal(feedback.last('info').message, '没有需要生成视频的分镜（分镜缺少图片，或视频已全部生成）')
    assertChinese(feedback.last('info').message)

    const disabledReason = batchGenerationDisabledReason({
      hasEpisode: false,
      pipelineRunning: false,
      storyboardGenerating: false,
      omniPolishing: false,
      batchImageRunning: false,
      batchVideoRunning: false,
    })
    const disabled = createBatchGeneration({
      storyboardMediaActionReason: refOf(disabledReason),
      imagesAPI: forbiddenApi('imagesAPI'),
    })
    await disabled.api.startBatchImageGeneration()
    assert.equal(feedback.last('warning').message, '请先创建或选择剧集')
    assertChinese(feedback.last('warning').message)
    assert.equal(disabled.imageCreates.length, 0)
  } finally {
    feedback.restore()
  }
})

test('batch generation cancel stops the queue and keeps dramaId off the episode id', async () => {
  assertDistinctIds(DRAMA_ID, EPISODE_ID)
  const feedback = stubElementPlusFeedback()
  const batchImageStopping = refOf(false)
  const imageCreates = []
  try {
    const batch = createBatchGeneration({
      storyboards: [
        { id: STORYBOARD_ID, storyboard_number: 1, image_prompt: '镜头一' },
        { id: STORYBOARD_ID + 1, storyboard_number: 2, image_prompt: '镜头二' },
      ],
      hasSbImage: () => false,
      concurrency: 1,
      batchImageStopping,
      imagesAPI: {
        async create(payload) {
          imageCreates.push(payload)
          batchImageStopping.value = true
          return { task_id: `img-${payload.storyboard_id}` }
        },
      },
    })
    await batch.api.startBatchImageGeneration()
    assert.equal(imageCreates.length, 1)
    assert.equal(imageCreates[0].drama_id, DRAMA_ID)
    assert.notEqual(imageCreates[0].drama_id, EPISODE_ID)
    assert.equal(imageCreates[0].storyboard_id, STORYBOARD_ID)
    assert.equal(feedback.last('info').message, '批量生成已停止')
    assertChinese(feedback.last('info').message)
  } finally {
    feedback.restore()
  }
})

test('episode compose stays blocked without playable storyboard videos', async () => {
  const feedback = stubElementPlusFeedback()
  const finalizeCalls = []
  try {
    const reason = composeVideoDisabledReason({
      hasEpisode: true,
      storyboardCount: 3,
      playableVideoCount: 0,
      videoGenerating: false,
      pipelineRunning: false,
      storyboardGenerating: false,
      omniPolishing: false,
      batchImageRunning: false,
      batchVideoRunning: false,
    })
    assert.match(reason, /请先为全部分镜生成可播放视频/)
    assertChinese(reason)
    const compose = useFilmCreateEpisodeCompose({
      store: createStore({
        drama: { id: DRAMA_ID, title: '项目甲' },
        currentEpisode: { id: EPISODE_ID, episode_number: 2 },
      }),
      dramaId: refOf(DRAMA_ID),
      currentEpisodeId: refOf(EPISODE_ID),
      dramaAPI: {
        async finalizeEpisode(epId, options) {
          finalizeCalls.push({ epId, options })
          return {}
        },
      },
      genStore: { markRunning() {}, markDone() {} },
      pollTask: async () => { throw new Error('pollTask 不应被调用') },
      captureDramaRefresh: () => async () => {},
      loadDrama: async () => { throw new Error('loadDrama 不应被调用') },
      composeActionDisabledReason: refOf(reason),
      currentEpisodeVideoUrl: refOf(''),
      videoErrorMsg: refOf(''),
      videoSubtitle: refOf(false),
      videoBurnDialogue: refOf(false),
      videoWatermark: refOf(false),
      videoWatermarkText: refOf(''),
    })
    await compose.onGenerateVideo()
    assert.equal(finalizeCalls.length, 0)
    assert.equal(feedback.last('warning').message, reason)
  } finally {
    feedback.restore()
  }
})

test('episode compose reports Chinese when there is no mergeable clip', async () => {
  const feedback = stubElementPlusFeedback()
  const finalizeCalls = []
  const runningMeta = []
  try {
    const videoErrorMsg = refOf('')
    const store = createStore({
      drama: { id: DRAMA_ID, title: '项目甲' },
      currentEpisode: { id: EPISODE_ID, episode_number: 2 },
      getVideoStatus() { return 'error' },
    })
    const compose = useFilmCreateEpisodeCompose({
      store,
      dramaId: refOf(DRAMA_ID),
      currentEpisodeId: refOf(EPISODE_ID),
      dramaAPI: {
        async finalizeEpisode(epId, options) {
          finalizeCalls.push({ epId, options })
          return {}
        },
      },
      genStore: {
        markRunning(meta) { runningMeta.push(meta) },
        markDone() {},
      },
      pollTask: async () => { throw new Error('pollTask 不应被调用') },
      captureDramaRefresh: () => async () => {},
      loadDrama: async () => { throw new Error('loadDrama 不应被调用') },
      composeActionDisabledReason: refOf(''),
      currentEpisodeVideoUrl: refOf(''),
      videoErrorMsg,
      videoSubtitle: refOf(false),
      videoBurnDialogue: refOf(false),
      videoWatermark: refOf(false),
      videoWatermarkText: refOf(''),
    })
    await compose.onGenerateVideo()
    assert.equal(finalizeCalls.length, 1)
    assert.equal(finalizeCalls[0].epId, EPISODE_ID)
    assert.notEqual(finalizeCalls[0].epId, DRAMA_ID)
    assert.equal(runningMeta[0].dramaId, DRAMA_ID)
    assert.equal(runningMeta[0].episodeId, EPISODE_ID)
    assert.equal(videoErrorMsg.value, '本集没有可合成的视频片段')
    assert.equal(feedback.last('warning').message, '本集没有可合成的视频片段')
    assertChinese(videoErrorMsg.value)
  } finally {
    feedback.restore()
  }
})

test('resource generate wraps extract and create failures in Chinese action logs', async () => {
  const events = []
  const restore = installOperationLogSink((event) => events.push(event))
  resetOperationLogs()
  try {
    const store = createStore({
      currentEpisode: { id: EPISODE_ID, characters: [{ id: 1 }], scenes: [] },
      props: [{ id: 2 }],
    })
    const { onGenerateCharacters, onExtractProps, onExtractScenes } = useFilmCreateResourceGenerate({
      store,
      trackFilmCreateAction,
      onGenerateCharactersRaw: async () => {
        throw new Error('角色生成失败：文本模型未配置')
      },
      onExtractPropsRaw: async () => {
        throw new Error('提取道具失败：剧本为空')
      },
      onExtractScenesRaw: async () => {
        throw new Error('提取场景失败：请先保存剧本')
      },
    })
    await assert.rejects(() => onGenerateCharacters(), /角色生成失败：文本模型未配置/)
    await assert.rejects(() => onExtractProps(), /提取道具失败：剧本为空/)
    await assert.rejects(() => onExtractScenes(), /提取场景失败：请先保存剧本/)
    const failedChars = events.find((event) => event.details?.action === 'generate_characters_failed')
    const failedProps = events.find((event) => event.details?.action === 'extract_props_failed')
    const failedScenes = events.find((event) => event.details?.action === 'extract_scenes_failed')
    assert.equal(failedChars.phase, 'error')
    assert.match(failedChars.details.message, /角色生成失败/)
    assertChinese(failedChars.details.message)
    assert.equal(failedProps.phase, 'error')
    assert.match(failedProps.details.message, /提取道具失败/)
    assert.equal(failedScenes.phase, 'error')
    assert.match(failedScenes.details.message, /提取场景失败/)
    assert.equal(events.some((event) => event.details?.action === 'pipeline_stop_complete'), false)
  } finally {
    restore()
    resetOperationLogs()
  }
})

test('media preview opens a real image and closes it', async () => {
  const feedback = stubElementPlusFeedback()
  class FakeImage {
    constructor() {
      this.naturalWidth = 16
      this.naturalHeight = 16
      this.onload = null
      this.onerror = null
    }
    set src(value) {
      this.currentSrc = value
      queueMicrotask(() => this.onload && this.onload())
    }
  }
  globalThis.Image = FakeImage
  try {
    const preview = useFilmCreateMediaPreview({ ElMessage })
    await preview.openImagePreview('mock://draft')
    assert.equal(preview.previewImageUrl.value, null)
    assert.match(feedback.last('info').message, /草稿占位图/)
    assertChinese(feedback.last('info').message)

    await preview.openImagePreview('/static/ok.png')
    assert.equal(preview.previewImageUrl.value, '/static/ok.png')
    preview.closeImagePreview()
    assert.equal(preview.previewImageUrl.value, null)
  } finally {
    feedback.restore()
  }
})

test('script persistence keeps a Chinese save failure bound to dramaId', async () => {
  const saved = []
  const loadCalls = []
  const store = createStore({
    dramaId: DRAMA_ID,
    currentEpisode: { id: EPISODE_ID, episode_number: 2, title: '正确集' },
    drama: {
      id: DRAMA_ID,
      episodes: [{ id: EPISODE_ID, episode_number: 2, title: '正确集', script_content: '旧正文' }],
    },
  })
  const { saveScriptToBackend } = useFilmCreateScriptPersistence({
    store,
    dramaAPI: {
      async create() { throw new Error('dramaAPI.create 不应被调用') },
      async saveEpisodes(id, payload) {
        saved.push({ id, payload })
        throw new Error('保存失败：磁盘已满')
      },
      async saveOutline() { throw new Error('dramaAPI.saveOutline 不应被调用') },
    },
    router: { replace() { throw new Error('router.replace 不应被调用') } },
    route: { params: { id: String(DRAMA_ID) } },
    scriptTitle: refOf('正确集'),
    storyType: refOf(''),
    generationStyle: refOf(''),
    storyStyle: refOf(''),
    storyInput: refOf(''),
    projectAspectRatio: refOf('16:9'),
    videoClipDuration: refOf(5),
    storyboardIncludeNarration: refOf(false),
    storyboardUniversalOmni: refOf(false),
    storyboardUseFirstLastFrame: refOf(false),
    lastFrameUseFirstLayoutLock: refOf(true),
    projectStylePromptMetadata: () => ({}),
    loadDrama: async () => { loadCalls.push(store.dramaId) },
    savedCurrentEpisodeNumber: refOf(2),
    selectedEpisodeId: refOf(EPISODE_ID),
    onEpisodeSelect() {},
    storyGenerating: refOf(false),
    scriptGenerating: refOf(false),
    pollTask: async () => { throw new Error('pollTask 不应被调用') },
    trackFilmCreateAction,
    storyEpisodeCount: refOf(1),
  })
  await saveScriptToBackend('   ')
  assert.equal(saved.length, 0)
  await assert.rejects(() => saveScriptToBackend('第一场：对白'), /保存失败：磁盘已满/)
  assert.equal(saved.length, 1)
  assert.equal(saved[0].id, DRAMA_ID)
  assert.notEqual(saved[0].id, EPISODE_ID)
  assert.equal(loadCalls.length, 0)
  assertChinese('保存失败：磁盘已满')
})

test('universal segment converts image tags and reports Chinese generate failures', async () => {
  const feedback = stubElementPlusFeedback()
  const saved = []
  const generateCalls = []
  try {
    const sbUniversalSegmentText = refOf({ [STORYBOARD_ID]: '  ' })
    const api = useFilmCreateUniversalSegment({
      store: createStore({
        currentEpisode: {
          id: EPISODE_ID,
          storyboards: [{ id: STORYBOARD_ID, title: '推门', description: '推门进入' }],
        },
      }),
      storyboardsAPI: {
        async generateUniversalSegmentPromptStream(id, body) {
          generateCalls.push({ id, body })
          throw new Error('生成失败：文本模型未配置')
        },
        async polishUniversalSegmentPromptStream() {
          throw new Error('storyboardsAPI.polish 不应被调用')
        },
      },
      generatingUniversalSegmentIds: new Set(),
      sbUniversalSegmentText,
      sbUniversalSegmentTrimmed: () => '',
      universalSegmentDurationSecForSb: () => 5,
      isSbUniversalMode: () => true,
      storyboardUniversalOmni: refOf(true),
      universalOmniPolishRunning: refOf(false),
      universalOmniPolishAbort: refOf(false),
      universalOmniPolishProgress: refOf({ current: 0, total: 0, label: '' }),
      pipelineRest: async () => {},
      onSaveUniversalSegmentField: async () => {
        saved.push(sbUniversalSegmentText.value[STORYBOARD_ID])
      },
    })
    api.onUniversalSegmentToGrokVideoTags({ id: STORYBOARD_ID })
    assert.equal(feedback.last('warning').message, '请先填写或生成片段描述')
    assertChinese(feedback.last('warning').message)

    sbUniversalSegmentText.value = { [STORYBOARD_ID]: '镜头 @图片1 推门 @图片2' }
    api.onUniversalSegmentToGrokVideoTags({ id: STORYBOARD_ID })
    assert.equal(sbUniversalSegmentText.value[STORYBOARD_ID], '镜头 <IMAGE_1> 推门 <IMAGE_2>')
    assert.equal(feedback.last('success').message, '已改为 Grok 视频占位符格式（<IMAGE_N>）')
    assert.equal(saved.length, 1)

    await api.onPolishUniversalSegmentPromptStream({ id: STORYBOARD_ID })
    assert.equal(feedback.last('warning').message, '请先填写或生成片段描述后再润色')

    await api.onGenerateUniversalSegmentPrompt({ id: STORYBOARD_ID, title: '推门' })
    assert.equal(generateCalls.length, 1)
    assert.equal(generateCalls[0].id, STORYBOARD_ID)
    assert.notEqual(generateCalls[0].id, DRAMA_ID)
    assert.equal(generateCalls[0].body.field_overrides.title, '推门')
    assert.equal(feedback.last('error').message, '生成失败：文本模型未配置')
    assertChinese(feedback.last('error').message)
  } finally {
    feedback.restore()
  }
})

