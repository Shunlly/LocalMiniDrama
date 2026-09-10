import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { remainingExtractNamedFunction } from './helpers/remainingSourceBetween.js'
import { useFilmCreateEpisodeCompose } from '../src/composables/filmCreate/useFilmCreateEpisodeCompose.js'
import { toUserFacingError } from '../src/utils/userFacingError.js'

const resourceDialogs = readFileSync(new URL('../src/components/filmCreate/FilmCreateResourceDialogs.vue', import.meta.url), 'utf8')
const imageColumn = readFileSync(new URL('../src/components/filmCreate/FilmCreateStoryboardImageColumn.vue', import.meta.url), 'utf8').replace(/\r\n?/g, '\n')
const panel = readFileSync(new URL('../src/components/filmCreate/FilmCreateStoryboardPanel.vue', import.meta.url), 'utf8')
const filmCreate = readFileSync(new URL('../src/views/FilmCreate.vue', import.meta.url), 'utf8')
const novelUx = readFileSync(new URL('../src/components/filmCreate/novelIntakeUx.js', import.meta.url), 'utf8')
const composeSource = readFileSync(new URL('../src/composables/filmCreate/useFilmCreateEpisodeCompose.js', import.meta.url), 'utf8')
const charactersSource = readFileSync(new URL('../src/composables/filmCreate/useCharacters.js', import.meta.url), 'utf8')

const DRAMA_ID = 11
const EPISODE_ID = 22
assert.notEqual(DRAMA_ID, EPISODE_ID)

const describeAddToEpisodeDisabledReason = new Function(
  `'use strict'; ${remainingExtractNamedFunction(resourceDialogs, 'describeAddToEpisodeDisabledReason')}; return describeAddToEpisodeDisabledReason;`,
)()
const describeImageGenerateDisabledReason = new Function(
  `'use strict'; ${remainingExtractNamedFunction(imageColumn, 'describeImageGenerateDisabledReason')}; return describeImageGenerateDisabledReason;`,
)()
const describeUpscaleDisabledReason = new Function(
  `'use strict'; ${remainingExtractNamedFunction(imageColumn, 'describeUpscaleDisabledReason')}; return describeUpscaleDisabledReason;`,
)()
const describeStoryboardImageError = new Function(
  'toUserFacingError',
  `'use strict'; ${remainingExtractNamedFunction(imageColumn, 'describeStoryboardImageError')}; return describeStoryboardImageError;`,
)(toUserFacingError)

function refOf(value) {
  return { value }
}

test('道具和场景库空状态下一步可点，不再只剩一句空文案', () => {
  assert.match(resourceDialogs, /@click="returnToPropPanel">去道具面板/)
  assert.match(resourceDialogs, /@click="returnToPropPanel">创建道具/)
  assert.match(resourceDialogs, /@click="returnToScenePanel">去场景面板/)
  assert.match(resourceDialogs, /@click="returnToScenePanel">创建场景/)
  assert.match(filmCreate, /returnToPropPanel, returnToScenePanel/)
  assert.doesNotMatch(
    resourceDialogs,
    /<div v-if="!propLibraryLoading && propLibraryList.length === 0" class="library-empty">暂无本剧道具库记录/,
  )
})

test('加入本集禁用时给出中文原因，且不把剧集 id 当成项目 id', () => {
  assert.equal(describeAddToEpisodeDisabledReason(null), '请先创建或选择剧集')
  assert.equal(describeAddToEpisodeDisabledReason(''), '请先创建或选择剧集')
  assert.equal(describeAddToEpisodeDisabledReason(EPISODE_ID), '')
  assert.notEqual(DRAMA_ID, EPISODE_ID)
  assert.match(resourceDialogs, /<ActionGate :reason="addToEpisodeDisabledReason" label="加入本集">/)
  assert.match(resourceDialogs, /:disabled="Boolean\(addToEpisodeDisabledReason\)"/)
})

test('分镜生图和超分禁用时给出中文原因，制作页把媒体原因接到图列', () => {
  assert.equal(describeImageGenerateDisabledReason(''), '')
  assert.equal(describeImageGenerateDisabledReason('分镜图片或视频读取失败，请先重试加载素材'), '分镜图片或视频读取失败，请先重试加载素材')
  assert.equal(describeUpscaleDisabledReason(true), '')
  assert.equal(describeUpscaleDisabledReason(false), '当前分镜没有可超分的本地图片')
  assert.match(imageColumn, /<ActionGate :reason="imageGenerateDisabledReason" label="生成分镜参考图">/)
  assert.match(imageColumn, /<ActionGate :reason="upscaleDisabledReason" label="超分">/)
  assert.match(panel, /:storyboard-media-action-reason="storyboardMediaActionReason"/)
  assert.match(filmCreate, /storyboardPanel: \{[\s\S]*storyboardMediaActionReason/)
})

test('分镜图失败文案和成片/音色成功提示不会把英文原文弹给用户', () => {
  assert.equal(describeStoryboardImageError({ error_msg: 'Network Error' }), '生成失败')
  assert.equal(describeStoryboardImageError({ errorMsg: '请先配置图片模型' }), '请先配置图片模型')
  assert.match(composeSource, /ElMessage\.success\(toUserFacingError\(result\?\.message, '视频合成任务已提交，请稍后查看'\)\)/)
  assert.match(charactersSource, /ElMessage\.success\(toUserFacingError\(res\?\.data\?\.message, '音色状态已刷新'\)\)/)
  assert.equal(toUserFacingError('Task submitted', '视频合成任务已提交，请稍后查看'), '视频合成任务已提交，请稍后查看')
  assert.equal(toUserFacingError('Voice refreshed', '音色状态已刷新'), '音色状态已刷新')
})

test('小说导入不再写没有 OCR，而是引导去配置图片识别或语音转写', () => {
  assert.match(novelUx, /图片识别/)
  assert.match(novelUx, /语音转写/)
  assert.match(novelUx, /AI 配置/)
  assert.doesNotMatch(novelUx, /当前没有 OCR|当前没有图片 OCR|暂不支持自动抽取/)
  assert.doesNotMatch(novelUx, /service_type=ocr/)
})

test('成片提交成功时英文接口文案会被收成中文', async () => {
  const messages = []
  const compose = useFilmCreateEpisodeCompose({
    store: {
      drama: { title: '项目甲' },
      currentEpisode: { episode_number: 2 },
      setVideoStatus() {},
      setVideoProgress() {},
      getVideoStatus() { return 'generating' },
    },
    dramaId: refOf(DRAMA_ID),
    currentEpisodeId: refOf(EPISODE_ID),
    dramaAPI: {
      async finalizeEpisode(epId) {
        assert.equal(epId, EPISODE_ID)
        assert.notEqual(epId, DRAMA_ID)
        return { task_id: 'merge-1', message: 'Task submitted' }
      },
    },
    genStore: { markRunning() {}, markDone() {} },
    pollTask: async () => ({ status: 'completed' }),
    captureDramaRefresh: () => async () => {},
    loadDrama: async () => {},
    composeActionDisabledReason: refOf(''),
    currentEpisodeVideoUrl: refOf('/static/ok.mp4'),
    videoErrorMsg: refOf(''),
    videoSubtitle: refOf(false),
    videoBurnDialogue: refOf(false),
    videoWatermark: refOf(false),
    videoWatermarkText: refOf(''),
  })
  const original = (await import('element-plus')).ElMessage
  const prev = { success: original.success, warning: original.warning, error: original.error, info: original.info }
  original.success = (message) => messages.push(['success', message])
  original.warning = (message) => messages.push(['warning', message])
  original.error = (message) => messages.push(['error', message])
  try {
    await compose.onGenerateVideo()
  } finally {
    original.success = prev.success
    original.warning = prev.warning
    original.error = prev.error
  }
  assert.ok(messages.some((item) => item[0] === 'success' && /视频合成任务已提交|视频生成完成/.test(item[1])))
  assert.equal(messages.some((item) => /Task submitted/i.test(item[1])), false)
})
