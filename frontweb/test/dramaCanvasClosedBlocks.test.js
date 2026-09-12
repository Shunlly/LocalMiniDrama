import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { effectScope, ref } from 'vue'

import {
  createDramaCanvasChromeBindings,
  createDramaCanvasLoadFailureBindings,
} from '../src/components/dramaCanvas/dramaCanvasControlBindings.js'
import {
  coreCanvasDramaAPI,
  friendlyCanvasProjectLoadError,
  isCanvasAbortError,
  requestCanvasProject,
} from '../src/components/dramaCanvas/dramaCanvasProjectRequest.js'
import {
  ensureKnownStoryboardMedia,
  findUnknownMediaStoryboards,
  getBillableMediaUnknownReason,
  getStoryboardMediaQueryStatus,
  pipelineTouchesBillableMedia,
} from '../src/components/dramaCanvas/dramaCanvasBillableMedia.js'

const pageSource = readFileSync(new URL('../src/views/DramaCanvas.vue', import.meta.url), 'utf8')
const chromeSource = readFileSync(new URL('../src/components/dramaCanvas/CanvasPageChrome.vue', import.meta.url), 'utf8')
const toolbarSource = readFileSync(new URL('../src/components/dramaCanvas/CanvasDesktopToolbar.vue', import.meta.url), 'utf8')
const bindingsSource = readFileSync(new URL('../src/components/dramaCanvas/dramaCanvasControlBindings.js', import.meta.url), 'utf8')
const pageBindingsSource = readFileSync(new URL('../src/composables/useDramaCanvasPageBindings.js', import.meta.url), 'utf8')

test('画布页把页头工具条和加载失败面交给闭合区块绑定', () => {
  assert.match(pageSource, /<CanvasPageChrome v-bind="pageChromeBindings"/)
  assert.match(pageSource, /v-bind="loadFailureBindings"/)
  assert.match(pageSource, /useDramaCanvasPageBindings\(/)
  assert.match(pageBindingsSource, /createDramaCanvasChromeBindings\(/)
  assert.match(pageBindingsSource, /createDramaCanvasLoadFailureBindings\(/)
  assert.match(chromeSource, /<CanvasPageHeader/)
  assert.match(chromeSource, /<CanvasDesktopToolbar/)
  assert.match(chromeSource, /:go-project-list="goProjectList"/)
  assert.match(chromeSource, /:go-list-mode="goListMode"/)
  assert.match(chromeSource, /:cancel-episode-generate="cancelEpisodeGenerate"/)
  assert.match(chromeSource, /@cancel-workflow="cancelActiveWorkflow"/)
  assert.match(chromeSource, /@generate-storyboards="aiGenerateStoryboards"/)
  assert.match(toolbarSource, /aria-label="AI 生成分镜"/)
  assert.match(toolbarSource, />\s*AI 分镜\s*</)
  assert.match(bindingsSource, /export function createDramaCanvasChromeBindings/)
  assert.match(bindingsSource, /export function createDramaCanvasLoadFailureBindings/)
})

test('chrome 绑定袋解开 dramaref 并保留工具条动作', () => {
  const scope = effectScope()
  try {
    const bag = scope.run(() => {
      const drama = ref({ title: '夜雨' })
      const selectedStoryboardIds = ref([11])
      const pipelineSteps = ref(['image'])
      return createDramaCanvasChromeBindings({
        drama,
        selectedStoryboardIds,
        pipelineSteps,
        goProjectList: () => 'list',
        aiGenerateStoryboards: () => 'storyboards',
        cancelActiveWorkflow: () => 'cancel',
      }).value
    })
    assert.equal(bag.drama.title, '夜雨')
    assert.deepEqual(bag.selectedStoryboardIds, [11])
    assert.deepEqual(bag.pipelineSteps, ['image'])
    assert.equal(bag.goProjectList(), 'list')
    assert.equal(bag.aiGenerateStoryboards(), 'storyboards')
    assert.equal(bag.cancelActiveWorkflow(), 'cancel')
  } finally {
    scope.stop()
  }
})

test('加载失败绑定袋把错误字段映射到卡片 props', () => {
  const scope = effectScope()
  try {
    const bag = scope.run(() => createDramaCanvasLoadFailureBindings({
      loading: ref(true),
      canvasLoadError: ref('画布服务暂时不可用'),
      canvasLoadNotFound: ref(false),
      retryCanvasProjectLoad: () => 'retry',
      goProjectList: () => 'list',
    }).value)
    assert.equal(bag.loading, true)
    assert.equal(bag.error, '画布服务暂时不可用')
    assert.equal(bag.notFound, false)
    assert.equal(bag.retryCanvasProjectLoad(), 'retry')
    assert.equal(bag.goProjectList(), 'list')
  } finally {
    scope.stop()
  }
})

test('画布项目请求解开 data、超时取消并拒绝 HTTP 失败', async () => {
  const calls = []
  const drama = await requestCanvasProject('/dramas/7', {
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

  const loaded = await coreCanvasDramaAPI.get(9, {
    fetchImpl: async (url) => {
      assert.equal(url, '/api/v1/dramas/9')
      return new Response(JSON.stringify({ success: true, data: { id: 9 } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    },
  })
  assert.deepEqual(loaded, { id: 9 })

  await assert.rejects(
    requestCanvasProject('/dramas/7', {
      fetchImpl: async () => new Response(JSON.stringify({ success: false }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      }),
    }),
    (error) => error.status === 500,
  )

  const abort = new AbortController()
  abort.abort()
  await assert.rejects(
    requestCanvasProject('/dramas/7', {
      signal: abort.signal,
      fetchImpl: async (_url, options) => {
        const err = new Error('aborted')
        err.name = 'AbortError'
        if (options.signal?.aborted) throw err
        throw err
      },
    }),
    (error) => isCanvasAbortError(error, abort.signal),
  )
})

test('项目加载失败文案按状态分类，不回传任意后端文本', () => {
  assert.equal(friendlyCanvasProjectLoadError({ status: 404 }), '该项目不存在，或已移入回收站。')
  assert.equal(friendlyCanvasProjectLoadError({ status: 503 }), '本地服务暂时不可用，请稍后重试。')
  assert.equal(friendlyCanvasProjectLoadError({ message: 'password=hunter2' }), '无法连接本地服务，请确认服务已经启动后重试。')
})

test('计费媒体未知态按分镜 ID 计数，不把项目 ID 当成集 ID', () => {
  const DRAMA_ID = 11
  const EPISODE_ID = 22
  assert.notEqual(DRAMA_ID, EPISODE_ID)
  const drama = {
    id: DRAMA_ID,
    episodes: [{
      id: EPISODE_ID,
      storyboards: [{ id: 101 }, { id: 202 }],
    }],
  }
  const mediaStatusBySbId = {
    101: { state: 'unknown', error: '', retryable: true, preservedData: false },
    202: { state: 'ready', error: '', retryable: false, preservedData: true },
  }
  assert.equal(getStoryboardMediaQueryStatus(mediaStatusBySbId, 101).state, 'unknown')
  assert.equal(findUnknownMediaStoryboards(drama, [101, 202], mediaStatusBySbId).length, 1)
  assert.match(getBillableMediaUnknownReason(drama, [101, 202], mediaStatusBySbId), /1 个分镜/)
  assert.equal(getBillableMediaUnknownReason(drama, [DRAMA_ID, EPISODE_ID], mediaStatusBySbId), '')
  assert.equal(pipelineTouchesBillableMedia(['audio']), false)
  assert.equal(pipelineTouchesBillableMedia(['image', 'audio']), true)
  const warnings = []
  assert.equal(ensureKnownStoryboardMedia(drama, [202], mediaStatusBySbId, (reason) => warnings.push(reason)), true)
  assert.equal(ensureKnownStoryboardMedia(drama, [101], mediaStatusBySbId, (reason) => warnings.push(reason)), false)
  assert.equal(warnings.length, 1)
})
