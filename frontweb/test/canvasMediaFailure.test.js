import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { parse } from '@vue/compiler-sfc'

import { fetchStoryboardMediaSnapshot } from '../src/composables/useCanvasStoryboardMedia.js'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const canvasSource = read('../src/views/DramaCanvas.vue')
const storyboardNodeSource = read('../src/components/dramaCanvas/CanvasStoryboardNode.vue')
const storyboardPanelSource = read('../src/components/dramaCanvas/CanvasStoryboardPanel.vue')
const mediaPanelSource = read('../src/components/dramaCanvas/CanvasMediaPanel.vue')
const mediaNodeSource = read('../src/components/dramaCanvas/CanvasMediaNode.vue')

const STORYBOARD_OK_ID = 11
const STORYBOARD_FAIL_ID = 12
assert.notEqual(STORYBOARD_OK_ID, STORYBOARD_FAIL_ID)

test('media query failure preserves cached storyboard media and marks only failed boards as unknown', async () => {
  const imagesAPIImpl = {
    async list({ storyboard_id: storyboardId }) {
      if (storyboardId === STORYBOARD_FAIL_ID) throw new Error('image service offline')
      return { items: [{ id: `img-${storyboardId}` }] }
    },
  }
  const videosAPIImpl = {
    async list({ storyboard_id: storyboardId }) {
      if (storyboardId === STORYBOARD_FAIL_ID) throw new Error('video service offline')
      return { items: [{ id: `vid-${storyboardId}` }] }
    },
  }

  const result = await fetchStoryboardMediaSnapshot(
    [{ id: STORYBOARD_OK_ID }, { id: STORYBOARD_FAIL_ID }],
    {
      imagesBySbId: {
        [STORYBOARD_OK_ID]: [{ id: 'stale-img-11' }],
        [STORYBOARD_FAIL_ID]: [{ id: 'stale-img-12' }],
      },
      videosBySbId: {
        [STORYBOARD_OK_ID]: [{ id: 'stale-vid-11' }],
        [STORYBOARD_FAIL_ID]: [{ id: 'stale-vid-12' }],
      },
      mediaStatusBySbId: {
        [STORYBOARD_OK_ID]: { state: 'ready' },
        [STORYBOARD_FAIL_ID]: { state: 'ready' },
      },
      imagesAPIImpl,
      videosAPIImpl,
    },
  )

  assert.deepEqual(result.failedStoryboardIds, [STORYBOARD_FAIL_ID])
  assert.equal(result.failedCount, 1)
  assert.deepEqual(result.nextImages[STORYBOARD_OK_ID], [{ id: 'img-11' }])
  assert.deepEqual(result.nextVideos[STORYBOARD_OK_ID], [{ id: 'vid-11' }])
  assert.deepEqual(result.nextImages[STORYBOARD_FAIL_ID], [{ id: 'stale-img-12' }])
  assert.deepEqual(result.nextVideos[STORYBOARD_FAIL_ID], [{ id: 'stale-vid-12' }])
  assert.deepEqual(result.nextMediaStatus[STORYBOARD_OK_ID], {
    state: 'ready',
    error: '',
    retryable: false,
    preservedData: false,
  })
  assert.equal(result.nextMediaStatus[STORYBOARD_FAIL_ID].state, 'unknown')
  assert.equal(result.nextMediaStatus[STORYBOARD_FAIL_ID].retryable, true)
  assert.equal(result.nextMediaStatus[STORYBOARD_FAIL_ID].preservedData, true)
  assert.match(result.nextMediaStatus[STORYBOARD_FAIL_ID].error, /offline/)
})

test('media query cancellation is forwarded to every request and is never downgraded to unknown', async () => {
  const controller = new AbortController()
  const requestOptions = { signal: controller.signal, timeout: 15_000 }
  const calls = []
  const abort = new Error('stopped')
  abort.name = 'AbortError'
  const imagesAPIImpl = {
    async list(params, options) {
      calls.push(['image', params, options])
      throw abort
    },
  }
  const videosAPIImpl = {
    async list(params, options) {
      calls.push(['video', params, options])
      return { items: [] }
    },
  }

  await assert.rejects(
    fetchStoryboardMediaSnapshot(
      [{ id: STORYBOARD_OK_ID }],
      { imagesAPIImpl, videosAPIImpl, requestOptions },
    ),
    (error) => error === abort,
  )
  assert.deepEqual(calls, [
    ['image', { storyboard_id: STORYBOARD_OK_ID, page: 1, page_size: 100 }, requestOptions],
    ['video', { storyboard_id: STORYBOARD_OK_ID, page: 1, page_size: 50 }, requestOptions],
  ])
})

test('drama canvas exposes persistent load failure UI and media retry entry points', () => {
  assert.match(canvasSource, /v-if="canvasLoadState === 'error'"/)
  assert.match(canvasSource, /ref="canvasLoadFailureRef"/)
  assert.match(canvasSource, /role="alert"/)
  assert.match(canvasSource, /@click="retryCanvasProjectLoad"/)
  assert.match(canvasSource, /await loadCanvasProject\(\{ blocking: true, preserveOnError: false \}\)/)
  assert.match(canvasSource, /coreCanvasDramaAPI\.get\(requestedDramaId, requestOptions\)/)
  assert.match(canvasSource, /loadForDrama\(drama\.value, filterEpisodeId\.value, requestOptions\)/)
  assert.match(canvasSource, /loadProjectAssets\(requestedDramaId, requestOptions\)/)
  assert.match(canvasSource, /if \(isCanvasAbortError\(error, requestOptions\.signal\)\) throw error/)
  assert.match(canvasSource, /canvasLoadFailureRef\.value\?\.focus\(\)/)
  assert.match(canvasSource, /getBillableMediaUnknownReason/)
  assert.match(canvasSource, /retryUnknownStoryboardMedia/)
  assert.match(canvasSource, /mediaStatusBySbId/)
})

test('storyboard nodes block billable regeneration while media state is unknown and offer retry', () => {
  const parsed = parse(storyboardNodeSource, { filename: 'CanvasStoryboardNode.vue' })
  assert.deepEqual(parsed.errors, [])
  assert.match(storyboardNodeSource, /mediaQueryUnknown/)
  assert.match(storyboardNodeSource, /class="media-query-blocker"/)
  assert.match(storyboardNodeSource, /为避免重复计费/)
  assert.match(storyboardNodeSource, /ctx\?\.retryStoryboardMedia\?\./)
  assert.match(storyboardNodeSource, /重试媒体查询/)
  assert.match(storyboardNodeSource, /媒体状态未知/)
})

test('media panel and media node gate regeneration behind the same unknown-media retry flow', () => {
  const panelParsed = parse(mediaPanelSource, { filename: 'CanvasMediaPanel.vue' })
  const nodeParsed = parse(mediaNodeSource, { filename: 'CanvasMediaNode.vue' })
  assert.deepEqual(panelParsed.errors, [])
  assert.deepEqual(nodeParsed.errors, [])

  assert.match(mediaPanelSource, /showMediaQueryBlocker/)
  assert.match(mediaPanelSource, /当前媒体状态未知。为避免重复计费，请先重试媒体查询，再继续重新生成图片或视频。/)
  assert.match(mediaPanelSource, /ctx\?\.getStoryboardMediaQueryStatus\?\./)
  assert.match(mediaPanelSource, /ctx\?\.retryStoryboardMedia\?\./)
  assert.match(mediaPanelSource, /重试媒体查询/)
  assert.match(mediaNodeSource, /showMediaQueryWarning/)
  assert.match(mediaNodeSource, /unknown-pill/)
  assert.match(mediaNodeSource, /媒体状态未知，可重试查询/)
})

test('both single-node generation panels register one cancellable run and forward its signal', () => {
  for (const [name, source] of [
    ['CanvasMediaPanel', mediaPanelSource],
    ['CanvasStoryboardPanel', storyboardPanelSource],
  ]) {
    const parsed = parse(source, { filename: `${name}.vue` })
    assert.deepEqual(parsed.errors, [])
    assert.ok(source.includes('ctx?.beginNodeGeneration?.'))
    assert.match(source, /runImageStep\([\s\S]*?\{ signal: generationRun\.signal \}/)
    assert.match(source, /runVideoStep\([\s\S]*?\{ signal: generationRun\.signal \}/)
    assert.match(source, /runAudioStep\([\s\S]*?\{ signal: generationRun\.signal \}/)
    assert.match(source, /onBeforeUnmount\([\s\S]*?generationRun\?\.abort/)
    assert.match(source, /audioOutcomeUnknown/)
    assert.match(source, /刷新分镜状态/)
  }
  assert.match(canvasSource, /nodeGenerationCoordinator.hasActive()/)
  assert.match(canvasSource, /ensureNodeGenerationFinished()/)
  assert.match(canvasSource, /nodeGenerationCoordinator.stopWaiting/)
})
