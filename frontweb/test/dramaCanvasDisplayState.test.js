import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { effectScope, ref } from 'vue'

import {
  MIN_READABLE_CANVAS_ZOOM,
  useDramaCanvasDisplayState,
} from '../src/composables/useDramaCanvasDisplayState.js'

if (typeof globalThis.requestAnimationFrame !== 'function') {
  globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0)
}

const pageSource = readFileSync(new URL('../src/views/DramaCanvas.vue', import.meta.url), 'utf8')
const displaySource = readFileSync(new URL('../src/composables/useDramaCanvasDisplayState.js', import.meta.url), 'utf8')

const DRAMA_ID = 11
const EPISODE_ID = 22

function makeDisplayCtx(overrides = {}) {
  return {
    route: { query: { returnTo: '/?q=夜雨' }, params: { id: String(DRAMA_ID) } },
    drama: ref({
      id: DRAMA_ID,
      metadata: { free_canvas: { viewport: { x: 4, y: 5, zoom: 1.1 } } },
      episodes: [{ id: EPISODE_ID, storyboards: [{ id: 101 }] }],
    }),
    mediaStatusBySbId: ref({
      101: { state: 'unknown', error: '', retryable: true, preservedData: false },
    }),
    canvasMode: ref('production'),
    freeCanvas: ref({ viewport: { x: 9, y: 8, zoom: 0.4 }, nodes: [] }),
    savedLayout: ref({ viewport: { x: 1, y: 2, zoom: 1.2 } }),
    canvasFlowApi: ref(null),
    currentViewport: ref({ x: 0, y: 0, zoom: 1 }),
    canvasMainRef: ref(null),
    canvasViewportReady: ref(false),
    canvasProjectId: ref(DRAMA_ID),
    activeWorkflowRun: ref(null),
    ...overrides,
  }
}

test('画布页把展示态交给 useDramaCanvasDisplayState', () => {
  assert.notEqual(DRAMA_ID, EPISODE_ID)
  assert.match(pageSource, /useDramaCanvasDisplayState\(/)
  assert.match(displaySource, /function currentCanvasProjectId\(\)/)
  assert.match(displaySource, /function safeFreeCanvasError\(error, fallback\) \{[\s\S]*return canvasUserError\(error, fallback/)
  assert.match(displaySource, /document\.querySelector\('\.canvas-inspector-dock \.canvas-node-panel'\)\?\.focus/)
})

test('项目身份要求路由 ID 与已加载项目 ID 相同，二者不可互换', () => {
  assert.notEqual(DRAMA_ID, EPISODE_ID)
  const scope = effectScope()
  try {
    const matched = scope.run(() => useDramaCanvasDisplayState(makeDisplayCtx()))
    assert.equal(matched.currentCanvasProjectId(), DRAMA_ID)
    assert.equal(matched.isCanvasProjectCurrent(DRAMA_ID), true)
    assert.equal(matched.isCanvasProjectCurrent(EPISODE_ID), false)

    const mismatched = scope.run(() => useDramaCanvasDisplayState(makeDisplayCtx({
      canvasProjectId: ref(DRAMA_ID),
      drama: ref({ id: EPISODE_ID }),
    })))
    assert.equal(mismatched.currentCanvasProjectId(), null)
    assert.equal(mismatched.isCanvasProjectCurrent(DRAMA_ID), false)
    assert.equal(mismatched.isCanvasProjectCurrent(EPISODE_ID), false)
  } finally {
    scope.stop()
  }
})

test('制作模式可读视口沿用已保存 zoom，过小则回落到最小可读值', () => {
  const scope = effectScope()
  try {
    const saved = scope.run(() => useDramaCanvasDisplayState(makeDisplayCtx()))
    assert.deepEqual(saved.initialViewport.value, { x: 1, y: 2, zoom: 1.2 })
    assert.equal(saved.hasSavedViewport.value, true)

    const tiny = scope.run(() => useDramaCanvasDisplayState(makeDisplayCtx({
      savedLayout: ref({ viewport: { x: 1, y: 2, zoom: 0.4 } }),
    })))
    assert.deepEqual(tiny.initialViewport.value, { x: 0, y: 0, zoom: MIN_READABLE_CANVAS_ZOOM })
    assert.equal(tiny.hasSavedViewport.value, false)

    const free = scope.run(() => useDramaCanvasDisplayState(makeDisplayCtx({
      canvasMode: ref('free'),
    })))
    assert.deepEqual(free.initialViewport.value, { x: 9, y: 8, zoom: 0.4 })
    assert.equal(free.hasSavedViewport.value, true)
  } finally {
    scope.stop()
  }
})

test('计费媒体未知态按分镜 ID 查询，不用项目 ID 冒充分镜 ID', () => {
  const scope = effectScope()
  try {
    const bag = scope.run(() => useDramaCanvasDisplayState(makeDisplayCtx()))
    assert.equal(bag.getStoryboardMediaQueryStatus(101).state, 'unknown')
    assert.match(bag.getBillableMediaUnknownReason([101]), /1 个分镜/)
    assert.equal(bag.getBillableMediaUnknownReason([DRAMA_ID, EPISODE_ID]), '')
  } finally {
    scope.stop()
  }
})

test('屏幕坐标换算在缺少画布根节点时返回 null', () => {
  const scope = effectScope()
  try {
    const bag = scope.run(() => useDramaCanvasDisplayState(makeDisplayCtx({
      canvasMainRef: ref(null),
    })))
    assert.equal(bag.screenToFlowPosition(10, 20), null)

    const canvasViewportReady = ref(false)
    const ready = scope.run(() => useDramaCanvasDisplayState(makeDisplayCtx({
      canvasMainRef: ref({
        getBoundingClientRect: () => ({ left: 10, top: 20, width: 400, height: 300 }),
      }),
      currentViewport: ref({ x: 5, y: 7, zoom: 2 }),
      canvasViewportReady,
    })))
    assert.deepEqual(ready.screenToFlowPosition(15, 27), { x: 0, y: 0 })
    ready.updateCanvasViewportReady()
    assert.equal(canvasViewportReady.value, true)
  } finally {
    scope.stop()
  }
})

test('focusCanvasNode 适配节点后聚焦检查器面板', async () => {
  const currentViewport = ref({ x: 0, y: 0, zoom: 1 })
  const fitCalls = []
  const focusCalls = []
  const panel = { focus: (opts) => focusCalls.push(opts) }
  const previousDocument = globalThis.document
  globalThis.document = {
    querySelectorAll: () => [{ dataset: { id: 'sb:11' }, querySelector: () => panel }],
    querySelector: (sel) => (String(sel).includes('canvas-inspector-dock') ? panel : null),
  }
  const scope = effectScope()
  try {
    const bag = scope.run(() => useDramaCanvasDisplayState(makeDisplayCtx({
      currentViewport,
      canvasFlowApi: ref({
        async fitView(opts) { fitCalls.push(opts) },
        getViewport: () => ({ x: 3, y: 4, zoom: 1 }),
      }),
    })))
    await bag.focusCanvasNode('sb:11')
    assert.deepEqual(fitCalls[0].nodes, ['sb:11'])
    assert.equal(fitCalls[0].includeHiddenNodes, false)
    assert.deepEqual(currentViewport.value, { x: 3, y: 4, zoom: 1 })
    assert.ok(focusCalls.length >= 1)
  } finally {
    globalThis.document = previousDocument
    scope.stop()
  }
})

test('活动工作流必须是当前项目上的同一 run 对象', () => {
  const run = { projectId: DRAMA_ID, controller: { signal: { aborted: false } } }
  const other = { projectId: DRAMA_ID, controller: { signal: { aborted: false } } }
  const scope = effectScope()
  try {
    const activeWorkflowRun = ref(run)
    const bag = scope.run(() => useDramaCanvasDisplayState(makeDisplayCtx({
      activeWorkflowRun,
    })))
    assert.equal(bag.isActiveWorkflowRun(activeWorkflowRun.value), true)
    assert.equal(bag.isActiveWorkflowRun(other), false)
    assert.equal(bag.isWorkflowAbortError({ name: 'AbortError' }), true)
    assert.equal(bag.isWorkflowAbortError({ code: 'ERR_CANCELED' }), true)
    assert.equal(bag.isWorkflowAbortError({ message: 'fail' }), false)
  } finally {
    scope.stop()
  }
})
