import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { effectScope, ref } from 'vue'
import { createFilmCreateWorkspaceBindingSources } from '../src/components/filmCreate/filmCreateWorkspaceBindings.js'
import { createFilmCreateCloseoutBindings } from '../src/components/filmCreate/filmCreateCloseoutBindings.js'
import {
  FILM_CREATE_OUTPUT_SECTION_MODEL_KEYS,
  FILM_CREATE_PIPELINE_PANEL_MODEL_KEYS,
  createFilmCreateSurfaceBindingSources,
  createFilmCreateSurfaceBindings,
} from '../src/components/filmCreate/filmCreateSurfaceBindings.js'
import {
  FILM_CREATE_QUICK_NAV_MODEL_KEYS,
  FILM_CREATE_WORKSPACE_LAYER_MODEL_KEYS,
  createFilmCreateShellBindingSources,
  createFilmCreateShellBindings,
} from '../src/components/filmCreate/filmCreateShellBindings.js'

import { requestCoreJson } from '../src/utils/coreJsonRequest.js'
import {
  buildEpisodeVideoFilename,
  fetchVerifiedVideoBlob,
  triggerBlobDownload,
} from '../src/utils/filmCreateDelivery.js'
import { runConcurrently } from '../src/utils/filmCreateConcurrency.js'
import {
  buildScriptStoryboardEstimate,
  clipSecondsForStoryboardEstimate,
  estimateVideoDurationSecFromCharLen,
} from '../src/utils/filmCreateEstimates.js'

test('core JSON request unwraps data, times out, and rejects HTTP failures', async () => {
  const calls = []
  const drama = await requestCoreJson('/dramas/7', {
    fetchImpl: async (url, options) => {
      calls.push({ url, options })
      return new Response(JSON.stringify({ success: true, data: { id: 7, title: '项目' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    },
  })
  assert.deepEqual(drama, { id: 7, title: '项目' })
  assert.equal(calls[0].url, '/api/v1/dramas/7')
  assert.equal(calls[0].options.method, 'GET')
  assert.ok(calls[0].options.signal)

  await assert.rejects(
    requestCoreJson('/dramas/7', {
      timeoutMs: 20,
      fetchImpl: async (_url, options) => new Promise((_, reject) => {
        options.signal.addEventListener('abort', () => reject(options.signal.reason || new Error('aborted')))
      }),
    }),
    { message: 'PROJECT_LOAD_FAILED', status: 0 },
  )

  await assert.rejects(
    requestCoreJson('/dramas/7', {
      fetchImpl: async () => new Response('{"success":false}', {
        status: 500,
        headers: { 'content-type': 'application/json' },
      }),
    }),
    { status: 500 },
  )
})

test('verified video fetch rejects HTTP errors, empty bodies, JSON errors and timeout', async () => {
  const blob = await fetchVerifiedVideoBlob('/static/final.mp4', async (url, options) => {
    assert.equal(url, '/static/final.mp4')
    assert.equal(options.method, 'GET')
    assert.equal(options.credentials, 'same-origin')
    assert.match(options.headers.Accept, /video\/*/)
    assert.ok(options.signal)
    return new Response(new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]), {
      status: 200,
      headers: { 'content-type': 'video/mp4' },
    })
  })
  assert.equal(blob.size, 8)
  assert.equal(blob.type, 'video/mp4')

  await assert.rejects(
    fetchVerifiedVideoBlob('/static/missing.mp4', async () => new Response('', { status: 502 })),
    /HTTP 502/,
  )
  await assert.rejects(
    fetchVerifiedVideoBlob('/static/empty.mp4', async () => new Response(new Uint8Array(), {
      status: 200,
      headers: { 'content-type': 'video/mp4' },
    })),
    /成片文件为空/,
  )
  await assert.rejects(
    fetchVerifiedVideoBlob('/static/error.mp4', async () => new Response('{"error":"failed"}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })),
    /服务器返回了错误信息/,
  )
  await assert.rejects(
    fetchVerifiedVideoBlob('/static/slow.mp4', async (_url, options) => new Promise((_, reject) => {
      options.signal.addEventListener('abort', () => reject(options.signal.reason || new Error('aborted')))
    }), { timeoutMs: 20 }),
    /成片下载超时/,
  )
})

test('video filename is filesystem-safe and Blob download always releases its object URL', () => {
  const blob = new Blob(['video'], { type: 'video/webm' })
  const filename = buildEpisodeVideoFilename('测试:<项目>/第一部*?', '2/3', blob)
  assert.doesNotMatch(filename, /[<>:"/\\|?*\u0000-\u001f]/)
  assert.match(filename, /^测试__项目__第一部__-第2_3集-成片\.webm$/)

  const events = []
  const anchor = {
    style: {},
    click() { events.push('click') },
    remove() { events.push('remove') },
  }
  const environment = {
    document: {
      createElement(tag) {
        assert.equal(tag, 'a')
        return anchor
      },
      body: { appendChild(node) { assert.equal(node, anchor); events.push('append') } },
    },
    URL: {
      createObjectURL(value) { assert.equal(value, blob); events.push('create'); return 'blob:video' },
      revokeObjectURL(value) { assert.equal(value, 'blob:video'); events.push('revoke') },
    },
  }

  triggerBlobDownload(blob, filename, environment)
  assert.equal(anchor.href, 'blob:video')
  assert.equal(anchor.download, filename)
  assert.equal(anchor.rel, 'noopener')
  assert.deepEqual(events, ['create', 'append', 'click', 'remove', 'revoke'])
})

test('script estimate and concurrent runner keep pipeline semantics', async () => {
  assert.equal(clipSecondsForStoryboardEstimate(8), 8)
  assert.equal(estimateVideoDurationSecFromCharLen(600), 70)
  const estimate = buildScriptStoryboardEstimate('字'.repeat(600), 5)
  assert.equal(estimate.sec, 70)
  assert.equal(estimate.locked, 14)

  const seen = []
  const active = new Set()
  await runConcurrently(['a', 'b', 'c'], 2, async (item) => {
    seen.push(item)
    assert.ok(active.has(item))
  }, { getLabel: (item) => item, activeTasks: active })
  assert.deepEqual(seen.sort(), ['a', 'b', 'c'])
  assert.equal(active.size, 0)
})

test('制作页把工作台绑定源交给独立装配函数', () => {
  const filmCreateSource = readFileSync(new URL('../src/views/FilmCreate.vue', import.meta.url), 'utf8')
  const workspaceBindingsSource = readFileSync(new URL('../src/components/filmCreate/filmCreateWorkspaceBindings.js', import.meta.url), 'utf8')
  const closeoutBindingsSource = readFileSync(new URL('../src/components/filmCreate/filmCreateCloseoutBindings.js', import.meta.url), 'utf8')
  assert.match(filmCreateSource, /createFilmCreateCloseoutBindings\(/)
  assert.doesNotMatch(filmCreateSource, /createFilmCreateWorkspaceBindingSources\(/)
  assert.doesNotMatch(filmCreateSource, /useFilmCreateWorkspaceBootstrap\(/)
  assert.match(filmCreateSource, /\.\.\.storyboardActions,/)
  assert.match(filmCreateSource, /\.\.\.resourcePanelState,/)
  assert.match(filmCreateSource, /onInsertStoryboardAfter/)
  assert.match(closeoutBindingsSource, /createFilmCreateWorkspaceBindingSources\(ctx\)/)
  assert.match(closeoutBindingsSource, /useFilmCreateWorkspaceBootstrap\(\{/)
  assert.match(filmCreateSource, /v-bind="resourcePanelBindings"/)
  assert.match(filmCreateSource, /v-bind="storyboardPanelBindings"/)
  assert.doesNotMatch(filmCreateSource, /resourcePanel: \{/)
  assert.doesNotMatch(filmCreateSource, /storyboardPanel: \{/)
  assert.match(workspaceBindingsSource, /export function createFilmCreateWorkspaceBindingSources/)
  assert.match(workspaceBindingsSource, /resourcePanel: \{[\s\S]*propItems: props[\s\S]*onGenerateCharacters/)
  assert.match(workspaceBindingsSource, /resourcePanel: \{[\s\S]*onAddEpisode, onSelectEpisode, onGenerateCharacters/)
  assert.match(workspaceBindingsSource, /storyboardPanel: \{[\s\S]*onAddEpisode, onAddSingleStoryboard/)
  assert.match(workspaceBindingsSource, /episodes: computed\(\(\) => store\.drama\?\.episodes \|\| \[\]\)/)
  assert.doesNotMatch(workspaceBindingsSource, /const currentEpisodeId = ref/)
})

test('工作台绑定源只映射已有状态，不改 episodeId', () => {
  const currentEpisodeId = ref(22)
  const props = ref([{ id: 3 }])
  const store = { drama: { episodes: [{ id: 11 }] } }
  const scope = effectScope()
  try {
    const bags = scope.run(() => createFilmCreateWorkspaceBindingSources({
      store,
      props,
      currentEpisodeId,
    }))
    assert.equal(bags.resourcePanel.propItems, props)
    assert.equal(bags.scriptWorkbench.episodes.value[0].id, 11)
    assert.notEqual(bags.scriptWorkbench.episodes.value[0].id, currentEpisodeId.value)
    assert.equal(bags.resourceDialogs.currentEpisodeId.value, 22)
    assert.equal(currentEpisodeId.value, 22)
    assert.equal(bags.resourceDialogModelKeys.includes('showAddProp'), true)
    assert.equal(bags.storyboardDialogModelKeys.includes('showSbPromptDialog'), true)
  } finally {
    scope.stop()
  }
})

test('制作页页头/流水线/侧栏调用名仍在 vue，BindingSources 已收进 bindings', () => {
  const filmCreateSource = readFileSync(new URL('../src/views/FilmCreate.vue', import.meta.url), 'utf8')
  const surfaceBindingsSource = readFileSync(new URL('../src/components/filmCreate/filmCreateSurfaceBindings.js', import.meta.url), 'utf8')
  const shellBindingsSource = readFileSync(new URL('../src/components/filmCreate/filmCreateShellBindings.js', import.meta.url), 'utf8')
  const closeoutBindingsSource = readFileSync(new URL('../src/components/filmCreate/filmCreateCloseoutBindings.js', import.meta.url), 'utf8')
  assert.match(filmCreateSource, /createFilmCreateSurfaceBindings\(/)
  assert.match(filmCreateSource, /createFilmCreateShellBindings\(/)
  assert.match(filmCreateSource, /createFilmCreateCloseoutBindings\(/)
  assert.match(filmCreateSource, /onMounted\(mountWorkspace\)/)
  assert.match(filmCreateSource, /onBeforeUnmount\(unmountWorkspace\)/)
  assert.match(filmCreateSource, /createFilmCreateCloseoutBindings\(\{[\s\S]*onGenerateStory/)
  assert.match(filmCreateSource, /onInsertStoryboardAfter/)
  assert.doesNotMatch(filmCreateSource, /createFilmCreateSurfaceBindingSources\(/)
  assert.doesNotMatch(filmCreateSource, /createFilmCreateShellBindingSources\(/)
  assert.doesNotMatch(filmCreateSource, /useFilmCreateWorkspaceBootstrap\(/)
  assert.doesNotMatch(filmCreateSource, /useFilmCreateAiConfigDialogState\(\)[\s\S]{0,80}loadList/)
  assert.doesNotMatch(filmCreateSource, /\bloadList\b|\bopenTest\b/)
  assert.match(filmCreateSource, /showEditCharacter/)
  assert.match(filmCreateSource, /hasSbDraftImagePlaceholder/)
  assert.match(filmCreateSource, /returnToPropPanel, returnToScenePanel/)
  assert.match(filmCreateSource, /\.\.\.scriptNovelState,/)
  assert.match(filmCreateSource, /\.\.\.scriptActions,/)
  assert.doesNotMatch(filmCreateSource, /charLibraryList/)
  assert.match(surfaceBindingsSource, /createFilmCreateSurfaceBindingSources\(ctx\)/)
  assert.match(shellBindingsSource, /createFilmCreateShellBindingSources\(ctx\)/)
  assert.match(closeoutBindingsSource, /useFilmCreateWorkspaceBootstrap\(\{/)
})

test('制作页把页头、流水线和交付区显式 props 交给独立绑定源', () => {
  const filmCreateSource = readFileSync(new URL('../src/views/FilmCreate.vue', import.meta.url), 'utf8')
  const surfaceBindingsSource = readFileSync(new URL('../src/components/filmCreate/filmCreateSurfaceBindings.js', import.meta.url), 'utf8')
  assert.doesNotMatch(filmCreateSource, /createFilmCreateSurfaceBindingSources\(/)
  assert.match(filmCreateSource, /createFilmCreateSurfaceBindings\(/)
  assert.match(filmCreateSource, /\.\.\.storeDisplay,/)
  assert.match(filmCreateSource, /\.\.\.deliveryActions,/)
  assert.match(filmCreateSource, /v-bind="headerBindings"/)
  assert.match(filmCreateSource, /v-bind="pipelinePanelBindings"/)
  assert.match(filmCreateSource, /v-bind="outputSectionBindings"/)
  assert.match(filmCreateSource, /ref="filmCreateHeaderRef"/)
  assert.match(filmCreateSource, /<FilmCreatePipelinePanel\s+ref="pipelinePanelRef"/)
  assert.doesNotMatch(filmCreateSource, /:project-page-title="projectPageTitle"/)
  assert.doesNotMatch(filmCreateSource, /v-model:aspect-ratio="projectAspectRatio"/)
  assert.doesNotMatch(filmCreateSource, /v-model:watermark-text="videoWatermarkText"/)
  assert.doesNotMatch(filmCreateSource, /:compose-action-disabled-reason="composeActionDisabledReason"/)
  assert.match(surfaceBindingsSource, /export function createFilmCreateSurfaceBindingSources/)
  assert.match(surfaceBindingsSource, /header: \{[\s\S]*selectedEpisodeId[\s\S]*onGoList: goList/)
  assert.match(surfaceBindingsSource, /pipelinePanel: \{[\s\S]*aspectRatio: projectAspectRatio[\s\S]*onOpenAiConfig: openAiConfigFromPipeline/)
  assert.match(surfaceBindingsSource, /outputSection: \{[\s\S]*watermarkText: videoWatermarkText[\s\S]*currentEpisodeId/)
  assert.match(surfaceBindingsSource, /outputSection: \{[\s\S]*storyboardCount: computed\(\(\) => \(unref\(storyboards\) \|\| \[\]\)\.length\)/)
  assert.match(surfaceBindingsSource, /productionDisabledReason: productionPipelineActionDisabledReason/)
  assert.match(surfaceBindingsSource, /draftDisabledReason: pipelineActionDisabledReason/)
  assert.doesNotMatch(surfaceBindingsSource, /const currentEpisodeId = ref/)
  assert.doesNotMatch(surfaceBindingsSource, /propItems/)
  assert.doesNotMatch(surfaceBindingsSource, /allowNavigationAfterDraftFlush/)
})

test('页头/流水线/交付区绑定源只映射已有状态，不改 episodeId 和 propItems', () => {
  const currentEpisodeId = ref(22)
  const selectedEpisodeId = ref(33)
  const dramaId = ref(11)
  const props = ref([{ id: 3 }])
  const storyboardCount = ref(8)
  const storyboards = ref([{ id: 1 }, { id: 2 }])
  const projectAspectRatio = ref('16:9')
  const videoWatermarkText = ref('水印')
  const pipelinePaused = ref(false)
  const pipelineAbortRequested = ref(true)
  const pipelineRunning = ref(true)
  const pipelineStopping = ref(false)
  const productionPipelineActionDisabledReason = ref('当前集还没有剧本，请先编写或导入剧本')
  const pipelineActionDisabledReason = productionPipelineActionDisabledReason
  const store = { drama: { episodes: [{ id: 11 }] } }
  const scope = effectScope()
  try {
    const bags = scope.run(() => createFilmCreateSurfaceBindingSources({
      store,
      props,
      currentEpisodeId,
      selectedEpisodeId,
      dramaId,
      storyboardCount,
      storyboards,
      projectAspectRatio,
      videoWatermarkText,
      pipelinePaused,
      pipelineAbortRequested,
      pipelineRunning,
      pipelineStopping,
      productionPipelineActionDisabledReason,
      pipelineActionDisabledReason,
    }))
    assert.equal(bags.header.selectedEpisodeId, selectedEpisodeId)
    assert.equal(bags.outputSection.currentEpisodeId, currentEpisodeId)
    assert.equal(bags.header.dramaId, dramaId)
    assert.equal(bags.outputSection.dramaId, dramaId)
    assert.equal('currentEpisodeId' in bags.header, false)
    assert.equal('selectedEpisodeId' in bags.outputSection, false)
    assert.equal('currentEpisodeId' in bags.pipelinePanel, false)
    assert.equal('propItems' in bags.header, false)
    assert.equal('propItems' in bags.pipelinePanel, false)
    assert.equal('propItems' in bags.outputSection, false)
    assert.equal(bags.outputSection.storyboardCount.value, 2)
    assert.notEqual(bags.outputSection.storyboardCount.value, storyboardCount.value)
    assert.equal(bags.header.episodes.value[0].id, 11)
    assert.notEqual(bags.header.episodes.value[0].id, selectedEpisodeId.value)
    assert.notEqual(bags.header.episodes.value[0].id, currentEpisodeId.value)
    assert.equal(bags.pipelinePanel.productionDisabledReason, productionPipelineActionDisabledReason)
    assert.equal(bags.pipelinePanel.draftDisabledReason, pipelineActionDisabledReason)
    assert.equal(bags.pipelinePanel.stopRequired.value, true)
    assert.equal(bags.pipelinePanel.aspectRatio, projectAspectRatio)
    assert.equal(currentEpisodeId.value, 22)
    assert.equal(selectedEpisodeId.value, 33)
    assert.equal(props.value[0].id, 3)

    const bindings = createFilmCreateSurfaceBindings(bags)
    const fromFlat = createFilmCreateSurfaceBindings({
      store,
      props,
      currentEpisodeId,
      selectedEpisodeId,
      dramaId,
      storyboardCount,
      storyboards,
      projectAspectRatio,
      videoWatermarkText,
      pipelinePaused,
      pipelineAbortRequested,
      pipelineRunning,
      pipelineStopping,
      productionPipelineActionDisabledReason,
      pipelineActionDisabledReason,
    })
    assert.equal(fromFlat.headerBindings.value.selectedEpisodeId, 33)
    assert.equal(fromFlat.outputSectionBindings.value.currentEpisodeId, 22)
    assert.notEqual(fromFlat.headerBindings.value.dramaId, fromFlat.outputSectionBindings.value.currentEpisodeId)
    assert.equal('propItems' in fromFlat.headerBindings.value, false)
    assert.equal(FILM_CREATE_PIPELINE_PANEL_MODEL_KEYS.includes('currentEpisodeId'), false)
    assert.equal(FILM_CREATE_PIPELINE_PANEL_MODEL_KEYS.includes('selectedEpisodeId'), false)
    assert.equal(FILM_CREATE_OUTPUT_SECTION_MODEL_KEYS.includes('currentEpisodeId'), false)
    assert.equal(FILM_CREATE_OUTPUT_SECTION_MODEL_KEYS.includes('dramaId'), false)
    assert.equal(Object.prototype.hasOwnProperty.call(bindings.headerBindings.value, 'onUpdate:selectedEpisodeId'), false)
    assert.equal(Object.prototype.hasOwnProperty.call(bindings.outputSectionBindings.value, 'onUpdate:currentEpisodeId'), false)
    assert.equal(Object.prototype.hasOwnProperty.call(bindings.pipelinePanelBindings.value, 'onUpdate:onAddEpisode'), false)
    assert.equal(bindings.outputSectionBindings.value.currentEpisodeId, 22)
    assert.equal(bindings.headerBindings.value.selectedEpisodeId, 33)
    assert.notEqual(bindings.headerBindings.value.dramaId, bindings.outputSectionBindings.value.currentEpisodeId)
    bindings.pipelinePanelBindings.value['onUpdate:aspectRatio']('9:16')
    bindings.outputSectionBindings.value['onUpdate:watermarkText']('新水印')
    bindings.pipelinePanelBindings.value.onPause()
    assert.equal(projectAspectRatio.value, '9:16')
    assert.equal(videoWatermarkText.value, '新水印')
    assert.equal(pipelinePaused.value, true)
    assert.equal(currentEpisodeId.value, 22)
    assert.equal(selectedEpisodeId.value, 33)
    assert.equal(dramaId.value, 11)
    assert.equal(props.value[0].id, 3)
  } finally {
    scope.stop()
  }
})

test('制作页把侧栏、加载面、依赖警告和弹窗层显式 props 交给独立绑定源', () => {
  const filmCreateSource = readFileSync(new URL('../src/views/FilmCreate.vue', import.meta.url), 'utf8')
  const shellBindingsSource = readFileSync(new URL('../src/components/filmCreate/filmCreateShellBindings.js', import.meta.url), 'utf8')
  assert.doesNotMatch(filmCreateSource, /createFilmCreateShellBindingSources\(/)
  assert.match(filmCreateSource, /createFilmCreateShellBindings\(/)
  assert.match(filmCreateSource, /\.\.\.navigation,/)
  assert.match(filmCreateSource, /\.\.\.projectLoadSurface,/)
  assert.match(filmCreateSource, /v-bind="quickNavBindings"/)
  assert.match(filmCreateSource, /v-bind="projectLoadStateBindings"/)
  assert.match(filmCreateSource, /v-bind="projectDependencyWarningBindings"/)
  assert.match(filmCreateSource, /v-bind="workspaceDialogsLayerBindings"/)
  assert.match(filmCreateSource, /ref="projectLoadFailureRef"/)
  assert.match(filmCreateSource, /ref="aiConfigContentRef"/)
  assert.doesNotMatch(filmCreateSource, /:nav-collapsed="navCollapsed"/)
  assert.doesNotMatch(filmCreateSource, /v-model:storyboard-menu-expanded="storyboardMenuExpanded"/)
  assert.doesNotMatch(filmCreateSource, /:media-error="storyboardMediaLoadError"/)
  assert.doesNotMatch(filmCreateSource, /v-model:max-chapters="novelMaxChapters"/)
  assert.doesNotMatch(filmCreateSource, /v-model="showAiConfigDialog"/)
  assert.match(shellBindingsSource, /export function createFilmCreateShellBindingSources/)
  assert.match(shellBindingsSource, /quickNav: \{[\s\S]*storyboardMenuExpanded[\s\S]*onToggleNav: toggleNav/)
  assert.match(shellBindingsSource, /projectLoadState: \{[\s\S]*onRetry: retryFilmProjectLoad[\s\S]*onGoList: goList/)
  assert.match(shellBindingsSource, /projectDependencyWarning: \{[\s\S]*mediaError: storyboardMediaLoadError[\s\S]*onRetry: retryProjectDependencies/)
  assert.match(shellBindingsSource, /workspaceDialogsLayer: \{[\s\S]*maxChapters: novelMaxChapters[\s\S]*modelValue: showAiConfigDialog/)
  assert.match(shellBindingsSource, /previewImageUrl: computed\(\(\) => unref\(previewImageUrl\) \|\| ''\)/)
  assert.doesNotMatch(shellBindingsSource, /const currentEpisodeId = ref/)
  assert.doesNotMatch(shellBindingsSource, /propItems/)
  assert.doesNotMatch(shellBindingsSource, /allowNavigationAfterDraftFlush/)
})

test('侧栏/加载面/警告/弹窗层绑定源只映射已有状态，不改 episodeId 和 propItems', () => {
  const currentEpisodeId = ref(22)
  const selectedEpisodeId = ref(33)
  const dramaId = ref(11)
  const props = ref([{ id: 3 }])
  const storyboardMenuExpanded = ref(false)
  const showAiConfigDialog = ref(false)
  const showNovelImport = ref(false)
  const novelMaxChapters = ref(10)
  const showGlobalMediaPicker = ref(false)
  const previewImageUrl = ref('')
  const pipelineStopping = ref(true)
  const productionPipelineActionDisabledReason = ref('当前集还没有剧本，请先编写或导入剧本')
  const store = { drama: { episodes: [{ id: 11 }] } }
  const scope = effectScope()
  try {
    const bags = scope.run(() => createFilmCreateShellBindingSources({
      store,
      props,
      currentEpisodeId,
      selectedEpisodeId,
      dramaId,
      storyboardMenuExpanded,
      showAiConfigDialog,
      showNovelImport,
      novelMaxChapters,
      showGlobalMediaPicker,
      previewImageUrl,
      pipelineStopping,
      productionPipelineActionDisabledReason,
      toggleNav() {},
      scrollToAnchor() {},
      cancelActiveTask() {},
      retryFilmProjectLoad() {},
      goList() {},
      retryProjectDependencies() {},
    }))
    assert.equal(bags.quickNav.storyboardMenuExpanded, storyboardMenuExpanded)
    assert.equal(bags.workspaceDialogsLayer.modelValue, showAiConfigDialog)
    assert.equal(bags.workspaceDialogsLayer.visible, showNovelImport)
    assert.equal(bags.workspaceDialogsLayer.maxChapters, novelMaxChapters)
    assert.equal(bags.quickNav.pipelineStopping, pipelineStopping)
    assert.equal('currentEpisodeId' in bags.quickNav, false)
    assert.equal('selectedEpisodeId' in bags.quickNav, false)
    assert.equal('dramaId' in bags.quickNav, false)
    assert.equal('propItems' in bags.quickNav, false)
    assert.equal('currentEpisodeId' in bags.projectLoadState, false)
    assert.equal('currentEpisodeId' in bags.projectDependencyWarning, false)
    assert.equal('currentEpisodeId' in bags.workspaceDialogsLayer, false)
    assert.equal('propItems' in bags.workspaceDialogsLayer, false)
    assert.equal('productionDisabledReason' in bags.quickNav, false)
    assert.equal(bags.workspaceDialogsLayer.previewImageUrl.value, '')
    assert.equal(currentEpisodeId.value, 22)
    assert.equal(selectedEpisodeId.value, 33)
    assert.equal(props.value[0].id, 3)

    const bindings = createFilmCreateShellBindings(bags)
    const fromFlat = createFilmCreateShellBindings({
      store,
      props,
      currentEpisodeId,
      selectedEpisodeId,
      dramaId,
      storyboardMenuExpanded,
      showAiConfigDialog,
      novelMaxChapters,
      pipelineStopping,
      productionPipelineActionDisabledReason,
    })
    assert.equal(fromFlat.quickNavBindings.value.pipelineStopping, true)
    assert.equal(Object.prototype.hasOwnProperty.call(fromFlat.quickNavBindings.value, 'onUpdate:currentEpisodeId'), false)
    assert.equal(FILM_CREATE_QUICK_NAV_MODEL_KEYS.includes('currentEpisodeId'), false)
    assert.equal(FILM_CREATE_QUICK_NAV_MODEL_KEYS.includes('dramaId'), false)
    assert.equal(FILM_CREATE_WORKSPACE_LAYER_MODEL_KEYS.includes('currentEpisodeId'), false)
    assert.equal(FILM_CREATE_WORKSPACE_LAYER_MODEL_KEYS.includes('dramaId'), false)
    assert.equal(Object.prototype.hasOwnProperty.call(bindings.quickNavBindings.value, 'onUpdate:currentEpisodeId'), false)
    assert.equal(Object.prototype.hasOwnProperty.call(bindings.projectLoadStateBindings.value, 'onUpdate:state'), false)
    assert.equal(Object.prototype.hasOwnProperty.call(bindings.workspaceDialogsLayerBindings.value, 'onUpdate:currentEpisodeId'), false)
    assert.equal(bindings.quickNavBindings.value.pipelineStopping, true)
    bindings.quickNavBindings.value['onUpdate:storyboardMenuExpanded'](true)
    bindings.workspaceDialogsLayerBindings.value['onUpdate:modelValue'](true)
    bindings.workspaceDialogsLayerBindings.value['onUpdate:maxChapters'](8)
    assert.equal(storyboardMenuExpanded.value, true)
    assert.equal(showAiConfigDialog.value, true)
    assert.equal(novelMaxChapters.value, 8)
    assert.equal(currentEpisodeId.value, 22)
    assert.equal(selectedEpisodeId.value, 33)
    assert.equal(dramaId.value, 11)
    assert.equal(props.value[0].id, 3)
    assert.equal(productionPipelineActionDisabledReason.value, '当前集还没有剧本，请先编写或导入剧本')
  } finally {
    scope.stop()
  }
})

test('制作页把工作台闭合接线交给独立装配函数', () => {
  const filmCreateSource = readFileSync(new URL('../src/views/FilmCreate.vue', import.meta.url), 'utf8')
  const closeoutBindingsSource = readFileSync(new URL('../src/components/filmCreate/filmCreateCloseoutBindings.js', import.meta.url), 'utf8')
  const workspaceBindingsSource = readFileSync(new URL('../src/components/filmCreate/filmCreateWorkspaceBindings.js', import.meta.url), 'utf8')
  assert.match(filmCreateSource, /createFilmCreateCloseoutBindings\(/)
  assert.match(filmCreateSource, /v-bind="scriptWorkbenchBindings"/)
  assert.match(filmCreateSource, /v-bind="resourcePanelBindings"/)
  assert.match(filmCreateSource, /v-bind="storyboardPanelBindings"/)
  assert.doesNotMatch(filmCreateSource, /v-model:story-input="storyInput"/)
  assert.doesNotMatch(filmCreateSource, /@generate-story="onGenerateStory"/)
  assert.doesNotMatch(filmCreateSource, /@return-to-creation="returnToScriptCreation"/)
  assert.doesNotMatch(filmCreateSource, /:character-generation-disabled-reason="characterGenerationDisabledReason"/)
  assert.doesNotMatch(filmCreateSource, /:batch-action-disabled-reason="batchActionDisabledReason"/)
  assert.match(filmCreateSource, /useFilmCreateActionDisabledReasons\(/)
  assert.match(filmCreateSource, /onBeforeRouteLeave\(allowNavigationAfterDraftFlush\)/)
  assert.match(filmCreateSource, /createFilmCreateShellBindings\(/)
  assert.doesNotMatch(filmCreateSource, /createFilmCreateShellBindingSources\(/)
  assert.doesNotMatch(closeoutBindingsSource, /allowNavigationAfterDraftFlush/)
  assert.doesNotMatch(closeoutBindingsSource, /useFilmCreateActionDisabledReasons/)
  assert.doesNotMatch(closeoutBindingsSource, /const currentEpisodeId = ref/)
  assert.match(closeoutBindingsSource, /export function createFilmCreateCloseoutBindings/)
  assert.match(closeoutBindingsSource, /createFilmCreateWorkspaceBindingSources\(ctx\)/)
  assert.match(closeoutBindingsSource, /route: ctx\.route/)
  assert.match(closeoutBindingsSource, /handleBeforeUnload: ctx\.handleBeforeUnload/)
  assert.match(workspaceBindingsSource, /scriptWorkbench: \{[\s\S]*storyInput[\s\S]*onGenerateStory[\s\S]*returnToScriptCreation/)
  assert.match(workspaceBindingsSource, /resourcePanel: \{[\s\S]*characterGenerationDisabledReason/)
  assert.match(workspaceBindingsSource, /storyboardPanel: \{[\s\S]*batchActionDisabledReason/)
})

test('工作台闭合接线只映射已有状态，不改 episodeId 和空剧本门闩', () => {
  const currentEpisodeId = ref(22)
  const dramaId = ref(11)
  const props = ref([{ id: 3 }])
  const storyInput = ref('已有梗概')
  const characterGenerationDisabledReason = ref('当前集还没有剧本，请先编写或导入剧本')
  const batchActionDisabledReason = ref('当前集还没有剧本，请先编写或导入剧本')
  const showNovelImport = ref(false)
  const store = { drama: { episodes: [{ id: 11 }] } }
  const calls = []
  function onGenerateStory() { calls.push('generate-story') }
  function returnToScriptCreation() { calls.push('return-to-creation') }
  function saveProjectSettings() {}
  const router = { push() {} }
  const route = { params: { id: '11' } }
  const scope = effectScope()
  try {
    const bindings = scope.run(() => createFilmCreateCloseoutBindings({
      store,
      props,
      currentEpisodeId,
      dramaId,
      storyInput,
      characterGenerationDisabledReason,
      batchActionDisabledReason,
      onGenerateStory,
      returnToScriptCreation,
      saveProjectSettings,
      showNovelImport,
      router,
      route,
      handleBeforeUnload() {},
      applyRouteToStore() {},
      loadPipelineConcurrency() {},
      refreshVideoGenerationCapability() {},
      refreshProductionReadiness() {},
      invalidateProjectLoads() {},
      projectLifecycle: { dispose() {} },
      scriptDraftController: { dispose() {} },
    }))
    assert.equal(bindings.scriptWorkbenchBindings.value.storyInput, '已有梗概')
    assert.equal(typeof bindings.scriptWorkbenchBindings.value['onUpdate:storyInput'], 'function')
    assert.equal(bindings.scriptWorkbenchBindings.value.onGenerateStory, onGenerateStory)
    assert.equal(bindings.scriptWorkbenchBindings.value.onReturnToCreation, returnToScriptCreation)
    assert.equal(bindings.resourcePanelBindings.value.characterGenerationDisabledReason, '当前集还没有剧本，请先编写或导入剧本')
    assert.equal(bindings.storyboardPanelBindings.value.batchActionDisabledReason, '当前集还没有剧本，请先编写或导入剧本')
    assert.equal('currentEpisodeId' in bindings.resourcePanelBindings.value, false)
    assert.equal(Object.prototype.hasOwnProperty.call(bindings.scriptWorkbenchBindings.value, 'onUpdate:currentEpisodeId'), false)
    bindings.scriptWorkbenchBindings.value['onUpdate:storyInput']('新的梗概')
    bindings.scriptWorkbenchBindings.value.onGenerateStory()
    bindings.scriptWorkbenchBindings.value.onReturnToCreation()
    assert.equal(storyInput.value, '新的梗概')
    assert.deepEqual(calls, ['generate-story', 'return-to-creation'])
    assert.equal(currentEpisodeId.value, 22)
    assert.equal(dramaId.value, 11)
    assert.equal(props.value[0].id, 3)
    assert.notEqual(currentEpisodeId.value, dramaId.value)
    assert.equal(characterGenerationDisabledReason.value, '当前集还没有剧本，请先编写或导入剧本')
    assert.equal(batchActionDisabledReason.value, '当前集还没有剧本，请先编写或导入剧本')
  } finally {
    scope.stop()
  }
})

test('制作页把分镜预备、剧本动作、分镜动作和流水线接线交给独立模块', () => {
  const filmCreateSource = readFileSync(new URL('../src/views/FilmCreate.vue', import.meta.url), 'utf8')
  const prepSource = readFileSync(new URL('../src/composables/filmCreate/useFilmCreateStoryboardPrep.js', import.meta.url), 'utf8')
  const scriptActionsSource = readFileSync(new URL('../src/composables/filmCreate/useFilmCreateScriptActions.js', import.meta.url), 'utf8')
  const storyboardActionsSource = readFileSync(new URL('../src/composables/filmCreate/useFilmCreateStoryboardActions.js', import.meta.url), 'utf8')
  const pipelineActionsSource = readFileSync(new URL('../src/composables/filmCreate/useFilmCreatePipelineActions.js', import.meta.url), 'utf8')
  assert.match(filmCreateSource, /createFilmCreateCloseoutBindings\(/)
  assert.match(filmCreateSource, /useFilmCreateActionDisabledReasons\(/)
  assert.match(filmCreateSource, /onBeforeRouteLeave\(allowNavigationAfterDraftFlush\)/)
  assert.match(filmCreateSource, /useFilmCreateStoryboardPrep\(/)
  assert.match(filmCreateSource, /useFilmCreateScriptActions\(/)
  assert.match(filmCreateSource, /useFilmCreateStoryboardActions\(/)
  assert.match(filmCreateSource, /useFilmCreatePipelineActions\(/)
  assert.match(filmCreateSource, /useFilmCreateActionDisabledReasons\(\{[\s\S]*scriptContent/)
  assert.match(filmCreateSource, /useFilmCreatePipelineActions\(\{[\s\S]*composeActionDisabledReason/)
  assert.doesNotMatch(filmCreateSource, /useFilmCreateStoryboardImageGeneration\(/)
  assert.doesNotMatch(filmCreateSource, /useFilmCreateStoryboardCrud\(/)
  assert.doesNotMatch(filmCreateSource, /useFilmCreatePipelineStages\(/)
  assert.doesNotMatch(filmCreateSource, /useFilmCreateScriptWorkspace\(/)
  assert.doesNotMatch(filmCreateSource, /useFilmCreateAiConfigDialogState\(\)[\s\S]{0,80}loadList/)
  assert.match(prepSource, /export function useFilmCreateStoryboardPrep/)
  assert.match(prepSource, /useFilmCreateStoryboardImageGeneration/)
  assert.match(scriptActionsSource, /saveScriptToBackend: persistence.saveScriptToBackend/)
  assert.match(storyboardActionsSource, /polishUniversalSegmentsAfterGeneration: universal.polishUniversalSegmentsAfterGeneration/)
  assert.match(pipelineActionsSource, /getFinalizeMergeOptions: compose.getFinalizeMergeOptions/)
  assert.doesNotMatch(prepSource, /loadList|openTest/)
  assert.doesNotMatch(scriptActionsSource, /loadList|openTest/)
  assert.doesNotMatch(storyboardActionsSource, /loadList|openTest/)
  assert.doesNotMatch(pipelineActionsSource, /loadList|openTest/)
})

