import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { effectScope, ref } from 'vue'

import { createDramaCanvasDerivedState, PANEL_NODE_TYPES } from '../src/components/dramaCanvas/dramaCanvasDerivedState.js'
import { createDramaCanvasPaneEvents } from '../src/components/dramaCanvas/dramaCanvasFocusSync.js'
import { createDramaCanvasContextMenu } from '../src/components/dramaCanvas/dramaCanvasContextMenu.js'
import {
  createDramaCanvasBatchGenerate,
} from '../src/components/dramaCanvas/dramaCanvasBatchGenerate.js'
import { createDramaCanvasNavigation } from '../src/components/dramaCanvas/dramaCanvasNavigation.js'
import { createDramaCanvasLeaveHelpers } from '../src/components/dramaCanvas/dramaCanvasLeaveHelpers.js'

const pageSource = readFileSync(new URL('../src/views/DramaCanvas.vue', import.meta.url), 'utf8')
const pageBindingsSource = readFileSync(new URL('../src/composables/useDramaCanvasPageBindings.js', import.meta.url), 'utf8')
const displayStateSource = readFileSync(new URL('../src/composables/useDramaCanvasDisplayState.js', import.meta.url), 'utf8')
const derivedSource = readFileSync(new URL('../src/components/dramaCanvas/dramaCanvasDerivedState.js', import.meta.url), 'utf8')
const focusSource = readFileSync(new URL('../src/components/dramaCanvas/dramaCanvasFocusSync.js', import.meta.url), 'utf8')
const menuSource = readFileSync(new URL('../src/components/dramaCanvas/dramaCanvasContextMenu.js', import.meta.url), 'utf8')
const batchSource = readFileSync(new URL('../src/components/dramaCanvas/dramaCanvasBatchGenerate.js', import.meta.url), 'utf8')
const navSource = readFileSync(new URL('../src/components/dramaCanvas/dramaCanvasNavigation.js', import.meta.url), 'utf8')
const leaveSource = readFileSync(new URL('../src/components/dramaCanvas/dramaCanvasLeaveHelpers.js', import.meta.url), 'utf8')
const leaveProtectionSource = readFileSync(new URL('../src/components/dramaCanvas/dramaCanvasLeaveProtection.js', import.meta.url), 'utf8')
const routeFocusSource = readFileSync(new URL('../src/components/dramaCanvas/dramaCanvasRouteFocus.js', import.meta.url), 'utf8')
const projectActionsSource = readFileSync(new URL('../src/components/dramaCanvas/dramaCanvasProjectActions.js', import.meta.url), 'utf8')

test('画布页把派生状态、焦点、右键、批处理和跳转接到新模块', () => {
  assert.match(pageSource, /createDramaCanvasDerivedState\(/)
  assert.match(pageSource, /createDramaCanvasFocusSync\(/)
  assert.match(pageSource, /createDramaCanvasPaneEvents\(/)
  assert.match(pageSource, /createDramaCanvasContextMenu\(/)
  assert.match(pageSource, /createDramaCanvasProductionGates\(/)
  assert.match(pageSource, /createDramaCanvasBatchGenerate\(/)
  assert.match(pageSource, /createDramaCanvasNavigation\(/)
  assert.match(pageSource, /createDramaCanvasLeaveHelpers\(/)
  assert.match(pageSource, /createDramaCanvasLeaveProtection\(/)
  assert.match(pageSource, /createDramaCanvasRouteFocus\(/)
  assert.match(pageSource, /createDramaCanvasProjectActions\(/)
  assert.match(pageSource, /useDramaCanvasDisplayState\(/)
  assert.match(pageSource, /useDramaCanvasPageBindings\(/)
  assert.match(pageBindingsSource, /function goListMode\(\)/)
  assert.match(displayStateSource, /function currentCanvasProjectId\(\)/)
  assert.match(leaveProtectionSource, /function handleCanvasBeforeUnload\(/)
  assert.match(routeFocusSource, /function requestEpisodeFilterChange\(/)
  assert.match(routeFocusSource, /function startCanvasRouteSynchronization\(/)
  assert.match(projectActionsSource, /function buildCanvasReturnTo\(/)
  assert.match(derivedSource, /const focusedInspectorNode = computed\(/)
  assert.match(derivedSource, /PANEL_NODE_TYPES\.has\(node\.type\)/)
  assert.match(focusSource, /async function onPaneClick\([\s\S]*\.canvas-inspector-dock[\s\S]*\.free-canvas-inspector-dock/)
  assert.match(focusSource, /await setFocusedCanvasNode\(null, \{ restoreFocus: true \}\)/)
  assert.match(menuSource, /function onPaneContextMenu\(/)
  assert.match(batchSource, /function cancelEpisodeGenerate\(\) \{[\s\S]*abortEpisodeGenerate\(\)/)
  assert.match(batchSource, /if \(!ensureProductionStepReady\('video'\)\) return/)
  assert.match(navSource, /function goMediaLibrary\(\)[\s\S]*returnTo: buildCanvasReturnTo\(\)/)
  assert.match(leaveSource, /素材正在上传，请等待完成后再离开/)
})

test('检查器派生状态只认带面板的节点类型', () => {
  const scope = effectScope()
  try {
    const focusedNodeId = ref('sb:11')
    const bag = scope.run(() => createDramaCanvasDerivedState({
      canvasProjectId: ref(7),
      canvasLoadState: ref('ready'),
      drama: ref({ id: 7, title: '夜雨', episodes: [] }),
      layoutCache: ref(null),
      projectAssets: ref([]),
      freeCanvas: ref({ nodes: [], edges: [], background: 'dots', viewport: { x: 0, y: 0, zoom: 1 } }),
      selectedFreeNodeIds: ref([]),
      selectedFreeNodeId: ref(null),
      focusedNodeId,
      nodes: ref([
        { id: 'sb:11', type: 'canvasStoryboard' },
        { id: 'label:1', type: 'canvasLabel' },
      ]),
      canvasMode: ref('production'),
      imagesBySbId: ref({}),
      videosBySbId: ref({}),
      mediaStatusBySbId: ref({}),
      filterEpisodeId: ref(null),
      workflowGroups: ref([]),
      activeGroupId: ref(null),
      pipelineSteps: ref(['image']),
      productionReadinessState: ref({ status: 'loading', data: null }),
      freeCanvasVideoCapability: ref({ ready: false }),
    }))
    assert.equal(bag.focusedInspectorNode.value.id, 'sb:11')
    assert.equal(PANEL_NODE_TYPES.has('canvasLabel'), false)
    focusedNodeId.value = 'label:1'
    assert.equal(bag.focusedInspectorNode.value, null)
  } finally {
    scope.stop()
  }
})

test('空白点击会清焦点，检查器内部点击会忽略', async () => {
  const calls = []
  const {
    onPaneClick,
  } = createDramaCanvasPaneEvents({
    paneClickSuppressed: { value: false },
    closeFreeCanvasInspector: (opts) => calls.push(['close', opts]),
    finishFreeCanvasNodeEditing: () => calls.push(['finish']),
    selectedFreeNodeIds: { value: ['free:1'] },
    selectedFreeEdgeIds: { value: ['e1'] },
    setFocusedCanvasNode: async (id, options) => { calls.push(['focus', id, options]); return true },
    closeContextMenu: () => calls.push(['menu']),
    isFreeCanvasNodeId: () => false,
    canvasMode: { value: 'production' },
    openFreeCanvasInspectorFor() {},
    startFreeCanvasNodeEditing() {},
    openCreateDialog() {},
    restoreFocusedNodeSelection() {},
    selectSidebarAsset() {},
    activeGroupId: { value: null },
    workflowGroups: { value: [] },
    navigateToStoryboard() {},
  })

  await onPaneClick({ target: { closest: (sel) => sel === '.canvas-inspector-dock' ? {} : null } })
  assert.deepEqual(calls, [])

  await onPaneClick({ target: { closest: () => null } })
  assert.deepEqual(calls, [
    ['close', { restoreFocus: false }],
    ['finish'],
    ['focus', null, { restoreFocus: true }],
    ['menu'],
  ])
})

test('右键菜单只在制作模式打开创建对话框', () => {
  const opened = []
  const canvasMode = { value: 'production' }
  const contextMenuVisible = { value: true }
  const contextMenuFlowPos = { value: { x: 8, y: 12 } }
  const pendingFlowPosition = { value: null }
  const menu = createDramaCanvasContextMenu({
    paneClickSuppressed: { value: false },
    screenToFlowPosition: () => ({ x: 1, y: 2 }),
    contextMenuFlowPos,
    contextMenuX: { value: 0 },
    contextMenuY: { value: 0 },
    contextMenuVisible,
    canvasMode,
    pendingFlowPosition,
    openCreateDialog: (type, pos) => opened.push([type, pos]),
    createFreeCanvasNode() {},
  })
  menu.onContextMenuSelect('storyboard')
  assert.deepEqual(opened, [['storyboard', { x: 8, y: 12 }]])
  assert.equal(contextMenuVisible.value, false)

  canvasMode.value = 'free'
  contextMenuVisible.value = true
  menu.onContextMenuSelect('storyboard')
  assert.equal(opened.length, 1)
  assert.equal(contextMenuVisible.value, false)
})

test('批量生成视频会先走制作门闩', async () => {
  const runs = []
  const warnings = []
  const { batchGenerateVideos, cancelEpisodeGenerate } = createDramaCanvasBatchGenerate({
    abortEpisodeGenerate: () => runs.push('abort'),
    canvasMode: { value: 'production' },
    currentEpisode: { value: { storyboards: [{ id: 11 }] } },
    filterEpisodeId: { value: 3 },
    drama: { value: { episodes: [] } },
    requestEpisodeFilterChange: async () => true,
    setFocusedCanvasNode: async () => true,
    runAiGenerateStoryboards: async () => {},
    runBatchGenerateImages: async () => {},
    runBatchGenerateVideos: async () => { runs.push('videos') },
    ensureKnownStoryboardMedia: () => true,
    ensureProductionStepReady: (step) => {
      runs.push(['gate', step])
      return false
    },
  })
  await batchGenerateVideos()
  assert.deepEqual(runs, [['gate', 'video']])
  cancelEpisodeGenerate()
  assert.deepEqual(runs, [['gate', 'video'], 'abort'])
})

test('没有上传中的素材时离开屏障直接放行', () => {
  const { ensureFreeCanvasUploadFinished } = createDramaCanvasLeaveHelpers({
    episodeGenerating: { value: false },
    abortEpisodeGenerate() {},
    nodeGenerationCoordinator: { hasActive: () => false, stopWaiting() {} },
    freeCanvasUploading: { value: false },
  })
  assert.equal(ensureFreeCanvasUploadFinished(), true)
})

test('媒体库跳转带上画布 returnTo', () => {
  const pushed = []
  const { goMediaLibrary } = createDramaCanvasNavigation({
    router: { push: (loc) => pushed.push(loc) },
    projectListReturnTo: { value: '' },
    dramaId: { value: 7 },
    buildCanvasReturnTo: () => '/film/7/canvas?episode=12',
  })
  goMediaLibrary()
  assert.deepEqual(pushed, [{
    name: 'media-library',
    query: { returnTo: '/film/7/canvas?episode=12' },
  }])
})
