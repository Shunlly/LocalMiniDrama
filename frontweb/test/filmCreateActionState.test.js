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
  storyboardDisabledReason,
  userFacingVideoGenerationError,
} from '../src/utils/filmCreateActionState.js'

test('resource actions explain missing context and active work', () => {
  assert.equal(projectResourceDisabledReason({ hasProject: false }), '请先创建或打开项目')
  assert.equal(
    projectResourceDisabledReason({ hasProject: true, running: true, label: '角色' }),
    '正在处理角色，请等待完成',
  )
  assert.equal(episodeResourceDisabledReason({ hasEpisode: false }), '请先创建或选择剧集')
  assert.equal(episodeResourceDisabledReason({ hasEpisode: true }), '')
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

test('FilmCreate delegates pipeline UI and wraps major gated actions', () => {
  const filmCreateSource = readFileSync(new URL('../src/views/FilmCreate.vue', import.meta.url), 'utf8')
  const pipelinePanelSource = readFileSync(
    new URL('../src/components/filmCreate/FilmCreatePipelinePanel.vue', import.meta.url),
    'utf8',
  )
  const deliveryPanelSource = readFileSync(
    new URL('../src/components/filmCreate/FilmCreateDeliveryPanel.vue', import.meta.url),
    'utf8',
  )

  assert.match(filmCreateSource, /<FilmCreatePipelinePanel/)
  assert.doesNotMatch(filmCreateSource, /class="one-click-actions"/)
  assert.match(filmCreateSource, /:reason="characterGenerationDisabledReason"/)
  assert.match(filmCreateSource, /:reason="batchActionDisabledReason"/)
  assert.match(deliveryPanelSource, /:reason="composeActionDisabledReason"/)
  assert.match(filmCreateSource, /if \(composeActionDisabledReason\.value\)/)
  assert.match(filmCreateSource, /videoCapabilityReason\.value/)
  assert.match(filmCreateSource, /ttsGenerationDisabledReason/)
  assert.match(filmCreateSource, /playableVideoCount: playableStoryboardVideoCount\.value/)
  assert.match(filmCreateSource, /return getSbImagesList\(sbImages\.value, storyboardId\)/)
  assert.match(filmCreateSource, /hasRealMediaValue\(sb\?\.composed_image\)/)
  assert.match(filmCreateSource, /getNovel2AnimeReadiness\(\{[\s\S]*qa_mode: 'production'/)
  assert.match(filmCreateSource, /productionReadinessReason/)
  assert.match(filmCreateSource, /service_type: 'tts'|key: 'tts'|tts/i)
  assert.match(pipelinePanelSource, /高级|生成设置/)
  assert.match(pipelinePanelSource, /<ActionGate label="一键生成成片" :reason="productionReason">/)
  assert.match(pipelinePanelSource, /<ActionGate label="仅生成文本框架" :reason="draftReason">/)
  assert.match(pipelinePanelSource, /完整成片/)
  assert.match(pipelinePanelSource, /草稿预演/)
})
