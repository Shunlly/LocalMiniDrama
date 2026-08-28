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
