import test, { describe } from 'node:test'
import assert from 'node:assert/strict'

import { ElMessage, ElMessageBox } from 'element-plus'

import { useFilmCreateStoryboardImageGeneration } from '../src/composables/filmCreate/useFilmCreateStoryboardImageGeneration.js'
import { useFilmCreateStoryboardVideoGeneration } from '../src/composables/filmCreate/useFilmCreateStoryboardVideoGeneration.js'
import { useFilmCreateUniversalSegment } from '../src/composables/filmCreate/useFilmCreateUniversalSegment.js'
import { useFilmCreateLinkedStoryboardRegen } from '../src/composables/filmCreate/useFilmCreateLinkedStoryboardRegen.js'
import { useFilmCreateResourceUpload } from '../src/composables/filmCreate/useFilmCreateResourceUpload.js'
import { GEN_RESOURCE } from '../src/stores/generationTaskStore.js'
import { userFacingVideoGenerationError } from '../src/utils/filmCreateActionState.js'
import {
  getOperationLogs,
  installOperationLogSink,
  resetOperationLogs,
} from '../src/utils/operationLog.js'

const DRAMA_ID = 11
const EPISODE_ID = 22
const STORYBOARD_ID = 77
const ASSET_ID = 88
const CHAR_ID = 5

assert.notEqual(DRAMA_ID, EPISODE_ID)
assert.notEqual(DRAMA_ID, STORYBOARD_ID)
assert.notEqual(EPISODE_ID, STORYBOARD_ID)

function refOf(value) {
  return { value }
}

function hasChinese(text) {
  return /[\u4e00-\u9fff]/.test(String(text || ''))
}

function assertChinese(text, pattern) {
  const value = String(text || '')
  assert.ok(hasChinese(value), `失败路径必须是中文，实际为：${value}`)
  if (pattern) assert.match(value, pattern)
}

function assertPipelineStopIsCancel() {
  for (const event of getOperationLogs()) {
    const action = String(event?.details?.action || event?.action || '')
    if (action.includes('pipeline_stop_complete')) {
      assert.equal(event.phase, 'cancel')
    }
  }
}

function rejectNetwork(label) {
  return async (...args) => {
    throw new Error(`${label} 不应发起真实网络请求：${JSON.stringify(args)}`)
  }
}

function stubFeedback() {
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

function createGenStore() {
  return {
    running: [],
    done: [],
    markRunning(meta) { this.running.push(meta) },
    markDone(meta) { this.done.push(meta) },
  }
}

function createStoryboard(overrides = {}) {
  return {
    id: STORYBOARD_ID,
    episode_id: EPISODE_ID,
    storyboard_number: 3,
    title: '推门',
    description: '李华推开办公室的门',
    image_prompt: '办公室门口，李华推门',
    polished_prompt: '电影感，办公室门口，李华推门进入',
    video_prompt: '镜头跟随李华推门进入办公室',
    creation_mode: 'classic',
    characters: [{ id: CHAR_ID }],
    ...overrides,
  }
}

const originalFetch = globalThis.fetch
const originalConsoleError = console.error
const originalConsoleWarn = console.warn

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

describe('filmCreateGenerationComposables', () => {
  let restoreFeedback = () => {}
  let restoreLogs = () => {}

  test.beforeEach(() => {
    resetOperationLogs()
    restoreLogs = installOperationLogSink(() => {})
  })

  test.afterEach(() => {
    assertPipelineStopIsCancel()
    restoreFeedback()
    restoreFeedback = () => {}
    restoreLogs()
    resetOperationLogs()
  })

  function captureFeedback() {
    const feedback = stubFeedback()
    restoreFeedback = feedback.restore
    return feedback
  }

  function createImageGeneration(overrides = {}) {
    const dramaId = overrides.dramaId || refOf(DRAMA_ID)
    const sb = overrides.sb || createStoryboard()
    const store = overrides.store || { storyboards: [sb], currentEpisode: { id: EPISODE_ID, episode_number: 2 } }
    const createCalls = []
    const updateCalls = []
    const pollCalls = []
    const genStore = overrides.genStore || createGenStore()
    const generatingSbImageIds = overrides.generatingSbImageIds || new Set()
    const generatingSbFirstImageIds = overrides.generatingSbFirstImageIds || new Set()
    const generatingSbLastImageIds = overrides.generatingSbLastImageIds || new Set()
    const storyboardsAPI = {
      update: async (id, payload) => { updateCalls.push({ id, payload }) },
      getFramePrompts: async () => ({ frame_prompts: [] }),
      generateFramePrompt: rejectNetwork('storyboardsAPI.generateFramePrompt'),
      saveFramePrompt: rejectNetwork('storyboardsAPI.saveFramePrompt'),
      ...(overrides.storyboardsAPI || {}),
    }
    const imagesAPI = {
      create: async (payload) => {
        createCalls.push(payload)
        return overrides.createResult === undefined ? { task_id: 'img-task' } : overrides.createResult
      },
      ...(overrides.imagesAPI || {}),
    }
    const api = useFilmCreateStoryboardImageGeneration({
      dramaId,
      store,
      storyboardsAPI,
      imagesAPI,
      genStore,
      pollTask: async (...args) => {
        pollCalls.push(args)
        return overrides.pollResult || { status: 'completed' }
      },
      captureStoryboardMediaRefresh: (id) => async () => { (overrides.refreshed ||= []).push(id) },
      refreshStoryboardMediaForCurrentContext: async (id) => { (overrides.refreshed ||= []).push(id) },
      restoreSelectionsFromBackend: () => { overrides.restored = true },
      loadDrama: async () => { overrides.loadedDrama = true },
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
      storyboardMediaActionReason: overrides.storyboardMediaActionReason || refOf(''),
      projectAspectRatio: refOf('16:9'),
      gridMode: refOf('single'),
      storyboardUseFirstLastFrame: overrides.storyboardUseFirstLastFrame || refOf(false),
      lastFrameUseFirstLayoutLock: refOf(false),
      sbLocation: refOf({ [STORYBOARD_ID]: '办公室' }),
      sbTime: refOf({ [STORYBOARD_ID]: '清晨' }),
      sbShotType: refOf({ [STORYBOARD_ID]: '中景' }),
      sbAngleH: refOf({ [STORYBOARD_ID]: 'front' }),
      sbAngleV: refOf({ [STORYBOARD_ID]: 'eye' }),
      sbAngleS: refOf({ [STORYBOARD_ID]: 'medium' }),
      sbResult: refOf({ [STORYBOARD_ID]: '门已打开' }),
      sbAction: refOf({ [STORYBOARD_ID]: '推门' }),
      sbAtmosphere: refOf({ [STORYBOARD_ID]: '紧张' }),
      sbCharacterIds: overrides.sbCharacterIds || refOf({ [STORYBOARD_ID]: [CHAR_ID] }),
      sbSelectedImgId: refOf({}),
      sbSelectedLastImgId: refOf({}),
      generatingSbImageIds,
      generatingSbFirstImageIds,
      generatingSbLastImageIds,
      showFramePromptEditor: refOf(false),
      editingFramePromptSb: refOf(null),
      editingFramePromptSlot: refOf(''),
      editingFramePromptText: refOf(''),
      editingFramePromptSaving: refOf(false),
      editingFramePromptRegenerating: refOf(false),
      ...overrides.deps,
    })
    return {
      api,
      sb,
      dramaId,
      store,
      createCalls,
      updateCalls,
      pollCalls,
      genStore,
      generatingSbImageIds,
    }
  }

  function createVideoGeneration(overrides = {}) {
    const dramaId = overrides.dramaId || refOf(DRAMA_ID)
    const sb = overrides.sb || createStoryboard()
    const createCalls = []
    const pollCalls = []
    const generatingSbVideoIds = overrides.generatingSbVideoIds || new Set()
    const sbVideoErrors = overrides.sbVideoErrors || refOf({})
    const genStore = overrides.genStore || createGenStore()
    const videosAPI = {
      create: async (payload) => {
        createCalls.push(payload)
        if (overrides.createError) throw overrides.createError
        return overrides.createResult === undefined ? { task_id: 'video-task' } : overrides.createResult
      },
      ...(overrides.videosAPI || {}),
    }
    const api = useFilmCreateStoryboardVideoGeneration({
      dramaId,
      videosAPI,
      storyboardsAPI: {
        update: rejectNetwork('storyboardsAPI.update'),
        ...(overrides.storyboardsAPI || {}),
      },
      genStore,
      pollTask: async (...args) => {
        pollCalls.push(args)
        return overrides.pollResult || { status: 'completed' }
      },
      captureStoryboardMediaRefresh: (id) => async () => { (overrides.refreshed ||= []).push(id) },
      sbVideoGenerationDisabledReason: overrides.sbVideoGenerationDisabledReason || (() => ''),
      isSbUniversalMode: overrides.isSbUniversalMode || (() => false),
      sbVideoReferenceImageId: refOf({}),
      getSbVideoReferenceGrid: overrides.getSbVideoReferenceGrid || (() => null),
      getActiveVideoAiConfig: overrides.getActiveVideoAiConfig || rejectNetwork('getActiveVideoAiConfig'),
      canUseUniversalOmniVideoApi: () => false,
      confirmUniversalNonSeedance2Video: async () => {},
      toAbsoluteImageUrl: (url) => url || '',
      assetImageUrl: (img) => img?.image_url || '',
      collectSbOmniReferenceAbsoluteUrls: () => [],
      collectSbSceneOnlyReferenceAbsoluteUrls: () => [],
      collectSbFreeReferenceAbsoluteUrls: () => [],
      getSbFirstFrameUrl: overrides.getSbFirstFrameUrl || (() => '/static/first.png'),
      getSbPrimaryReferenceAbsoluteUrl: () => '',
      generatingSbVideoIds,
      buildSbGenMeta: (board, resourceType, label) => ({
        dramaId: dramaId.value,
        episodeId: EPISODE_ID,
        resourceType,
        resourceId: board.id,
        label,
      }),
      sbVideoErrors,
      buildStoryboardVideoReferencePayload: overrides.buildStoryboardVideoReferencePayload || (async () => ({
        firstFrameUrl: '/static/first.png',
        absoluteUrl: '/static/first.png',
        lastFrameUrl: '',
        referenceUrls: [],
      })),
      assertStoryboardMediaReady: () => {},
      buildSbVideoPromptForApi: () => '镜头跟随李华推门进入办公室',
      getSelectedStyle: () => 'cinematic',
      projectAspectRatio: refOf('16:9'),
      videoResolution: refOf('720p'),
      getSbVideoDurationForApi: () => 5,
      sbSelectedVideoId: refOf({}),
      userFacingVideoGenerationError,
      ...overrides.deps,
    })
    return {
      api,
      sb,
      createCalls,
      pollCalls,
      genStore,
      generatingSbVideoIds,
      sbVideoErrors,
    }
  }

  function createUniversalSegment(overrides = {}) {
    const sb = overrides.sb || createStoryboard({ creation_mode: 'universal', universal_segment_text: '@图片1 推门' })
    const store = overrides.store || {
      currentEpisode: { id: EPISODE_ID, storyboards: [sb] },
    }
    const streamCalls = []
    const saved = []
    const generatingUniversalSegmentIds = overrides.generatingUniversalSegmentIds || new Set()
    const sbUniversalSegmentText = overrides.sbUniversalSegmentText || refOf({ [sb.id]: '@图片1 推门进入办公室' })
    const api = useFilmCreateUniversalSegment({
      store,
      storyboardsAPI: {
        generateUniversalSegmentPromptStream: rejectNetwork('generateUniversalSegmentPromptStream'),
        polishUniversalSegmentPromptStream: rejectNetwork('polishUniversalSegmentPromptStream'),
        ...(overrides.storyboardsAPI || {}),
      },
      generatingUniversalSegmentIds,
      sbUniversalSegmentText,
      sbUniversalSegmentTrimmed: (board) => String(sbUniversalSegmentText.value[board.id] || '').trim(),
      universalSegmentDurationSecForSb: () => 5,
      isSbUniversalMode: () => true,
      storyboardUniversalOmni: overrides.storyboardUniversalOmni || refOf(false),
      universalOmniPolishRunning: refOf(false),
      universalOmniPolishAbort: refOf(false),
      universalOmniPolishProgress: refOf({ current: 0, total: 0, label: '' }),
      pipelineRest: async () => {},
      onSaveUniversalSegmentField: async (board) => { saved.push(board.id) },
      ...overrides.deps,
    })
    return {
      api,
      sb,
      store,
      streamCalls,
      saved,
      generatingUniversalSegmentIds,
      sbUniversalSegmentText,
    }
  }

  function createLinkedRegen(overrides = {}) {
    const dramaId = overrides.dramaId || refOf(DRAMA_ID)
    const createCalls = []
    const taskGets = []
    const refreshed = []
    const regenSbImagesForAsset = overrides.regenSbImagesForAsset || new Set()
    const regenSbImagesProgress = overrides.regenSbImagesProgress || refOf(null)
    const api = useFilmCreateLinkedStoryboardRegen({
      dramaId,
      imagesAPI: {
        create: async (payload) => {
          createCalls.push(payload)
          if (overrides.createError) throw overrides.createError
          return overrides.createResult === undefined ? {} : overrides.createResult
        },
        ...(overrides.imagesAPI || {}),
      },
      taskAPI: {
        get: async (taskId) => {
          taskGets.push(taskId)
          throw new Error('taskAPI.get 不应在无 task_id 路径被调用')
        },
        ...(overrides.taskAPI || {}),
      },
      assertStoryboardMediaReady: overrides.assertStoryboardMediaReady || (() => {}),
      captureStoryboardMediaRefresh: (id) => async () => { refreshed.push(id) },
      storyboardUseFirstLastFrame: overrides.storyboardUseFirstLastFrame || refOf(false),
      isSbUniversalMode: () => false,
      ensureProfessionalFramePrompt: async () => '专业首帧提示词',
      getSelectedStyle: () => 'cinematic',
      projectAspectRatio: refOf('16:9'),
      regenSbImagesForAsset,
      regenSbImagesProgress,
      sbSelectedImgId: refOf({ [STORYBOARD_ID]: 1 }),
      ...overrides.deps,
    })
    return {
      api,
      createCalls,
      taskGets,
      refreshed,
      regenSbImagesForAsset,
      regenSbImagesProgress,
    }
  }

  function createResourceUpload(overrides = {}) {
    const dramaId = overrides.dramaId || refOf(DRAMA_ID)
    const uploadCalls = []
    const putImageCalls = []
    const updateCalls = []
    const loadDramaCalls = []
    const store = overrides.store || {
      characters: overrides.characters || [{ id: CHAR_ID, name: '李华', episode_id: EPISODE_ID }],
      props: [],
      scenes: [],
    }
    const api = useFilmCreateResourceUpload({
      dramaId,
      store,
      uploadAPI: {
        uploadImage: async (file, opts) => {
          uploadCalls.push({ file, opts })
          if (overrides.uploadError) throw overrides.uploadError
          return overrides.uploadResult || { url: '/static/new.png', local_path: 'uploads/new.png' }
        },
        ...(overrides.uploadAPI || {}),
      },
      characterAPI: {
        putImage: async (id, payload) => { putImageCalls.push({ id, payload }) },
        ...(overrides.characterAPI || {}),
      },
      propAPI: {
        update: async (id, payload) => { updateCalls.push({ type: 'prop', id, payload }) },
      },
      sceneAPI: {
        update: async (id, payload) => { updateCalls.push({ type: 'scene', id, payload }) },
      },
      loadDrama: async () => { loadDramaCalls.push(dramaId.value) },
      resourceUploadType: overrides.resourceUploadType || refOf(null),
      resourceUploadId: overrides.resourceUploadId || refOf(null),
      resourceImageFileInput: refOf({ click() {} }),
      uploadingResourceId: refOf(null),
      ...overrides.deps,
    })
    return {
      api,
      store,
      uploadCalls,
      putImageCalls,
      updateCalls,
      loadDramaCalls,
    }
  }

  test('storyboard image generation submits with distinct dramaId and reports Chinese poll failure', async () => {
    const feedback = captureFeedback()
    const ok = createImageGeneration()
    await ok.api.onGenerateSbImage(ok.sb)
    assert.equal(ok.createCalls.length, 1)
    assert.equal(ok.createCalls[0].drama_id, DRAMA_ID)
    assert.equal(ok.createCalls[0].storyboard_id, STORYBOARD_ID)
    assert.notEqual(ok.createCalls[0].drama_id, EPISODE_ID)
    assert.notEqual(ok.createCalls[0].drama_id, ok.createCalls[0].storyboard_id)
    assert.equal(ok.updateCalls[0].payload.character_ids[0], CHAR_ID)
    assert.equal(ok.pollCalls[0][2].dramaId, DRAMA_ID)
    assert.equal(ok.pollCalls[0][2].episodeId, EPISODE_ID)
    assert.notEqual(ok.pollCalls[0][2].dramaId, ok.pollCalls[0][2].episodeId)
    assert.equal(ok.pollCalls[0][2].resourceType, GEN_RESOURCE.SB_IMAGE)
    assert.match(feedback.last('success').message, /分镜图生成完成/)
    assert.equal(ok.generatingSbImageIds.size, 0)

    const failed = createImageGeneration({
      pollResult: { status: 'failed', error: '图片模型暂时不可用' },
    })
    await failed.api.onGenerateSbImage(failed.sb)
    assertChinese(failed.sb.errorMsg, /图片模型暂时不可用/)
    assert.equal(failed.genStore.done.length, 1)

    const thrown = createImageGeneration({
      imagesAPI: {
        create: async () => { throw new Error('分镜图提交失败，请稍后重试') },
      },
    })
    await thrown.api.onGenerateSbImage(thrown.sb)
    assertChinese(feedback.last('error').message, /分镜图提交失败/)
    assertChinese(thrown.sb.errorMsg, /分镜图提交失败/)
  })

  test('storyboard image generation stays idle for media lock and missing ids', async () => {
    const feedback = captureFeedback()
    const locked = createImageGeneration({
      storyboardMediaActionReason: refOf('分镜媒体尚未就绪，请稍后重试'),
    })
    await locked.api.onGenerateSbImage(locked.sb)
    assertChinese(feedback.last('warning').message, /分镜媒体尚未就绪/)
    assert.equal(locked.createCalls.length, 0)

    const missing = createImageGeneration({ dramaId: refOf(null) })
    await missing.api.onGenerateSbImage(missing.sb)
    assert.equal(missing.createCalls.length, 0)

    const prompt = locked.api.buildLastFrameImagePrompt(STORYBOARD_ID)
    assert.match(prompt, /办公室/)
    assert.match(prompt, /尾帧静止画面/)
    const first = locked.api.buildFirstFrameImagePrompt(STORYBOARD_ID)
    assert.match(first, /李华推门/)
  })

  test('storyboard video generation keeps drama/episode apart and maps English failures to Chinese', async () => {
    const feedback = captureFeedback()
    const ok = createVideoGeneration()
    await ok.api.onGenerateSbVideo(ok.sb)
    assert.equal(ok.createCalls.length, 1)
    assert.equal(ok.createCalls[0].drama_id, DRAMA_ID)
    assert.equal(ok.createCalls[0].storyboard_id, STORYBOARD_ID)
    assert.notEqual(ok.createCalls[0].drama_id, EPISODE_ID)
    assert.equal(ok.pollCalls[0][2].dramaId, DRAMA_ID)
    assert.equal(ok.pollCalls[0][2].episodeId, EPISODE_ID)
    assert.notEqual(ok.pollCalls[0][2].dramaId, ok.pollCalls[0][2].episodeId)
    assert.match(feedback.last('success').message, /视频生成完成/)
    assert.equal(ok.generatingSbVideoIds.size, 0)
    assert.equal(ok.sbVideoErrors.value[STORYBOARD_ID], '')

    const failed = createVideoGeneration({
      createError: new Error('failed to fetch'),
    })
    await failed.api.onGenerateSbVideo(failed.sb)
    assertChinese(failed.sbVideoErrors.value[STORYBOARD_ID], /无法连接视频生成服务/)
    assertChinese(feedback.last('error').message, /无法连接视频生成服务/)
    assert.equal(failed.createCalls.length, 1)
  })

  test('storyboard video generation warns in Chinese and honors cancel', async () => {
    const feedback = captureFeedback()
    const disabled = createVideoGeneration({
      sbVideoGenerationDisabledReason: () => '请先填写视频提示词或全能片段描述',
    })
    await disabled.api.onGenerateSbVideo(disabled.sb)
    assertChinese(feedback.last('warning').message, /请先填写视频提示词/)
    assert.equal(disabled.createCalls.length, 0)

    const missingGrid = createVideoGeneration({
      deps: {
        sbVideoReferenceImageId: refOf({ [STORYBOARD_ID]: 9 }),
        getSbVideoReferenceGrid: () => null,
      },
    })
    await missingGrid.api.onGenerateSbVideo(missingGrid.sb)
    assertChinese(feedback.last('error').message, /宫格视频参考图不存在/)
    assert.equal(missingGrid.createCalls.length, 0)

    feedback.setConfirm(async () => { throw 'cancel' })
    const noImage = createVideoGeneration({
      getSbFirstFrameUrl: () => '',
      buildStoryboardVideoReferencePayload: async () => ({
        firstFrameUrl: '',
        absoluteUrl: '',
        lastFrameUrl: '',
        referenceUrls: [],
      }),
    })
    await noImage.api.onGenerateSbVideo(noImage.sb)
    assertChinese(feedback.last('alert').message, /传统模式/)
    assert.equal(noImage.createCalls.length, 0)
  })

  test('universal segment converts @图片 tags and warns in Chinese when empty', async () => {
    const feedback = captureFeedback()
    const harness = createUniversalSegment()
    assert.equal(harness.api.universalSegmentAtImageToGrokTags('@图片1 推门 @图片2'), '<IMAGE_1> 推门 <IMAGE_2>')
    harness.api.onUniversalSegmentToGrokVideoTags(harness.sb)
    assert.equal(harness.sbUniversalSegmentText.value[STORYBOARD_ID], '<IMAGE_1> 推门进入办公室')
    assert.deepEqual(harness.saved, [STORYBOARD_ID])
    assert.match(feedback.last('success').message, /Grok/)

    harness.sbUniversalSegmentText.value[STORYBOARD_ID] = '   '
    await harness.api.onPolishUniversalSegmentPromptStream(harness.sb)
    assertChinese(feedback.last('warning').message, /请先填写或生成片段描述后再润色/)

    const empty = createUniversalSegment({
      sbUniversalSegmentText: refOf({ [STORYBOARD_ID]: '' }),
    })
    empty.api.onUniversalSegmentToGrokVideoTags(empty.sb)
    assertChinese(feedback.last('warning').message, /请先填写或生成片段描述/)
    assert.equal(empty.saved.length, 0)
  })

  test('universal post-generation polish skips when omni is off and when already running', async () => {
    const harness = createUniversalSegment({ storyboardUniversalOmni: refOf(false) })
    const skipped = await harness.api.polishUniversalSegmentsAfterGeneration()
    assert.equal(skipped.skipped, true)
    assert.equal(skipped.polished, 0)

    harness.generatingUniversalSegmentIds.add(STORYBOARD_ID)
    await harness.api.onGenerateUniversalSegmentPrompt(harness.sb)
    assert.equal(harness.generatingUniversalSegmentIds.has(STORYBOARD_ID), true)
  })

  test('linked storyboard regen cancels without network and reports Chinese failures', async () => {
    const feedback = captureFeedback()
    const boards = [createStoryboard({ storyboard_number: 3 })]
    feedback.setConfirm(async () => { throw 'cancel' })
    const cancelled = createLinkedRegen()
    await cancelled.api.onRegenAffectedSbImages('char-5', boards)
    assert.equal(cancelled.createCalls.length, 0)
    assert.equal(cancelled.taskGets.length, 0)
    assert.equal(cancelled.regenSbImagesForAsset.size, 0)
    assertChinese(feedback.last('confirm').message, /关联分镜/)

    const blocked = createLinkedRegen({
      assertStoryboardMediaReady: () => {
        throw new Error('分镜媒体尚未就绪，无法重新生成')
      },
    })
    await blocked.api.onRegenAffectedSbImages('char-5', boards)
    assert.equal(feedback.last('warning').message, '分镜媒体尚未就绪，无法重新生成')
    assertChinese(feedback.last('warning').message, /分镜媒体尚未就绪，无法重新生成/)
    assert.equal(blocked.createCalls.length, 0)
    assert.equal(blocked.taskGets.length, 0)
    assert.equal(blocked.regenSbImagesForAsset.size, 0)
  })

  test('linked storyboard regen submits with distinct dramaId when confirmed', async () => {
    const feedback = captureFeedback()
    const boards = [createStoryboard()]
    const harness = createLinkedRegen()
    await harness.api.onRegenAffectedSbImages('prop-4', boards)
    assert.equal(harness.createCalls.length, 1)
    assert.equal(harness.createCalls[0].drama_id, DRAMA_ID)
    assert.equal(harness.createCalls[0].storyboard_id, STORYBOARD_ID)
    assert.notEqual(harness.createCalls[0].drama_id, EPISODE_ID)
    assert.deepEqual(harness.refreshed, [STORYBOARD_ID])
    assert.equal(harness.taskGets.length, 0)
    assert.match(feedback.last('success').message, /已重新生成 1 张关联分镜图/)
    assert.equal(harness.regenSbImagesForAsset.size, 0)
  })

  test('resource upload writes extra images under dramaId and reports Chinese errors', async () => {
    const feedback = captureFeedback()
    const first = createResourceUpload()
    await first.api.doUploadResourceImage('character', CHAR_ID, { name: 'face.png', type: 'image/png' })
    assert.equal(first.uploadCalls[0].opts.dramaId, DRAMA_ID)
    assert.notEqual(first.uploadCalls[0].opts.dramaId, EPISODE_ID)
    assert.equal(first.putImageCalls[0].id, CHAR_ID)
    assert.equal(first.putImageCalls[0].payload.image_url, '/static/new.png')
    assert.equal(first.loadDramaCalls[0], DRAMA_ID)
    assert.match(feedback.last('success').message, /上传成功/)

    const extras = createResourceUpload({
      characters: [{
        id: CHAR_ID,
        local_path: 'uploads/old.png',
        extra_images: JSON.stringify(['uploads/old-extra.png']),
      }],
    })
    await extras.api.doUploadResourceImage('character', CHAR_ID, { name: 'face2.png', type: 'image/png' })
    const extraPayload = JSON.parse(extras.putImageCalls[0].payload.extra_images)
    assert.deepEqual(extraPayload, ['uploads/old-extra.png', 'uploads/new.png'])
    assert.equal(extras.api.findResource('character', CHAR_ID).id, CHAR_ID)
    assert.equal(extras.api.localPathToUrl('uploads/new.png'), '/static/uploads/new.png')
    assert.deepEqual(extras.api.parseExtraImages({ extra_images: extraPayload }), extraPayload)

    const failed = createResourceUpload({
      uploadError: new Error('角色参考图上传失败，请稍后重试'),
    })
    await failed.api.doUploadResourceImage('character', CHAR_ID, { name: 'face.png', type: 'image/png' })
    assertChinese(feedback.last('error').message, /角色参考图上传失败/)
    assert.equal(failed.putImageCalls.length, 0)
  })

  test('resource upload click/file change stay idle without a file', async () => {
    const clicked = []
    const resourceUploadType = refOf(null)
    const resourceUploadId = refOf(null)
    const harness = createResourceUpload({
      resourceUploadType,
      resourceUploadId,
      deps: {
        resourceImageFileInput: refOf({ click() { clicked.push(true) } }),
      },
    })
    harness.api.onUploadResourceClick('character', CHAR_ID)
    assert.equal(resourceUploadType.value, 'character')
    assert.equal(resourceUploadId.value, CHAR_ID)
    assert.equal(clicked.length, 1)

    const ev = { target: { files: [], value: 'kept' } }
    harness.api.onResourceImageFileChange(ev)
    assert.equal(ev.target.value, '')
    assert.equal(harness.uploadCalls.length, 0)
  })
})
