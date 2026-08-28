import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { parse } from '@vue/compiler-sfc'
import { ElMessage } from 'element-plus'

import { requestCoreJson } from '../src/utils/coreJsonRequest.js'
import {
  buildEpisodeVideoFilename,
  fetchVerifiedVideoBlob,
  triggerBlobDownload,
} from '../src/utils/filmCreateDelivery.js'
import { useFilmCreateDeliveryActions } from '../src/composables/filmCreate/useFilmCreateDeliveryActions.js'
import { useFilmCreateProjectLoad } from '../src/composables/filmCreate/useFilmCreateProjectLoad.js'
import { useFilmCreateStoryboardMedia } from '../src/composables/filmCreate/useFilmCreateStoryboardMedia.js'
import { remainingImportedFunctionSource } from './helpers/remainingSourceBetween.js'

const DRAMA_ID = 11
const EPISODE_ID = 22
const STORYBOARD_OK_ID = 31
const STORYBOARD_FAIL_ID = 32
assert.notEqual(DRAMA_ID, EPISODE_ID)
assert.notEqual(STORYBOARD_OK_ID, STORYBOARD_FAIL_ID)

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const dramaDetailSource = read('../src/views/DramaDetail.vue')
const filmCreateSource = read('../src/views/FilmCreate.vue')
const deliveryPanelSource = read('../src/components/filmCreate/FilmCreateDeliveryPanel.vue')
const resourceDialogsSource = read('../src/components/filmCreate/FilmCreateResourceDialogs.vue')

function refOf(value) {
  return { value }
}

function jsonOk(data) {
  return new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function jsonError(status) {
  return new Response(JSON.stringify({ success: false, error: 'offline' }), {
    status,
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
  const focusCalls = []
  const dependencyCalls = []
  const projectLoadState = refOf('ready')
  const projectLoadError = refOf('')
  const projectLoadNotFound = refOf(false)
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
    loadPipelineConcurrency: async () => { dependencyCalls.push('concurrency') },
    refreshVideoGenerationCapability: async () => { dependencyCalls.push('video-cap') },
    refreshProductionReadiness: async () => { dependencyCalls.push('production') },
    scriptTitle: refOf(''),
    selectedEpisodeId: refOf(null),
    savedCurrentEpisodeNumber: refOf(1),
    storyInput: refOf(''),
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
    projectLoadState,
    projectLoadPending: refOf(false),
    projectLoadError,
    projectLoadNotFound,
    projectDependencyWarning: refOf(''),
    projectDependencyLoading: refOf(false),
    projectLoadFailureRef: refOf({ focus() { focusCalls.push('focus') } }),
    scriptDraftController: { dispose() { dependencyCalls.push('dispose') } },
  })
  return {
    api,
    store,
    projectLoadState,
    projectLoadError,
    projectLoadNotFound,
    focusCalls,
    dependencyCalls,
  }
}

function installBlobDownloadEnvironment() {
  const events = []
  const originalDocument = globalThis.document
  const originalCreateObjectURL = URL.createObjectURL
  const originalRevokeObjectURL = URL.revokeObjectURL
  const anchor = {
    style: {},
    click() { events.push('click') },
    remove() { events.push('remove') },
  }
  globalThis.document = {
    createElement(tag) {
      assert.equal(tag, 'a')
      return anchor
    },
    body: {
      appendChild(node) {
        assert.equal(node, anchor)
        events.push('append')
      },
    },
  }
  URL.createObjectURL = () => {
    events.push('create')
    return 'blob:video'
  }
  URL.revokeObjectURL = (value) => {
    events.push('revoke:' + value)
  }
  return {
    events,
    anchor,
    restore() {
      if (originalDocument === undefined) delete globalThis.document
      else globalThis.document = originalDocument
      if (originalCreateObjectURL) URL.createObjectURL = originalCreateObjectURL
      else delete URL.createObjectURL
      if (originalRevokeObjectURL) URL.revokeObjectURL = originalRevokeObjectURL
      else delete URL.revokeObjectURL
    },
  }
}


test('project pages keep core load failures outside every editable project surface', () => {
  for (const [name, source] of [
    ['DramaDetail', dramaDetailSource],
    ['FilmCreate', filmCreateSource],
  ]) {
    const parsed = parse(source, { filename: name + '.vue' })
    assert.deepEqual(parsed.errors, [], name + ' must remain a valid Vue SFC')
    assert.match(source, /role="alert"/)
    assert.match(source, /项目数据没有被删除/)
    assert.match(source, /项目可能已移入回收站或被删除/)
    assert.match(source, /重试加载/)
    assert.match(source, /返回项目列表/)
  }
  assert.match(dramaDetailSource, /dramaLoadFailureRef\.value\?\.focus\(\)/)
  assert.match(remainingImportedFunctionSource(useFilmCreateProjectLoad), /LoadFailureRef\.value\?\.focus\(\)/)

  assert.match(dramaDetailSource, /<template v-else-if="isDramaReady">[\s\S]*剧集信息/)
  assert.match(dramaDetailSource, /<template v-if="isDramaReady">\s*<!--[\s\S]*?<AccessibleDialog/)
  assert.match(dramaDetailSource, /<el-tooltip[\s\S]*v-if="isDramaReady"[\s\S]*请先新增一集，再进入制作[\s\S]*:disabled="!currentEpisodeId" @click="goCreate">/)

  assert.match(filmCreateSource, /<nav v-if="projectLoadState === 'ready'"/)
  assert.match(filmCreateSource, /<main v-if="projectLoadState === 'loading'"/)
  assert.match(filmCreateSource, /<main v-else-if="projectLoadState === 'error'"/)
  assert.match(filmCreateSource, /<main v-else class="main">[\s\S]*FilmCreateScriptWorkbench/)
  assert.match(filmCreateSource, /<template v-if="projectLoadState === 'ready'">[\s\S]*?<FilmCreateResourceDialogs/)
  assert.match(resourceDialogsSource, /<AccessibleDialog/)
  assert.match(filmCreateSource, /:disabled="projectLoadState !== 'ready'" @click="openAiConfig\(\)"/)
  assert.match(filmCreateSource, /v-if="!projectLoadNotFound"[\s\S]*重试加载/)
  assert.match(dramaDetailSource, /v-if="!dramaLoadNotFound"[\s\S]*重试加载/)
})

test('core drama request failures use stable page state instead of raw request toasts', async () => {
  assert.match(dramaDetailSource, /async function loadDrama\([\s\S]*coreDramaAPI\.get\(dramaId\)[\s\S]*drama\.value = null[\s\S]*dramaLoadState\.value = 'error'/)
  assert.match(dramaDetailSource, /requestCoreJson as requestCoreDrama/)
  assert.doesNotMatch(dramaDetailSource, /dramaAPI\.get\(dramaId\)/)

  const originalFetch = globalThis.fetch
  const originalError = ElMessage.error
  const originalWarning = ElMessage.warning
  const toasts = []
  ElMessage.error = (message) => { toasts.push(['error', message]) }
  ElMessage.warning = (message) => { toasts.push(['warning', message]) }
  const harness = createProjectLoad()
  globalThis.fetch = async (url) => {
    assert.equal(String(url), '/api/v1/dramas/' + DRAMA_ID)
    assert.notEqual(String(url), '/api/v1/dramas/' + EPISODE_ID)
    return jsonError(502)
  }
  try {
    const loaded = await harness.api.loadDrama({ blocking: true })
    assert.equal(loaded, false)
    assert.equal(harness.projectLoadState.value, 'error')
    assert.equal(harness.store.resetCount, 1)
    assert.deepEqual(harness.store.drama, { id: DRAMA_ID })
    assert.match(harness.projectLoadError.value, /本地服务暂时不可用/)
    assert.equal(harness.projectLoadNotFound.value, false)
    assert.deepEqual(harness.dependencyCalls, ['dispose'])
    assert.deepEqual(harness.focusCalls, ['focus'])
    assert.deepEqual(toasts, [])
  } finally {
    globalThis.fetch = originalFetch
    ElMessage.error = originalError
    ElMessage.warning = originalWarning
  }

  assert.match(filmCreateSource, /projectDependencyWarning/)
})


test('core project request unwraps data and rejects HTTP failures without the global toast client', async () => {
  const calls = []
  const drama = await requestCoreJson('/dramas/' + DRAMA_ID, {
    fetchImpl: async (url, options) => {
      calls.push({ url, options })
      return jsonOk({ id: DRAMA_ID, title: '项目' })
    },
  })
  assert.deepEqual(drama, { id: DRAMA_ID, title: '项目' })
  assert.equal(calls[0].url, '/api/v1/dramas/' + DRAMA_ID)
  assert.equal(calls[0].options.credentials, 'same-origin')

  await assert.rejects(
    requestCoreJson('/dramas/' + DRAMA_ID, {
      fetchImpl: async () => jsonError(502),
    }),
    (error) => error.message === 'PROJECT_LOAD_FAILED' && error.status === 502,
  )
})

test('verified video fetch accepts a non-empty video and preserves safe request options', async () => {
  const calls = []
  const blob = await fetchVerifiedVideoBlob('/static/final.mp4', async (url, options) => {
    calls.push({ url, options })
    return new Response(new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]), {
      status: 200,
      headers: { 'content-type': 'video/mp4' },
    })
  })

  assert.equal(blob.size, 8)
  assert.equal(blob.type, 'video/mp4')
  assert.equal(calls[0].url, '/static/final.mp4')
  assert.equal(calls[0].options.method, 'GET')
  assert.equal(calls[0].options.credentials, 'same-origin')
  assert.match(calls[0].options.headers.Accept, /video\/\*/)
})

test('verified video fetch rejects HTTP errors, empty bodies, and JSON errors before download', async () => {
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
    fetchVerifiedVideoBlob('/static/disguised.mp4', async () => new Response('{"error":"failed"}', {
      status: 200,
      headers: { 'content-type': 'application/octet-stream' },
    })),
    /服务器返回了错误信息/,
  )
})

test('video filename is filesystem-safe and Blob download always releases its object URL', async () => {
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

  anchor.click = () => { events.push('click-error'); throw new Error('blocked') }
  assert.throws(() => triggerBlobDownload(blob, filename, environment), /blocked/)
  assert.deepEqual(events.slice(-5), ['create', 'append', 'click-error', 'remove', 'revoke'])
})


function createDeliveryActions(overrides = {}) {
  const messages = []
  return useFilmCreateDeliveryActions({
    store: { drama: { title: '项目甲' } },
    ElMessage: {
      success(message) { messages.push(['success', message]) },
      error(message) { messages.push(['error', message]) },
    },
    dramaId: refOf(DRAMA_ID),
    currentEpisode: refOf({ episode_number: 2, video_url: '/static/final.mp4' }),
    currentEpisodeId: refOf(EPISODE_ID),
    storyboards: refOf([{ id: STORYBOARD_OK_ID, dialogue: '对白' }]),
    videoStatus: refOf('idle'),
    videoProgress: refOf(0),
    timelinesAPI: {
      getEpisodeSrt: async (episodeId) => {
        assert.equal(episodeId, EPISODE_ID)
        return new Blob(['1\n00:00:00,000 --> 00:00:01,000\n对白\n'], { type: 'text/plain' })
      },
    },
    dramaAPI: {
      exportDrama: async (dramaId) => {
        assert.equal(dramaId, DRAMA_ID)
        assert.notEqual(dramaId, EPISODE_ID)
        return new Blob([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00])], { type: 'application/zip' })
      },
    },
    ...overrides,
  })
}

test('FilmCreate exposes an accessible retryable download command beside the final preview', async () => {
  const originalFetch = globalThis.fetch
  const downloadEnv = installBlobDownloadEnvironment()
  const messages = []
  const actions = createDeliveryActions({
    ElMessage: {
      success(message) { messages.push(['success', message]) },
      error(message) { messages.push(['error', message]) },
    },
  })
  globalThis.fetch = async (url) => {
    assert.equal(url, '/static/final.mp4')
    return new Response(new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]), {
      status: 200,
      headers: { 'content-type': 'video/mp4' },
    })
  }
  try {
    await actions.downloadCurrentEpisodeVideo()
    assert.equal(actions.videoDownloadStatus.value, 'success')
    assert.equal(messages.at(-1)[0], 'success')
    assert.ok(downloadEnv.events.indexOf('create') < downloadEnv.events.indexOf('click'))
    assert.ok(downloadEnv.events.includes('revoke:blob:video'))
  } finally {
    globalThis.fetch = originalFetch
    downloadEnv.restore()
  }

  globalThis.fetch = async () => new Response('', { status: 502 })
  const failedEnv = installBlobDownloadEnvironment()
  try {
    await actions.downloadCurrentEpisodeVideo()
    assert.equal(actions.videoDownloadStatus.value, 'error')
    assert.match(actions.videoDownloadError.value, /HTTP 502|暂时无法提供成片/)
    assert.equal(failedEnv.events.includes('click'), false)
  } finally {
    globalThis.fetch = originalFetch
    failedEnv.restore()
  }

  assert.match(deliveryPanelSource, /<el-icon><Download \/><\/el-icon>/)
  assert.match(deliveryPanelSource, /videoDownloadStatus === 'error' \? '重试下载' : '下载成片'/)
  assert.match(deliveryPanelSource, /:role="videoDownloadStatus === 'error' \? 'alert' : 'status'"/)
})

test('FilmCreate delivery exports validate files before reporting success', async () => {
  const downloadEnv = installBlobDownloadEnvironment()
  const messages = []
  const actions = createDeliveryActions({
    ElMessage: {
      success(message) { messages.push(['success', message]) },
      error(message) { messages.push(['error', message]) },
    },
  })
  try {
    await actions.downloadCurrentEpisodeSubtitle()
    assert.equal(actions.deliveryExportStatus.subtitle, 'success')
    assert.equal(actions.deliveryExportStatus.project, 'idle')
    await actions.exportCurrentProjectPackage()
    assert.equal(actions.deliveryExportStatus.project, 'success')
    assert.equal(actions.deliveryExportStatus.subtitle, 'idle')
    assert.match(messages.map((item) => item[1]).join('|'), /字幕下载已完成/)
    assert.match(messages.map((item) => item[1]).join('|'), /项目包导出已完成/)
    assert.ok(downloadEnv.events.filter((item) => item === 'click').length >= 2)
  } finally {
    downloadEnv.restore()
  }
})

test('storyboard media load counts failed boards without wiping sibling results', async () => {
  const media = useFilmCreateStoryboardMedia({
    dramaId: refOf(DRAMA_ID),
    currentEpisodeId: refOf(EPISODE_ID),
    getStoryboards: () => ([
      { id: STORYBOARD_OK_ID, episode_id: EPISODE_ID },
      { id: STORYBOARD_FAIL_ID, episode_id: EPISODE_ID },
    ]),
    imagesAPI: {
      async list({ storyboard_id: storyboardId }) {
        if (storyboardId === STORYBOARD_FAIL_ID) throw new Error('image offline')
        return { items: [{ id: 'img-' + storyboardId }] }
      },
    },
    videosAPI: {
      async list({ storyboard_id: storyboardId }) {
        if (storyboardId === STORYBOARD_FAIL_ID) throw new Error('video offline')
        return { items: [{ id: 'vid-' + storyboardId }] }
      },
    },
  })
  media.ensureStoryboardMediaContext(DRAMA_ID, EPISODE_ID)
  const result = await media.loadStoryboardMedia()
  assert.equal(result.failedCount, 1)
  assert.equal(result.total, 2)
  assert.match(media.storyboardMediaLoadError.value, /1 个分镜/)
})

