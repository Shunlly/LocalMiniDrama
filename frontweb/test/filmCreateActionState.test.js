import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  batchGenerationDisabledReason,
  composeVideoDisabledReason,
  episodeResourceDisabledReason,
  getGenerationServiceCapability,
  getVideoGenerationCapability,
  pipelineDisabledReason,
  projectResourceDisabledReason,
  missingAssetImageReason,
  saveCurrentEpisodeDisabledReason,
  storyboardDisabledReason,
  userFacingVideoGenerationError,
} from '../src/utils/filmCreateActionState.js'
import { useFilmCreateActionDisabledReasons } from '../src/composables/filmCreate/useFilmCreateActionDisabledReasons.js'
import { useFilmCreateEpisodeCompose } from '../src/composables/filmCreate/useFilmCreateEpisodeCompose.js'
import { useFilmCreateProductionReadiness } from '../src/composables/filmCreate/useFilmCreateProductionReadiness.js'
import { useFilmCreateStoryboardAccessors } from '../src/composables/filmCreate/useFilmCreateStoryboardAccessors.js'
import { ElMessage } from 'element-plus'

test('resource actions explain missing context and active work', () => {
  assert.equal(projectResourceDisabledReason({ hasProject: false }), '请先创建或打开项目')
  assert.equal(
    projectResourceDisabledReason({ hasProject: true, running: true, label: '角色' }),
    '正在处理角色，请等待完成',
  )
  assert.equal(episodeResourceDisabledReason({ hasEpisode: false }), '请先创建或选择剧集')
  assert.equal(episodeResourceDisabledReason({ hasEpisode: true }), '')
})

test('保存当前集和入库按钮在缺剧集或缺图时给出中文原因', () => {
  const dramaId = 9
  const selectedEpisodeId = 7
  assert.notEqual(dramaId, selectedEpisodeId)
  assert.equal(saveCurrentEpisodeDisabledReason({
    dramaId,
    hasAnyEpisode: true,
    currentEpisodeId: null,
  }), '请先选择要保存的剧集')
  assert.equal(saveCurrentEpisodeDisabledReason({
    dramaId,
    hasAnyEpisode: true,
    currentEpisodeId: selectedEpisodeId,
  }), '')
  assert.equal(saveCurrentEpisodeDisabledReason({
    dramaId: null,
    hasAnyEpisode: false,
    currentEpisodeId: null,
  }), '')
  assert.equal(missingAssetImageReason(false), '请先生成或上传图片')
  assert.equal(missingAssetImageReason(true), '')
})

test('pipeline and storyboard actions expose the first blocking reason', () => {
  assert.equal(pipelineDisabledReason({ hasEpisode: false, pipelineRunning: false }), '请先创建或选择剧集')
  assert.match(pipelineDisabledReason({ hasEpisode: true, pipelineRunning: true }), /全流程任务/)
  assert.match(
    storyboardDisabledReason({ hasEpisode: true, storyboardGenerating: true, omniPolishing: false }),
    /正在生成分镜/,
  )
  assert.equal(
    storyboardDisabledReason({ hasEpisode: true, storyboardGenerating: false, omniPolishing: false }),
    '',
  )
})

test('batch generation prioritizes the active pipeline and generation tasks', () => {
  assert.match(batchGenerationDisabledReason({
    hasEpisode: true,
    pipelineRunning: true,
    storyboardGenerating: true,
    omniPolishing: false,
    batchImageRunning: false,
    batchVideoRunning: false,
  }), /全流程任务/)
  assert.match(batchGenerationDisabledReason({
    hasEpisode: true,
    pipelineRunning: false,
    storyboardGenerating: false,
    omniPolishing: false,
    batchImageRunning: false,
    batchVideoRunning: true,
  }), /分镜视频/)
})

test('compose action requires an episode and at least one storyboard', () => {
  assert.equal(composeVideoDisabledReason({ hasEpisode: false, storyboardCount: 2 }), '请先创建或选择剧集')
  assert.equal(composeVideoDisabledReason({ hasEpisode: true, storyboardCount: 0 }), '请先生成或添加分镜')
  assert.match(composeVideoDisabledReason({ hasEpisode: true, storyboardCount: 2, videoGenerating: true }), /正在合成视频/)
  assert.match(composeVideoDisabledReason({
    hasEpisode: true,
    storyboardCount: 2,
    videoGenerating: false,
    pipelineRunning: false,
    batchVideoRunning: true,
  }), /分镜视频/)
  assert.equal(composeVideoDisabledReason({ hasEpisode: true, storyboardCount: 2, videoGenerating: false }), '')
  assert.equal(
    composeVideoDisabledReason({ hasEpisode: true, storyboardCount: 2, playableVideoCount: 1 }),
    '请先为全部分镜生成可播放视频（已完成 1/2）',
  )
})

test('video generation errors hide placeholders and generic server failures', () => {
  assert.equal(
    userFacingVideoGenerationError('mock://dramas/1/storyboards/2/video.mp4'),
    '草稿占位视频，尚未生成可播放片段。',
  )
  assert.equal(
    userFacingVideoGenerationError('Internal server error'),
    '视频生成服务暂时不可用，请检查视频模型配置后重试。',
  )
  assert.equal(userFacingVideoGenerationError('模型额度不足'), '模型额度不足')
})

test('video and production capabilities require a usable model, with only explicit ComfyUI workflow exception', () => {
  const emptyVideo = getVideoGenerationCapability([{
    service_type: 'video',
    is_active: true,
    is_default: true,
    model: [],
    default_model: '',
  }])
  assert.equal(emptyVideo.ready, false)
  assert.match(emptyVideo.reason, /尚未选择可用模型/)

  const comfyImage = getGenerationServiceCapability([{
    service_type: 'image',
    api_protocol: 'comfyui',
    is_active: true,
    is_default: true,
    model: [],
    settings: JSON.stringify({ workflow: { '1': { class_type: 'CheckpointLoaderSimple' } } }),
  }], 'image')
  assert.equal(comfyImage.ready, true)
  assert.equal(comfyImage.modelOptional, true)
})

test('FilmCreate delegates pipeline UI and wraps major gated actions', async () => {
  const filmCreateSource = readFileSync(new URL('../src/views/FilmCreate.vue', import.meta.url), 'utf8')
  const pipelinePanelSource = readFileSync(
    new URL('../src/components/filmCreate/FilmCreatePipelinePanel.vue', import.meta.url),
    'utf8',
  )
  const deliveryPanelSource = readFileSync(
    new URL('../src/components/filmCreate/FilmCreateDeliveryPanel.vue', import.meta.url),
    'utf8',
  )

  const reasons = useFilmCreateActionDisabledReasons({
    dramaId: { value: 11 },
    currentEpisodeId: { value: 22 },
    charactersGenerating: { value: false },
    propsExtracting: { value: false },
    scenesExtracting: { value: false },
    pipelineRunning: { value: false },
    storyboardMediaActionReason: { value: '' },
    productionReadinessReason: { value: '' },
    storyboardGenerating: { value: false },
    universalOmniPolishRunning: { value: false },
    batchImageRunning: { value: false },
    batchVideoRunning: { value: false },
    videoCapabilityReason: { value: '尚未选择可用模型' },
    storyboards: { value: [{ id: 101 }, { id: 202 }] },
    assetVideoUrl: (url) => url,
    getSbVideo: (id) => (id === 101 ? '/static/a.mp4' : ''),
    videoStatus: { value: 'idle' },
  })
  assert.match(reasons.composeActionDisabledReason.value, /请先为全部分镜生成可播放视频/)
  assert.equal(reasons.playableStoryboardVideoCount.value, 1)
  assert.equal(reasons.batchVideoActionDisabledReason.value, '尚未选择可用模型')

  const warnings = []
  const originalWarning = ElMessage.warning
  ElMessage.warning = (message) => { warnings.push(message) }
  try {
    const compose = useFilmCreateEpisodeCompose({
      store: {},
      dramaId: { value: 11 },
      currentEpisodeId: { value: 22 },
      dramaAPI: { async composeVideo() { throw new Error('不应开始合成') } },
      genStore: { markRunning() {}, markFailed() {} },
      pollTask: async () => {},
      captureDramaRefresh() {},
      loadDrama: async () => {},
      composeActionDisabledReason: reasons.composeActionDisabledReason,
      currentEpisodeVideoUrl: { value: '' },
      videoErrorMsg: { value: '' },
      videoSubtitle: { value: false },
      videoBurnDialogue: { value: false },
      videoWatermark: { value: false },
      videoWatermarkText: { value: '' },
    })
    await compose.onGenerateVideo()
    assert.deepEqual(warnings, [reasons.composeActionDisabledReason.value])
  } finally {
    ElMessage.warning = originalWarning
  }

  const accessors = useFilmCreateStoryboardAccessors({
    store: { storyboards: [{ id: 101, composed_image: '/static/composed.png' }] },
    sbImages: { value: { 101: [{ id: 9, image_url: '/static/a.png', status: 'completed' }] } },
    sbVideos: { value: {} },
    sbVideoErrors: { value: {} },
    storyboardUseFirstLastFrame: { value: false },
    isSbUniversalMode: () => false,
    storyboardsAPI: {},
    imagesAPI: {},
    ElMessage,
    ElMessageBox: { async confirm() {} },
    refreshStoryboardMediaForCurrentContext: async () => {},
    assetImageUrl: (item) => item?.image_url || item?.local_path || '',
    assetVideoUrl: (url) => url,
    recordHasPlayableVideoUrl: () => false,
    toAbsoluteImageUrl: (url) => url,
    userFacingVideoGenerationError: (value) => value,
    sbVideoReferenceImageId: { value: {} },
  })
  assert.equal(accessors.hasSbImage({ composed_image: '/static/composed.png' }), true)
  assert.deepEqual(accessors.getSbAllImages(101).map((item) => item.id), [9])
  assert.equal(accessors.getSbFirstFrameUrl({ id: 101 }), '/static/a.png')
  const fallbackAccessors = useFilmCreateStoryboardAccessors({
    store: { storyboards: [] },
    sbImages: { value: {} },
    sbVideos: { value: {} },
    sbVideoErrors: { value: {} },
    storyboardUseFirstLastFrame: { value: false },
    isSbUniversalMode: () => false,
    storyboardsAPI: {},
    imagesAPI: {},
    ElMessage,
    ElMessageBox: { async confirm() {} },
    refreshStoryboardMediaForCurrentContext: async () => {},
    assetImageUrl: (item) => item?.image_url || item?.local_path || '',
    assetVideoUrl: (url) => url,
    recordHasPlayableVideoUrl: () => false,
    toAbsoluteImageUrl: (url) => url,
    userFacingVideoGenerationError: (value) => value,
    sbVideoReferenceImageId: { value: {} },
  })
  assert.equal(fallbackAccessors.getSbFirstFrameUrl({ id: 404, composed_image: '/static/composed.png' }), '/static/composed.png')

  const originalFetch = globalThis.fetch
  const posts = []
  globalThis.fetch = async (url, options = {}) => {
    posts.push({ url: String(url), body: options.body })
    return new Response(JSON.stringify({ success: true, data: { ready: true, missing_capabilities: [] } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  try {
    const productionReadinessLoading = { value: false }
    const productionReadinessFailed = { value: false }
    const authoritativeProductionReadiness = { value: null }
    const readiness = useFilmCreateProductionReadiness({
      dramaId: { value: 11 },
      productionReadinessLoading,
      productionReadinessFailed,
      authoritativeProductionReadiness,
      videoCapabilityLoading: { value: false },
      videoCapabilityFailed: { value: false },
      videoCapabilityConfigs: { value: [] },
    })
    await readiness.refreshProductionReadiness()
    assert.match(posts[0].url, /\/workflows\/novel2anime\/readiness/)
    assert.equal(JSON.parse(posts[0].body).qa_mode, 'production')
    assert.equal(JSON.parse(posts[0].body).drama_id, 11)
  } finally {
    globalThis.fetch = originalFetch
  }

  assert.match(filmCreateSource, /<FilmCreatePipelinePanel/)
  assert.doesNotMatch(filmCreateSource, /class="one-click-actions"/)
  assert.match(filmCreateSource, /:character-generation-disabled-reason="characterGenerationDisabledReason"/)
  assert.match(filmCreateSource, /<FilmCreateResourcePanel/)
  assert.match(filmCreateSource, /:batch-action-disabled-reason="batchActionDisabledReason"/)
  assert.match(filmCreateSource, /<FilmCreateStoryboardPanel/)
  assert.match(deliveryPanelSource, /:reason="composeActionDisabledReason"/)
  assert.match(filmCreateSource, /ttsGenerationDisabledReason/)
  assert.match(filmCreateSource, /productionReadinessReason/)
  assert.match(pipelinePanelSource, /高级|生成设置/)
  assert.match(pipelinePanelSource, /<ActionGate label="一键生成成片" :reason="productionReason">/)
  assert.match(pipelinePanelSource, /<ActionGate label="仅生成文本框架" :reason="draftReason">/)
  assert.match(pipelinePanelSource, /完整成片/)
  assert.match(pipelinePanelSource, /草稿预演/)
})
