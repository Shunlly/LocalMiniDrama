import test from 'node:test'
import assert from 'node:assert/strict'
import { ref } from 'vue'
import { useFilmCreateActionDisabledReasons } from '../src/composables/filmCreate/useFilmCreateActionDisabledReasons.js'

const DRAMA_ID = 11
const EPISODE_ID = 22

function createReasons(overrides = {}) {
  assert.notEqual(DRAMA_ID, EPISODE_ID)
  return useFilmCreateActionDisabledReasons({
    dramaId: ref(DRAMA_ID),
    currentEpisodeId: ref(EPISODE_ID),
    charactersGenerating: ref(false),
    propsExtracting: ref(false),
    scenesExtracting: ref(false),
    pipelineRunning: ref(false),
    storyboardMediaActionReason: ref(''),
    productionReadinessReason: ref(''),
    storyboardGenerating: ref(false),
    universalOmniPolishRunning: ref(false),
    batchImageRunning: ref(false),
    batchVideoRunning: ref(false),
    videoCapabilityReason: ref(''),
    storyboards: ref([]),
    assetVideoUrl: (url) => url,
    getSbVideo: () => '',
    videoStatus: ref('idle'),
    ...overrides,
  })
}

test('missing project or episode blocks resource actions in Chinese', () => {
  const noProject = createReasons({ dramaId: ref(null), currentEpisodeId: ref(null) })
  assert.equal(noProject.projectActionDisabledReason.value, '请先创建或打开项目')
  assert.equal(noProject.characterGenerationDisabledReason.value, '请先创建或打开项目')
  assert.equal(noProject.episodeActionDisabledReason.value, '请先创建或选择剧集')
  assert.equal(noProject.propsExtractionDisabledReason.value, '请先创建或选择剧集')
  assert.equal(noProject.scenesExtractionDisabledReason.value, '请先创建或选择剧集')
})

test('production pipeline combines media and readiness reasons without mixing ids', () => {
  const reasons = createReasons({
    storyboardMediaActionReason: ref('分镜媒体尚未就绪'),
    productionReadinessReason: ref('视频模型：未配置'),
  })
  assert.equal(reasons.productionPipelineActionDisabledReason.value, '分镜媒体尚未就绪')
  const readinessOnly = createReasons({
    productionReadinessReason: ref('视频模型：未配置'),
  })
  assert.equal(readinessOnly.productionPipelineActionDisabledReason.value, '视频模型：未配置')
  assert.notEqual(DRAMA_ID, EPISODE_ID)
})

test('compose stays blocked until every storyboard has a playable video', () => {
  const reasons = createReasons({
    storyboards: ref([{ id: 101 }, { id: 202 }]),
    getSbVideo: (id) => (id === 101 ? '/static/a.mp4' : ''),
  })
  assert.match(reasons.composeActionDisabledReason.value, /请先为全部分镜生成可播放视频/)
  assert.equal(reasons.playableStoryboardVideoCount.value, 1)
  const ready = createReasons({
    storyboards: ref([{ id: 101 }, { id: 202 }]),
    getSbVideo: () => '/static/ok.mp4',
  })
  assert.equal(ready.composeActionDisabledReason.value, '')
  assert.equal(ready.playableStoryboardVideoCount.value, 2)
})
