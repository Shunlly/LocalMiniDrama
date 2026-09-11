import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { effectScope, ref } from 'vue'
import { createFilmCreateWorkspaceBindingSources } from '../src/components/filmCreate/filmCreateWorkspaceBindings.js'
import {
  FILM_CREATE_OUTPUT_SECTION_MODEL_KEYS,
  FILM_CREATE_PIPELINE_PANEL_MODEL_KEYS,
  createFilmCreateSurfaceBindingSources,
  createFilmCreateSurfaceBindings,
} from '../src/components/filmCreate/filmCreateSurfaceBindings.js'

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
  assert.match(filmCreateSource, /createFilmCreateWorkspaceBindingSources\(/)
  assert.match(filmCreateSource, /useFilmCreateWorkspaceBootstrap\(\{/)
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

test('制作页把页头、流水线和交付区显式 props 交给独立绑定源', () => {
  const filmCreateSource = readFileSync(new URL('../src/views/FilmCreate.vue', import.meta.url), 'utf8')
  const surfaceBindingsSource = readFileSync(new URL('../src/components/filmCreate/filmCreateSurfaceBindings.js', import.meta.url), 'utf8')
  assert.match(filmCreateSource, /createFilmCreateSurfaceBindingSources\(/)
  assert.match(filmCreateSource, /createFilmCreateSurfaceBindings\(\{/)
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
