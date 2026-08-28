/** 分镜媒体失败链路测试夹具：构造 dramaId 与 episodeId 不相等的失败、取消与缓存反例。 */
import assert from 'node:assert/strict'
import { effectScope, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useFilmCreateStoryboardMedia } from '../../src/composables/filmCreate/useFilmCreateStoryboardMedia.js'
import { createStoryboardMediaStateController } from '../../src/utils/storyboardMedia.js'
import { useFilmCreateBatchGeneration } from '../../src/composables/filmCreate/useFilmCreateBatchGeneration.js'
import { useFilmCreateLinkedStoryboardRegen } from '../../src/composables/filmCreate/useFilmCreateLinkedStoryboardRegen.js'
import { useFilmCreateStoryboardImageGeneration } from '../../src/composables/filmCreate/useFilmCreateStoryboardImageGeneration.js'
import { useFilmCreateStoryboardVideoGeneration } from '../../src/composables/filmCreate/useFilmCreateStoryboardVideoGeneration.js'
import { useFilmCreatePipelineRun } from '../../src/composables/filmCreate/useFilmCreatePipelineRun.js'
import { useFilmCreatePipelineStages } from '../../src/composables/filmCreate/useFilmCreatePipelineStages.js'
import { useFilmCreateProjectLoad } from '../../src/composables/filmCreate/useFilmCreateProjectLoad.js'
import { useFilmCreateRouteSync } from '../../src/composables/filmCreate/useFilmCreateRouteSync.js'
import { useFilmCreateTaskRecovery } from '../../src/composables/filmCreate/useFilmCreateTaskRecovery.js'
import { userFacingVideoGenerationError } from '../../src/utils/filmCreateActionState.js'

export const DRAMA_ID = 11
export const EPISODE_ID = 22
export const OTHER_EPISODE_ID = 33
export const STORYBOARD_ID = 77
export const MIXED_STORYBOARD_ID = 88

assert.notEqual(DRAMA_ID, EPISODE_ID)
assert.notEqual(DRAMA_ID, OTHER_EPISODE_ID)
assert.notEqual(EPISODE_ID, OTHER_EPISODE_ID)
assert.notEqual(DRAMA_ID, STORYBOARD_ID)
assert.notEqual(EPISODE_ID, STORYBOARD_ID)
assert.notEqual(MIXED_STORYBOARD_ID, DRAMA_ID)
assert.notEqual(MIXED_STORYBOARD_ID, EPISODE_ID)

export function forbiddenApi(name) {
  return new Proxy({}, {
    get(_target, prop) {
      return async () => {
        throw new Error(`${name}.${String(prop)} 不应被调用`)
      }
    },
  })
}

export function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

export function stubFeedback() {
  const messages = []
  const originals = {
    warning: ElMessage.warning,
    error: ElMessage.error,
    success: ElMessage.success,
    info: ElMessage.info,
    alert: ElMessageBox.alert,
    confirm: ElMessageBox.confirm,
  }
  const record = (type) => (message, title, options) => {
    messages.push({ type, message, title, options })
    return { close() {} }
  }
  ElMessage.warning = record('warning')
  ElMessage.error = record('error')
  ElMessage.success = record('success')
  ElMessage.info = record('info')
  let confirmImpl = async () => {}
  let alertImpl = async () => {}
  ElMessageBox.confirm = async (message, title, options) => {
    messages.push({ type: 'confirm', message, title, options })
    return confirmImpl(message, title, options)
  }
  ElMessageBox.alert = async (message, title, options) => {
    messages.push({ type: 'alert', message, title, options })
    return alertImpl(message, title, options)
  }
  return {
    messages,
    setConfirm(next) { confirmImpl = next },
    setAlert(next) { alertImpl = next },
    last(type) {
      return messages.filter((item) => item.type === type).at(-1)
    },
    restore() {
      ElMessage.warning = originals.warning
      ElMessage.error = originals.error
      ElMessage.success = originals.success
      ElMessage.info = originals.info
      ElMessageBox.alert = originals.alert
      ElMessageBox.confirm = originals.confirm
    },
  }
}

export function createStore(overrides = {}) {
  const store = {
    dramaId: DRAMA_ID,
    drama: {
      id: DRAMA_ID,
      title: '项目甲',
      episodes: [{ id: EPISODE_ID, episode_number: 2, title: '正确集' }],
    },
    currentEpisode: {
      id: EPISODE_ID,
      episode_number: 2,
      title: '正确集',
      script_content: '正确剧本',
      characters: [{ id: 1, name: '李华', image_url: '/static/c.png' }],
      scenes: [{ id: 2, name: '办公室', image_url: '/static/s.png' }],
      props: [{ id: 3, name: '杯子', image_url: '/static/p.png' }],
    },
    scriptContent: '正确剧本',
    characters: [{ id: 1, name: '李华', image_url: '/static/c.png' }],
    scenes: [{ id: 2, name: '办公室', image_url: '/static/s.png' }],
    props: [{ id: 3, name: '杯子', image_url: '/static/p.png' }],
    storyboards: [
      {
        id: STORYBOARD_ID,
        episode_id: EPISODE_ID,
        storyboard_number: 1,
        description: '李华推门',
        image_prompt: '办公室门口，李华推门',
        polished_prompt: '电影感，办公室门口，李华推门进入',
        video_prompt: '镜头跟随李华推门进入办公室',
        characters: [{ id: 5 }],
      },
    ],
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

export function createStoryboard(overrides = {}) {
  return {
    id: STORYBOARD_ID,
    episode_id: EPISODE_ID,
    storyboard_number: 1,
    title: '推门',
    description: '李华推开办公室的门',
    image_prompt: '办公室门口，李华推门',
    polished_prompt: '电影感，办公室门口，李华推门进入',
    video_prompt: '镜头跟随李华推门进入办公室',
    creation_mode: 'classic',
    characters: [{ id: 5 }],
    ...overrides,
  }
}

export function createGenStore() {
  return {
    running: [],
    done: [],
    markRunning(meta) { this.running.push(meta) },
    markDone(meta) { this.done.push(meta) },
    markFailed() {},
    stopPollingTask() {},
    isRunning() { return false },
    pollTask: async () => ({ status: 'completed' }),
    async recoverPendingForEpisode() {},
    getRunningForEpisode() { return [] },
  }
}

/** 构造处于 error 状态、但仍保留缓存的控制器，供写入前 assertReady 使用。 */
export function createErrorMediaAssert() {
  const controller = createStoryboardMediaStateController()
  controller.setContext({ projectId: DRAMA_ID, episodeId: EPISODE_ID })
  const first = controller.beginFull([STORYBOARD_ID])
  for (const request of first) controller.commitSuccess(request, [{ id: 'keep' }])
  const refresh = controller.beginFull([STORYBOARD_ID])
  controller.commitFailure(refresh.find((request) => request.endpoint === 'images'))
  controller.commitSuccess(refresh.find((request) => request.endpoint === 'videos'), [{ id: 'v1' }])
  return {
    controller,
    assertReady: () => controller.assertReady({ projectId: DRAMA_ID, episodeId: EPISODE_ID }),
    reason: () => controller.actionReason({ projectId: DRAMA_ID, episodeId: EPISODE_ID }),
  }
}

export function createMediaHarness(overrides = {}) {
  const dramaId = overrides.dramaId || ref(DRAMA_ID)
  const currentEpisodeId = overrides.currentEpisodeId || ref(EPISODE_ID)
  const store = overrides.store || createStore()
  const listCalls = []
  const loadDramaCalls = []
  const restored = []
  const bag = {}
  let imagesList = overrides.imagesList
  let videosList = overrides.videosList

  const api = useFilmCreateStoryboardMedia({
    dramaId,
    currentEpisodeId,
    getStoryboards: overrides.getStoryboards || (() => store.storyboards || []),
    imagesAPI: {
      async list(payload) {
        listCalls.push({
          endpoint: 'images',
          payload,
          context: { ...bag.api.storyboardMediaStateController.getSnapshot().context },
        })
        if (typeof imagesList === 'function') return imagesList(payload)
        return { items: [{ id: `img-${payload.storyboard_id}` }] }
      },
    },
    videosAPI: {
      async list(payload) {
        listCalls.push({
          endpoint: 'videos',
          payload,
          context: { ...bag.api.storyboardMediaStateController.getSnapshot().context },
        })
        if (typeof videosList === 'function') return videosList(payload)
        return { items: [{ id: `vid-${payload.storyboard_id}` }] }
      },
    },
    onSelectionsRestored: () => { restored.push(bag.api.storyboardMediaStateController.getSnapshot().context) },
    loadDrama: async (options) => {
      loadDramaCalls.push(options)
    },
    ...overrides.deps,
  })
  bag.api = api

  return {
    api,
    dramaId,
    currentEpisodeId,
    store,
    listCalls,
    loadDramaCalls,
    restored,
    setImagesList(next) { imagesList = next },
    setVideosList(next) { videosList = next },
  }
}

export async function primeMediaReady(media, storyboardIds = [STORYBOARD_ID]) {
  media.store.storyboards = storyboardIds.map((id) => (
    media.store.storyboards.find((board) => board.id === id)
    || createStoryboard({ id, episode_id: media.currentEpisodeId.value })
  ))
  media.api.ensureStoryboardMediaContext(media.dramaId.value, media.currentEpisodeId.value)
  const result = await media.api.loadStoryboardMedia()
  assert.equal(media.api.storyboardMediaLoadState.value, 'ready')
  return result
}

export async function failMediaImages(media) {
  media.setImagesList(async () => {
    throw new Error('images list failed')
  })
  media.setVideosList(async () => ({ items: [{ id: 'vid-keep' }] }))
  return media.api.loadStoryboardMedia()
}

export function createBatch(overrides = {}) {
  const imageCreates = []
  const videoCreates = []
  const mediaLoads = []
  const storyboardUpdates = []
  const storyboardMediaActionReason = overrides.storyboardMediaActionReason || ref('')
  const batchImageErrors = overrides.batchImageErrors || ref([])
  const batchVideoErrors = overrides.batchVideoErrors || ref([])
  const sbSelectedVideoId = overrides.sbSelectedVideoId || ref({ [STORYBOARD_ID]: 99 })
  const api = useFilmCreateBatchGeneration({
    currentEpisodeId: overrides.currentEpisodeId || ref(EPISODE_ID),
    dramaId: overrides.dramaId || ref(DRAMA_ID),
    store: overrides.store || createStore({
      storyboards: [
        createStoryboard(),
        createStoryboard({ id: STORYBOARD_ID + 1, storyboard_number: 2, episode_id: EPISODE_ID }),
      ],
    }),
    pipelineRunning: ref(false),
    pipelineConcurrency: ref(1),
    pipelineVideoConcurrency: ref(1),
    storyboardMediaActionReason,
    batchImageRunning: ref(false),
    batchImageStopping: ref(false),
    batchImageErrors,
    batchImageProgress: ref({ current: 0, total: 0, failed: 0 }),
    batchVideoRunning: ref(false),
    batchVideoStopping: ref(false),
    batchVideoErrors,
    batchVideoProgress: ref({ current: 0, total: 0, failed: 0 }),
    sbImages: overrides.sbImages || ref({ [STORYBOARD_ID]: [{ id: 'cached' }] }),
    sbVideos: overrides.sbVideos || ref({ [STORYBOARD_ID]: [] }),
    sbSelectedImgId: ref({}),
    sbSelectedVideoId,
    gridMode: ref('single'),
    storyboardUseFirstLastFrame: ref(false),
    videoFrameContiguity: ref(false),
    projectAspectRatio: ref('16:9'),
    videoResolution: ref('720p'),
    generatingSbVideoIds: new Set(),
    loadStoryboardMedia: overrides.loadStoryboardMedia || (async (opts = {}) => {
      mediaLoads.push(opts)
      return { failedCount: 0 }
    }),
    hasSbImage: overrides.hasSbImage || (() => false),
    isSbUniversalMode: () => false,
    ensureProfessionalFramePrompt: async () => '专业首帧',
    assertStoryboardMediaReady: overrides.assertStoryboardMediaReady || (() => {}),
    imagesAPI: {
      async create(payload) {
        imageCreates.push(payload)
        return { task_id: `img-${payload.storyboard_id}` }
      },
    },
    videosAPI: {
      async create(payload) {
        videoCreates.push(payload)
        return { task_id: `vid-${payload.storyboard_id}` }
      },
    },
    storyboardsAPI: {
      async update(id, payload) {
        storyboardUpdates.push({ id, payload })
      },
    },
    uploadAPI: forbiddenApi('uploadAPI'),
    pollTask: async (_taskId, onDone) => {
      if (onDone) await onDone()
      return { status: 'completed' }
    },
    captureStoryboardMediaRefresh: overrides.captureStoryboardMediaRefresh || ((id) => async () => ({ id })),
    refreshStoryboardMediaForCurrentContext: async () => {},
    restoreSelectionsFromBackend() {},
    getSelectedStyle: () => 'realistic',
    getSbVideoReferenceGrid: () => null,
    sbCanSubmitVideo: () => true,
    getSbFirstFrameUrl: () => '/static/first.png',
    collectSbSceneOnlyReferenceAbsoluteUrls: () => [],
    collectSbOmniReferenceAbsoluteUrls: () => [],
    getSbPrimaryReferenceAbsoluteUrl: () => '',
    toAbsoluteImageUrl: (url) => url || '',
    assetImageUrl: () => '',
    recordHasPlayableVideoUrl: () => false,
    buildStoryboardVideoReferencePayload: async () => ({
      firstFrameUrl: '/static/first.png',
      absoluteUrl: '/static/first.png',
      lastFrameUrl: '',
      referenceUrls: [],
    }),
    buildSbVideoPromptForApi: () => '镜头跟随李华推门进入办公室',
    getSbVideoDurationForApi: () => 5,
    captureVideoLastFrame: async () => null,
    buildSbGenMeta: (board, resourceType, label) => ({
      dramaId: DRAMA_ID,
      episodeId: EPISODE_ID,
      resourceType,
      resourceId: board.id,
      label,
    }),
    refreshVideoGenerationCapability: overrides.refreshVideoGenerationCapability || (async () => ({
      ready: true,
      config: { id: 1 },
    })),
    canUseUniversalOmniVideoApi: () => false,
    ...overrides.deps,
  })
  return {
    api,
    imageCreates,
    videoCreates,
    mediaLoads,
    storyboardUpdates,
    storyboardMediaActionReason,
    sbSelectedVideoId,
    batchImageErrors,
    batchVideoErrors,
  }
}

export function createImageGen(overrides = {}) {
  const createCalls = []
  const updateCalls = []
  const pollCalls = []
  const dramaId = overrides.dramaId || ref(DRAMA_ID)
  const sb = overrides.sb || createStoryboard()
  const api = useFilmCreateStoryboardImageGeneration({
    dramaId,
    store: overrides.store || createStore({ storyboards: [sb] }),
    storyboardsAPI: {
      async update(id, payload) { updateCalls.push({ id, payload }) },
      async getFramePrompts() { return { frame_prompts: [] } },
      async generateFramePrompt() { return {} },
    },
    imagesAPI: {
      async create(payload) {
        createCalls.push(payload)
        return { task_id: 'img-task' }
      },
    },
    genStore: createGenStore(),
    pollTask: overrides.pollTask || (async (taskId, onDone, meta) => {
      pollCalls.push({ taskId, meta })
      if (onDone) pollCalls.at(-1).doneResult = await onDone()
      return { status: 'completed' }
    }),
    captureStoryboardMediaRefresh: overrides.captureStoryboardMediaRefresh || ((id) => async () => ({ id })),
    refreshStoryboardMediaForCurrentContext: async () => {},
    restoreSelectionsFromBackend() {},
    loadDrama: async () => {},
    getSelectedStyle: () => 'cinematic',
    getSelectedStylePrompt: () => 'cinematic lighting',
    getSelectedStylePromptZh: () => '电影感光影',
    angleToPromptFragment: () => ({ label: '平视正面' }),
    frameTypeForSlot: (slot) => (slot === 'last' ? 'storyboard_last' : 'storyboard_first'),
    getSbFirstImage: () => null,
    buildSbGenMeta: (board, resourceType, label) => ({
      dramaId: dramaId.value,
      episodeId: EPISODE_ID,
      resourceType,
      resourceId: board.id,
      label,
    }),
    assertStoryboardMediaReady: overrides.assertStoryboardMediaReady || (() => {}),
    storyboardMediaActionReason: overrides.storyboardMediaActionReason || ref(''),
    projectAspectRatio: ref('16:9'),
    gridMode: ref('single'),
    storyboardUseFirstLastFrame: ref(false),
    lastFrameUseFirstLayoutLock: ref(false),
    sbLocation: ref({ [STORYBOARD_ID]: '办公室' }),
    sbTime: ref({ [STORYBOARD_ID]: '清晨' }),
    sbShotType: ref({ [STORYBOARD_ID]: '中景' }),
    sbAngleH: ref({ [STORYBOARD_ID]: 'front' }),
    sbAngleV: ref({ [STORYBOARD_ID]: 'eye' }),
    sbAngleS: ref({ [STORYBOARD_ID]: 'medium' }),
    sbResult: ref({ [STORYBOARD_ID]: '门已打开' }),
    sbAction: ref({ [STORYBOARD_ID]: '推门' }),
    sbAtmosphere: ref({ [STORYBOARD_ID]: '紧张' }),
    sbCharacterIds: ref({ [STORYBOARD_ID]: [5] }),
    sbSelectedImgId: ref({}),
    sbSelectedLastImgId: ref({}),
    generatingSbImageIds: new Set(),
    generatingSbFirstImageIds: new Set(),
    generatingSbLastImageIds: new Set(),
    showFramePromptEditor: ref(false),
    editingFramePromptSb: ref(null),
    editingFramePromptSlot: ref(''),
    editingFramePromptText: ref(''),
    editingFramePromptSaving: ref(false),
    editingFramePromptRegenerating: ref(false),
    ...overrides.deps,
  })
  return { api, sb, createCalls, updateCalls, pollCalls, dramaId }
}

export function createVideoGen(overrides = {}) {
  const createCalls = []
  const updateCalls = []
  const sbSelectedVideoId = overrides.sbSelectedVideoId || ref({ [STORYBOARD_ID]: 99 })
  const sb = overrides.sb || createStoryboard()
  const api = useFilmCreateStoryboardVideoGeneration({
    dramaId: overrides.dramaId || ref(DRAMA_ID),
    videosAPI: {
      async create(payload) {
        createCalls.push(payload)
        return { task_id: 'video-task' }
      },
    },
    storyboardsAPI: {
      async update(id, payload) { updateCalls.push({ id, payload }) },
    },
    genStore: createGenStore(),
    pollTask: async () => ({ status: 'completed' }),
    captureStoryboardMediaRefresh: () => async () => {},
    sbVideoGenerationDisabledReason: () => '',
    isSbUniversalMode: () => false,
    sbVideoReferenceImageId: ref({}),
    getSbVideoReferenceGrid: () => null,
    getActiveVideoAiConfig: async () => ({ id: 1 }),
    canUseUniversalOmniVideoApi: () => false,
    confirmUniversalNonSeedance2Video: async () => {},
    toAbsoluteImageUrl: (url) => url || '',
    assetImageUrl: (img) => img?.image_url || '',
    collectSbOmniReferenceAbsoluteUrls: () => [],
    collectSbSceneOnlyReferenceAbsoluteUrls: () => [],
    collectSbFreeReferenceAbsoluteUrls: () => [],
    getSbFirstFrameUrl: () => '/static/first.png',
    getSbPrimaryReferenceAbsoluteUrl: () => '',
    generatingSbVideoIds: new Set(),
    buildSbGenMeta: (board, resourceType, label) => ({
      dramaId: DRAMA_ID,
      episodeId: EPISODE_ID,
      resourceType,
      resourceId: board.id,
      label,
    }),
    sbVideoErrors: ref({}),
    buildStoryboardVideoReferencePayload: async () => ({
      firstFrameUrl: '/static/first.png',
      absoluteUrl: '/static/first.png',
      lastFrameUrl: '',
      referenceUrls: [],
    }),
    assertStoryboardMediaReady: overrides.assertStoryboardMediaReady || (() => {}),
    buildSbVideoPromptForApi: () => '镜头跟随李华推门进入办公室',
    getSelectedStyle: () => 'cinematic',
    projectAspectRatio: ref('16:9'),
    videoResolution: ref('720p'),
    getSbVideoDurationForApi: () => 5,
    sbSelectedVideoId,
    userFacingVideoGenerationError,
    ...overrides.deps,
  })
  return { api, sb, createCalls, updateCalls, sbSelectedVideoId }
}

export function createLinked(overrides = {}) {
  const createCalls = []
  const regenSbImagesForAsset = overrides.regenSbImagesForAsset || new Set()
  const api = useFilmCreateLinkedStoryboardRegen({
    dramaId: ref(DRAMA_ID),
    imagesAPI: {
      async create(payload) {
        createCalls.push(payload)
        return {}
      },
    },
    taskAPI: forbiddenApi('taskAPI'),
    assertStoryboardMediaReady: overrides.assertStoryboardMediaReady || (() => {}),
    captureStoryboardMediaRefresh: () => async () => {},
    storyboardUseFirstLastFrame: ref(false),
    isSbUniversalMode: () => false,
    ensureProfessionalFramePrompt: async () => '专业首帧',
    getSelectedStyle: () => 'cinematic',
    projectAspectRatio: ref('16:9'),
    regenSbImagesForAsset,
    regenSbImagesProgress: ref(null),
    sbSelectedImgId: ref({}),
    ...overrides.deps,
  })
  return { api, createCalls, regenSbImagesForAsset }
}

export function createPipelineRun(reasonRef = ref('')) {
  return useFilmCreatePipelineRun({
    store: createStore(),
    videoClipDuration: ref(5),
    taskAPI: forbiddenApi('taskAPI'),
    genStore: createGenStore(),
    trackFilmCreateAction() {},
    getStoryboardCountForApi: () => 1,
    resolvePollMeta: (meta) => ({
      dramaId: DRAMA_ID,
      episodeId: EPISODE_ID,
      ...meta,
    }),
    storyboardMediaActionReason: reasonRef,
  })
}

export function createPipelineStages(overrides = {}) {
  const imageCreates = []
  const videoCreates = []
  const ownedRuns = []
  const errors = []
  const actions = []
  const mediaLoads = []
  const pollPauseCalls = []
  const storyboardMediaActionReason = overrides.storyboardMediaActionReason || ref('')
  const pipelineErrorLog = ref([])
  const api = useFilmCreatePipelineStages({
    currentEpisodeId: overrides.currentEpisodeId || ref(EPISODE_ID),
    dramaId: overrides.dramaId || ref(DRAMA_ID),
    store: overrides.store || createStore(),
    storyInput: ref(''),
    scriptLanguage: ref('zh'),
    generationAPI: forbiddenApi('generationAPI'),
    dramaAPI: forbiddenApi('dramaAPI'),
    propAPI: forbiddenApi('propAPI'),
    characterAPI: forbiddenApi('characterAPI'),
    sceneAPI: forbiddenApi('sceneAPI'),
    imagesAPI: {
      async create(payload) {
        imageCreates.push(payload)
        return { task_id: `img-${payload.storyboard_id}` }
      },
    },
    videosAPI: {
      async create(payload) {
        videoCreates.push(payload)
        return { task_id: `vid-${payload.storyboard_id}` }
      },
    },
    loadDrama: overrides.loadDrama || (async () => {}),
    loadStoryboardMedia: overrides.loadStoryboardMedia || (async (opts = {}) => {
      mediaLoads.push(opts)
      return { failedCount: 0 }
    }),
    refreshStoryboardsOnly: async () => {},
    getStoryboardCountForApi: () => 1,
    getVideoDurationForApi: () => 5,
    projectAspectRatio: ref('16:9'),
    storyboardIncludeNarration: ref(false),
    storyboardUniversalOmni: ref(false),
    polishUniversalSegmentsAfterGeneration: async () => {},
    hasAssetImage: () => true,
    hasSbImage: overrides.hasSbImage || (() => false),
    generatingCharIds: new Set(),
    generatingSceneIds: new Set(),
    generatingPropIds: new Set(),
    generatingSbImageIds: new Set(),
    generatingSbVideoIds: new Set(),
    getSelectedStyle: () => 'realistic',
    captureDramaRefresh: () => async () => {},
    captureStoryboardMediaRefresh: overrides.captureStoryboardMediaRefresh || ((id) => async () => ({ id, stale: false })),
    refreshStoryboardMediaForCurrentContext: async () => {},
    pollUntilResourceHasImage: async () => {},
    sceneUseQuadGrid: ref(false),
    storyboardUseFirstLastFrame: ref(false),
    isSbUniversalMode: () => false,
    ensureProfessionalFramePrompt: async () => '专业首帧',
    assertStoryboardMediaReady: overrides.assertStoryboardMediaReady || (() => {}),
    sbVideos: ref({}),
    recordHasPlayableVideoUrl: () => false,
    sbCanSubmitVideo: () => true,
    collectSbOmniReferenceAbsoluteUrls: () => [],
    getSbFirstFrameUrl: () => '/static/first.png',
    buildStoryboardVideoReferencePayload: async () => ({
      firstFrameUrl: '/static/first.png',
      lastFrameUrl: '',
      referenceUrls: [],
    }),
    buildSbVideoPromptForApi: () => '镜头跟随',
    getSbVideoDurationForApi: () => 5,
    videoResolution: ref('720p'),
    buildSbGenMeta: (board, resourceType, label) => ({
      dramaId: DRAMA_ID,
      episodeId: EPISODE_ID,
      resourceType,
      resourceId: board.id,
      label,
    }),
    getFinalizeMergeOptions: () => ({}),
    refreshProductionReadiness: overrides.refreshProductionReadiness || (async () => ({ ready: true, reason: '' })),
    trackFilmCreateAction: (action) => { actions.push(action) },
    pipelineStarting: ref(false),
    pipelineRunning: ref(false),
    pipelineStopping: ref(false),
    activePipelineRunPromise: ref(null),
    pipelineAbortRequested: ref(false),
    pipelineErrorLog,
    pipelineCurrentStep: ref(''),
    pipelineStepIndex: ref(0),
    pipelineActiveTasks: new Set(),
    pipelineOwnedTaskIds: new Set(),
    pipelineStepTotal: ref(10),
    pipelineConcurrency: ref(1),
    pipelineVideoConcurrency: ref(1),
    executeOwnedPipelineRun: overrides.executeOwnedPipelineRun || (async (_run, opts = {}) => {
      ownedRuns.push(opts)
    }),
    confirmProductionPipelineCost: overrides.confirmProductionPipelineCost || (async () => true),
    checkPause: overrides.checkPause || (async () => {}),
    pollTaskWithPause: overrides.pollTaskWithPause || (async (taskId, onDone) => {
      pollPauseCalls.push({ taskId, onDone })
      if (onDone) await onDone()
      return { status: 'completed' }
    }),
    addPipelineError: (step, message) => {
      errors.push({ step, message })
      pipelineErrorLog.value = [...pipelineErrorLog.value, { step, message }]
    },
    pipelineRest: async () => {},
    runPipelineCountdown: async () => {},
    pipelineWithRetry: overrides.pipelineWithRetry || (async (_name, fn) => fn()),
    runConcurrently: async (items, _concurrency, fn) => {
      for (const item of items || []) await fn(item)
    },
    setPipelineStep() {},
    storyboardMediaActionReason,
    ...overrides.deps,
  })
  return {
    api,
    imageCreates,
    videoCreates,
    ownedRuns,
    errors,
    actions,
    mediaLoads,
    pollPauseCalls,
    storyboardMediaActionReason,
    pipelineErrorLog,
  }
}

export function createProjectLoadHarness(media, overrides = {}) {
  const contextEvents = []
  const store = media.store
  const api = useFilmCreateProjectLoad({
    store,
    dramaId: media.dramaId,
    currentEpisodeId: media.currentEpisodeId,
    projectLifecycle: { guardApi(next) { return next } },
    episodeSwitchController: {
      async select(id) { return { changed: true, episode: { id } } },
    },
    syncEpisodeRouteQuery() {},
    resetStoryboardMediaContext: (...args) => media.api.resetStoryboardMediaContext(...args),
    ensureStoryboardMediaContext: (...args) => {
      contextEvents.push({ type: 'ensure', args })
      return media.api.ensureStoryboardMediaContext(...args)
    },
    storyboardMediaStateController: media.api.storyboardMediaStateController,
    syncStoryboardStateFromEpisode(ep) {
      if (ep?.storyboards) store.storyboards = ep.storyboards
    },
    markScriptDraftSaved() {},
    loadStoryboardMedia: async (...args) => {
      contextEvents.push({
        type: 'media',
        context: { ...media.api.storyboardMediaStateController.getSnapshot().context },
      })
      return media.api.loadStoryboardMedia(...args)
    },
    recoverAndSyncEpisodeTasks: async () => {},
    loadPipelineConcurrency: async () => {},
    refreshVideoGenerationCapability: async () => ({}),
    refreshProductionReadiness: async () => ({}),
    scriptTitle: ref(''),
    selectedEpisodeId: ref(EPISODE_ID),
    savedCurrentEpisodeNumber: ref(2),
    storyInput: ref(''),
    storyStyle: ref(''),
    storyType: ref(''),
    generationStyle: ref(''),
    projectAspectRatio: ref('16:9'),
    videoClipDuration: ref(5),
    storyboardIncludeNarration: ref(false),
    storyboardUniversalOmni: ref(false),
    storyboardUseFirstLastFrame: ref(false),
    lastFrameUseFirstLayoutLock: ref(true),
    gridMode: ref('single'),
    projectLoadState: ref('idle'),
    projectLoadPending: ref(false),
    projectLoadError: ref(''),
    projectLoadNotFound: ref(false),
    projectDependencyWarning: ref(''),
    projectDependencyLoading: ref(false),
    projectLoadFailureRef: ref({ focus() {} }),
    scriptDraftController: { dispose() {} },
    ...overrides,
  })
  return { api, store, contextEvents }
}

export function createRouteSyncHarness(media) {
  const scope = effectScope()
  const route = reactive({
    params: { id: String(DRAMA_ID) },
    query: { episode: String(EPISODE_ID) },
  })
  const sync = scope.run(() => useFilmCreateRouteSync({
    route,
    router: { replace: async () => {} },
    store: media.store,
    dramaId: media.dramaId,
    invalidateProjectLoads() {},
    resetStoryboardMediaContext: (...args) => media.api.resetStoryboardMediaContext(...args),
    loadDrama: async () => {},
    projectLoadError: ref(''),
    projectLoadNotFound: ref(false),
    projectDependencyWarning: ref(''),
    projectLoadPending: ref(false),
    projectDependencyLoading: ref(false),
    projectLoadState: ref('idle'),
    selectedEpisodeId: ref(EPISODE_ID),
    savedCurrentEpisodeNumber: ref(2),
    storyInput: ref(''),
    scriptTitle: ref(''),
    storyStyle: ref(''),
    storyType: ref(''),
    scriptLanguage: ref('zh'),
    scriptStoryboardStyle: ref(''),
    generationStyle: ref(''),
    markScriptDraftSaved() {},
    onEpisodeSelect: async () => {},
  }))
  return { scope, sync, route }
}

export function createRecovery(media, overrides = {}) {
  const recoverPayloads = []
  const genStore = {
    async recoverPendingForEpisode(payload) {
      recoverPayloads.push(payload)
      if (overrides.onRecover) await overrides.onRecover(payload)
    },
    getRunningForEpisode() { return [] },
    isRunning() { return false },
  }
  const api = useFilmCreateTaskRecovery({
    dramaId: media.dramaId,
    currentEpisodeId: media.currentEpisodeId,
    store: media.store,
    genStore,
    ElMessage: { warning() {}, error() {} },
    videoErrorMsg: ref(''),
    generatingCharIds: new Set(),
    generatingPropIds: new Set(),
    generatingSceneIds: new Set(),
    generatingSbImageIds: new Set(),
    generatingSbFirstImageIds: new Set(),
    generatingSbLastImageIds: new Set(),
    generatingSbVideoIds: new Set(),
    currentStoryboardMediaContext: media.api.currentStoryboardMediaContext,
    loadSingleStoryboardMedia: media.api.loadSingleStoryboardMedia,
    captureDramaRefresh: media.api.captureDramaRefresh,
  })
  return { api, recoverPayloads, genStore }
}
