import test from 'node:test'
import assert from 'node:assert/strict'

import { ElMessage, ElMessageBox } from 'element-plus'

import { useFilmCreateTaskRecovery } from '../src/composables/filmCreate/useFilmCreateTaskRecovery.js'
import { useFilmCreatePipelineStages } from '../src/composables/filmCreate/useFilmCreatePipelineStages.js'
import { useFilmCreateScriptWorkspace } from '../src/composables/filmCreate/useFilmCreateScriptWorkspace.js'
import { useFilmCreatePipelineRun } from '../src/composables/filmCreate/useFilmCreatePipelineRun.js'
import { useFilmCreateNavigationGuards } from '../src/composables/filmCreate/useFilmCreateNavigationGuards.js'
import { useFilmCreateProductionReadiness } from '../src/composables/filmCreate/useFilmCreateProductionReadiness.js'
import { GEN_RESOURCE } from '../src/stores/generationTaskStore.js'
import { trackFilmCreateAction } from '../src/utils/filmCreateActionLog.js'
import {
  getOperationLogs,
  installOperationLogSink,
  resetOperationLogs,
} from '../src/utils/operationLog.js'

const DRAMA_ID = 11
const EPISODE_ID = 22
const RECOVER_EPISODE_ID = 33
const STORYBOARD_ID = 77

function refOf(value) {
  return { value }
}

function assertDistinctIds(dramaId, episodeId) {
  assert.notEqual(dramaId, episodeId)
}

function forbiddenApi(name) {
  return new Proxy({}, {
    get(_target, prop) {
      return async () => {
        throw new Error(`${name}.${String(prop)} 不应被调用`)
      }
    },
  })
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
    setConfirm(next) {
      confirmImpl = next
    },
    last(type) {
      return messages.filter((item) => item.type === type).at(-1)
    },
    restore() {
      ElMessage.warning = originals.warning
      ElMessage.error = originals.error
      ElMessage.success = originals.success
      ElMessage.info = originals.info
      ElMessageBox.confirm = originals.confirm
    },
  }
}

function createTaskRecovery(overrides = {}) {
  const recoverCalls = []
  const statusCalls = []
  const isRunningQueries = []
  const mediaContextCalls = []
  const videoErrorMsg = overrides.videoErrorMsg || refOf('')
  const dramaId = overrides.dramaId || refOf(DRAMA_ID)
  const currentEpisodeId = overrides.currentEpisodeId || refOf(EPISODE_ID)
  const generatingSbVideoIds = overrides.generatingSbVideoIds || new Set()
  const genStore = {
    isRunning(query) {
      isRunningQueries.push(query)
      return overrides.isRunning ? overrides.isRunning(query) : false
    },
    async recoverPendingForEpisode(payload) {
      recoverCalls.push(payload)
      if (overrides.onRecover) await overrides.onRecover(payload)
    },
    getRunningForEpisode(did, eid) {
      return overrides.getRunningForEpisode?.(did, eid) || []
    },
  }
  const store = {
    currentEpisode: { id: EPISODE_ID, episode_number: 2 },
    drama: { title: '项目甲', episodes: [{ id: EPISODE_ID, episode_number: 2 }] },
    setVideoStatus(status, did, eid) {
      statusCalls.push({ kind: 'status', status, dramaId: did, episodeId: eid })
    },
    setVideoProgress(progress, did, eid) {
      statusCalls.push({ kind: 'progress', progress, dramaId: did, episodeId: eid })
    },
  }
  const recovery = useFilmCreateTaskRecovery({
    dramaId,
    currentEpisodeId,
    store,
    genStore,
    ElMessage: { warning() {}, error() {} },
    videoErrorMsg,
    generatingCharIds: new Set(),
    generatingPropIds: new Set(),
    generatingSceneIds: new Set(),
    generatingSbImageIds: new Set(),
    generatingSbFirstImageIds: new Set(),
    generatingSbLastImageIds: new Set(),
    generatingSbVideoIds,
    currentStoryboardMediaContext(did, eid) {
      mediaContextCalls.push({ dramaId: did, episodeId: eid })
      return { dramaId: did, episodeId: eid }
    },
    loadSingleStoryboardMedia: async () => {},
    captureDramaRefresh: () => () => {},
  })
  return {
    recovery,
    recoverCalls,
    statusCalls,
    isRunningQueries,
    mediaContextCalls,
    videoErrorMsg,
    dramaId,
    currentEpisodeId,
  }
}

test('task recovery returns immediately when dramaId or episodeId is missing', async () => {
  assertDistinctIds(DRAMA_ID, EPISODE_ID)
  const missingDrama = createTaskRecovery({
    dramaId: refOf(null),
    currentEpisodeId: refOf(EPISODE_ID),
  })
  await missingDrama.recovery.recoverAndSyncEpisodeTasks()
  await missingDrama.recovery.recoverAndSyncEpisodeTasks(RECOVER_EPISODE_ID)
  assert.equal(missingDrama.recoverCalls.length, 0)
  assert.equal(missingDrama.statusCalls.length, 0)

  const missingEpisode = createTaskRecovery({
    dramaId: refOf(DRAMA_ID),
    currentEpisodeId: refOf(null),
  })
  await missingEpisode.recovery.recoverAndSyncEpisodeTasks()
  assert.equal(missingEpisode.recoverCalls.length, 0)
  await missingEpisode.recovery.recoverAndSyncEpisodeTasks(EPISODE_ID)
  assert.equal(missingEpisode.recoverCalls.length, 1)
  assert.equal(missingEpisode.recoverCalls[0].dramaId, DRAMA_ID)
  assert.equal(missingEpisode.recoverCalls[0].episodeId, EPISODE_ID)
  assert.notEqual(missingEpisode.recoverCalls[0].dramaId, missingEpisode.recoverCalls[0].episodeId)
})

test('isSbVideoGenerating checks the local Set and genStore.isRunning with distinct ids', () => {
  assertDistinctIds(DRAMA_ID, EPISODE_ID)
  const local = createTaskRecovery({
    generatingSbVideoIds: new Set([STORYBOARD_ID]),
    isRunning(query) {
      if (query.resourceId === STORYBOARD_ID) {
        throw new Error('本地 Set 命中后不应再问 genStore')
      }
      return false
    },
  })
  assert.equal(local.recovery.isSbVideoGenerating(STORYBOARD_ID), true)
  assert.equal(local.recovery.isSbVideoGenerating(88), false)
  assert.equal(local.isRunningQueries.length, 1)
  assert.equal(local.isRunningQueries[0].dramaId, DRAMA_ID)
  assert.equal(local.isRunningQueries[0].episodeId, EPISODE_ID)
  assert.equal(local.isRunningQueries[0].resourceType, GEN_RESOURCE.SB_VIDEO)
  assert.equal(local.isRunningQueries[0].resourceId, 88)

  const fromStore = createTaskRecovery({
    generatingSbVideoIds: new Set(),
    isRunning(query) {
      return query.dramaId === DRAMA_ID
        && query.episodeId === EPISODE_ID
        && query.resourceType === GEN_RESOURCE.SB_VIDEO
        && query.resourceId === STORYBOARD_ID
    },
  })
  assert.equal(fromStore.recovery.isSbVideoGenerating(STORYBOARD_ID), true)
  assert.equal(fromStore.recovery.isSbVideoGenerating(88), false)
  assert.equal(fromStore.isRunningQueries[0].dramaId, DRAMA_ID)
  assert.equal(fromStore.isRunningQueries[0].episodeId, EPISODE_ID)
  assert.notEqual(fromStore.isRunningQueries[0].dramaId, fromStore.isRunningQueries[0].episodeId)
  assert.notEqual(fromStore.isRunningQueries[0].episodeId, fromStore.isRunningQueries[0].resourceId)
})

test('episode merge recovery callbacks update video status for the recovered episode', async () => {
  assertDistinctIds(DRAMA_ID, RECOVER_EPISODE_ID)
  const complete = createTaskRecovery({
    currentEpisodeId: refOf(EPISODE_ID),
    async onRecover(payload) {
      payload.callbacks.onEpisodeMergeComplete()
    },
  })
  await complete.recovery.recoverAndSyncEpisodeTasks(RECOVER_EPISODE_ID)
  assert.deepEqual(complete.statusCalls[0], {
    kind: 'status',
    status: 'done',
    dramaId: DRAMA_ID,
    episodeId: RECOVER_EPISODE_ID,
  })
  assert.deepEqual(complete.statusCalls[1], {
    kind: 'progress',
    progress: 100,
    dramaId: DRAMA_ID,
    episodeId: RECOVER_EPISODE_ID,
  })
  assert.notEqual(complete.statusCalls[0].episodeId, EPISODE_ID)
  assert.equal(complete.mediaContextCalls[0].dramaId, DRAMA_ID)
  assert.equal(complete.mediaContextCalls[0].episodeId, RECOVER_EPISODE_ID)

  const failed = createTaskRecovery({
    currentEpisodeId: refOf(EPISODE_ID),
    async onRecover(payload) {
      payload.callbacks.onEpisodeMergeFailed('合成失败')
      payload.callbacks.onEpisodeMergeFailed('')
    },
  })
  await failed.recovery.recoverAndSyncEpisodeTasks(RECOVER_EPISODE_ID)
  assert.equal(failed.statusCalls[0].status, 'error')
  assert.equal(failed.statusCalls[0].dramaId, DRAMA_ID)
  assert.equal(failed.statusCalls[0].episodeId, RECOVER_EPISODE_ID)
  assert.equal(failed.videoErrorMsg.value, '视频生成失败')
})

function createPipelineStageDeps(overrides = {}) {
  return {
    currentEpisodeId: refOf(EPISODE_ID),
    dramaId: refOf(DRAMA_ID),
    generationAPI: forbiddenApi('generationAPI'),
    dramaAPI: forbiddenApi('dramaAPI'),
    propAPI: forbiddenApi('propAPI'),
    pipelineStarting: refOf(false),
    pipelineRunning: refOf(false),
    pipelineStopping: refOf(false),
    activePipelineRunPromise: refOf(null),
    pipelineAbortRequested: refOf(false),
    storyboardMediaActionReason: refOf(''),
    refreshProductionReadiness: async () => {
      throw new Error('不应检查制作能力')
    },
    confirmProductionPipelineCost: async () => {
      throw new Error('不应弹出计费确认')
    },
    executeOwnedPipelineRun: async () => {
      throw new Error('不应启动完整 pipeline')
    },
    trackFilmCreateAction() {
      throw new Error('不应记录 pipeline 开始')
    },
    getSelectedStyle() {
      throw new Error('缺 id 时不应读取风格')
    },
    ...overrides,
  }
}

test('pipeline stages return early when dramaId or episodeId is missing', async () => {
  assertDistinctIds(DRAMA_ID, EPISODE_ID)
  const feedback = stubElementPlusFeedback()
  try {
    const missingEpisode = useFilmCreatePipelineStages(createPipelineStageDeps({
      currentEpisodeId: refOf(null),
      dramaId: refOf(DRAMA_ID),
    }))
    await missingEpisode.startOneClickPipeline()
    await missingEpisode.startTextFrameworkPipeline()
    await missingEpisode.startRepairPipeline()
    await missingEpisode.runOneClickPipeline()
    await missingEpisode.runRepairPipeline()

    const missingDrama = useFilmCreatePipelineStages(createPipelineStageDeps({
      currentEpisodeId: refOf(EPISODE_ID),
      dramaId: refOf(null),
    }))
    await missingDrama.runOneClickPipeline()
    await missingDrama.runRepairPipeline()
    assert.equal(feedback.messages.length, 0)
  } finally {
    feedback.restore()
  }
})

test('pipeline stages surface Chinese warnings for missing script, storyboard and images', async () => {
  assertDistinctIds(DRAMA_ID, EPISODE_ID)
  const feedback = stubElementPlusFeedback()
  try {
    const missingImages = useFilmCreatePipelineStages(createPipelineStageDeps({
      storyboardMediaActionReason: refOf('请先生成或上传分镜图片'),
    }))
    await missingImages.startOneClickPipeline()
    await missingImages.startRepairPipeline()
    assert.equal(feedback.last('warning').message, '请先生成或上传分镜图片')

    const errors = []
    const actions = []
    const runMissingImages = useFilmCreatePipelineStages(createPipelineStageDeps({
      storyboardMediaActionReason: refOf('请先生成或上传分镜图片'),
      getSelectedStyle: () => 'realistic',
      addPipelineError(step, message) {
        errors.push({ step, message })
      },
      trackFilmCreateAction(action) {
        actions.push(action)
      },
    }))
    await runMissingImages.runOneClickPipeline(false)
    assert.equal(errors[0].step, '流程')
    assert.equal(errors[0].message, '请先生成或上传分镜图片')
    assert.equal(actions[0], 'one_click_generate_failed')

    const missingScript = useFilmCreatePipelineStages(createPipelineStageDeps({
      refreshProductionReadiness: async () => ({
        ready: false,
        reason: '请先填写本集剧本后再生成分镜',
      }),
    }))
    await missingScript.startOneClickPipeline()
    assert.equal(feedback.last('warning').message, '请先填写本集剧本后再生成分镜')

    const missingBoards = useFilmCreatePipelineStages(createPipelineStageDeps({
      refreshProductionReadiness: async () => ({
        ready: false,
        reason: '当前集还没有分镜，请先生成分镜脚本',
      }),
    }))
    await missingBoards.startRepairPipeline()
    assert.equal(feedback.last('warning').message, '当前集还没有分镜，请先生成分镜脚本')
  } finally {
    feedback.restore()
  }
})

function createScriptWorkspace(overrides = {}) {
  const showSelectScriptDialog = overrides.showSelectScriptDialog || refOf(false)
  const scriptWorkbenchMode = overrides.scriptWorkbenchMode || refOf('select')
  const scriptContent = overrides.scriptContent || refOf('')
  const scriptGenerating = refOf(false)
  const selectPreviewEpisodeId = refOf('')
  const anchors = []
  const actions = []
  const dramaAPI = {
    async get() {
      throw new Error('剧本不存在')
    },
    async list() {
      return { items: [] }
    },
    async saveEpisodes() {
      throw new Error('dramaAPI.saveEpisodes 不应被调用')
    },
    async saveOutline() {
      throw new Error('dramaAPI.saveOutline 不应被调用')
    },
    async create() {
      throw new Error('dramaAPI.create 不应被调用')
    },
    ...overrides.dramaAPI,
  }
  const workspace = useFilmCreateScriptWorkspace({
    store: {
      dramaId: DRAMA_ID,
      scriptContent: '',
      drama: { episodes: [{ id: EPISODE_ID, episode_number: 1, title: '第1集' }] },
      setDrama() {},
      setScriptContent() {},
    },
    dramaAPI,
    router: { replace() { throw new Error('不应跳转路由') } },
    route: { params: { id: String(DRAMA_ID) } },
    loadDrama: async () => {},
    scrollToAnchor(anchor) { anchors.push(anchor) },
    saveScriptToBackend: overrides.saveScriptToBackend || (async () => {
      throw new Error('保存失败：磁盘已满')
    }),
    flushScriptDraft: overrides.flushScriptDraft || (async () => {}),
    markScriptDraftSaved: () => {},
    trackFilmCreateAction(action) { actions.push(action) },
    scriptTitle: refOf('新故事'),
    scriptContent,
    scriptGenerating,
    savedCurrentEpisodeNumber: refOf(1),
    selectedEpisodeId: refOf(EPISODE_ID),
    selectPreviewEpisodeId,
    showSelectScriptDialog,
    scriptWorkbenchMode,
    showCharLibrary: refOf(false),
    resourcePanelCollapsed: refOf(false),
    charactersBlockCollapsed: refOf(false),
    selectScriptLoading: refOf(false),
    selectScriptDramas: refOf([]),
    selectScriptImporting: refOf(false),
    novelText: refOf(''),
    novelFileName: refOf(''),
    novelFileContent: refOf(''),
    novelImportMode: refOf('text'),
    novelImporting: refOf(false),
    novelMaxChapters: refOf(10),
    novelAiSummarize: refOf(false),
    showNovelImport: refOf(false),
  })
  return {
    workspace,
    showSelectScriptDialog,
    scriptWorkbenchMode,
    scriptGenerating,
    anchors,
    actions,
  }
}

test('script workspace open and return toggles dialog and workbench mode', async () => {
  assertDistinctIds(DRAMA_ID, EPISODE_ID)
  const harness = createScriptWorkspace()
  harness.workspace.openSelectScriptDialog()
  assert.equal(harness.showSelectScriptDialog.value, true)
  assert.equal(harness.scriptWorkbenchMode.value, 'select')
  await harness.workspace.returnToScriptCreation()
  assert.equal(harness.showSelectScriptDialog.value, false)
  assert.equal(harness.scriptWorkbenchMode.value, 'create')
  assert.deepEqual(harness.anchors, ['anchor-script'])
})

test('script workspace reports Chinese ElMessage when save or pick fails', async () => {
  assertDistinctIds(DRAMA_ID, EPISODE_ID)
  const feedback = stubElementPlusFeedback()
  try {
    const empty = createScriptWorkspace({ scriptContent: refOf('   ') })
    await empty.workspace.onGenerateScript()
    assert.equal(feedback.last('warning').message, '请先在「故事生成」中点击 AI 生成，或手动输入剧本内容')
    assert.deepEqual(empty.actions, ['save_script_click'])
    assert.equal(empty.scriptGenerating.value, false)

    const saveFailed = createScriptWorkspace({ scriptContent: refOf('第一场：开门') })
    await saveFailed.workspace.onGenerateScript()
    assert.equal(feedback.last('error').message, '保存失败：磁盘已满')
    assert.equal(saveFailed.scriptGenerating.value, false)

    const pickFailed = createScriptWorkspace()
    await pickFailed.workspace.onPickScriptFromDialog(RECOVER_EPISODE_ID)
    assert.equal(feedback.last('confirm').title, '导入剧本到当前工程')
    assert.equal(feedback.last('error').message, '剧本不存在')
    assert.notEqual(DRAMA_ID, RECOVER_EPISODE_ID)
  } finally {
    feedback.restore()
  }
})

test('pipeline stop complete is recorded as cancel instead of success', async () => {
  const feedback = stubElementPlusFeedback()
  const events = []
  const restoreSink = installOperationLogSink((event) => events.push(event))
  resetOperationLogs()
  const cancelCalls = []
  const stopCalls = []
  try {
    const run = useFilmCreatePipelineRun({
      store: { storyboards: [{ id: STORYBOARD_ID }] },
      videoClipDuration: refOf(5),
      taskAPI: {
        async cancel(taskId, payload, options) {
          cancelCalls.push({ taskId, payload, options })
        },
      },
      genStore: {
        stopPollingTask(taskId, reason) {
          stopCalls.push({ taskId, reason })
        },
      },
      trackFilmCreateAction,
      getStoryboardCountForApi: () => 1,
    })

    assert.equal(await run.cancelPipelineRun(), true)
    assert.equal(events.some((event) => event.details?.action === 'pipeline_stop_complete'), false)

    run.pipelineStopping.value = true
    assert.equal(await run.cancelPipelineRun(), false)

    run.pipelineStopping.value = false
    run.pipelineRunning.value = true
    run.pipelineOwnedTaskIds.add(501)
    assert.equal(await run.cancelPipelineRun(), true)
    assert.equal(cancelCalls[0].taskId, 501)
    assert.equal(cancelCalls[0].payload.reason, '用户停止全流程')
    assert.deepEqual(stopCalls[0], { taskId: 501, reason: '已停止本地等待' })
    assert.equal(feedback.last('warning').message, '本地全流程已停止；已提交的供应商任务和计费可能继续，请稍后刷新任务状态')
    assert.equal(run.pipelineCurrentStep.value, '本地全流程已停止；供应商任务可能继续')
    assert.equal(run.pipelineRunning.value, false)

    const filmEvents = getOperationLogs().filter((event) => event.operation === 'film_create')
    const complete = filmEvents.find((event) => event.details?.action === 'pipeline_stop_complete')
    const start = filmEvents.find((event) => event.details?.action === 'pipeline_stop_start')
    assert.equal(start.phase, 'start')
    assert.equal(complete.phase, 'cancel')
    assert.notEqual(complete.phase, 'success')
  } finally {
    restoreSink()
    resetOperationLogs()
    feedback.restore()
  }
})

test('failed pipeline stop keeps waiting and records an error phase', async () => {
  const feedback = stubElementPlusFeedback()
  const restoreSink = installOperationLogSink(() => {})
  resetOperationLogs()
  try {
    const run = useFilmCreatePipelineRun({
      store: { storyboards: [] },
      videoClipDuration: refOf(5),
      taskAPI: {
        async cancel() {
          throw new Error('停止失败')
        },
      },
      genStore: { stopPollingTask() {} },
      trackFilmCreateAction,
    })
    run.pipelineRunning.value = true
    run.pipelineOwnedTaskIds.add(502)
    assert.equal(await run.cancelPipelineRun(), false)
    assert.equal(run.pipelineRunning.value, true)
    assert.equal(run.pipelineOwnedTaskIds.has(502), true)
    assert.equal(run.pipelineCurrentStep.value, '停止未完成，请重试处理剩余本地任务')
    assert.match(feedback.last('error').message, /仍有 1 个任务状态未能标记为已停止/)
    const failed = getOperationLogs().find((event) => event.details?.action === 'pipeline_stop_failed')
    assert.equal(failed.phase, 'error')
  } finally {
    restoreSink()
    resetOperationLogs()
    feedback.restore()
  }
})

function createNavigationGuards(overrides = {}) {
  const pipelineOwnedTaskIds = overrides.pipelineOwnedTaskIds || new Set()
  return useFilmCreateNavigationGuards({
    pipelineStarting: refOf(false),
    pipelineRunning: refOf(false),
    pipelineStopping: refOf(false),
    activePipelineRunPromise: refOf(null),
    pipelineOwnedTaskIds,
    showAiConfigDialog: refOf(false),
    aiConfigContentRef: refOf(null),
    scriptDraftController: {
      hasPendingChanges: () => false,
      markSaved() {},
      ...overrides.scriptDraftController,
    },
    flushScriptDraft: overrides.flushScriptDraft || (async () => {}),
    cancelPipelineRun: overrides.cancelPipelineRun || (async () => true),
    ...overrides.deps,
  })
}

test('navigation guards block unload when draft or pipeline work is pending', () => {
  const draftGuards = createNavigationGuards({
    scriptDraftController: { hasPendingChanges: () => true, markSaved() {} },
  })
  let draftPrevented = false
  const draftEvent = {
    preventDefault() { draftPrevented = true },
    returnValue: 'preset',
  }
  draftGuards.handleBeforeUnload(draftEvent)
  assert.equal(draftPrevented, true)
  assert.equal(draftEvent.returnValue, '')

  const pipelineGuards = createNavigationGuards({
    pipelineOwnedTaskIds: new Set([501]),
  })
  let pipelinePrevented = false
  const pipelineEvent = {
    preventDefault() { pipelinePrevented = true },
    returnValue: 'preset',
  }
  pipelineGuards.handleBeforeUnload(pipelineEvent)
  assert.equal(pipelineGuards.hasActivePipelineWork(), true)
  assert.equal(pipelinePrevented, true)

  const idleGuards = createNavigationGuards()
  let idlePrevented = false
  const idleEvent = {
    preventDefault() { idlePrevented = true },
    returnValue: 'preset',
  }
  idleGuards.handleBeforeUnload(idleEvent)
  assert.equal(idleGuards.hasActivePipelineWork(), false)
  assert.equal(idlePrevented, false)
  assert.equal(idleEvent.returnValue, 'preset')
})

test('navigation guards keep the user on the page while pipeline is stopping or leave is cancelled', async () => {
  const feedback = stubElementPlusFeedback()
  try {
    const stopping = createNavigationGuards({
      deps: { pipelineStopping: refOf(true), pipelineRunning: refOf(true) },
    })
    assert.equal(await stopping.confirmPipelineNavigation(), false)
    assert.equal(feedback.last('info').message, '全流程仍在停止中，请等待停止完成后再离开')

    feedback.setConfirm(async () => { throw 'cancel' })
    const running = createNavigationGuards({
      deps: { pipelineRunning: refOf(true) },
    })
    assert.equal(await running.confirmPipelineNavigation(), false)
    assert.equal(feedback.last('confirm').title, '全流程仍在执行')
    assert.equal(await running.allowNavigationAfterDraftFlush(), false)

    const flushFailed = createNavigationGuards({
      scriptDraftController: { hasPendingChanges: () => true, markSaved() {} },
      flushScriptDraft: async () => { throw new Error('自动保存失败') },
    })
    feedback.setConfirm(async () => { throw 'close' })
    const decision = await flushFailed.flushDraftBeforeNavigation()
    assert.equal(decision.allowed, false)
    assert.equal(feedback.last('confirm').title, '剧本尚未保存')
  } finally {
    feedback.restore()
  }
})

function jsonOk(data) {
  return new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

test('production readiness stays blocked when config or assets are missing', async () => {
  assertDistinctIds(DRAMA_ID, EPISODE_ID)
  const originalFetch = globalThis.fetch
  const fetchCalls = []
  globalThis.fetch = async (url, options = {}) => {
    fetchCalls.push({ url: String(url), method: options.method, body: options.body })
    const target = String(url)
    if (target.includes('/workflows/novel2anime/readiness')) {
      return jsonOk({
        ready: false,
        qa_mode: 'production',
        capabilities: [],
        missing_capabilities: [
          { label: '视频模型', detail: '未配置已启用的视频服务', service_type: 'video' },
          { label: '分镜图片', detail: '当前集缺少可用分镜图', service_type: 'image' },
        ],
      })
    }
    if (target.includes('/ai-configs?service_type=video')) {
      return jsonOk([])
    }
    throw new Error(`不应请求 ${target}`)
  }
  try {
    const productionReadinessLoading = refOf(false)
    const productionReadinessFailed = refOf(false)
    const authoritativeProductionReadiness = refOf(null)
    const productionReadinessReason = {
      get value() {
        if (productionReadinessLoading.value) return '正在检查完整成片所需的 AI 服务与本地合成能力。'
        if (productionReadinessFailed.value) return '无法确认完整成片制作能力，请刷新后重试。'
        const gaps = authoritativeProductionReadiness.value?.missing_capabilities || []
        if (!gaps.length) return ''
        return gaps.map((gap) => `${gap.label}：${gap.detail}`).join('；')
      },
    }
    const videoCapabilityLoading = refOf(false)
    const videoCapabilityFailed = refOf(false)
    const videoCapabilityConfigs = refOf([])
    const videoGenerationCapability = refOf({ reason: '', config: null })
    const readiness = useFilmCreateProductionReadiness({
      dramaId: refOf(DRAMA_ID),
      productionReadinessLoading,
      productionReadinessFailed,
      authoritativeProductionReadiness,
      productionReadinessReason,
      videoCapabilityLoading,
      videoCapabilityFailed,
      videoCapabilityConfigs,
      videoGenerationCapability,
    })

    const production = await readiness.refreshProductionReadiness()
    assert.equal(production.ready, false)
    assert.equal(production.reason, '视频模型：未配置已启用的视频服务；分镜图片：当前集缺少可用分镜图')
    const readinessBody = JSON.parse(fetchCalls[0].body)
    assert.equal(readinessBody.drama_id, DRAMA_ID)
    assert.equal(readinessBody.episode_id, undefined)
    assert.notEqual(readinessBody.drama_id, EPISODE_ID)

    const capability = await readiness.refreshVideoGenerationCapability()
    assert.equal(capability.ready, false)
    assert.equal(capability.reason, '缺少已启用的视频模型，完整成片和批量视频暂不可用。')
    assert.equal(readiness.canUseUniversalOmniVideoApi(null), false)
    assert.equal(readiness.canUseUniversalOmniVideoApi({ api_protocol: 'kling_omni' }), true)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('production readiness reports a Chinese failure when capability lookup fails', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    const target = String(url)
    if (target.includes('/workflows/novel2anime/readiness')) {
      return new Response(JSON.stringify({ success: false }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      })
    }
    if (target.includes('/ai-configs?service_type=video')) {
      throw new Error('network down')
    }
    throw new Error(`不应请求 ${target}`)
  }
  try {
    const productionReadinessLoading = refOf(false)
    const productionReadinessFailed = refOf(false)
    const authoritativeProductionReadiness = refOf(null)
    const productionReadinessReason = {
      get value() {
        if (productionReadinessFailed.value) return '无法确认完整成片制作能力，请刷新后重试。'
        return ''
      },
    }
    const videoCapabilityLoading = refOf(false)
    const videoCapabilityFailed = refOf(false)
    const videoCapabilityConfigs = refOf([{ id: 1 }])
    const videoGenerationCapability = refOf({ reason: '', config: null })
    const readiness = useFilmCreateProductionReadiness({
      dramaId: refOf(DRAMA_ID),
      productionReadinessLoading,
      productionReadinessFailed,
      authoritativeProductionReadiness,
      productionReadinessReason,
      videoCapabilityLoading,
      videoCapabilityFailed,
      videoCapabilityConfigs,
      videoGenerationCapability,
    })

    const production = await readiness.refreshProductionReadiness()
    assert.equal(production.ready, false)
    assert.equal(production.reason, '无法确认完整成片制作能力，请刷新后重试。')
    assert.equal(productionReadinessFailed.value, true)

    const capability = await readiness.refreshVideoGenerationCapability()
    assert.equal(capability.ready, false)
    assert.equal(capability.reason, '无法确认视频模型配置，请刷新后重试或前往 AI 配置检查。')
    assert.equal(videoCapabilityFailed.value, true)
    assert.deepEqual(videoCapabilityConfigs.value, [])
  } finally {
    globalThis.fetch = originalFetch
  }
})
