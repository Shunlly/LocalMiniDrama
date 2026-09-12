import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { useFilmCreateDeliveryActions } from '../src/composables/filmCreate/useFilmCreateDeliveryActions.js'
import { useFilmCreateMediaPreview } from '../src/composables/filmCreate/useFilmCreateMediaPreview.js'
import { useFilmCreateProjectLoadSurface } from '../src/composables/filmCreate/useFilmCreateProjectLoadSurface.js'
import { describeOutputVideoSettingsLock } from '../src/components/filmCreate/filmCreateOutputSectionCopy.js'

const storyboardPanel = readFileSync(new URL('../src/components/filmCreate/FilmCreateStoryboardPanel.vue', import.meta.url), 'utf8') + '\n' + readFileSync(new URL('../src/components/filmCreate/FilmCreateStoryboardPanel.css', import.meta.url), 'utf8')
const storyboardConfigBar = [
  readFileSync(new URL('../src/components/filmCreate/FilmCreateStoryboardConfigBar.vue', import.meta.url), 'utf8'),
  readFileSync(new URL('../src/components/filmCreate/filmCreateStoryboardConfigBarCopy.js', import.meta.url), 'utf8'),
].join('\n')
const scriptWorkbench = readFileSync(new URL('../src/components/filmCreate/FilmCreateScriptWorkbench.vue', import.meta.url), 'utf8')
const resourcePanel = [
  readFileSync(new URL('../src/components/filmCreate/FilmCreateResourcePanel.vue', import.meta.url), 'utf8'),
  readFileSync(new URL('../src/components/filmCreate/FilmCreateCharacterBlock.vue', import.meta.url), 'utf8'),
  readFileSync(new URL('../src/components/filmCreate/FilmCreatePropBlock.vue', import.meta.url), 'utf8'),
  readFileSync(new URL('../src/components/filmCreate/FilmCreateSceneBlock.vue', import.meta.url), 'utf8'),
  readFileSync(new URL('../src/components/filmCreate/filmCreateResourcePanelCopy.js', import.meta.url), 'utf8'),
].join('\n')
const outputSection = [
  readFileSync(new URL('../src/components/filmCreate/FilmCreateOutputSection.vue', import.meta.url), 'utf8'),
  readFileSync(new URL('../src/components/filmCreate/filmCreateOutputSectionCopy.js', import.meta.url), 'utf8'),
].join('\n')
const deliveryPanel = [
  readFileSync(new URL('../src/components/filmCreate/FilmCreateDeliveryPanel.vue', import.meta.url), 'utf8'),
  readFileSync(new URL('../src/components/filmCreate/filmCreateDeliveryPanelCopy.js', import.meta.url), 'utf8'),
].join('\n')
const warningSource = readFileSync(new URL('../src/components/filmCreate/FilmCreateProjectDependencyWarning.vue', import.meta.url), 'utf8')

const DRAMA_ID = 11
const EPISODE_ID = 22
assert.notEqual(DRAMA_ID, EPISODE_ID)

function refOf(value) {
  return { value }
}

function createDeliveryActions(overrides = {}) {
  const messages = []
  return {
    messages,
    actions: useFilmCreateDeliveryActions({
      store: { drama: { title: '项目甲' } },
      ElMessage: {
        success(message) { messages.push(['success', message]) },
        error(message) { messages.push(['error', message]) },
      },
      dramaId: refOf(DRAMA_ID),
      currentEpisode: refOf({ episode_number: 2, video_url: '/static/final.mp4' }),
      currentEpisodeId: refOf(EPISODE_ID),
      storyboards: refOf([{ id: 31, dialogue: '对白' }]),
      videoStatus: refOf('idle'),
      videoProgress: refOf(0),
      timelinesAPI: {
        getEpisodeSrt: async () => new Blob(['1\n00:00:00,000 --> 00:00:01,000\n对白\n'], { type: 'text/plain' }),
      },
      dramaAPI: {
        exportDrama: async () => new Blob([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00])], { type: 'application/zip' }),
      },
      ...overrides,
    }),
  }
}

test('分镜导出按钮在没有剧集时展示禁用原因', () => {
  assert.match(storyboardPanel, /<FilmCreateStoryboardConfigBar/)
  assert.match(storyboardConfigBar, /<ActionGate[\s\S]*?label="导出分镜表"/)
  assert.match(storyboardConfigBar, /<ActionGate[\s\S]*?label="导出解说 SRT"/)
  assert.match(storyboardConfigBar, /:disabled="Boolean\(episodeActionDisabledReason\)"/)
  assert.match(storyboardConfigBar, /首尾帧模式下使用单张图，序列宫格暂不可用/)
})

test('保存当前集在未选剧集时展示禁用原因', () => {
  assert.match(scriptWorkbench, /<ActionGate :reason="saveCurrentEpisodeDisabledReason" label="保存当前集">/)
  assert.match(scriptWorkbench, /describeSaveCurrentEpisodeDisabledReason/)
  assert.match(scriptWorkbench, /if \(props\.dramaId && !props\.hasAnyEpisode\) return '请先创建或选择剧集'/)
  assert.match(scriptWorkbench, /<ActionGate :reason="generateStoryDisabledReason" label="生成剧本">/)
  assert.match(scriptWorkbench, /请先输入故事梗概/)
})

test('角色道具场景入库按钮在缺图时展示禁用原因', () => {
  assert.match(resourcePanel, /<ActionGate :reason="missingAssetImageReason\(char, 'character'\)" label="加入本剧库">/)
  assert.match(resourcePanel, /<ActionGate :reason="missingAssetImageReason\(prop, 'prop'\)" label="加入素材库">/)
  assert.match(resourcePanel, /<ActionGate :reason="missingAssetImageReason\(scene, 'scene'\)" label="加入本剧库">/)
  assert.match(resourcePanel, /<ActionGate :reason="missingAssetImageReason\(char, 'character'\)" :label="sd2ActionLabel\(char\)">/)
  assert.match(resourcePanel, /请先为该角色生成或上传主图/)
  assert.match(resourcePanel, /请先为该道具生成或上传主图/)
  assert.match(resourcePanel, /请先为该场景生成或上传主图/)
})

test('交付失败保持原按钮语义，并用中文说明下一步', () => {
  assert.match(outputSection, /<FilmCreateDeliveryPanel/)
  assert.match(outputSection, /@download-video="emit\('download-video'\)"/)
  assert.match(outputSection, /@download-subtitle="emit\('download-subtitle'\)"/)
  assert.match(outputSection, /@export-project="emit\('export-project'\)"/)
  assert.match(outputSection, /可继续点「重试下载」/)
  assert.match(outputSection, /可继续点「重试字幕」/)
  assert.match(outputSection, /可继续点「重试项目包」/)
  assert.match(outputSection, /aria-live="polite"/)
  assert.match(deliveryPanel, /videoDownloadStatus === 'error' \? '重试下载' : '下载成片'/)
  assert.match(deliveryPanel, /deliveryExportStatus.subtitle === 'error' \? '重试字幕' : '下载字幕'/)
  assert.match(deliveryPanel, /deliveryExportStatus.project === 'error' \? '重试项目包' : '导出项目包'/)
  assert.doesNotMatch(outputSection, /label="下载成片"/)
})

test('字幕和项目包失败映射为中文，空文件不会误报成功', async () => {
  const emptySubtitle = createDeliveryActions({
    timelinesAPI: { getEpisodeSrt: async () => new Blob([], { type: 'text/plain' }) },
  })
  await emptySubtitle.actions.downloadCurrentEpisodeSubtitle()
  assert.equal(emptySubtitle.actions.deliveryExportStatus.subtitle, 'error')
  assert.match(emptySubtitle.actions.deliveryExportError.value, /字幕文件为空|字幕下载失败/)
  assert.equal(emptySubtitle.messages.at(-1)[0], 'error')
  assert.doesNotMatch(emptySubtitle.actions.deliveryExportError.value, /[A-Za-z]{4,}/)

  const invalidZip = createDeliveryActions({
    dramaAPI: { exportDrama: async () => new Blob(['not-zip'], { type: 'application/zip' }) },
  })
  await invalidZip.actions.exportCurrentProjectPackage()
  assert.equal(invalidZip.actions.deliveryExportStatus.project, 'error')
  assert.match(invalidZip.actions.deliveryExportError.value, /项目包格式无效|项目包导出失败/)
  assert.doesNotMatch(invalidZip.actions.deliveryExportError.value, /zip signature|invalid zip/i)

  const offline = createDeliveryActions({
    timelinesAPI: {
      getEpisodeSrt: async () => {
        const error = new Error('ECONNREFUSED')
        error.status = 502
        throw error
      },
    },
  })
  await offline.actions.downloadCurrentEpisodeSubtitle()
  assert.equal(offline.actions.deliveryExportStatus.subtitle, 'error')
  assert.match(offline.actions.deliveryExportError.value, /字幕导出暂时不可用|字幕下载失败/)
  assert.match(offline.actions.deliveryExportError.value, /[\u4e00-\u9fff]/)
})

test('项目加载失败可重试，不把剧集 id 当成项目标题', () => {
  const store = { dramaId: DRAMA_ID, drama: { title: '月光基地', episodes: [{ id: EPISODE_ID }] } }
  const surface = useFilmCreateProjectLoadSurface({ initialRouteProjectId: DRAMA_ID, store })
  assert.equal(surface.projectLoadState.value, 'loading')
  surface.projectLoadState.value = 'error'
  assert.equal(surface.projectPageTitle.value, '项目加载失败')
  assert.equal(surface.projectLoadRetryable.value, true)
  assert.match(surface.projectLoadErrorText.value, /无法连接本地服务/)
  surface.projectLoadNotFound.value = true
  assert.equal(surface.projectPageTitle.value, '项目不存在')
  assert.equal(surface.projectLoadRetryable.value, false)
  assert.match(surface.projectLoadErrorText.value, /不存在|回收站/)
  assert.notEqual(surface.projectPageTitle.value, String(EPISODE_ID))
  const focused = []
  surface.projectLoadFailureRef.value = { focus() { focused.push('focus') } }
  surface.focusProjectLoadFailure()
  assert.deepEqual(focused, ['focus'])
})

test('依赖警告提供重试和查看分镜，不另造按钮文案', () => {
  assert.match(warningSource, /重试加载素材/)
  assert.match(warningSource, /describeActionAriaLabel\('重试加载素材'/)
  assert.match(warningSource, /href="#anchor-storyboard-images"/)
  assert.match(warningSource, /查看分镜/)
  assert.match(warningSource, /event\?\.currentTarget\?\.focus/)
  assert.match(warningSource, /已加载的分镜可以继续编辑/)
})

test('媒体预览失败给出中文提示，占位图不会打开预览', async () => {
  const messages = []
  const preview = useFilmCreateMediaPreview({
    ElMessage: {
      info(message) { messages.push(['info', message]) },
      warning(message) { messages.push(['warning', message]) },
    },
  })
  await preview.openImagePreview('')
  assert.equal(preview.previewImageUrl.value, null)
  assert.match(preview.previewError.value, /没有可预览的图片/)
  await preview.openImagePreview('placeholder://draft')
  assert.equal(preview.previewImageUrl.value, null)
  assert.match(preview.previewError.value, /草稿占位/)
  await preview.openImagePreview('/static/missing.png')
  assert.equal(preview.previewImageUrl.value, '/static/missing.png')
  assert.match(preview.previewError.value, /无法加载|不可用/)
  assert.equal(messages.at(-1)[0], 'warning')
  assert.match(messages.map((item) => item[1]).join('|'), /[\u4e00-\u9fff]/)
})

test('成片设置只在合成或相关任务进行中锁定，准备态仍可改配置', () => {
  assert.match(outputSection, /:disabled="videoSettingsLocked"/)
  assert.match(outputSection, /:disabled-reason="videoSettingsLockedReason"/)
  assert.match(outputSection, /describeOutputVideoSettingsLock\(props\)/)
  assert.match(outputSection, /input\.videoStatus === 'generating'/)
  assert.match(outputSection, /正在合成视频，请等待当前任务完成/)

  const idle = describeOutputVideoSettingsLock({
    composeActionDisabledReason: '',
    videoStatus: 'idle',
  })
  const missingEpisode = describeOutputVideoSettingsLock({
    composeActionDisabledReason: '请先创建或选择剧集',
    videoStatus: 'idle',
  })
  const composing = describeOutputVideoSettingsLock({
    composeActionDisabledReason: '',
    videoStatus: 'generating',
  })
  const composingWithReason = describeOutputVideoSettingsLock({
    composeActionDisabledReason: '正在合成视频，请等待当前任务完成',
    videoStatus: 'generating',
  })
  const done = describeOutputVideoSettingsLock({
    composeActionDisabledReason: '',
    videoStatus: 'done',
  })
  const otherProject = describeOutputVideoSettingsLock({
    composeActionDisabledReason: `请先为全部分镜生成可播放视频（已完成 0/${DRAMA_ID}）`,
    videoStatus: 'idle',
  })
  const thisProject = describeOutputVideoSettingsLock({
    composeActionDisabledReason: `请先为全部分镜生成可播放视频（已完成 0/${EPISODE_ID}）`,
    videoStatus: 'idle',
  })

  assert.equal(idle, '')
  assert.equal(done, '')
  assert.equal(missingEpisode, '')
  assert.equal(composing, '正在合成视频，请等待当前任务完成')
  assert.equal(composingWithReason, '正在合成视频，请等待当前任务完成')
  assert.equal(otherProject, '')
  assert.equal(thisProject, '')
  assert.equal(otherProject, thisProject)
  const pipelineBusy = describeOutputVideoSettingsLock({
    composeActionDisabledReason: '全流程任务正在执行，请先暂停或等待完成',
    videoStatus: 'idle',
  })
  assert.equal(pipelineBusy, '全流程任务正在执行，请先暂停或等待完成')
})
