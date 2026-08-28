import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { parse } from '@vue/compiler-sfc'
import { requestCoreJson } from '../src/utils/coreJsonRequest.js'
import {
  buildEpisodeVideoFilename,
  fetchVerifiedVideoBlob,
  triggerBlobDownload,
} from '../src/utils/filmCreateDelivery.js'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const dramaDetailSource = read('../src/views/DramaDetail.vue')
const filmCreateSource = read('../src/views/FilmCreate.vue')
const deliveryPanelSource = read('../src/components/filmCreate/FilmCreateDeliveryPanel.vue')
const storyboardMediaSource = read('../src/composables/filmCreate/useFilmCreateStoryboardMedia.js')
const resourceDialogsSource = read('../src/components/filmCreate/FilmCreateResourceDialogs.vue')
const filmCreateUiSource = filmCreateSource + '\n' + deliveryPanelSource

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start)
  assert.ok(start >= 0, `missing source marker: ${startMarker}`)
  assert.ok(end > start, `missing source marker: ${endMarker}`)
  return source.slice(start, end)
}

async function loadVideoDownloadHelpers() {
  return { buildEpisodeVideoFilename, fetchVerifiedVideoBlob, triggerBlobDownload }
}

async function loadCoreDramaRequestHelpers() {
  return { requestCoreJson }
}

test('project pages keep core load failures outside every editable project surface', () => {
  for (const [name, source] of [
    ['DramaDetail', dramaDetailSource],
    ['FilmCreate', filmCreateSource],
  ]) {
    const parsed = parse(source, { filename: `${name}.vue` })
    assert.deepEqual(parsed.errors, [], `${name} must remain a valid Vue SFC`)
    assert.match(source, /role="alert"/)
    assert.match(source, /项目数据没有被删除/)
    assert.match(source, /项目可能已移入回收站或被删除/)
    assert.match(source, /重试加载/)
    assert.match(source, /返回项目列表/)
    assert.match(source, /LoadFailureRef\.value\?\.focus\(\)/)
  }

  assert.match(dramaDetailSource, /<template v-else-if="isDramaReady">[\s\S]*剧集信息/)
  assert.match(dramaDetailSource, /<template v-if="isDramaReady">\s*<!--[\s\S]*?<AccessibleDialog/)
  assert.match(dramaDetailSource, /<el-tooltip[\s\S]*v-if="isDramaReady"[\s\S]*请先新增一集，再进入制作[\s\S]*:disabled="!currentEpisodeId" @click="goCreate">/)

  assert.match(filmCreateSource, /<nav v-if="projectLoadState === 'ready'"/)
  assert.match(filmCreateSource, /<main v-if="projectLoadState === 'loading'"/)
  assert.match(filmCreateSource, /<main v-else-if="projectLoadState === 'error'"/)
  assert.match(filmCreateSource, /<main v-else class="main">[\s\S]*FilmCreateScriptWorkbench/)
  assert.match(filmCreateSource + '\n' + resourceDialogsSource, /<template v-if="projectLoadState === 'ready'">[\s\S]*?<FilmCreateResourceDialogs[\s\S]*?<AccessibleDialog/)
  assert.match(filmCreateSource, /:disabled="projectLoadState !== 'ready'" @click="openAiConfig\(\)"/)
  assert.match(filmCreateSource, /v-if="!projectLoadNotFound"[\s\S]*重试加载/)
  assert.match(dramaDetailSource, /v-if="!dramaLoadNotFound"[\s\S]*重试加载/)
})

test('core drama request failures use stable page state instead of raw request toasts', () => {
  const detailLoader = sourceBetween(
    dramaDetailSource,
    'async function loadDrama(',
    'async function retryDramaLoad',
  )
  assert.match(detailLoader, /dramaLoadState\.value = 'error'/)
  assert.match(detailLoader, /drama\.value = null/)
  assert.match(detailLoader, /coreDramaAPI\.get\(dramaId\)/)
  assert.doesNotMatch(detailLoader, /dramaAPI\.get\(dramaId\)/)
  assert.doesNotMatch(detailLoader, /ElMessage\.(error|warning)/)

  const createLoader = sourceBetween(
    filmCreateSource,
    'async function loadDrama(',
    'async function retryFilmProjectLoad',
  )
  assert.match(createLoader, /projectLoadState\.value = 'error'/)
  assert.match(createLoader, /store\.reset\(\)/)
  assert.match(createLoader, /await refreshProjectDependencies\(ep\?\.id, \{ includeProjectCapabilities: true \}\)/)
  assert.match(createLoader, /coreDramaAPI\.get\(requestedDramaId\)/)
  assert.doesNotMatch(createLoader, /dramaAPI\.get\(requestedDramaId\)/)
  assert.doesNotMatch(createLoader, /ElMessage\.(error|warning)/)
  assert.match(filmCreateSource, /projectDependencyWarning/)
  assert.match(storyboardMediaSource, /failedCount \+= 1/)
})

test('core project request unwraps data and rejects HTTP failures without the global toast client', async () => {
  const { requestCoreJson } = await loadCoreDramaRequestHelpers()
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
  assert.equal(calls[0].options.credentials, 'same-origin')

  await assert.rejects(
    requestCoreJson('/dramas/7', {
      fetchImpl: async () => new Response(JSON.stringify({ error: 'offline' }), { status: 502 }),
    }),
    (error) => error.message === 'PROJECT_LOAD_FAILED' && error.status === 502,
  )
})

test('verified video fetch accepts a non-empty video and preserves safe request options', async () => {
  const { fetchVerifiedVideoBlob } = await loadVideoDownloadHelpers()
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
  const { fetchVerifiedVideoBlob } = await loadVideoDownloadHelpers()

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
  const { buildEpisodeVideoFilename, triggerBlobDownload } = await loadVideoDownloadHelpers()
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

test('FilmCreate exposes an accessible retryable download command beside the final preview', () => {
  const handler = sourceBetween(
    filmCreateSource,
    'async function downloadCurrentEpisodeVideo',
    'watch([currentEpisodeId, currentEpisodeVideoUrl]',
  )
  assert.ok(handler.indexOf('fetchVerifiedVideoBlob') < handler.indexOf('triggerBlobDownload'))
  assert.ok(handler.indexOf('triggerBlobDownload') < handler.indexOf("videoDownloadStatus.value = 'success'"))
  assert.match(filmCreateUiSource, /<el-icon><Download \/><\/el-icon>/)
  assert.match(filmCreateUiSource, /videoDownloadStatus === 'error' \? '重试下载' : '下载成片'/)
  assert.match(filmCreateUiSource, /:role="videoDownloadStatus === 'error' \? 'alert' : 'status'"/)
})

test('FilmCreate delivery exports validate files before reporting success', () => {
  const deliveryHandlers = sourceBetween(
    filmCreateSource,
    'async function downloadCurrentEpisodeSubtitle',
    'watch([currentEpisodeId, currentEpisodeVideoUrl]',
  )
  assert.match(deliveryHandlers, /await timelinesAPI\.getEpisodeSrt\(currentEpisodeId\.value\)/)
  assert.match(deliveryHandlers, /await dramaAPI\.exportDrama\(dramaId\.value\)/)
  assert.match(deliveryHandlers, /validateDeliveryBlob\([\s\S]*kind: 'zip'/)
  assert.match(deliveryHandlers, /triggerBlobDownload\(blob, filename\)/)
  assert.match(deliveryHandlers, /deliveryExportStatus\.project = 'success'/)
  assert.match(deliveryHandlers, /deliveryExportStatus\.subtitle = 'success'/)
  assert.match(deliveryHandlers, /deliveryExportStatus\.project = 'idle'[\s\S]*timelinesAPI\.getEpisodeSrt/)
  assert.match(deliveryHandlers, /deliveryExportStatus\.subtitle = 'idle'[\s\S]*dramaAPI\.exportDrama/)
})
