import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { ElMessage, ElMessageBox } from 'element-plus'

import { dramaAPI } from '../src/api/drama.js'
import { generationAPI } from '../src/api/generation.js'
import { useFilmCreateNavigationGuards } from '../src/composables/filmCreate/useFilmCreateNavigationGuards.js'
import { useFilmCreateProjectLoad } from '../src/composables/filmCreate/useFilmCreateProjectLoad.js'
import { useFilmCreateScriptPersistence } from '../src/composables/filmCreate/useFilmCreateScriptPersistence.js'
import { runGenerateStoryFromPremise } from '../src/composables/useStoryGeneration.js'

const DRAMA_ID = 11
const EPISODE_ID = 22
assert.notEqual(DRAMA_ID, EPISODE_ID)

const filmCreateSource = readFileSync(new URL('../src/views/FilmCreate.vue', import.meta.url), 'utf8')
const scriptPersistenceSource = readFileSync(
  new URL('../src/composables/filmCreate/useFilmCreateScriptPersistence.js', import.meta.url),
  'utf8',
)

function refOf(value) {
  return { value }
}

function stubElementPlusFeedback() {
  const messages = []
  const originals = {
    warning: ElMessage.warning,
    error: ElMessage.error,
    success: ElMessage.success,
    info: ElMessage.info,
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
  ElMessageBox.confirm = async (message, title, options) => {
    messages.push({ type: 'confirm', message, title, options })
    return confirmImpl(message, title, options)
  }
  return {
    messages,
    setConfirm(next) { confirmImpl = next },
    last(type) { return messages.filter((item) => item.type === type).at(-1) },
    restore() {
      ElMessage.warning = originals.warning
      ElMessage.error = originals.error
      ElMessage.success = originals.success
      ElMessage.info = originals.info
      ElMessageBox.confirm = originals.confirm
    },
  }
}

function jsonOk(data) {
  return new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function createProjectLoad() {
  const store = {
    dramaId: DRAMA_ID,
    drama: null,
    currentEpisode: null,
    resetCount: 0,
    setDrama(drama) {
      this.drama = drama
      this.dramaId = drama?.id ?? this.dramaId
    },
    reset() {
      this.resetCount += 1
      this.drama = null
      this.currentEpisode = null
    },
    setCurrentEpisode(ep) { this.currentEpisode = ep },
    setScriptContent() {},
  }
  const storyInput = refOf('')
  const selectedEpisodeId = refOf(null)
  const dependencyCalls = []
  const api = useFilmCreateProjectLoad({
    store,
    dramaId: refOf(DRAMA_ID),
    currentEpisodeId: refOf(EPISODE_ID),
    projectLifecycle: { guardApi(target) { return target } },
    episodeSwitchController: { select: async () => ({ changed: false }) },
    syncEpisodeRouteQuery() {},
    resetStoryboardMediaContext() {},
    ensureStoryboardMediaContext() {},
    storyboardMediaStateController: { isCurrentContext: () => true },
    syncStoryboardStateFromEpisode() {},
    markScriptDraftSaved() {},
    loadStoryboardMedia: async () => ({ failedCount: 0 }),
    recoverAndSyncEpisodeTasks: async (episodeId) => { dependencyCalls.push(['tasks', episodeId]) },
    loadPipelineConcurrency: async () => {},
    refreshVideoGenerationCapability: async () => {},
    refreshProductionReadiness: async () => {},
    scriptTitle: refOf(''),
    selectedEpisodeId,
    savedCurrentEpisodeNumber: refOf(1),
    storyInput,
    storyStyle: refOf(''),
    storyType: refOf(''),
    generationStyle: refOf(''),
    projectAspectRatio: refOf('16:9'),
    videoClipDuration: refOf(5),
    storyboardIncludeNarration: refOf(false),
    storyboardUniversalOmni: refOf(false),
    storyboardUseFirstLastFrame: refOf(false),
    lastFrameUseFirstLayoutLock: refOf(true),
    gridMode: refOf('single'),
    projectLoadState: refOf('ready'),
    projectLoadPending: refOf(false),
    projectLoadError: refOf(''),
    projectLoadNotFound: refOf(false),
    projectDependencyWarning: refOf(''),
    projectDependencyLoading: refOf(false),
    projectLoadFailureRef: refOf(null),
    scriptDraftController: { dispose() {} },
  })
  return { api, store, storyInput, selectedEpisodeId, dependencyCalls }
}

function createScriptPersistence(overrides = {}) {
  const calls = []
  const store = overrides.store || {
    dramaId: DRAMA_ID,
    currentEpisode: { id: EPISODE_ID, episode_number: 1, title: '第1集', script_content: '旧正文' },
    drama: {
      id: DRAMA_ID,
      title: '项目甲',
      episodes: [{ id: EPISODE_ID, episode_number: 1, title: '第1集', script_content: '旧正文' }],
    },
    setDrama(drama) {
      this.drama = drama
      this.dramaId = drama.id
    },
  }
  const generationCalls = []
  const originalGenerateStory = generationAPI.generateStory
  generationAPI.generateStory = async (payload) => {
    generationCalls.push(payload)
    return { task_id: 'task-story' }
  }
  const api = useFilmCreateScriptPersistence({
    store,
    dramaAPI: overrides.dramaAPI || {
      async create(payload) { calls.push(['create', payload]); return { id: DRAMA_ID, title: payload.title } },
      async saveEpisodes(id, episodes) { calls.push(['saveEpisodes', id, episodes]) },
      async saveOutline(id, payload) { calls.push(['saveOutline', id, payload]) },
    },
    router: { replace() {} },
    route: { params: { id: String(DRAMA_ID) } },
    scriptTitle: refOf('第1集'),
    storyType: refOf(''),
    generationStyle: refOf(''),
    storyStyle: refOf(''),
    storyInput: refOf('独立草稿'),
    projectAspectRatio: refOf('16:9'),
    videoClipDuration: refOf(5),
    storyboardIncludeNarration: refOf(false),
    storyboardUniversalOmni: refOf(false),
    storyboardUseFirstLastFrame: refOf(false),
    lastFrameUseFirstLayoutLock: refOf(true),
    projectStylePromptMetadata: () => ({}),
    loadDrama: async () => { calls.push(['loadDrama']) },
    savedCurrentEpisodeNumber: refOf(1),
    selectedEpisodeId: refOf(EPISODE_ID),
    onEpisodeSelect: async () => { calls.push(['select', EPISODE_ID]) },
    storyGenerating: refOf(false),
    scriptGenerating: refOf(false),
    pollTask: async () => ({ status: 'completed', result: { episode_count: 1 } }),
    trackFilmCreateAction() {},
    storyEpisodeCount: refOf(1),
    ...overrides.deps,
  })
  return {
    api,
    store,
    calls,
    generationCalls,
    restore() { generationAPI.generateStory = originalGenerateStory },
  }
}

test('story generation draft is restored from dedicated metadata rather than project description', async () => {
  const originalFetch = globalThis.fetch
  const harness = createProjectLoad()
  globalThis.fetch = async (url) => {
    assert.equal(String(url), '/api/v1/dramas/' + DRAMA_ID)
    return jsonOk({
      id: DRAMA_ID,
      description: '项目说明，不能当生成草稿',
      metadata: { story_generation_draft: '  独立生成草稿  ' },
      episodes: [{ id: EPISODE_ID, episode_number: 1, title: '第1集', script_content: '第一集正文' }],
    })
  }
  try {
    const loaded = await harness.api.loadDrama({ blocking: true })
    assert.equal(loaded, true)
    assert.equal(harness.storyInput.value, '独立生成草稿')
    assert.notEqual(harness.storyInput.value, '项目说明，不能当生成草稿')
    assert.equal(harness.selectedEpisodeId.value, EPISODE_ID)
    assert.deepEqual(harness.dependencyCalls, [['tasks', EPISODE_ID]])
    assert.notEqual(harness.dependencyCalls[0][1], DRAMA_ID)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('saving a script never submits a generation request and keeps its draft out of project description', async () => {
  const feedback = stubElementPlusFeedback()
  const harness = createScriptPersistence()
  try {
    await harness.api.saveScriptToBackend('角色走上舞台。')
    assert.equal(harness.generationCalls.length, 0)
    const created = harness.calls.filter((item) => item[0] === 'create')
    const outlines = harness.calls.filter((item) => item[0] === 'saveOutline')
    const episodes = harness.calls.filter((item) => item[0] === 'saveEpisodes')
    assert.equal(created.length, 0)
    assert.equal(episodes.length, 1)
    assert.equal(episodes[0][1], DRAMA_ID)
    assert.equal(episodes[0][2][0].script_content, '角色走上舞台。')
    assert.equal(outlines.length, 1)
    assert.equal(outlines[0][2].description, undefined)
    assert.equal(outlines[0][2].summary, undefined)
    assert.equal(outlines[0][2].metadata.story_generation_draft, '独立草稿')
    assert.doesNotMatch(JSON.stringify(harness.calls), /generationAPI|generateStory/)

    const createdStore = {
      dramaId: null,
      currentEpisode: null,
      drama: null,
      setDrama(drama) {
        this.drama = drama
        this.dramaId = drama.id
      },
    }
    const createdPersistence = createScriptPersistence({ store: createdStore })
    try {
      await createdPersistence.api.saveScriptToBackend('新项目剧本')
      const createCall = createdPersistence.calls.find((item) => item[0] === 'create')
      assert.ok(createCall)
      assert.equal(createCall[1].description, '')
      assert.equal(createCall[1].metadata.story_generation_draft, '独立草稿')
      assert.equal(createdPersistence.generationCalls.length, 0)
    } finally {
      createdPersistence.restore()
    }
  } finally {
    harness.restore()
    feedback.restore()
  }
})

test('manual single-episode saves preserve the exact script body instead of stripping an episode heading', async () => {
  const feedback = stubElementPlusFeedback()
  const harness = createScriptPersistence()
  const script = '第一集 开场\n对白必须原样保留'
  try {
    await harness.api.saveScriptToBackend(script)
    const payload = harness.calls.find((item) => item[0] === 'saveEpisodes')[2]
    assert.equal(payload.length, 1)
    assert.equal(payload[0].script_content, script)
    assert.notEqual(payload[0].script_content, '开场\n对白必须原样保留')
  } finally {
    harness.restore()
    feedback.restore()
  }
})

test('only the explicit generate-story command can invoke story generation', async () => {
  const feedback = stubElementPlusFeedback()
  const harness = createScriptPersistence()
  const originalCreate = dramaAPI.create
  dramaAPI.create = async () => { throw new Error('saveScript 不应创建项目') }
  try {
    await harness.api.saveScriptToBackend('只保存剧本')
    assert.equal(harness.generationCalls.length, 0)

    await harness.api.onGenerateStory()
    assert.equal(harness.generationCalls.length, 1)
    assert.equal(harness.generationCalls[0].drama_id, DRAMA_ID)
    assert.equal(harness.generationCalls[0].premise, '独立草稿')
    assert.equal(harness.generationCalls[0].metadata.story_generation_draft, '独立草稿')
    assert.equal(harness.generationCalls[0].metadata.summary, undefined)
    assert.equal(harness.generationCalls[0].summary, undefined)

    assert.match(filmCreateSource, /@generate-story="onGenerateStory"/)
    assert.doesNotMatch(filmCreateSource, /runGenerateStoryFromPremise/)
    assert.equal((scriptPersistenceSource.match(/runGenerateStoryFromPremise\(/g) || []).length, 1)
    assert.equal(typeof runGenerateStoryFromPremise, 'function')
  } finally {
    dramaAPI.create = originalCreate
    harness.restore()
    feedback.restore()
  }
})

test('failed automatic script saves offer save, leave, and cancel choices before navigation', async () => {
  const feedback = stubElementPlusFeedback()
  const flushCalls = []
  const guards = useFilmCreateNavigationGuards({
    pipelineStarting: refOf(false),
    pipelineRunning: refOf(false),
    pipelineStopping: refOf(false),
    activePipelineRunPromise: refOf(null),
    pipelineOwnedTaskIds: new Set(),
    showAiConfigDialog: refOf(false),
    aiConfigContentRef: refOf(null),
    scriptDraftController: {
      hasPendingChanges: () => true,
      markSaved() {},
    },
    flushScriptDraft: async () => {
      flushCalls.push('flush')
      throw new Error('自动保存失败')
    },
    cancelPipelineRun: async () => true,
  })
  try {
    feedback.setConfirm(async () => { throw 'close' })
    const closed = await guards.flushDraftBeforeNavigation()
    assert.equal(closed.allowed, false)
    assert.equal(feedback.last('confirm').title, '剧本尚未保存')
    assert.equal(feedback.last('confirm').options.confirmButtonText, '保存并离开')
    assert.equal(feedback.last('confirm').options.cancelButtonText, '仍然离开')
    assert.equal(feedback.last('confirm').options.distinguishCancelAndClose, true)
    assert.deepEqual(flushCalls, ['flush'])

    feedback.setConfirm(async () => { throw 'cancel' })
    const discarded = await guards.flushDraftBeforeNavigation()
    assert.equal(discarded.allowed, true)
    assert.equal(discarded.discard, true)
    assert.deepEqual(flushCalls, ['flush', 'flush'])
  } finally {
    feedback.restore()
  }
})

