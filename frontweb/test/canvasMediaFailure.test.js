import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { parse } from '@vue/compiler-sfc'

import { fetchStoryboardMediaSnapshot } from '../src/composables/useCanvasStoryboardMedia.js'

import { generateAssetReferenceImage } from '../src/composables/useCanvasAssetGenerate.js'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const canvasSource = [read('../src/views/DramaCanvas.vue'), read('../src/components/dramaCanvas/CanvasPageHeader.vue'), read('../src/views/DramaCanvas.css'), read('../src/composables/useDramaCanvasProjectLoad.js'), read('../src/composables/useDramaCanvasGraph.js')].join('\n')
const storyboardNodeSource = read('../src/components/dramaCanvas/CanvasStoryboardNode.vue')
const inspectorDockSource = read('../src/components/dramaCanvas/CanvasInspectorDock.vue')
const storyboardPanelSource = read('../src/components/dramaCanvas/CanvasStoryboardPanel.vue')
const mediaPanelSource = read('../src/components/dramaCanvas/CanvasMediaPanel.vue')
const mediaNodeSource = read('../src/components/dramaCanvas/CanvasMediaNode.vue')
const assetPanelSource = read('../src/components/dramaCanvas/CanvasAssetPanel.vue')
const scriptPanelSource = read('../src/components/dramaCanvas/CanvasScriptPanel.vue')

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
  const dockParsed = parse(inspectorDockSource, { filename: 'CanvasInspectorDock.vue' })
  assert.deepEqual(parsed.errors, [])
  assert.deepEqual(dockParsed.errors, [])
  assert.match(storyboardNodeSource, /mediaQueryUnknown/)
  assert.match(storyboardNodeSource, /媒体状态未知/)
  assert.match(inspectorDockSource, /class="media-query-blocker"/)
  assert.match(inspectorDockSource, /为避免重复计费/)
  assert.match(inspectorDockSource, /ctx\?\.retryStoryboardMedia\?\./)
  assert.match(inspectorDockSource, /重试媒体查询/)
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
  assert.match(mediaPanelSource, /正在重试媒体查询，请稍候/)
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


const PROVIDER_SECRET = 'sk-test-not-a-real-key-aaaaaaaaaaaaaaaaaaaaaaaaaaaa'

function assetGenerateCtx() {
  return {
    drama: { value: { id: 1, characters: [{ id: 9, name: '角色甲' }] } },
    nodeStatus: { set() {}, clear() {} },
    refreshDrama: async () => {},
    refresh: async () => {},
  }
}

function isChineseWithoutSecret(text) {
  return /[\u4e00-\u9fff]/.test(text)
    && !String(text).includes(PROVIDER_SECRET)
    && !/sk-[A-Za-z0-9._-]{6,}/i.test(text)
    && !/api[_-]?key/i.test(text)
    && !/Invalid API key/i.test(text)
}

test('asset reference generation maps provider English and secrets to Chinese', async () => {
  await assert.rejects(
    generateAssetReferenceImage(assetGenerateCtx(), {
      kind: 'character',
      entity: { id: 9 },
      nodeId: 'char:9',
      pollOptions: { interval: 0, maxAttempts: 2, deadlineMs: 1000 },
      characterAPIImpl: {
        async generateImage() {
          return { task_id: 'task-asset-fail' }
        },
      },
      getTask: async () => ({
        status: 'failed',
        error: { message: `Invalid API key ${PROVIDER_SECRET}` },
      }),
    }),
    (error) => isChineseWithoutSecret(error.message),
  )
})

test('asset reference generation keeps mixed Chinese provider errors from leaking keys', async () => {
  await assert.rejects(
    generateAssetReferenceImage(assetGenerateCtx(), {
      kind: 'character',
      entity: { id: 9 },
      nodeId: 'char:9',
      pollOptions: { interval: 0, maxAttempts: 2, deadlineMs: 1000 },
      characterAPIImpl: {
        async generateImage() {
          return { task_id: 'task-asset-zh' }
        },
      },
      getTask: async () => ({
        status: 'failed',
        error: { message: `\u9274\u6743\u5931\u8d25 ${PROVIDER_SECRET}` },
      }),
    }),
    (error) => isChineseWithoutSecret(error.message),
  )
})

test('asset reference generation can be cancelled during polling', async () => {
  const controller = new AbortController()
  const pending = generateAssetReferenceImage(assetGenerateCtx(), {
    kind: 'character',
    entity: { id: 9 },
    nodeId: 'char:9',
    signal: controller.signal,
    pollOptions: { interval: 20, maxAttempts: 50, deadlineMs: 5000 },
    characterAPIImpl: {
      async generateImage() {
        return { task_id: 'task-asset-wait' }
      },
    },
    getTask: async () => ({ status: 'pending' }),
  })
  await new Promise((resolve) => setImmediate(resolve))
  controller.abort()
  await assert.rejects(
    pending,
    (error) => error?.name === 'AbortError' && /\u53d6\u6d88/.test(error.message) && isChineseWithoutSecret(error.message),
  )
})

test('batch episode generate cancel is wired to abortEpisodeGenerate', () => {
  const parsed = parse(read('../src/views/DramaCanvas.vue'), { filename: 'DramaCanvas.vue' })
  assert.deepEqual(parsed.errors, [])
  assert.match(canvasSource, /abortEpisodeGenerate/)
  assert.match(canvasSource, /function cancelEpisodeGenerate\(\) \{[\s\S]*abortEpisodeGenerate\(\)/)
  assert.match(canvasSource, /aria-label="取消批量生成"/)
  assert.match(canvasSource, /@click="cancelEpisodeGenerate"/)
  assert.match(canvasSource, /ensureEpisodeGenerationFinished\(\)/)
  assert.match(canvasSource, /onBeforeUnmount\([\s\S]*?abortEpisodeGenerate\(\)/)
})

test('asset and script panels expose cancel controls and forward abort signals', () => {
  const assetParsed = parse(assetPanelSource, { filename: 'CanvasAssetPanel.vue' })
  const scriptParsed = parse(scriptPanelSource, { filename: 'CanvasScriptPanel.vue' })
  assert.deepEqual(assetParsed.errors, [])
  assert.deepEqual(scriptParsed.errors, [])
  assert.match(assetPanelSource, /aria-label="取消生成参考图"/)
  assert.match(assetPanelSource, /@click.stop="abortGenerate"/)
  assert.match(assetPanelSource, /signal: generationRun\.signal/)
  assert.match(assetPanelSource, /onBeforeUnmount\([\s\S]*?abortGenerate\(\)/)
  assert.match(assetPanelSource, /isCanvasUserAbort\(e\) \|\| controller\.signal\.aborted/)
  assert.match(scriptPanelSource, /aria-label="取消提取"/)
  assert.match(scriptPanelSource, /@click.stop="abortExtract"/)
  assert.match(scriptPanelSource, /extractCharacters\?\.\(props\.episode\.id, form\.scriptContent, \{ signal \}\)/)
  assert.match(scriptPanelSource, /extractScenes\?\.\(props\.episode\.id, \{ signal \}\)/)
  assert.match(scriptPanelSource, /extractProps\?\.\(props\.episode\.id, \{ signal \}\)/)
  assert.match(scriptPanelSource, /extractAll\?\.\(props\.episode\.id, form\.scriptContent, \{ signal \}\)/)
  assert.match(scriptPanelSource, /onBeforeUnmount\([\s\S]*?abortExtract\(\)/)
  assert.match(scriptPanelSource, /isCanvasUserAbort\(e\) \|\| controller\.signal\.aborted/)
})
