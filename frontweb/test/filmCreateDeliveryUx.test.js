import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { compileScript, parse } from '@vue/compiler-sfc'

import { remainingExtractNamedFunction } from './helpers/remainingSourceBetween.js'

const deliveryPanelSource = readFileSync(
  new URL('../src/components/filmCreate/FilmCreateDeliveryPanel.vue', import.meta.url),
  'utf8',
).replace(/\r\n?/g, '\n')
const outputSectionSource = readFileSync(
  new URL('../src/components/filmCreate/FilmCreateOutputSection.vue', import.meta.url),
  'utf8',
).replace(/\r\n?/g, '\n')

const describeDeliveryPanelState = new Function(
  `'use strict'; ${remainingExtractNamedFunction(deliveryPanelSource, 'describeDeliveryPanelState')}; return describeDeliveryPanelState;`,
)()
const describeOutputVideoSettingsLock = new Function(
  `'use strict'; ${remainingExtractNamedFunction(outputSectionSource, 'describeOutputVideoSettingsLock')}; return describeOutputVideoSettingsLock;`,
)()
const describeDeliveryOutputNextStep = new Function(
  `'use strict'; ${remainingExtractNamedFunction(outputSectionSource, 'describeDeliveryOutputNextStep')}; return describeDeliveryOutputNextStep;`,
)()
const describeOutputDeliveryMessages = new Function(
  `'use strict'; ${remainingExtractNamedFunction(outputSectionSource, 'toOutputUserFacingText')}; ${remainingExtractNamedFunction(outputSectionSource, 'toOutputDisabledReasonText')}; ${remainingExtractNamedFunction(outputSectionSource, 'describeDeliveryOutputNextStep')}; ${remainingExtractNamedFunction(outputSectionSource, 'describeOutputDeliveryMessages')}; return describeOutputDeliveryMessages;`,
)()

const DRAMA_ID = 11
const EPISODE_ID = 22
assert.notEqual(DRAMA_ID, EPISODE_ID)

function compileVue(source, filename, id) {
  const parsed = parse(source, { filename })
  assert.deepEqual(parsed.errors.map((error) => String(error)), [])
  assert.doesNotThrow(() => compileScript(parsed.descriptor, { id, inlineTemplate: true }))
}

test('交付面板和输出区可以独立编译', () => {
  compileVue(deliveryPanelSource, 'FilmCreateDeliveryPanel.vue', 'film-create-delivery-ux')
  compileVue(outputSectionSource, 'FilmCreateOutputSection.vue', 'film-create-output-ux')
})

test('没有可播放分镜视频时给出中文空状态和下一步入口', () => {
  const noStoryboards = describeDeliveryPanelState({
    playableStoryboardVideoCount: 0,
    storyboardCount: 0,
    composeActionDisabledReason: '请先生成或添加分镜',
  })
  const missingVideos = describeDeliveryPanelState({
    playableStoryboardVideoCount: 0,
    storyboardCount: EPISODE_ID,
    composeActionDisabledReason: `请先为全部分镜生成可播放视频（已完成 0/${EPISODE_ID}）`,
  })
  const otherCount = describeDeliveryPanelState({
    playableStoryboardVideoCount: 0,
    storyboardCount: DRAMA_ID,
    composeActionDisabledReason: `请先为全部分镜生成可播放视频（已完成 0/${DRAMA_ID}）`,
  })
  const ready = describeDeliveryPanelState({
    playableStoryboardVideoCount: 2,
    storyboardCount: 2,
    composeActionDisabledReason: '',
    currentEpisodeVideoUrl: '/static/final.mp4',
    dramaId: DRAMA_ID,
    currentEpisodeId: EPISODE_ID,
    deliverySubtitleAvailable: true,
  })

  assert.equal(noStoryboards.guidanceKind, 'empty')
  assert.match(noStoryboards.guidanceText, /还没有可播放的分镜视频/)
  assert.match(noStoryboards.guidanceText, /生成或添加分镜/)
  assert.equal(noStoryboards.guidanceHref, '#anchor-storyboard')
  assert.equal(noStoryboards.guidanceActionLabel, '去分镜面板添加分镜')

  assert.equal(missingVideos.guidanceKind, 'empty')
  assert.match(missingVideos.guidanceText, /请先到「分镜」面板为每个镜头生成视频/)
  assert.match(missingVideos.guidanceText, new RegExp(`已完成 0/${EPISODE_ID}`))
  assert.doesNotMatch(missingVideos.guidanceText, new RegExp(String(DRAMA_ID)))
  assert.equal(missingVideos.guidanceHref, '#anchor-storyboard-images')
  assert.equal(missingVideos.guidanceActionLabel, '去分镜面板生成视频')
  assert.notEqual(missingVideos.guidanceText, otherCount.guidanceText)
  assert.match(otherCount.guidanceText, new RegExp(String(DRAMA_ID)))
  assert.doesNotMatch(otherCount.guidanceText, new RegExp(String(EPISODE_ID)))

  assert.equal(ready.guidanceKind, '')
  assert.equal(ready.guidanceText, '')
  assert.match(deliveryPanelSource, /data-testid="delivery-guidance"/)
  assert.match(deliveryPanelSource, /data-testid="delivery-empty-action"/)
  assert.match(deliveryPanelSource, /#anchor-storyboard-images/)
})

test('未选剧集时禁用原因可见，不会误导去生成分镜视频', () => {
  const missingEpisode = describeDeliveryPanelState({
    playableStoryboardVideoCount: 0,
    storyboardCount: 0,
    composeActionDisabledReason: '请先创建或选择剧集',
    currentEpisodeId: null,
    dramaId: DRAMA_ID,
  })
  assert.equal(missingEpisode.guidanceKind, 'disabled')
  assert.equal(missingEpisode.guidanceText, '请先创建或选择剧集')
  assert.equal(missingEpisode.guidanceHref, '')
  assert.match(missingEpisode.composeButtonAriaLabel, /合成成片不可用：请先创建或选择剧集/)
})

test('禁用原因保持中文可见，项目 id 与剧集 id 不会混用', () => {
  const missingProject = describeDeliveryPanelState({
    dramaId: null,
    currentEpisodeId: EPISODE_ID,
    currentEpisodeVideoUrl: '/static/final.mp4',
    deliverySubtitleAvailable: true,
    playableStoryboardVideoCount: 1,
    storyboardCount: 1,
  })
  const missingEpisode = describeDeliveryPanelState({
    dramaId: DRAMA_ID,
    currentEpisodeId: null,
    currentEpisodeVideoUrl: '/static/final.mp4',
    deliverySubtitleAvailable: true,
    playableStoryboardVideoCount: 1,
    storyboardCount: 1,
  })
  const missingSubtitle = describeDeliveryPanelState({
    dramaId: DRAMA_ID,
    currentEpisodeId: EPISODE_ID,
    currentEpisodeVideoUrl: '/static/final.mp4',
    deliverySubtitleAvailable: false,
    playableStoryboardVideoCount: 1,
    storyboardCount: 1,
  })
  const englishCompose = describeDeliveryPanelState({
    composeActionDisabledReason: 'Network Error',
    playableStoryboardVideoCount: 2,
    storyboardCount: 2,
  })

  assert.equal(missingProject.exportProjectDisabledReason, '请先打开制作项目')
  assert.equal(missingProject.downloadSubtitleDisabledReason, '')
  assert.equal(missingEpisode.downloadSubtitleDisabledReason, '请先选择剧集')
  assert.equal(missingEpisode.exportProjectDisabledReason, '')
  assert.equal(missingSubtitle.downloadSubtitleDisabledReason, '当前集还没有可下载的字幕')
  assert.equal(englishCompose.composeDisabledReason, '当前不能合成成片')
  assert.equal(englishCompose.guidanceText, '当前不能合成成片')
  assert.match(englishCompose.composeButtonAriaLabel, /当前不能合成成片/)
  assert.doesNotMatch(englishCompose.composeDisabledReason, /Network Error/i)
  assert.match(deliveryPanelSource, /<ActionGate :reason="visibleComposeDisabledReason" label="合成成片">/)
  assert.match(deliveryPanelSource, /<ActionGate :reason="downloadVideoDisabledReason" label="下载成片">/)
  assert.match(deliveryPanelSource, /请先合成成片后再下载/)
})

test('交付按钮提供中文 aria-label，禁用时带上原因', () => {
  const idle = describeDeliveryPanelState({
    playableStoryboardVideoCount: 2,
    storyboardCount: 2,
    currentEpisodeVideoUrl: '/static/final.mp4',
    dramaId: DRAMA_ID,
    currentEpisodeId: EPISODE_ID,
    deliverySubtitleAvailable: true,
  })
  const blocked = describeDeliveryPanelState({
    playableStoryboardVideoCount: 0,
    storyboardCount: 3,
    composeActionDisabledReason: '请先为全部分镜生成可播放视频（已完成 0/3）',
  })
  const loading = describeDeliveryPanelState({
    playableStoryboardVideoCount: 2,
    storyboardCount: 2,
    videoStatus: 'generating',
    composeActionDisabledReason: '正在合成视频，请等待当前任务完成',
    currentEpisodeVideoUrl: '/static/final.mp4',
    dramaId: DRAMA_ID,
    currentEpisodeId: EPISODE_ID,
    deliverySubtitleAvailable: true,
  })
  const retry = describeDeliveryPanelState({
    playableStoryboardVideoCount: 2,
    storyboardCount: 2,
    currentEpisodeVideoUrl: '/static/final.mp4',
    videoDownloadStatus: 'error',
    deliveryExportStatus: { subtitle: 'error', project: 'error' },
    dramaId: DRAMA_ID,
    currentEpisodeId: EPISODE_ID,
    deliverySubtitleAvailable: true,
  })

  assert.equal(idle.composeButtonAriaLabel, '重新合成')
  assert.equal(idle.downloadVideoButtonAriaLabel, '下载成片')
  assert.equal(idle.downloadSubtitleButtonAriaLabel, '下载字幕')
  assert.equal(idle.exportProjectButtonAriaLabel, '导出项目包')
  assert.match(blocked.composeButtonAriaLabel, /合成成片不可用：请先为全部分镜生成可播放视频/)
  assert.match(blocked.downloadVideoButtonAriaLabel, /下载成片不可用：请先合成成片后再下载/)
  assert.equal(loading.composeButtonAriaLabel, '正在合成成片')
  assert.equal(retry.downloadVideoActionLabel, '重试下载')
  assert.equal(retry.downloadSubtitleActionLabel, '重试字幕')
  assert.equal(retry.exportProjectActionLabel, '重试项目包')
  assert.match(deliveryPanelSource, /:aria-label="panelState\.composeButtonAriaLabel"/)
  assert.match(deliveryPanelSource, /:aria-label="panelState\.downloadVideoButtonAriaLabel"/)
  assert.match(deliveryPanelSource, /:aria-label="panelState\.downloadSubtitleButtonAriaLabel"/)
  assert.match(deliveryPanelSource, /:aria-label="panelState\.exportProjectButtonAriaLabel"/)
  assert.match(deliveryPanelSource, /:title="panelState\.composeButtonTitle"/)
  assert.match(deliveryPanelSource, /:title="panelState\.downloadVideoButtonTitle"/)
  assert.match(deliveryPanelSource, /:title="panelState\.downloadSubtitleButtonTitle"/)
  assert.match(deliveryPanelSource, /:title="panelState\.exportProjectButtonTitle"/)
  assert.equal(idle.composeButtonTitle, undefined)
  assert.equal(blocked.composeButtonTitle, blocked.composeDisabledReason)
  assert.equal(loading.composeButtonTitle, '正在合成成片，请稍候')
  assert.match(blocked.composeButtonTitle, /请先为全部分镜生成可播放视频/)
  assert.doesNotMatch(JSON.stringify(blocked), /Network Error|HTTP Error|Failed/i)
})

test('合成下载导出失败不展示英文 HTTP/Network Error', () => {
  const composeError = describeDeliveryPanelState({
    videoStatus: 'error',
    videoErrorMsg: 'Network Error',
    playableStoryboardVideoCount: 2,
    storyboardCount: 2,
  })
  const httpError = describeDeliveryPanelState({
    videoStatus: 'error',
    videoErrorMsg: 'HTTP Error',
    playableStoryboardVideoCount: 2,
    storyboardCount: 2,
  })
  const downloadError = describeDeliveryPanelState({
    videoDownloadStatus: 'error',
    videoDownloadError: 'Request failed with status code 502',
    currentEpisodeVideoUrl: '/static/final.mp4',
    playableStoryboardVideoCount: 2,
    storyboardCount: 2,
  })
  const exportError = describeDeliveryPanelState({
    deliveryExportHasError: true,
    deliveryExportFeedback: 'Failed to fetch',
    playableStoryboardVideoCount: 2,
    storyboardCount: 2,
  })
  const chineseError = describeDeliveryPanelState({
    videoStatus: 'error',
    videoErrorMsg: '成片合成超时，请稍后重试',
    playableStoryboardVideoCount: 2,
    storyboardCount: 2,
  })

  assert.equal(composeError.videoErrorMsg, '成片合成失败，请稍后重试')
  assert.equal(httpError.videoErrorMsg, '成片合成失败，请稍后重试')
  assert.equal(downloadError.videoDownloadError, '成片下载失败，请稍后重试')
  assert.equal(exportError.deliveryExportFeedback, '导出失败，请稍后重试')
  assert.equal(chineseError.videoErrorMsg, '成片合成超时，请稍后重试')
  assert.doesNotMatch(JSON.stringify(composeError), /Network Error/i)
  assert.doesNotMatch(JSON.stringify(httpError), /HTTP Error/i)
  assert.doesNotMatch(deliveryPanelSource, /Network Error/)
  assert.doesNotMatch(deliveryPanelSource, /HTTP Error/)
  assert.match(deliveryPanelSource, /panelState\.videoErrorMsg/)
})

test('输出区把英文错误收成中文，并补上合成失败下一步', () => {
  const lockEnglish = describeOutputVideoSettingsLock({
    composeActionDisabledReason: 'Network Error',
    videoStatus: 'idle',
  })
  const lockChinese = describeOutputVideoSettingsLock({
    composeActionDisabledReason: '请先创建或选择剧集',
    videoStatus: 'idle',
  })
  const composing = describeOutputVideoSettingsLock({
    composeActionDisabledReason: '',
    videoStatus: 'generating',
  })
  const messages = describeOutputDeliveryMessages({
    videoStatus: 'error',
    videoErrorMsg: 'HTTP Error',
    composeActionDisabledReason: 'Failed to fetch',
    videoDownloadStatus: 'idle',
    deliveryExportStatus: { subtitle: 'idle', project: 'idle' },
  })
  const nextCompose = describeDeliveryOutputNextStep({
    videoStatus: 'error',
    videoDownloadStatus: 'idle',
    deliveryExportStatus: { subtitle: 'idle', project: 'idle' },
  })
  const nextDownload = describeDeliveryOutputNextStep({
    videoStatus: 'error',
    videoDownloadStatus: 'error',
    deliveryExportStatus: { subtitle: 'idle', project: 'idle' },
  })

  assert.equal(lockEnglish, '')
  assert.equal(lockChinese, '')
  assert.equal(composing, '正在合成视频，请等待当前任务完成')
  const missingVideos = describeOutputVideoSettingsLock({
    composeActionDisabledReason: `请先为全部分镜生成可播放视频（已完成 0/${EPISODE_ID}）`,
    videoStatus: 'idle',
  })
  const pipelineBusy = describeOutputVideoSettingsLock({
    composeActionDisabledReason: '全流程任务正在执行，请先暂停或等待完成',
    videoStatus: 'idle',
  })
  assert.equal(missingVideos, '')
  assert.equal(pipelineBusy, '全流程任务正在执行，请先暂停或等待完成')
  assert.doesNotMatch(missingVideos, new RegExp(String(EPISODE_ID)))
  assert.equal(messages.videoErrorMsg, '成片合成失败，请稍后重试')
  assert.equal(messages.composeActionDisabledReason, '当前不能合成成片')
  assert.equal(nextCompose, '成片合成失败后，可检查分镜视频是否齐全，再点「合成成片」重试。')
  assert.match(nextDownload, /可继续点「重试下载」/)
  assert.match(outputSectionSource, /visibleComposeActionDisabledReason/)
  assert.match(outputSectionSource, /visibleVideoErrorMsg/)
  assert.match(outputSectionSource, /visibleVideoDownloadError/)
  assert.doesNotMatch(outputSectionSource, /Network Error/)
  assert.doesNotMatch(outputSectionSource, /HTTP Error/)
})

test('交付区用户可见文案保持简体中文', () => {
  assert.doesNotMatch(deliveryPanelSource, /\bPlease\b|\bFailed\b|\bThe\s/)
  assert.doesNotMatch(outputSectionSource, /\bPlease\b|\bFailed\b|\bThe\s/)
  assert.match(deliveryPanelSource, /还没有可播放的分镜视频/)
  assert.match(deliveryPanelSource, /去分镜面板生成视频/)
  assert.match(outputSectionSource, /成片合成失败后，可检查分镜视频是否齐全/)
  assert.match(outputSectionSource, /可继续点「重试下载」/)
  assert.match(outputSectionSource, /可继续点「重试字幕」/)
  assert.match(outputSectionSource, /可继续点「重试项目包」/)
  assert.match(outputSectionSource, /const busyLock/)
  assert.match(deliveryPanelSource, /视频正在生成，请稍候/)
  assert.match(deliveryPanelSource, /正在验证并下载成片，请稍候/)
  assert.doesNotMatch(deliveryPanelSource, /视频生成中\.\.\./)
})

test('交付面板把项目包写成随时可导出工程，不把工程包算成已有成片', () => {
  const empty = describeDeliveryPanelState({})
  assert.equal(empty.deliveryPackageHint, '随时可导出工程')
  assert.match(deliveryPanelSource, /随时可导出工程/)
  assert.match(deliveryPanelSource, /panelState\.deliveryPackageHint/)
  assert.match(deliveryPanelSource, /delivery-package-hint/)
})
