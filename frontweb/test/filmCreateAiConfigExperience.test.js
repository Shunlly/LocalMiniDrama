import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { effectScope, nextTick, ref } from 'vue'

import { useAiConfigCoverage } from '../src/composables/useAiConfigCoverage.js'
import { useFilmCreateAiConfigWorkspace } from '../src/composables/filmCreate/useFilmCreateAiConfigWorkspace.js'
import { useFilmCreateProductionReadiness } from '../src/composables/filmCreate/useFilmCreateProductionReadiness.js'
import { useFilmCreateProjectLoad } from '../src/composables/filmCreate/useFilmCreateProjectLoad.js'

/**
 * 已抽出的 JS 模块用真实导入跑行为；仍留在 Vue/CSS 里的接线只做 source match，
 * 不拼接 SFC 再 eval，也不抽取 AIConfigContent 的 loadList/连接测试。
 */
function readSource(url) {
  return readFileSync(url, 'utf8').replace(/\r\n?/g, '\n')
}

const filmCreateSource = readSource(new URL('../src/views/FilmCreate.vue', import.meta.url))
const filmListSource = readSource(new URL('../src/views/FilmList.vue', import.meta.url))
const aiConfigSource = readSource(new URL('../src/components/AIConfigContent.vue', import.meta.url))
const pipelinePanelSource = readSource(new URL('../src/components/filmCreate/FilmCreatePipelinePanel.vue', import.meta.url))
const videoSettingsSource = readSource(new URL('../src/components/filmCreate/FilmCreateVideoSettingsPanel.vue', import.meta.url))
const aiConfigDialogSource = readSource(new URL('../src/components/filmCreate/FilmCreateAiConfigDialog.vue', import.meta.url))
const themeSource = readSource(new URL('../src/styles/theme.css', import.meta.url))
const mainSource = readSource(new URL('../src/main.js', import.meta.url))
const aiDialogHostSelector = ':is(.el-dialog.ai-config-workspace-dialog, .el-dialog:has(> .el-dialog__body > .ai-config-content))'

const DRAMA_ID = 11
const EPISODE_ID = 22
const TEXT_CONFIG_ID = 41
const IMAGE_CONFIG_ID = 77
const STALE_VIDEO_ID = 101
const LATEST_VIDEO_ID = 202
assert.notEqual(DRAMA_ID, EPISODE_ID)
assert.notEqual(TEXT_CONFIG_ID, IMAGE_CONFIG_ID)
assert.notEqual(STALE_VIDEO_ID, LATEST_VIDEO_ID)

const originalFetch = globalThis.fetch

function cssRule(source, selector) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = source.match(new RegExp(`${escapedSelector}\\s*\\{([\\s\\S]*?)\\}`))
  assert.ok(match, `missing CSS rule: ${selector}`)
  return match[1]
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function jsonOk(data) {
  return new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function jsonError(status = 500) {
  return new Response(JSON.stringify({ success: false }), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

async function flushUi() {
  await nextTick()
  await Promise.resolve()
  await nextTick()
  await Promise.resolve()
}

async function waitFor(predicate, label) {
  for (let i = 0; i < 20; i += 1) {
    if (predicate()) return
    await flushUi()
  }
  assert.fail(label)
}

function videoConfig(id) {
  return {
    id,
    name: `视频配置 ${id}`,
    service_type: 'video',
    is_active: true,
    is_default: true,
    provider: 'openai',
    default_model: `model-${id}`,
    api_key: 'sk-test',
    credential_set: true,
  }
}

function readinessPayload({ ready, missing = [] }) {
  return {
    ready,
    qa_mode: 'production',
    capabilities: missing.map((item) => ({ ...item, required: true, ready: false })),
    missing_capabilities: missing,
  }
}

function stubFetch(responders) {
  const calls = []
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url)
    calls.push({
      url: target,
      method: init.method || 'GET',
      body: init.body ? JSON.parse(init.body) : null,
    })
    for (const [fragment, responder] of Object.entries(responders)) {
      if (target.includes(fragment)) return responder(init, calls)
    }
    throw new Error(`不应请求 ${target}`)
  }
  return {
    calls,
    restore() {
      globalThis.fetch = originalFetch
    },
  }
}

function createProjectLoad(overrides = {}) {
  const calls = []
  const deps = {
    store: {
      dramaId: DRAMA_ID,
      setDrama() {},
      reset() {},
      setCurrentEpisode() {},
      setScriptContent() {},
    },
    dramaId: ref(DRAMA_ID),
    currentEpisodeId: ref(EPISODE_ID),
    projectLifecycle: { guardApi(next) { return next } },
    episodeSwitchController: { async select() { return { changed: false } } },
    syncEpisodeRouteQuery() {},
    resetStoryboardMediaContext() {},
    ensureStoryboardMediaContext() {},
    storyboardMediaStateController: { isCurrentContext: () => true },
    syncStoryboardStateFromEpisode() {},
    markScriptDraftSaved() {},
    async loadStoryboardMedia() {
      calls.push('media')
      return { failedCount: 0 }
    },
    async recoverAndSyncEpisodeTasks(episodeId) {
      calls.push(['tasks', episodeId])
    },
    async loadPipelineConcurrency() {
      calls.push('concurrency')
    },
    async refreshVideoGenerationCapability() {
      calls.push('video')
    },
    async refreshProductionReadiness() {
      calls.push('production')
    },
    scriptTitle: ref(''),
    selectedEpisodeId: ref(EPISODE_ID),
    savedCurrentEpisodeNumber: ref(1),
    storyInput: ref(''),
    storyStyle: ref(''),
    storyType: ref(''),
    generationStyle: ref(''),
    projectAspectRatio: ref('16:9'),
    videoClipDuration: ref(5),
    storyboardIncludeNarration: ref(false),
    storyboardUniversalOmni: ref(false),
    storyboardUseFirstLastFrame: ref(false),
    lastFrameUseFirstLayoutLock: ref(true),
    gridMode: ref('grid'),
    projectLoadState: ref('ready'),
    projectLoadPending: ref(false),
    projectLoadError: ref(''),
    projectLoadNotFound: ref(false),
    projectDependencyWarning: ref(''),
    projectDependencyLoading: ref(false),
    projectLoadFailureRef: ref({ focus() {} }),
    scriptDraftController: { dispose() {} },
    ...overrides,
  }
  return {
    api: useFilmCreateProjectLoad(deps),
    calls,
    deps,
  }
}

function createReadiness() {
  const productionReadinessLoading = ref(false)
  const productionReadinessFailed = ref(false)
  const authoritativeProductionReadiness = ref(null)
  const videoCapabilityLoading = ref(false)
  const videoCapabilityFailed = ref(false)
  const videoCapabilityConfigs = ref([])
  const api = useFilmCreateProductionReadiness({
    dramaId: ref(DRAMA_ID),
    productionReadinessLoading,
    productionReadinessFailed,
    authoritativeProductionReadiness,
    videoCapabilityLoading,
    videoCapabilityFailed,
    videoCapabilityConfigs,
  })
  return {
    api,
    productionReadinessLoading,
    productionReadinessFailed,
    authoritativeProductionReadiness,
    videoCapabilityLoading,
    videoCapabilityFailed,
    videoCapabilityConfigs,
  }
}

function createAiConfigWorkspace(options = {}) {
  const events = []
  const showAiConfigDialog = ref(false)
  const aiConfigContentRef = ref(options.content || { async requestClose() { return true } })
  const pipelinePanelRef = ref({
    focusSummary() { events.push('focus') },
  })
  const aiConfigInitialServiceType = ref(options.initialServiceType || '')
  const aiConfigChanged = ref(false)
  const aiConfigOpenedFromPipelineAction = ref(false)
  const api = useFilmCreateAiConfigWorkspace({
    ElMessage: {
      info(message) { events.push(`message:${message}`) },
    },
    showAiConfigDialog,
    aiConfigContentRef,
    pipelinePanelRef,
    aiConfigInitialServiceType,
    aiConfigChanged,
    aiConfigOpenedFromPipelineAction,
    invalidateActiveVideoAiConfigCache() { events.push('invalidate-cache') },
    async refreshVideoGenerationCapability() {
      events.push('video-start')
      if (options.videoGate) await options.videoGate.promise
      events.push('video-end')
    },
    async refreshProductionReadiness() {
      events.push('production-start')
      if (options.productionGate) await options.productionGate.promise
      events.push('production-end')
    },
  })
  return {
    api,
    events,
    showAiConfigDialog,
    aiConfigContentRef,
    aiConfigInitialServiceType,
    aiConfigChanged,
    aiConfigOpenedFromPipelineAction,
  }
}

function createCoverage(overrides = {}) {
  const testingConfigId = overrides.testingConfigId || ref(null)
  const configWriteLocked = overrides.configWriteLocked || ref(false)
  const api = useAiConfigCoverage({
    vendorLock: overrides.vendorLock || ref({ enabled: false }),
    configWriteLocked,
    testingConfigId,
    canAutoOpenMissingService: ref(true),
    configWorkspaceView: ref('coverage'),
    activeServiceFilter: ref(''),
    serviceCoverage: ref({ services: [] }),
    coverageWorkspaceModeRef: ref(null),
    configListSectionRef: ref(null),
    selectConfigWorkspaceView() {},
    normalizeInitialServiceType: (value) => value,
    openAddForService() {},
    async openEdit() {},
    async openTest() {},
    abortConnectionTest() {},
  })
  return { api, testingConfigId, configWriteLocked }
}

test.afterEach(() => {
  globalThis.fetch = originalFetch
})

test('FilmCreate keeps AI readiness in the pipeline instead of the page-level dependency warning', async () => {
  assert.match(filmCreateSource, /:production-readiness-reason="productionReadinessReason"/)
  assert.match(filmCreateSource, /:production-readiness-state="productionReadinessState"/)
  assert.match(filmCreateSource, /@retry-readiness="refreshProductionReadiness"/)

  const capabilityCalls = []
  const capabilityFails = createProjectLoad({
    async loadPipelineConcurrency() {
      capabilityCalls.push('concurrency')
      throw new Error('并发配置失败')
    },
    async refreshVideoGenerationCapability() {
      capabilityCalls.push('video')
      throw new Error('视频能力失败')
    },
    async refreshProductionReadiness() {
      capabilityCalls.push('production')
      throw new Error('就绪检查失败')
    },
  })
  const ok = await capabilityFails.api.refreshProjectDependencies(EPISODE_ID, { includeProjectCapabilities: true })
  assert.equal(ok, true)
  assert.equal(capabilityFails.deps.projectDependencyWarning.value, '')
  assert.deepEqual(capabilityCalls, ['concurrency', 'video', 'production'])
  assert.deepEqual(capabilityFails.calls, ['media', ['tasks', EPISODE_ID]])
  assert.notEqual(capabilityFails.calls[1][1], DRAMA_ID)

  const skipped = createProjectLoad()
  await skipped.api.refreshProjectDependencies(EPISODE_ID)
  assert.deepEqual(skipped.calls, ['media', ['tasks', EPISODE_ID]])

  const taskFailed = createProjectLoad({
    async recoverAndSyncEpisodeTasks() { throw new Error('任务同步失败') },
    async refreshVideoGenerationCapability() { throw new Error('视频能力失败') },
    async refreshProductionReadiness() { throw new Error('就绪检查失败') },
  })
  const taskOk = await taskFailed.api.refreshProjectDependencies(EPISODE_ID, { includeProjectCapabilities: true })
  assert.equal(taskOk, false)
  assert.match(taskFailed.deps.projectDependencyWarning.value, /生成任务状态暂时无法同步/)
  assert.match(taskFailed.deps.projectDependencyWarning.value, /项目已正常打开/)
})

test('FilmCreate readiness refreshes use independent latest-request generation guards', async () => {
  const staleReadiness = deferred()
  const latestReadiness = deferred()
  const staleVideo = deferred()
  const latestVideo = deferred()
  let readinessCalls = 0
  let videoCalls = 0
  const fetchStub = stubFetch({
    '/workflows/novel2anime/readiness': async (init) => {
      const body = JSON.parse(init.body)
      assert.equal(body.drama_id, DRAMA_ID)
      assert.equal(body.episode_id, undefined)
      assert.notEqual(body.drama_id, EPISODE_ID)
      const call = ++readinessCalls
      if (call === 1) await staleReadiness.promise
      else await latestReadiness.promise
      return jsonOk(readinessPayload(call === 1
        ? {
          ready: false,
          missing: [{ label: '过期视频模型', detail: '旧请求', service_type: 'video' }],
        }
        : { ready: true }))
    },
    '/ai-configs?service_type=video': async () => {
      const call = ++videoCalls
      if (call === 1) await staleVideo.promise
      else await latestVideo.promise
      return jsonOk([videoConfig(call === 1 ? STALE_VIDEO_ID : LATEST_VIDEO_ID)])
    },
  })
  try {
    const production = createReadiness()
    const staleProductionRun = production.api.refreshProductionReadiness()
    const latestProductionRun = production.api.refreshProductionReadiness()
    latestReadiness.resolve()
    const latestProduction = await latestProductionRun
    assert.equal(latestProduction.ready, true)
    assert.equal(production.productionReadinessFailed.value, false)
    assert.equal(production.authoritativeProductionReadiness.value.ready, true)

    staleReadiness.resolve()
    const staleProduction = await staleProductionRun
    assert.equal(staleProduction.ready, true)
    assert.equal(production.authoritativeProductionReadiness.value.ready, true)
    assert.equal(production.productionReadinessFailed.value, false)
    assert.equal(production.productionReadinessLoading.value, false)

    const video = createReadiness()
    const staleVideoRun = video.api.refreshVideoGenerationCapability()
    const latestVideoRun = video.api.refreshVideoGenerationCapability()
    latestVideo.resolve()
    const latestCapability = await latestVideoRun
    assert.equal(latestCapability.ready, true)
    assert.equal(latestCapability.config.id, LATEST_VIDEO_ID)

    staleVideo.resolve()
    const staleCapability = await staleVideoRun
    assert.equal(staleCapability.ready, true)
    assert.equal(staleCapability.config.id, LATEST_VIDEO_ID)
    assert.equal(video.videoCapabilityConfigs.value[0].id, LATEST_VIDEO_ID)
    assert.equal(video.videoCapabilityFailed.value, false)
    const cached = await video.api.getActiveVideoAiConfig()
    assert.equal(cached.id, LATEST_VIDEO_ID)

    fetchStub.restore()
    const staleSuccess = deferred()
    const latestFailure = deferred()
    let supersededCalls = 0
    const supersededFetch = stubFetch({
      '/workflows/novel2anime/readiness': async () => {
        const call = ++supersededCalls
        if (call === 1) {
          await staleSuccess.promise
          return jsonOk(readinessPayload({ ready: true }))
        }
        await latestFailure.promise
        return jsonError(500)
      },
    })
    try {
      const superseded = createReadiness()
      const staleRun = superseded.api.refreshProductionReadiness()
      const latestRun = superseded.api.refreshProductionReadiness()
      latestFailure.resolve()
      const latestResult = await latestRun
      assert.equal(latestResult.ready, false)
      assert.equal(superseded.productionReadinessFailed.value, true)
      staleSuccess.resolve()
      const staleResult = await staleRun
      assert.equal(staleResult.ready, false)
      assert.equal(superseded.productionReadinessFailed.value, true)
      assert.equal(superseded.authoritativeProductionReadiness.value, null)
    } finally {
      supersededFetch.restore()
    }

    const mixed = createReadiness()
    const productionGate = deferred()
    const videoGate = deferred()
    let mixedReadiness = 0
    let mixedVideo = 0
    fetchStub.restore()
    const mixedFetch = stubFetch({
      '/workflows/novel2anime/readiness': async () => {
        mixedReadiness += 1
        await productionGate.promise
        return jsonOk(readinessPayload({ ready: true }))
      },
      '/ai-configs?service_type=video': async () => {
        mixedVideo += 1
        await videoGate.promise
        return jsonOk([videoConfig(LATEST_VIDEO_ID)])
      },
    })
    const productionRun = mixed.api.refreshProductionReadiness()
    const videoRun = mixed.api.refreshVideoGenerationCapability()
    await flushUi()
    assert.equal(mixed.productionReadinessLoading.value, true)
    assert.equal(mixed.videoCapabilityLoading.value, true)

    videoGate.resolve()
    const mixedVideoResult = await videoRun
    assert.equal(mixedVideoResult.config.id, LATEST_VIDEO_ID)
    assert.equal(mixed.videoCapabilityLoading.value, false)
    assert.equal(mixed.productionReadinessLoading.value, true)
    assert.equal(mixed.authoritativeProductionReadiness.value, null)

    productionGate.resolve()
    const mixedProductionResult = await productionRun
    assert.equal(mixedProductionResult.ready, true)
    assert.equal(mixed.productionReadinessLoading.value, false)
    assert.equal(mixed.videoCapabilityConfigs.value[0].id, LATEST_VIDEO_ID)
    assert.equal(mixedReadiness, 1)
    assert.equal(mixedVideo, 1)
    mixedFetch.restore()
  } finally {
    fetchStub.restore()
  }
})

test('FilmCreate AI config dialog fixes its header and tabs around one content scroller', () => {
  assert.match(
    aiConfigDialogSource,
    /<AccessibleDialog\s+v-model="visible"[^>]*top="5vh"[^>]*class="ai-config-workspace-dialog ai-config-overlay"/,
  )
  assert.doesNotMatch(aiConfigSource, /max-height:\s*calc\(100vh\s*-\s*320px\)/)
  assert.match(mainSource, /import ['"]\.\/styles\/theme\.css['"]/)

  assert.match(
    filmListSource,
    /<AccessibleDialog\s+v-model="showAiConfigDialog"[\s\S]*?<AIConfigContent ref="aiConfigContentRef" v-if="showAiConfigDialog"\s*\/>/,
  )
  assert.doesNotMatch(filmListSource, /ai-config-workspace-dialog/)

  const dialog = cssRule(themeSource, aiDialogHostSelector)
  assert.match(dialog, /margin-top:\s*5vh/)
  assert.match(dialog, /max-height:\s*90vh/)
  assert.match(dialog, /display:\s*flex/)
  assert.match(dialog, /flex-direction:\s*column/)
  assert.match(dialog, /overflow:\s*hidden/)

  const header = cssRule(themeSource, `${aiDialogHostSelector} > .el-dialog__header`)
  assert.match(header, /flex:\s*0 0 auto/)

  const body = cssRule(themeSource, `${aiDialogHostSelector} > .el-dialog__body`)
  assert.match(body, /flex:\s*1 1 auto/)
  assert.match(body, /display:\s*flex/)
  assert.match(body, /flex-direction:\s*column/)
  assert.match(body, /min-height:\s*0/)
  assert.match(body, /overflow:\s*hidden/)

  const tabsHeader = cssRule(themeSource, `${aiDialogHostSelector} .config-tabs > .el-tabs__header`)
  assert.match(tabsHeader, /flex:\s*0 0 auto/)

  const tabsContent = cssRule(themeSource, `${aiDialogHostSelector} .config-tabs > .el-tabs__content`)
  assert.match(tabsContent, /min-height:\s*0/)
  assert.match(tabsContent, /overflow:\s*hidden/)

  const tabContent = cssRule(themeSource, `${aiDialogHostSelector} .tab-content`)
  assert.match(tabContent, /height:\s*100%/)
  assert.match(tabContent, /max-height:\s*100%/)
  assert.match(tabContent, /overflow-y:\s*auto/)

  const workspaceScrollRules = [...themeSource.matchAll(
    /:is\(\.el-dialog\.ai-config-workspace-dialog,[^\{]*\{([\s\S]*?)\}/g,
  )].filter((match) => /overflow-y:\s*auto/.test(match[1]))
  assert.equal(workspaceScrollRules.length, 1)
})

test('FilmCreate generic AI config entry resets a prior service-specific filter', async () => {
  assert.doesNotMatch(filmCreateSource, /@click="showAiConfigDialog = true"/)
  assert.match(filmCreateSource, /@open-ai-config="openAiConfig"/)
  assert.match(videoSettingsSource, /<button type="button" class="ai-config-text-button" @click="emit\('open-ai-config'\)">AI 配置<\/button>/)

  const scope = effectScope()
  try {
    const ctx = scope.run(() => createAiConfigWorkspace({ initialServiceType: 'video' }))
    ctx.api.openAiConfig()
    assert.equal(ctx.aiConfigInitialServiceType.value, '')
    assert.equal(ctx.showAiConfigDialog.value, true)
    assert.equal(ctx.aiConfigOpenedFromPipelineAction.value, false)

    ctx.api.openAiConfig('tts')
    assert.equal(ctx.aiConfigInitialServiceType.value, 'tts')
    ctx.api.openAiConfig('not-a-service')
    assert.equal(ctx.aiConfigInitialServiceType.value, '')
  } finally {
    scope.stop()
  }
})

test('FilmCreate AI config returns to production and refreshes changed readiness through the close watcher', async () => {
  assert.match(filmCreateSource, /<FilmCreateAiConfigDialog/)
  assert.match(aiConfigDialogSource, /:show-close="true"/)
  assert.match(aiConfigDialogSource, /<template #header="\{ titleId, titleClass \}">[\s\S]*<ArrowLeft \/>[\s\S]*返回制作[\s\S]*<\/template>/)
  assert.match(aiConfigDialogSource, /<strong :id="titleId" :class="\[titleClass, 'ai-config-dialog-title'\]">AI 配置<\/strong>/)
  assert.match(filmCreateSource, /@back="requestAiConfigWorkspaceClose"/)
  assert.match(filmCreateSource, /@configuration-changed="onAiConfigurationChanged"/)
  assert.match(filmCreateSource, /const aiConfigChanged = ref\(false\)/)

  const videoGate = deferred()
  const productionGate = deferred()
  const scope = effectScope()
  try {
    const ctx = scope.run(() => createAiConfigWorkspace({ videoGate, productionGate }))
    ctx.api.openAiConfigFromPipeline('video', { source: 'compact-action' })
    await flushUi()
    assert.equal(ctx.aiConfigChanged.value, false)
    assert.deepEqual(ctx.events, [])

    ctx.api.onAiConfigurationChanged()
    assert.equal(ctx.aiConfigChanged.value, true)
    await ctx.api.requestAiConfigWorkspaceClose()
    await flushUi()

    const messageIndex = ctx.events.indexOf('message:配置已更新，正在重新检查')
    const invalidateIndex = ctx.events.indexOf('invalidate-cache')
    const videoStart = ctx.events.indexOf('video-start')
    const productionStart = ctx.events.indexOf('production-start')
    assert.ok(messageIndex >= 0 && messageIndex < videoStart)
    assert.ok(messageIndex < productionStart)
    assert.ok(invalidateIndex >= 0 && invalidateIndex < videoStart)
    assert.equal(ctx.events.indexOf('focus'), -1)
    assert.equal(ctx.showAiConfigDialog.value, false)
    assert.equal(ctx.aiConfigChanged.value, false)
    assert.equal(ctx.aiConfigOpenedFromPipelineAction.value, false)

    videoGate.resolve()
    productionGate.resolve()
    await waitFor(() => ctx.events.includes('focus'), '关闭流水线入口后应在刷新完成再恢复焦点')
    assert.ok(ctx.events.indexOf('video-end') < ctx.events.indexOf('focus'))
    assert.ok(ctx.events.indexOf('production-end') < ctx.events.indexOf('focus'))

    ctx.api.openAiConfig('image')
    await flushUi()
    await ctx.api.requestAiConfigWorkspaceClose()
    await waitFor(
      () => ctx.events.filter((item) => item === 'video-end').length === 2,
      '未改配置关闭时仍应刷新能力',
    )
    assert.equal(ctx.events.filter((item) => item.startsWith('message:')).length, 1)
    assert.equal(ctx.events.filter((item) => item === 'focus').length, 1)
  } finally {
    videoGate.resolve()
    productionGate.resolve()
    scope.stop()
  }
})

test('pipeline-owned AI recovery restores focus to a stable exposed summary', async () => {
  assert.match(
    pipelinePanelSource,
    /<div\s+ref="summaryRef"[\s\S]*data-testid="film-pipeline-summary"[\s\S]*tabindex="-1"/,
  )
  assert.match(pipelinePanelSource, /import \{ computed, ref \} from 'vue'/)
  assert.match(pipelinePanelSource, /const summaryRef = ref\(null\)/)
  assert.match(pipelinePanelSource, /function focusSummary\(\) \{\s*summaryRef\.value\?\.focus\(\{ preventScroll: true \}\)\s*\}/)
  assert.match(pipelinePanelSource, /defineExpose\(\{\s*focusSummary,?\s*\}\)/)
  assert.match(
    pipelinePanelSource,
    /\.pipeline-compact-copy:focus-visible\s*\{[\s\S]*outline:\s*2px solid var\(--el-color-primary\)[\s\S]*outline-offset:\s*2px/,
  )
  assert.match(pipelinePanelSource, /emit\(action\.event, action\.payload, \{ source: 'compact-action' \}\)/)
  assert.match(filmCreateSource, /<FilmCreatePipelinePanel\s+ref="pipelinePanelRef"/)
  assert.match(filmCreateSource, /@open-ai-config="openAiConfigFromPipeline"/)
  assert.match(filmCreateSource, /const pipelinePanelRef = ref\(null\)/)
  assert.match(filmCreateSource, /const aiConfigOpenedFromPipelineAction = ref\(false\)/)

  const scope = effectScope()
  try {
    const ctx = scope.run(() => createAiConfigWorkspace())
    ctx.api.openAiConfigFromPipeline('video', { source: 'compact-action' })
    assert.equal(ctx.aiConfigOpenedFromPipelineAction.value, true)
    ctx.api.openAiConfigFromPipeline('tts', { source: 'toolbar' })
    assert.equal(ctx.aiConfigOpenedFromPipelineAction.value, false)
    ctx.api.openAiConfig('image')
    assert.equal(ctx.aiConfigOpenedFromPipelineAction.value, false)
  } finally {
    scope.stop()
  }
})

test('AI coverage test actions are accessible secondary buttons with pending state', () => {
  const coverageAction = aiConfigSource.match(
    /<el-button\s+v-for="action in coverageActions\(item\)"[\s\S]*?<\/el-button>/,
  )?.[0]
  assert.ok(coverageAction, 'missing service coverage action button')
  assert.match(coverageAction, /:link="action\.action !== 'test'"/)
  assert.match(coverageAction, /:plain="action\.action === 'test'"/)
  assert.match(coverageAction, /:aria-label="action\.label"/)
  assert.match(coverageAction, /:loading="isCoverageActionTesting\(item, action\)"/)
  assert.match(coverageAction, /:disabled="isCoverageActionDisabled\(item, action\)"/)
  assert.match(coverageAction, /:aria-busy="isCoverageActionTesting\(item, action\)"/)
  assert.match(aiConfigSource, /const testingConfigId = ref\(null\)/)
  assert.match(aiConfigSource, /function isCoverageActionTesting\(item, action\)/)
  assert.match(aiConfigSource, /isCoverageActionTesting\(item, action\) \|\| testingConfigId\.value !== null/)
  assert.match(aiConfigSource, /if \(testingConfigId\.value !== null && lastTestedConfig/)
  assert.match(aiConfigSource, /testingConfigId\.value = row\.id/)
  assert.match(aiConfigSource, /if \(testingConfigId\.value === row\.id\) testingConfigId\.value = null/)

  const { api, testingConfigId, configWriteLocked } = createCoverage()
  const textItem = { targetConfig: { id: TEXT_CONFIG_ID } }
  const imageItem = { targetConfig: { id: IMAGE_CONFIG_ID } }
  const testAction = { action: 'test' }
  const editAction = { action: 'edit' }

  testingConfigId.value = TEXT_CONFIG_ID
  assert.equal(api.isCoverageActionTesting(textItem, testAction), true)
  assert.equal(api.isCoverageActionTesting({ targetConfig: { id: String(TEXT_CONFIG_ID) } }, testAction), true)
  assert.equal(api.isCoverageActionTesting(imageItem, testAction), false)
  assert.equal(api.isCoverageActionTesting(textItem, editAction), false)
  assert.equal(api.isCoverageActionDisabled(textItem, testAction), true)
  assert.equal(api.isCoverageActionDisabled(imageItem, testAction), true)
  assert.equal(api.isCoverageActionDisabled(textItem, editAction), false)
  configWriteLocked.value = true
  assert.equal(api.isCoverageActionDisabled(textItem, editAction), true)
})
