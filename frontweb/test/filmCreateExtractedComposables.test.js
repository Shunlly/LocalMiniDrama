import test from 'node:test'
import assert from 'node:assert/strict'

import { trackFilmCreateAction } from '../src/utils/filmCreateActionLog.js'
import {
  getOperationLogs,
  installOperationLogSink,
  resetOperationLogs,
} from '../src/utils/operationLog.js'
import { useFilmCreateTtsDisableReason } from '../src/composables/filmCreate/useFilmCreateTtsDisableReason.js'
import { useFilmCreateStylePrompts } from '../src/composables/filmCreate/useFilmCreateStylePrompts.js'
import { useFilmCreateWorkspaceNav } from '../src/composables/filmCreate/useFilmCreateWorkspaceNav.js'
import { useFilmCreateTaskCancel } from '../src/composables/filmCreate/useFilmCreateTaskCancel.js'
import { useFilmCreateTaskPolling } from '../src/composables/filmCreate/useFilmCreateTaskPolling.js'
import { useFilmCreateScriptEstimates } from '../src/composables/filmCreate/useFilmCreateScriptEstimates.js'
import { useFilmCreateFirstLastFrameSetting } from '../src/composables/filmCreate/useFilmCreateFirstLastFrameSetting.js'
import { useFilmCreateStoryboardMedia } from '../src/composables/filmCreate/useFilmCreateStoryboardMedia.js'
import { useFilmCreateDeliveryActions } from '../src/composables/filmCreate/useFilmCreateDeliveryActions.js'
import { useFilmCreateScriptDraft } from '../src/composables/filmCreate/useFilmCreateScriptDraft.js'
import { useFilmCreateStoryboardVideoFields } from '../src/composables/filmCreate/useFilmCreateStoryboardVideoFields.js'
import { GEN_RESOURCE } from '../src/stores/generationTaskStore.js'

test('trackFilmCreateAction maps action suffixes to log phases', () => {
  const events = []
  const restore = installOperationLogSink((event) => events.push(event))
  resetOperationLogs()
  try {
    trackFilmCreateAction('generate_characters_click')
    trackFilmCreateAction('generate_characters_complete', { extra: { after_count: 3 } })
    trackFilmCreateAction('generate_characters_failed', { extra: { message: 'timeout' } })
    trackFilmCreateAction('pipeline_stop_complete')
    trackFilmCreateAction('batch_cancel', { cancelled: true })
    assert.equal(events[0].phase, 'start')
    assert.equal(events[1].phase, 'success')
    assert.equal(events[1].details.after_count, 3)
    assert.equal(events[2].phase, 'error')
    assert.equal(events[3].phase, 'cancel')
    assert.equal(events[4].phase, 'cancel')
    assert.equal(events[4].details.cancelled, true)
    assert.equal(getOperationLogs().length, 5)
  } finally {
    restore()
    resetOperationLogs()
  }
})

test('TTS disable reason prefers in-flight generation over capability gaps', () => {
  const ttsSbIds = new Set([11])
  const ttsSbNarrationIds = new Set([22])
  const ttsCapabilityReason = { value: '请先配置语音合成' }
  const { ttsGenerationDisabledReason } = useFilmCreateTtsDisableReason({
    ttsSbIds,
    ttsSbNarrationIds,
    ttsCapabilityReason,
  })
  assert.equal(ttsGenerationDisabledReason(11), '正在生成配音，请等待完成')
  assert.equal(ttsGenerationDisabledReason(22, 'narration'), '正在生成配音，请等待完成')
  assert.equal(ttsGenerationDisabledReason(33), '请先配置语音合成')
})

test('style prompts fall back from English to Chinese to the raw value', () => {
  const generationStyle = { value: 'realistic' }
  const { getSelectedStylePrompt, getSelectedStylePromptZh, getSelectedStyle, projectStylePromptMetadata } = useFilmCreateStylePrompts({
    generationStyle,
  })
  assert.match(getSelectedStylePrompt(), /photorealistic/)
  assert.match(getSelectedStylePromptZh(), /超写实/)
  assert.equal(getSelectedStyle(), getSelectedStylePrompt())
  assert.match(projectStylePromptMetadata().style_prompt_en, /photorealistic/)

  generationStyle.value = 'not-a-style'
  assert.equal(getSelectedStylePrompt(), 'not-a-style')
  generationStyle.value = '  '
  assert.equal(getSelectedStylePrompt(), undefined)
})

test('workspace navigation keeps returnTo and current episode on canvas and library jumps', () => {
  const pushes = []
  const router = { push: (target) => pushes.push(target) }
  const route = { fullPath: '/film/9?episode=3' }
  const dramaId = { value: 9 }
  const selectedEpisodeId = { value: 3 }
  const projectListReturnTo = { value: '/?q=moon' }
  const showGlobalMediaPicker = { value: true }
  const { goList, goCanvasMode, openMediaLibraryFromPicker } = useFilmCreateWorkspaceNav({
    router,
    route,
    dramaId,
    selectedEpisodeId,
    projectListReturnTo,
    showGlobalMediaPicker,
  })
  goList()
  goCanvasMode()
  openMediaLibraryFromPicker()
  assert.deepEqual(pushes[0], '/?q=moon')
  assert.equal(pushes[1].path, '/film/9/canvas')
  assert.equal(pushes[1].query.episode, '3')
  assert.equal(pushes[1].query.returnTo, '/?q=moon')
  assert.equal(pushes[2].name, 'media-library')
  assert.equal(pushes[2].query.returnTo, '/film/9?episode=3')
  assert.equal(showGlobalMediaPicker.value, false)

  dramaId.value = null
  goCanvasMode()
  assert.equal(pushes.length, 3)
})

test('task cancel routes pipeline, local story, polish and batch stop without unlocking the pipeline flag', async () => {
  const messages = []
  const ElMessage = {
    success: (text) => messages.push(['success', text]),
    info: (text) => messages.push(['info', text]),
    error: (text) => messages.push(['error', text]),
  }
  const cancelled = []
  const genStore = {
    cancelTask: async (task) => { cancelled.push(task) },
    getAllRunningTasks: () => [{ id: 'story-1', resourceType: GEN_RESOURCE.GENERATE_STORY }],
  }
  let pipelineCancelled = 0
  const storyGenerating = { value: true }
  const scriptGenerating = { value: true }
  const universalOmniPolishAbort = { value: false }
  const batchImageStopping = { value: false }
  const batchVideoStopping = { value: false }
  const { cancelActiveTask } = useFilmCreateTaskCancel({
    ElMessage,
    genStore,
    cancelPipelineRun: async () => { pipelineCancelled += 1 },
    storyGenerating,
    scriptGenerating,
    universalOmniPolishAbort,
    batchImageStopping,
    batchVideoStopping,
  })

  await cancelActiveTask()
  await cancelActiveTask({ kind: 'pipeline' })
  await cancelActiveTask({ kind: 'storyGenLocal' })
  await cancelActiveTask({ kind: 'universalOmniPolish' })
  await cancelActiveTask({ kind: 'batchImage' })
  await cancelActiveTask({ kind: 'batchVideo' })
  await cancelActiveTask({ kind: 'genStore', task: { id: 't-9' } })

  assert.equal(pipelineCancelled, 1)
  assert.equal(storyGenerating.value, false)
  assert.equal(scriptGenerating.value, false)
  assert.equal(universalOmniPolishAbort.value, true)
  assert.equal(batchImageStopping.value, true)
  assert.equal(batchVideoStopping.value, true)
  assert.deepEqual(cancelled.map((task) => task.id), ['story-1', 't-9'])
  assert.equal(messages.some((entry) => entry[0] === 'error'), false)
})

test('poll meta fills drama context and pollUntil stops when the checker passes', async () => {
  const loads = []
  const { resolvePollMeta, pollTask, pollUntilResourceHasImage } = useFilmCreateTaskPolling({
    genStore: {
      pollTask: (taskId, meta, onDone, extras) => ({ taskId, meta, onDone, extras }),
    },
    dramaId: { value: 8 },
    currentEpisodeId: { value: 21 },
    store: { drama: { title: '月光基地' }, currentEpisode: { episode_number: 2 } },
    ElMessage: { info() {} },
    loadDrama: async () => { loads.push('load') },
  })
  const meta = resolvePollMeta({ resourceType: 'sb_image', resourceId: 44 })
  assert.equal(meta.dramaId, 8)
  assert.equal(meta.episodeId, 21)
  assert.equal(meta.dramaTitle, '月光基地')
  assert.equal(meta.episodeNumber, 2)
  assert.equal(meta.resourceId, 44)
  const polled = pollTask('task-1', () => {}, { label: '生图' })
  assert.equal(polled.taskId, 'task-1')
  assert.equal(polled.meta.label, '生图')
  assert.ok(polled.extras.ElMessage)

  let attempts = 0
  await pollUntilResourceHasImage(() => {
    attempts += 1
    return attempts >= 2
  }, 5, 0)
  assert.equal(attempts, 2)
  assert.equal(loads.length, 2)
})

test('script estimates honor manual duration and shot count over inferred values', () => {
  const { getVideoDurationForApi, getStoryboardCountForApi, userFilledVideoDuration, userFilledStoryboardCount } = useFilmCreateScriptEstimates({
    videoClipDuration: { value: 5 },
    scriptContent: { value: '一二三四五六七八九十'.repeat(80) },
    storyboardCount: { value: 12 },
    videoDuration: { value: 90 },
  })
  assert.equal(userFilledVideoDuration(), true)
  assert.equal(userFilledStoryboardCount(), true)
  assert.equal(getVideoDurationForApi(), 90)
  assert.equal(getStoryboardCountForApi(), 12)
})

test('first-last-frame toggle forces single grid before saving', () => {
  const messages = []
  const storyboardUseFirstLastFrame = { value: true }
  const gridMode = { value: 'quad_grid' }
  let saved = 0
  const { onStoryboardUseFirstLastFrameChange } = useFilmCreateFirstLastFrameSetting({
    storyboardUseFirstLastFrame,
    gridMode,
    ElMessage: { info: (text) => messages.push(text) },
    saveProjectSettings: (flag) => { saved += 1; assert.equal(flag, false) },
  })
  onStoryboardUseFirstLastFrameChange()
  assert.equal(gridMode.value, 'single')
  assert.equal(saved, 1)
  assert.equal(messages.length, 1)
})

test('drama refresh captures episode context so a later load cannot use the current selection', async () => {
  const loads = []
  const dramaId = { value: 4 }
  const currentEpisodeId = { value: 40 }
  const { captureDramaRefresh } = useFilmCreateStoryboardMedia({
    dramaId,
    currentEpisodeId,
    getStoryboards: () => [],
    imagesAPI: { list: async () => ({ items: [] }) },
    videosAPI: { list: async () => ({ items: [] }) },
    loadDrama: async (options) => { loads.push(options) },
  })
  const refresh = captureDramaRefresh()
  currentEpisodeId.value = 99
  await refresh()
  assert.deepEqual(loads, [{ expectedContext: { projectId: 4, episodeId: 40 } }])
})

test('delivery preview ignores placeholders and reports subtitle availability', () => {
  const {
    currentEpisodeVideoUrl,
    deliveryCompositeStatusLabel,
    deliverySubtitleAvailable,
    deliveryFileCount,
    buildDeliveryFilename,
  } = useFilmCreateDeliveryActions({
    store: { drama: { title: '月光基地' } },
    ElMessage: { success() {}, error() {} },
    dramaId: { value: 7 },
    currentEpisode: { value: { episode_number: 2, video_url: 'placeholder://draft' } },
    currentEpisodeId: { value: 21 },
    storyboards: { value: [{ dialogue: '你好' }] },
    videoStatus: { value: 'idle' },
    videoProgress: { value: 0 },
    timelinesAPI: {},
    dramaAPI: {},
  })
  assert.equal(currentEpisodeVideoUrl.value, '')
  assert.equal(deliveryCompositeStatusLabel.value, '待合成')
  assert.equal(deliverySubtitleAvailable.value, true)
  assert.equal(deliveryFileCount.value, 2)
  assert.match(buildDeliveryFilename('字幕', 'srt'), /字幕\.srt$/)
})

test('delivery preview prefixes local files and shows generating progress', () => {
  const currentEpisode = { value: { episode_number: 1, video_url: 'outputs/ep1.mp4' } }
  const videoStatus = { value: 'generating' }
  const videoProgress = { value: 42 }
  const { currentEpisodeVideoUrl, deliveryCompositeStatusLabel } = useFilmCreateDeliveryActions({
    store: { drama: { title: '项目' } },
    ElMessage: { success() {}, error() {} },
    dramaId: { value: 1 },
    currentEpisode,
    currentEpisodeId: { value: 1 },
    storyboards: { value: [] },
    videoStatus,
    videoProgress,
    timelinesAPI: {},
    dramaAPI: {},
  })
  assert.equal(currentEpisodeVideoUrl.value, '/static/outputs/ep1.mp4')
  assert.equal(deliveryCompositeStatusLabel.value, '42%')
})

test('subtitle export stays idle without an episode and records a Chinese error when the API fails', async () => {
  const messages = []
  const { downloadCurrentEpisodeSubtitle, deliveryExportStatus, deliveryExportError } = useFilmCreateDeliveryActions({
    store: { drama: { title: '项目' } },
    ElMessage: { success() {}, error: (text) => messages.push(text) },
    dramaId: { value: 1 },
    currentEpisode: { value: { episode_number: 1 } },
    currentEpisodeId: { value: null },
    storyboards: { value: [] },
    videoStatus: { value: 'idle' },
    videoProgress: { value: 0 },
    timelinesAPI: { getEpisodeSrt: async () => { throw new Error('missing') } },
    dramaAPI: {},
  })
  await downloadCurrentEpisodeSubtitle()
  assert.equal(deliveryExportStatus.subtitle, 'idle')

  const again = useFilmCreateDeliveryActions({
    store: { drama: { title: '项目' } },
    ElMessage: { success() {}, error: (text) => messages.push(text) },
    dramaId: { value: 1 },
    currentEpisode: { value: { episode_number: 1 } },
    currentEpisodeId: { value: 9 },
    storyboards: { value: [] },
    videoStatus: { value: 'idle' },
    videoProgress: { value: 0 },
    timelinesAPI: { getEpisodeSrt: async () => { throw new Error('missing') } },
    dramaAPI: {},
  })
  await again.downloadCurrentEpisodeSubtitle()
  assert.equal(again.deliveryExportStatus.subtitle, 'error')
  assert.match(again.deliveryExportError.value, /字幕下载失败/)
  assert.equal(messages.at(-1), again.deliveryExportError.value)
})

test('script draft capture stays bound to the original project and refuses a switched drama', async () => {
  const store = {
    dramaId: 5,
    currentEpisode: { id: 50, episode_number: 2, title: '旧标题', script_content: '旧正文' },
    drama: { episodes: [{ id: 50, episode_number: 2, title: '旧标题', script_content: '旧正文' }] },
  }
  const saved = []
  const { captureScriptDraft, persistScriptDraftSnapshot } = useFilmCreateScriptDraft({
    store,
    dramaAPI: { saveEpisodes: async (id, payload) => { saved.push({ id, payload }) } },
    scriptTitle: { value: '新标题' },
    scriptContent: { value: '新正文' },
    scriptDraftStatus: { value: 'saved' },
    currentEpisodeId: { value: 50 },
  })
  const snapshot = captureScriptDraft()
  assert.equal(snapshot.dramaId, 5)
  assert.equal(snapshot.episodeId, 50)
  assert.equal(snapshot.title, '新标题')
  store.dramaId = 9
  await assert.rejects(() => persistScriptDraftSnapshot(snapshot), /项目已切换/)
  assert.equal(saved.length, 0)
  store.dramaId = 5
  await persistScriptDraftSnapshot(snapshot)
  assert.equal(saved[0].id, 5)
  assert.equal(store.drama.episodes[0].title, '新标题')
  assert.equal(store.currentEpisode.script_content, '新正文')
})

test('universal video submit requires a prompt or segment and explains the gap', () => {
  const sbCreationMode = { value: { 8: 'universal' } }
  const sbUniversalSegmentText = { value: { 8: '  @Image1 推门  ' } }
  const storyboardMediaActionReason = { value: '' }
  const videoCapabilityReason = { value: '' }
  const {
    isSbUniversalMode,
    sbCanSubmitVideo,
    sbVideoGenerationDisabledReason,
    sbUniversalSegmentTrimmed,
  } = useFilmCreateStoryboardVideoFields({
    store: {},
    storyboardsAPI: { update: async () => {} },
    ElMessage: { success() {}, error() {} },
    upscalingSbIds: new Set(),
    refreshStoryboardMediaForCurrentContext: async () => {},
    sbNarration: { value: {} },
    sbCreationMode,
    sbUniversalSegmentText,
    sbDuration: { value: {} },
    videoClipDuration: { value: 5 },
    getSbFirstFrameUrl: () => '',
    storyboardMediaActionReason,
    isSbVideoGenerating: () => false,
    videoCapabilityReason,
  })
  const sb = { id: 8, video_prompt: '' }
  assert.equal(isSbUniversalMode(8), true)
  assert.equal(sbUniversalSegmentTrimmed(sb), '@Image1 推门')
  assert.equal(sbCanSubmitVideo(sb), true)
  assert.equal(sbVideoGenerationDisabledReason(sb), '')
  sbUniversalSegmentText.value[8] = ''
  assert.equal(sbCanSubmitVideo(sb), false)
  assert.equal(sbVideoGenerationDisabledReason(sb), '请先填写视频提示词或全能片段描述')
})
