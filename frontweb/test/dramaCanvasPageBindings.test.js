import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { effectScope, ref } from 'vue'

import {
  createDramaCanvasActionDisplay,
  createDramaCanvasHistoryDisplay,
  createDramaCanvasListModeNavigation,
  createDramaCanvasPageBindings,
} from '../src/composables/useDramaCanvasPageBindings.js'

const pageSource = readFileSync(new URL('../src/views/DramaCanvas.vue', import.meta.url), 'utf8')
const bindingsSource = readFileSync(new URL('../src/composables/useDramaCanvasPageBindings.js', import.meta.url), 'utf8')
const flowStageSource = readFileSync(new URL('../src/components/dramaCanvas/CanvasFlowStage.vue', import.meta.url), 'utf8')

const DRAMA_ID = 11
const EPISODE_ID = 22
const STORYBOARD_ID = 101

function readyProductionActions() {
  return {
    video: { reason: '', serviceType: 'video', ready: true },
    tts: { reason: '', serviceType: 'tts', ready: true },
    composite: { reason: '', serviceType: '', ready: true },
  }
}

function makeActionCtx(overrides = {}) {
  const currentEpisode = ref({
    id: EPISODE_ID,
    script_content: '夜雨开场',
    storyboards: [{ id: STORYBOARD_ID }, { id: 202 }],
  })
  return {
    selectedStoryboardIds: ref([STORYBOARD_ID]),
    pipelineSteps: ref(['image']),
    activeGroupId: ref('wf-1'),
    activeWorkflowSteps: ref(['image']),
    productionActions: ref(readyProductionActions()),
    drama: ref({
      id: DRAMA_ID,
      title: '夜雨',
      episodes: [currentEpisode.value],
    }),
    filterEpisodeId: ref(EPISODE_ID),
    currentEpisode,
    workflowRunning: ref(false),
    episodeGenerating: ref(false),
    getBillableMediaUnknownReason: (ids = []) => {
      const called = ids.map(Number)
      if (called.includes(DRAMA_ID) || called.includes(EPISODE_ID)) return '误把项目或集 ID 当成了分镜'
      return ''
    },
    activeWorkflowGroup: ref({ storyboard_ids: [STORYBOARD_ID] }),
    createWorkflowProductionGate: ref({ reason: '', serviceType: 'image' }),
    runWorkflowProductionGate: ref({ reason: '', serviceType: 'image' }),
    ...overrides,
  }
}

test('画布页把绑定袋交给 useDramaCanvasPageBindings，且不关闭 only-render-visible-elements', () => {
  assert.match(pageSource, /<CanvasPageChrome v-bind="pageChromeBindings"/)
  assert.match(pageSource, /v-bind="workspaceBindings"/)
  assert.match(pageSource, /v-bind="overlayHostBindings"/)
  assert.match(pageSource, /v-bind="loadFailureBindings"/)
  assert.match(pageSource, /useDramaCanvasPageBindings\(/)
  assert.match(bindingsSource, /createDramaCanvasChromeBindings\(/)
  assert.match(bindingsSource, /createDramaCanvasWorkspaceBindings\(/)
  assert.match(bindingsSource, /function goListMode\(\)/)
  assert.match(flowStageSource, /:only-render-visible-elements="true"/)
  assert.doesNotMatch(pageSource, /only-render-visible-elements="!focusedNodeId/)
  assert.doesNotMatch(bindingsSource, /only-render-visible-elements/)
})

test('动作禁用原因用集 ID 而不是项目 ID，缺集时即使项目 ID 有值也不能生成', () => {
  assert.notEqual(DRAMA_ID, EPISODE_ID)
  const scope = effectScope()
  try {
    const missingEpisode = scope.run(() => createDramaCanvasActionDisplay(makeActionCtx({
      filterEpisodeId: ref(null),
      currentEpisode: ref(null),
    })))
    assert.equal(missingEpisode.actionReasons.value.generateStoryboards, '请先选择一集')
    assert.equal(missingEpisode.actionReasons.value.batchImages, '请先选择一集')

    const billableIds = []
    const ready = scope.run(() => createDramaCanvasActionDisplay(makeActionCtx({
      getBillableMediaUnknownReason: (ids = []) => {
        billableIds.push(ids.map(Number))
        return ''
      },
    })))
    assert.equal(ready.actionReasons.value.generateStoryboards, '')
    assert.equal(ready.actionReasons.value.batchImages, '')
    assert.ok(billableIds.some((ids) => ids.includes(STORYBOARD_ID)))
    assert.equal(billableIds.some((ids) => ids.includes(DRAMA_ID) || ids.includes(EPISODE_ID)), false)
  } finally {
    scope.stop()
  }
})

test('列表模式跳转把项目 ID 放进路径、把集 ID 放进 query', () => {
  assert.notEqual(DRAMA_ID, EPISODE_ID)
  const pushed = []
  const { goListMode } = createDramaCanvasListModeNavigation({
    filterEpisodeId: ref(EPISODE_ID),
    routeEpisodeId: () => 99,
    projectListReturnTo: ref('/?q=夜雨'),
    router: { push: (loc) => pushed.push(loc) },
    dramaId: ref(DRAMA_ID),
    freeLibraryVisible: ref(true),
  })
  goListMode()
  assert.deepEqual(pushed, [{
    path: `/film/${DRAMA_ID}`,
    query: { episode: String(EPISODE_ID), returnTo: '/?q=夜雨' },
  }])
})

test('自由画布撤销按钮只在非只读自由模式可点', () => {
  const scope = effectScope()
  try {
    const free = scope.run(() => createDramaCanvasHistoryDisplay({
      freeHistoryRevision: ref(1),
      canvasMode: ref('free'),
      freeCanvasReadOnly: ref(false),
      canUndoFreeCanvasHistory: () => true,
      canRedoFreeCanvasHistory: () => false,
    }))
    assert.equal(free.canUndoFreeCanvas.value, true)
    assert.equal(free.canRedoFreeCanvas.value, false)

    const production = scope.run(() => createDramaCanvasHistoryDisplay({
      freeHistoryRevision: ref(1),
      canvasMode: ref('production'),
      freeCanvasReadOnly: ref(false),
      canUndoFreeCanvasHistory: () => true,
      canRedoFreeCanvasHistory: () => true,
    }))
    assert.equal(production.canUndoFreeCanvas.value, false)
    assert.equal(production.canRedoFreeCanvas.value, false)
  } finally {
    scope.stop()
  }
})

test('绑定袋透出的项目 ID 和集 ID 不相等，失败卡片映射 error 而不是混用 ID', () => {
  assert.notEqual(DRAMA_ID, EPISODE_ID)
  const scope = effectScope()
  try {
    const bags = scope.run(() => createDramaCanvasPageBindings({
      ...makeActionCtx(),
      freeHistoryRevision: ref(0),
      canvasMode: ref('production'),
      freeCanvasReadOnly: ref(false),
      canUndoFreeCanvasHistory: () => false,
      canRedoFreeCanvasHistory: () => false,
      routeEpisodeId: () => EPISODE_ID,
      projectListReturnTo: ref(''),
      router: { push() {} },
      dramaId: ref(DRAMA_ID),
      freeLibraryVisible: ref(false),
      freeCanvas: ref({ nodes: [], background: 'dots' }),
      nodes: ref([]),
      edges: ref([]),
      loading: ref(false),
      canvasLoadError: ref('画布服务暂时不可用'),
      canvasLoadNotFound: ref(false),
      retryCanvasProjectLoad: () => 'retry',
      goProjectList: () => 'list',
    }))
    assert.equal(bags.workspaceBindings.value.dramaId, DRAMA_ID)
    assert.equal(bags.overlayHostBindings.value.dramaId, DRAMA_ID)
    assert.equal(bags.pageChromeBindings.value.filterEpisodeId, EPISODE_ID)
    assert.notEqual(bags.workspaceBindings.value.dramaId, bags.pageChromeBindings.value.filterEpisodeId)
    assert.equal(bags.loadFailureBindings.value.error, '画布服务暂时不可用')
    assert.equal(bags.loadFailureBindings.value.retryCanvasProjectLoad(), 'retry')
    assert.equal(typeof bags.goListMode, 'function')
  } finally {
    scope.stop()
  }
})
