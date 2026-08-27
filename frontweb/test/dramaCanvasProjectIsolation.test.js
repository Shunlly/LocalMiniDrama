import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createCanvasHistory } from '../src/utils/canvasHistory.js'
import {
  cloneFreeSelection,
  createFreeNode,
  findFreeNodeSpawnPosition,
  normalizeFreeCanvas,
  removeFreeSelection,
  screenRectToFreeCanvasBounds,
  serializeFreeCanvas,
  synchronizeFreeCanvasSelection,
} from '../src/utils/freeCanvasState.js'
import {
  buildFreeCanvasStoryboardMediaItems,
  getFreeCanvasAssetSaveEligibility,
} from '../src/utils/freeCanvasMedia.js'
import * as freeCanvasMedia from '../src/utils/freeCanvasMedia.js'
import { createCanvasSaveCoordinator } from '../src/utils/canvasSaveCoordinator.js'

const canvasSource = readFileSync(new URL('../src/views/DramaCanvas.vue', import.meta.url), 'utf8')

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function extractFunction(name) {
  const asyncMarker = `async function ${name}`
  const syncMarker = `function ${name}`
  const start = canvasSource.indexOf(asyncMarker) >= 0
    ? canvasSource.indexOf(asyncMarker)
    : canvasSource.indexOf(syncMarker)
  assert.ok(start >= 0, `missing ${name}`)
  let parenthesisDepth = 0
  let bodyStart = -1
  for (let index = canvasSource.indexOf('(', start); index < canvasSource.length; index += 1) {
    if (canvasSource[index] === '(') parenthesisDepth += 1
    if (canvasSource[index] === ')') parenthesisDepth -= 1
    if (parenthesisDepth === 0 && canvasSource[index] === '{') {
      bodyStart = index
      break
    }
  }
  assert.ok(bodyStart >= 0, `missing ${name} body`)
  let depth = 0
  for (let index = bodyStart; index < canvasSource.length; index += 1) {
    if (canvasSource[index] === '{') depth += 1
    if (canvasSource[index] === '}') depth -= 1
    if (depth === 0) return canvasSource.slice(start, index + 1)
  }
  throw new Error(`unterminated ${name}`)
}

function loadCanvasFunctions(names, dependencies) {
  const dependencyNames = Object.keys(dependencies)
  const persistHelpers = [
    'mergeFailedCanvasSaveOperations',
    'canvasSaveOperationError',
    'subtractSuccessfulCanvasSaveOperation',
  ]
  let sourceNames = names.includes('persistCanvasState')
    ? [...persistHelpers.filter((name) => !names.includes(name)), ...names]
    : names
  const guardedActions = ['onAlignNodes', 'onCreateWorkflowGroup', 'onDeleteActiveGroup', 'onRunActiveGroup']
  if (names.some((name) => guardedActions.includes(name))) {
    sourceNames = [
      ...['currentCanvasProjectId', 'isCanvasProjectCurrent'].filter((name) => !sourceNames.includes(name)),
      ...sourceNames,
    ]
  }
  if (names.includes('onRunActiveGroup')) {
    sourceNames = [
      ...['isActiveWorkflowRun', 'isWorkflowAbortError'].filter((name) => !sourceNames.includes(name)),
      ...sourceNames,
    ]
  }
  return new Function(
    ...dependencyNames,
    `'use strict'; ${sourceNames.map(extractFunction).join('\n')}; return { ${names.join(', ')} };`,
  )(...dependencyNames.map((name) => dependencies[name]))
}

function loadCanvasFunction(name, dependencies) {
  const names = Object.keys(dependencies)
  const guardedActions = ['onAlignNodes', 'onCreateWorkflowGroup', 'onDeleteActiveGroup', 'onRunActiveGroup']
  const source = name === 'persistCanvasState'
    ? [
        extractFunction('mergeFailedCanvasSaveOperations'),
        extractFunction('canvasSaveOperationError'),
        extractFunction('subtractSuccessfulCanvasSaveOperation'),
        extractFunction(name),
      ].join('\n')
    : name === 'abandonCanvasSaveOperation'
      ? [extractFunction('canvasSaveOperationError'), extractFunction(name)].join('\n')
    : guardedActions.includes(name)
      ? [
          extractFunction('currentCanvasProjectId'),
          extractFunction('isCanvasProjectCurrent'),
          ...(name === 'onRunActiveGroup'
            ? [extractFunction('isActiveWorkflowRun'), extractFunction('isWorkflowAbortError')]
            : []),
          extractFunction(name),
        ].join('\n')
    : extractFunction(name)
  return new Function(
    ...names,
    `'use strict'; ${source}; return ${name};`,
  )(...names.map((name) => dependencies[name]))
}

function saveDependencies(overrides = {}) {
  return {
    canvasProjectId: { value: 101 },
    canvasInstanceActive: { value: true },
    dramaId: { value: 202 },
    nodes: { value: [] },
    currentViewport: { value: { x: 0, y: 0, zoom: 1 } },
    productionViewport: { value: { x: 0, y: 0, zoom: 1 } },
    freeCanvas: { value: { version: 1, mode: 'production', background: 'dots', viewport: { x: 0, y: 0, zoom: 1 }, nodes: [], edges: [] } },
    freeCanvasReadOnly: { value: false },
    canvasMode: { value: 'production' },
    layoutCache: { value: null },
    workflowGroups: { value: [] },
    canvasMutationRevision: 0,
    canvasSaveOperationId: 0,
    canvasSaveChain: Promise.resolve(),
    beginCanvasSaveSettlement: () => () => {},
    failedCanvasSaveOperation: { value: null },
    layoutSaveState: { value: 'idle' },
    layoutSaveError: { value: '' },
    layoutDirty: { value: true },
    saveTimer: null,
    savedHintTimer: null,
    buildCanvasLayoutPayload: () => ({ version: 1, nodes: {}, viewport: { x: 0, y: 0, zoom: 1 } }),
    serializeFreeCanvas: (value) => value,
    normalizeFreeCanvasForProject: (value) => value,
    mergeActiveCanvasGraphs: () => {},
    parseDramaMetadata: () => ({}),
    drama: { value: { id: 101, title: '项目 A', metadata: '{}' } },
    dramaAPI: { saveCanvasLayout: async () => ({ metadata: '{}' }) },
    runWithOwnedRequestErrorToast: (operation) => operation(),
    ElMessage: { error: () => {} },
    safeFreeCanvasError: (error, fallback) => String(error?.message || fallback),
    setTimeout,
    clearTimeout,
    Error,
    ...overrides,
  }
}

test('canvas project identity follows same-component route changes', () => {
  assert.match(canvasSource, /const canvasProjectId = computed\(\(\) => Number\(route\.params\.id\)\)/)
  assert.doesNotMatch(canvasSource, /const canvasProjectId = Number\(route\.params\.id\)/)
  assert.match(
    canvasSource,
    /watch\([\s\S]*?\(\) => \[String\(route\.params\.id \|\| ''\), routeFocusNodeId\(\), routeEpisodeId\(\)\][\s\S]*?startCanvasRouteSynchronization\(\{ resetProject \}\)/,
  )
  assert.match(canvasSource, /function resetCanvasProjectForRoute\(\)[\s\S]*?canvasEntityFocusRevision \+= 1[\s\S]*?cancelScheduledCanvasSave\(\)/)
  assert.match(canvasSource, /async function synchronizeCanvasRouteFocus[\s\S]*?resetCanvasProjectForRoute\(\)[\s\S]*?claimRouteEntityFocus\(\)[\s\S]*?ownsCanvasEntityFocus\(ownership\)/)
})

test('same-project focus and episode history updates must pass the shared navigation barrier', async () => {
  const route = { params: { id: '7' }, query: { episode: '11', focus: 'sb:101' } }
  let barrierCalls = 0
  let barrierResult = false
  const controller = loadCanvasFunctions([
    'routeFocusNodeId',
    'routeEpisodeId',
    'canvasRouteContext',
    'guardCanvasRouteUpdate',
  ], {
    route,
    runCanvasNavigationBarrier: async () => {
      barrierCalls += 1
      return barrierResult
    },
    String,
    Number,
  })

  assert.equal(await controller.guardCanvasRouteUpdate({
    params: { id: '7' },
    query: { episode: '11', focus: 'sb:101', ignored: 'yes' },
  }), true)
  assert.equal(barrierCalls, 0)

  assert.equal(await controller.guardCanvasRouteUpdate({
    params: { id: '7' },
    query: { episode: '12', focus: 'sb:101' },
  }), false)
  assert.equal(barrierCalls, 1)

  barrierResult = true
  assert.equal(await controller.guardCanvasRouteUpdate({
    params: { id: '7' },
    query: { episode: '11', focus: 'sb:202' },
  }), true)
  assert.equal(await controller.guardCanvasRouteUpdate({
    params: { id: '8' },
    query: { episode: '11', focus: 'sb:101' },
  }), true)
  assert.equal(barrierCalls, 3)
})

test('episode selector removes stale focus and waits for route restoration to finish', async () => {
  const synchronization = deferred()
  const route = {
    query: { episode: '11', focus: 'sb:101', returnTo: '/?status=draft' },
  }
  const replacements = []
  const requestEpisodeFilterChange = loadCanvasFunction('requestEpisodeFilterChange', {
    filterEpisodeId: { value: 11 },
    route,
    router: {
      async replace(location) {
        replacements.push(location)
      },
    },
    canvasRouteSynchronization: synchronization.promise,
    routeEpisodeId: (routeLike = route) => {
      const raw = Array.isArray(routeLike?.query?.episode)
        ? routeLike.query.episode[0]
        : routeLike?.query?.episode
      return raw == null || raw === '' ? null : Number(raw)
    },
    String,
    Number,
  })

  let settled = false
  const result = requestEpisodeFilterChange(12).then((value) => {
    settled = true
    return value
  })
  await Promise.resolve()

  assert.equal(settled, false)
  assert.deepEqual(replacements, [{
    query: { episode: '12', returnTo: '/?status=draft' },
  }])

  synchronization.resolve(true)
  assert.equal(await result, true)
})

test('canvas return path preserves route episode and focus before inspector hydration', () => {
  const route = {
    params: { id: '7' },
    query: { episode: '12', focus: 'free:text:alpha', ignored: 'removed-later' },
  }
  let resolvedLocation = null
  const controller = loadCanvasFunctions([
    'routeFocusNodeId',
    'routeEpisodeId',
    'buildCanvasReturnTo',
  ], {
    route,
    canvasMode: { value: 'free' },
    selectedFreeNodeId: { value: null },
    focusedNodeId: { value: null },
    dramaId: { value: 7 },
    router: {
      resolve(location) {
        resolvedLocation = structuredClone(location)
        return { fullPath: '/film/7/canvas?episode=12&focus=free:text:alpha' }
      },
    },
    String,
    Number,
  })

  assert.equal(
    controller.buildCanvasReturnTo(),
    '/film/7/canvas?episode=12&focus=free:text:alpha',
  )
  assert.equal(resolvedLocation.name, 'film-canvas')
  assert.deepEqual(resolvedLocation.params, { id: '7' })
  assert.equal(resolvedLocation.query.episode, '12')
  assert.equal(resolvedLocation.query.focus, 'free:text:alpha')

  controller.buildCanvasReturnTo('free:text:beta')
  assert.equal(resolvedLocation.query.focus, 'free:text:beta')
})

test('project reset cancels a pending autosave before the route identity changes', () => {
  const cleared = []
  const cancelScheduledCanvasSave = loadCanvasFunction('cancelScheduledCanvasSave', {
    saveTimer: 77,
    clearTimeout: (timer) => cleared.push(timer),
  })

  cancelScheduledCanvasSave()

  assert.deepEqual(cleared, [77])
})

function keyboardControllerHarness() {
  const initialState = normalizeFreeCanvas({
    mode: 'free',
    nodes: [
      { id: 'config-a', type: 'config', position: { x: 20, y: 20 } },
      { id: 'text-b', type: 'text', position: { x: 340, y: 20 }, content: 'B' },
    ],
    edges: [],
  })
  const freeCanvas = { value: initialState }
  const selectionWrites = []
  function trackedRef(name, initialValue) {
    let value = initialValue
    return {
      get value() { return value },
      set value(nextValue) {
        selectionWrites.push(name)
        value = nextValue
      },
    }
  }
  const nodes = trackedRef('visual-nodes', [
    { id: 'config-a', type: 'freeCanvas', selected: true },
    { id: 'text-b', type: 'freeCanvas', selected: false },
  ])
  const edges = trackedRef('visual-edges', [])
  const selectedFreeNodeIds = trackedRef('internal-nodes', ['config-a'])
  const selectedFreeEdgeIds = trackedRef('internal-edges', [])
  const selectedFreeNodeId = trackedRef('inspector-node', 'config-a')
  const history = createCanvasHistory(initialState)
  const inspectorTarget = {
    closest(selector) {
      return selector.includes('.free-canvas-inspector-dock') ? this : null
    },
  }
  const document = {
    activeElement: null,
    querySelector() {
      return {
        focus() { document.activeElement = inspectorTarget },
      }
    },
  }
  const nodeTarget = {
    closest(selector) {
      if (selector === '.vue-flow__node') return { dataset: { id: 'text-b' } }
      return null
    },
  }
  document.activeElement = nodeTarget

  const controller = loadCanvasFunctions([
    'isTypingTarget',
    'isEditableKeyTarget',
    'activateFreeCanvasNode',
    'removeFreeCanvasItems',
    'currentVisualFreeCanvasSelection',
    'syncVisualFreeCanvasSelection',
    'deleteFreeCanvasSelection',
    'copyFreeCanvasSelection',
    'pasteFreeCanvasSelection',
    'handleFreeCanvasKeydown',
    'undoFreeCanvas',
  ], {
    canvasMode: { value: 'free' },
    freeCanvasReadOnly: { value: false },
    freeCanvas,
    nodes,
    edges,
    selectedFreeNodeIds,
    selectedFreeEdgeIds,
    selectedFreeNodeId,
    editingFreeNodeId: { value: null },
    contextMenuVisible: { value: false },
    dramaId: { value: 7 },
    freeClipboard: null,
    freePasteCount: 0,
    cloneFreeSelection,
    serializeFreeCanvas,
    normalizeFreeCanvas,
    ElMessage: { warning() {} },
    isFreeCanvasNodeId: (id) => freeCanvas.value.nodes.some((node) => String(node.id) === String(id)),
    synchronizeFreeCanvasSelection,
    normalizeFreeCanvasForProject: normalizeFreeCanvas,
    removeFreeSelection,
    nextTick(callback) {
      callback?.()
      return Promise.resolve()
    },
    document,
    finishFreeCanvasNodeEditing() {},
    closeContextMenu() {},
    closeFreeCanvasInspector() {},
    commitFreeCanvasState(nextState, reason) {
      freeCanvas.value = history.commit(nextState, reason)
      const remaining = new Set(freeCanvas.value.nodes.map((node) => String(node.id)))
      nodes.value = [
        ...nodes.value.filter((node) => remaining.has(String(node.id))),
        ...freeCanvas.value.nodes
          .filter((node) => !nodes.value.some((item) => String(item.id) === String(node.id)))
          .map((node) => ({ id: node.id, type: 'freeCanvas', selected: true })),
      ]
    },
    freeCanvasHistory: history,
    applyFreeCanvasHistoryState(nextState) {
      freeCanvas.value = nextState
      nodes.value = nextState.nodes.map((node) => ({ id: node.id, type: 'freeCanvas', selected: false }))
    },
  })

  function keyEvent(key, target = document.activeElement) {
    return {
      key,
      target,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      defaultPrevented: false,
      propagationStopped: false,
      preventDefault() { this.defaultPrevented = true },
      stopPropagation() { this.propagationStopped = true },
    }
  }

  return {
    ...controller,
    document,
    edges,
    freeCanvas,
    keyEvent,
    nodeTarget,
    nodes,
    selectedFreeEdgeIds,
    selectedFreeNodeId,
    selectedFreeNodeIds,
    selectionWrites,
  }
}

for (const activationKey of ['Enter', ' ']) {
  test(`keyboard ${JSON.stringify(activationKey)} keeps focus on B, deletes only B, and undo restores B`, () => {
    const harness = keyboardControllerHarness()
    const activation = harness.keyEvent(activationKey, harness.nodeTarget)

    harness.handleFreeCanvasKeydown(activation)

    assert.equal(activation.defaultPrevented, true)
    assert.equal(harness.document.activeElement, harness.nodeTarget)
    assert.deepEqual(harness.nodes.value.filter((node) => node.selected).map((node) => node.id), ['text-b'])
    assert.deepEqual(harness.selectedFreeNodeIds.value, ['text-b'])
    assert.equal(harness.selectedFreeNodeId.value, 'text-b')
    assert.ok(
      harness.selectionWrites.indexOf('visual-nodes') < harness.selectionWrites.indexOf('inspector-node'),
      `selection write order: ${harness.selectionWrites.join(', ')}`,
    )

    const deletion = harness.keyEvent('Delete')
    harness.handleFreeCanvasKeydown(deletion)

    assert.equal(deletion.defaultPrevented, true)
    assert.deepEqual(harness.freeCanvas.value.nodes.map((node) => node.id), ['config-a'])

    harness.undoFreeCanvas()
    assert.deepEqual(harness.freeCanvas.value.nodes.map((node) => node.id), ['config-a', 'text-b'])
  })
}

test('shared deletion uses current visual selection instead of stale internal ids', () => {
  const harness = keyboardControllerHarness()
  harness.nodes.value = harness.nodes.value.map((node) => ({
    ...node,
    selected: node.id === 'text-b',
  }))
  harness.selectedFreeNodeIds.value = ['config-a']
  harness.selectedFreeNodeId.value = 'config-a'

  assert.equal(harness.deleteFreeCanvasSelection(), true)
  assert.deepEqual(harness.freeCanvas.value.nodes.map((node) => node.id), ['config-a'])
})

test('copy and paste use current visual selection even when a toolbar button is focused', () => {
  const harness = keyboardControllerHarness()
  harness.freeCanvas.value = normalizeFreeCanvas({
    ...harness.freeCanvas.value,
    edges: [{ id: 'edge-ab', source: 'config-a', target: 'text-b' }],
  })
  harness.nodes.value = harness.nodes.value.map((node) => ({ ...node, selected: true }))
  harness.selectedFreeNodeIds.value = []
  harness.selectedFreeNodeId.value = null

  const buttonTarget = {
    closest(selector) {
      return String(selector).split(',').map((item) => item.trim()).includes('button') ? this : null
    },
  }
  const copyEvent = harness.keyEvent('c', buttonTarget)
  copyEvent.ctrlKey = true
  harness.handleFreeCanvasKeydown(copyEvent)
  assert.equal(copyEvent.defaultPrevented, true)
  assert.deepEqual([...harness.selectedFreeNodeIds.value].sort(), ['config-a', 'text-b'])

  const pasteEvent = harness.keyEvent('v', buttonTarget)
  pasteEvent.ctrlKey = true
  harness.handleFreeCanvasKeydown(pasteEvent)
  assert.equal(pasteEvent.defaultPrevented, true)
  assert.equal(harness.freeCanvas.value.nodes.length, 4)
  assert.equal(harness.freeCanvas.value.edges.length, 2)
})

test('node creation aborts when the visible safe area has no open position', async () => {
  let createCalls = 0
  let commitCalls = 0
  const warnings = []
  const createFreeCanvasNode = loadCanvasFunction('createFreeCanvasNode', {
    canvasMode: { value: 'free' },
    freeCanvasReadOnly: { value: false },
    freeCanvas: { value: { nodes: [], edges: [] } },
    setCanvasMode: async () => {},
    ElMessage: { warning: (message) => warnings.push(message) },
    defaultFreeNodePosition: () => null,
    freeNodeDefaults: () => ({ title: '文本灵感' }),
    createFreeNode(type, overrides) {
      createCalls += 1
      return { id: `free:${type}:1`, type, ...overrides }
    },
    selectedFreeNodeId: { value: null },
    selectedFreeNodeIds: { value: [] },
    selectedFreeEdgeIds: { value: [] },
    commitFreeCanvasState() { commitCalls += 1 },
  })

  assert.equal(await createFreeCanvasNode('text'), null)
  assert.equal(createCalls, 0)
  assert.equal(commitCalls, 0)
  assert.equal(warnings.length, 1)
})

function realPlacementCreationHarness(screenRect) {
  const initial = normalizeFreeCanvas({
    mode: 'free',
    nodes: [{
      id: 'existing-node',
      type: 'text',
      position: { x: -1000, y: -1000 },
      content: 'existing',
    }],
    edges: [],
  })
  const freeCanvas = { value: initial }
  const nodes = {
    value: [{
      id: 'existing-node',
      position: { x: -1000, y: -1000 },
      dimensions: { width: 280, height: 208 },
    }],
  }
  const selectedFreeNodeId = { value: 'existing-node' }
  const selectedFreeNodeIds = { value: ['existing-node'] }
  const selectedFreeEdgeIds = { value: [] }
  const history = createCanvasHistory(initial)
  const warnings = []
  const commits = []
  const controller = loadCanvasFunctions([
    'freeCanvasSafeBounds',
    'defaultFreeNodePosition',
    'freeNodeDefaults',
    'createFreeCanvasNode',
  ], {
    canvasMainRef: {
      value: screenRect
        ? { getBoundingClientRect: () => screenRect }
        : null,
    },
    currentViewport: { value: { x: 0, y: 0, zoom: 2 } },
    screenRectToFreeCanvasBounds,
    findFreeNodeSpawnPosition,
    nodes,
    selectedFreeNodeId,
    selectedFreeNodeIds,
    selectedFreeEdgeIds,
    canvasMode: { value: 'free' },
    freeCanvas,
    setCanvasMode: async () => {},
    ElMessage: { warning: (message) => warnings.push(message) },
    createFreeNode,
    commitFreeCanvasState(nextState, reason) {
      commits.push(reason)
      freeCanvas.value = history.commit(normalizeFreeCanvas(nextState), reason)
    },
  })

  return {
    ...controller,
    commits,
    freeCanvas,
    history,
    nodes,
    selectedFreeEdgeIds,
    selectedFreeNodeId,
    selectedFreeNodeIds,
    warnings,
  }
}

test('high-zoom creation still places a node outside the tight measured bounds', async () => {
  const harness = realPlacementCreationHarness({
    left: 240,
    top: 0,
    right: 900,
    bottom: 720,
    width: 660,
    height: 720,
  })

  const result = await harness.createFreeCanvasNode('text', null, { id: 'new-node' })

  assert.equal(result.id, 'new-node')
  assert.equal(typeof result.position?.x, 'number')
  assert.equal(typeof result.position?.y, 'number')
  assert.deepEqual(harness.freeCanvas.value.nodes.map((node) => node.id), ['existing-node', 'new-node'])
  assert.equal(harness.history.canUndo(), true)
  assert.equal(harness.selectedFreeNodeId.value, 'new-node')
  assert.deepEqual(harness.selectedFreeNodeIds.value, ['new-node'])
  assert.deepEqual(harness.commits, ['create:text'])
  assert.deepEqual(harness.warnings, [])
})

test('real placement chain still creates a node when measured high-zoom geometry is sufficient', async () => {
  const harness = realPlacementCreationHarness({
    left: 240,
    top: 0,
    right: 1060,
    bottom: 900,
    width: 820,
    height: 900,
  })

  const result = await harness.createFreeCanvasNode('text', null, { id: 'new-node' })

  assert.equal(result.id, 'new-node')
  assert.deepEqual(result.position, { x: 36, y: 103 })
  assert.deepEqual(harness.freeCanvas.value.nodes.map((node) => node.id), ['existing-node', 'new-node'])
  assert.equal(harness.history.canUndo(), true)
  assert.equal(harness.selectedFreeNodeId.value, 'new-node')
  assert.deepEqual(harness.selectedFreeNodeIds.value, ['new-node'])
  assert.deepEqual(harness.selectedFreeEdgeIds.value, [])
  assert.deepEqual(harness.commits, ['create:text'])
  assert.deepEqual(harness.warnings, [])
})

test('real placement chain retains the legacy fallback when canvas geometry is unavailable', async () => {
  const harness = realPlacementCreationHarness(null)

  const result = await harness.createFreeCanvasNode('text', null, { id: 'new-node' })

  assert.equal(result.id, 'new-node')
  assert.deepEqual(result.position, { x: 80, y: 80 })
  assert.deepEqual(harness.commits, ['create:text'])
  assert.deepEqual(harness.warnings, [])
})

test('a canvas instance saves its layout only to the project captured when it was created', async () => {
  const savedProjectIds = []
  const persistCanvasState = loadCanvasFunction('persistCanvasState', saveDependencies({
    dramaAPI: {
      saveCanvasLayout: async (projectId) => {
        savedProjectIds.push(projectId)
        return { metadata: '{}' }
      },
    },
  }))

  await persistCanvasState({ layoutOnly: true })

  assert.deepEqual(savedProjectIds, [101])
})

test('canvas persistence rejects a route project that does not match the loaded drama', async () => {
  let saveCalls = 0
  const persistCanvasState = loadCanvasFunction('persistCanvasState', saveDependencies({
    canvasProjectId: { value: 202 },
    dramaId: { value: 202 },
    drama: { value: { id: 101, title: '项目 A', metadata: '{}' } },
    dramaAPI: {
      async saveCanvasLayout() {
        saveCalls += 1
        return { metadata: '{}' }
      },
    },
  }))

  assert.deepEqual(await persistCanvasState({ layoutOnly: true }), { ok: false, cancelled: true })
  assert.equal(saveCalls, 0)
})

test('production layout saves preserve an unsupported free canvas without sending a replacement', async () => {
  const calls = []
  const persistCanvasState = loadCanvasFunction('persistCanvasState', saveDependencies({
    freeCanvasReadOnly: { value: true },
    dramaAPI: {
      saveCanvasLayout: async (...args) => {
        calls.push(args)
        return { metadata: JSON.stringify({ free_canvas: { version: 2, future: true } }) }
      },
    },
  }))

  const result = await persistCanvasState({ layoutOnly: true })

  assert.equal(result.ok, true)
  assert.equal(calls.length, 1)
  assert.equal(calls[0][3], undefined)
})

test('a disposed canvas save neither mutates state nor reports its stale failure', async () => {
  const save = deferred()
  const canvasInstanceActive = { value: true }
  const layoutSaveState = { value: 'idle' }
  const messages = []
  let ownedRequestCalls = 0
  const persistCanvasState = loadCanvasFunction('persistCanvasState', saveDependencies({
    canvasInstanceActive,
    layoutSaveState,
    dramaAPI: { saveCanvasLayout: () => save.promise },
    runWithOwnedRequestErrorToast(operation) {
      ownedRequestCalls += 1
      return operation()
    },
    ElMessage: { error: (message) => messages.push(message) },
  }))

  const pendingSave = persistCanvasState({ layoutOnly: true, reportError: false })
  canvasInstanceActive.value = false
  save.reject(new Error('项目 A 保存失败'))

  assert.deepEqual(await pendingSave, { ok: false, cancelled: true })
  assert.equal(ownedRequestCalls, 1)
  assert.equal(layoutSaveState.value, 'saving')
  assert.deepEqual(messages, [])
})

test('accepted canvas saves reach the backend in snapshot order', async () => {
  const firstSave = deferred()
  const secondSave = deferred()
  const freeCanvas = {
    value: {
      version: 1,
      mode: 'free',
      background: 'dots',
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [{ id: 'free:text:1', type: 'text', position: { x: 0, y: 0 }, content: 'first' }],
      edges: [],
    },
  }
  const calls = []
  const persistCanvasState = loadCanvasFunction('persistCanvasState', saveDependencies({
    freeCanvas,
    canvasMode: { value: 'free' },
    dramaAPI: {
      saveCanvasLayout: async (...args) => {
        calls.push(args)
        return calls.length === 1 ? firstSave.promise : secondSave.promise
      },
    },
  }))

  const firstPending = persistCanvasState({ freeOnly: true })
  freeCanvas.value = {
    ...freeCanvas.value,
    nodes: [{ ...freeCanvas.value.nodes[0], content: 'second' }],
  }
  const secondPending = persistCanvasState({ freeOnly: true })

  await Promise.resolve()
  assert.equal(calls.length, 1)
  assert.equal(calls[0][3].nodes[0].content, 'first')

  firstSave.resolve({ metadata: '{}' })
  await firstPending
  await Promise.resolve()
  assert.equal(calls.length, 2)
  assert.equal(calls[1][3].nodes[0].content, 'second')

  secondSave.resolve({ metadata: '{}' })
  assert.equal((await secondPending).ok, true)
})

test('a queued retry is cancelled when a newer save supersedes its snapshot', async () => {
  const newerSave = deferred()
  const calls = []
  const failedCanvasSaveOperation = { value: null }
  const workflowGroups = { value: [{ id: 'group-a', label: 'G1' }] }
  const dependencies = saveDependencies({
    failedCanvasSaveOperation,
    workflowGroups,
    dramaAPI: {
      async saveCanvasLayout(...args) {
        calls.push(args)
        if (calls.length === 1) throw new Error('first save failed')
        if (calls.length === 2) return newerSave.promise
        return { metadata: '{}' }
      },
    },
  })
  const { persistCanvasState, retryCanvasSave } = loadCanvasFunctions(
    ['persistCanvasState', 'retryCanvasSave'],
    dependencies,
  )

  assert.equal((await persistCanvasState({ groupsOnly: true, reportError: false })).ok, false)
  workflowGroups.value = [{ id: 'group-a', label: 'G2' }]
  const newerPending = persistCanvasState({ groupsOnly: true, reportError: false })
  await Promise.resolve()
  const staleRetryPending = retryCanvasSave()

  newerSave.resolve({ metadata: '{}' })
  assert.equal((await newerPending).ok, true)
  assert.deepEqual(await staleRetryPending, { ok: false, cancelled: true })
  assert.equal(calls.length, 2)
  assert.deepEqual(calls[1][2], [{ id: 'group-a', label: 'G2' }])
  assert.equal(failedCanvasSaveOperation.value, null)
})

test('save failure keeps a sanitized reason until a successful retry clears it', async () => {
  const layoutSaveState = { value: 'idle' }
  const layoutSaveError = { value: '' }
  let shouldFail = true
  const dependencies = saveDependencies({
    layoutSaveState,
    layoutSaveError,
    dramaAPI: {
      async saveCanvasLayout() {
        if (shouldFail) throw new Error('本地保存暂时不可用')
        return { metadata: '{}' }
      },
    },
  })
  const { persistCanvasState, retryCanvasSave } = loadCanvasFunctions(
    ['persistCanvasState', 'retryCanvasSave'],
    dependencies,
  )

  assert.equal((await persistCanvasState({ layoutOnly: true, reportError: false })).ok, false)
  assert.equal(layoutSaveState.value, 'error')
  assert.equal(layoutSaveError.value, '本地保存暂时不可用')

  shouldFail = false
  const retryPending = retryCanvasSave()
  const retryResult = await (retryPending || new Promise((resolve) => setImmediate(() => resolve({ ok: true }))))
  assert.equal(retryResult.ok, true)
  assert.equal(layoutSaveState.value, 'saved')
  assert.equal(layoutSaveError.value, '')
})

test('layout retry replays the exact failed layout and free-canvas snapshots', async () => {
  const calls = []
  let shouldFail = true
  const failedCanvasSaveOperation = { value: null }
  const layoutSaveError = { value: '' }
  let buildCalls = 0
  const layoutSource = { version: 1, nodes: { a: { x: 12, y: 34 } }, viewport: { x: 1, y: 2, zoom: 1 } }
  const freeCanvas = {
    value: {
      version: 1,
      mode: 'free',
      background: 'dots',
      viewport: { x: 3, y: 4, zoom: 1 },
      nodes: [{ id: 'free:text:1', type: 'text', position: { x: 0, y: 0 }, content: 'first' }],
      edges: [],
    },
  }
  const dependencies = saveDependencies({
    failedCanvasSaveOperation,
    layoutSaveError,
    freeCanvas,
    canvasMode: { value: 'free' },
    buildCanvasLayoutPayload: () => {
      buildCalls += 1
      return layoutSource
    },
    dramaAPI: {
      async saveCanvasLayout(...args) {
        calls.push(structuredClone(args))
        if (shouldFail) throw new Error('layout failed')
        return { metadata: '{}' }
      },
    },
  })
  const { persistCanvasState, retryCanvasSave } = loadCanvasFunctions(
    ['persistCanvasState', 'retryCanvasSave'],
    dependencies,
  )

  assert.equal((await persistCanvasState({ layoutOnly: true, reportError: false })).ok, false)
  const firstPayloads = calls[0].slice(1)
  layoutSource.nodes.a.x = 999
  freeCanvas.value.nodes[0].content = 'second'
  shouldFail = false

  const retryPending = retryCanvasSave()
  await (retryPending || new Promise((resolve) => setImmediate(resolve)))

  assert.deepEqual(calls[1].slice(1), firstPayloads)
  assert.equal(buildCalls, 1)
  assert.equal(failedCanvasSaveOperation.value, null)
  assert.equal(layoutSaveError.value, '')
})

test('group retry replays the exact failed group snapshot and no other save scope', async () => {
  const calls = []
  let shouldFail = true
  const failedCanvasSaveOperation = { value: null }
  const layoutSaveError = { value: '' }
  const workflowGroups = { value: [{ id: 'group-a', storyboardIds: [1, 2] }] }
  const dependencies = saveDependencies({
    failedCanvasSaveOperation,
    layoutSaveError,
    workflowGroups,
    dramaAPI: {
      async saveCanvasLayout(...args) {
        calls.push(structuredClone(args))
        if (shouldFail) throw new Error('groups failed')
        return { metadata: '{}' }
      },
    },
  })
  const { persistCanvasState, retryCanvasSave } = loadCanvasFunctions(
    ['persistCanvasState', 'retryCanvasSave'],
    dependencies,
  )

  assert.equal((await persistCanvasState({ groupsOnly: true, reportError: false })).ok, false)
  workflowGroups.value[0].storyboardIds.push(3)
  shouldFail = false

  const retryPending = retryCanvasSave()
  await (retryPending || new Promise((resolve) => setImmediate(resolve)))

  assert.deepEqual(calls[1].slice(1), [null, [{ id: 'group-a', storyboardIds: [1, 2] }], undefined])
  assert.equal(failedCanvasSaveOperation.value, null)
  assert.equal(layoutSaveError.value, '')
})

test('a newer successful save supersedes the retained failed snapshot', async () => {
  let shouldFail = true
  const failedCanvasSaveOperation = { value: null }
  const layoutSaveState = { value: 'idle' }
  const layoutSaveError = { value: '' }
  const dependencies = saveDependencies({
    failedCanvasSaveOperation,
    layoutSaveState,
    layoutSaveError,
    dramaAPI: {
      async saveCanvasLayout() {
        if (shouldFail) throw new Error('layout failed')
        return { metadata: '{}' }
      },
    },
  })
  const { persistCanvasState } = loadCanvasFunctions(['persistCanvasState'], dependencies)

  assert.equal((await persistCanvasState({ layoutOnly: true, reportError: false })).ok, false)
  shouldFail = false
  assert.equal((await persistCanvasState({ layoutOnly: true, reportError: false })).ok, true)

  assert.equal(failedCanvasSaveOperation.value, null)
  assert.equal(layoutSaveError.value, '')
  assert.equal(layoutSaveState.value, 'saved')
})

test('a free-only success keeps an older failed layout snapshot retryable', async () => {
  let saveCalls = 0
  const failedCanvasSaveOperation = { value: null }
  const layoutSaveState = { value: 'idle' }
  const layoutSaveError = { value: '' }
  const dependencies = saveDependencies({
    failedCanvasSaveOperation,
    layoutSaveState,
    layoutSaveError,
    dramaAPI: {
      async saveCanvasLayout() {
        saveCalls += 1
        if (saveCalls === 1) throw new Error('layout failed')
        return { metadata: '{}' }
      },
    },
  })
  const { persistCanvasState } = loadCanvasFunctions(['persistCanvasState'], dependencies)

  assert.equal((await persistCanvasState({ layoutOnly: true, reportError: false })).ok, false)
  const retainedFailure = failedCanvasSaveOperation.value
  assert.equal((await persistCanvasState({ freeOnly: true, reportError: false })).ok, true)

  assert.notEqual(failedCanvasSaveOperation.value, retainedFailure)
  assert.equal(failedCanvasSaveOperation.value.writesLayout, true)
  assert.equal(failedCanvasSaveOperation.value.writesFreeCanvas, false)
  assert.equal(failedCanvasSaveOperation.value.freeCanvasPayload, undefined)
  assert.equal(layoutSaveError.value, 'layout failed')
  assert.equal(layoutSaveState.value, 'error')
})

test('failures from different save scopes merge into one complete retry snapshot', async () => {
  let saveCalls = 0
  const requests = []
  const failedCanvasSaveOperation = { value: null }
  const workflowGroups = { value: [{ id: 'group-a', storyboardIds: [1, 2] }] }
  const layout = { version: 1, nodes: { a: { x: 40, y: 80 } } }
  const dependencies = saveDependencies({
    failedCanvasSaveOperation,
    workflowGroups,
    buildCanvasLayoutPayload: () => layout,
    dramaAPI: {
      async saveCanvasLayout(...args) {
        requests.push(args)
        saveCalls += 1
        if (saveCalls <= 2) throw new Error('save failed')
        return { metadata: '{}' }
      },
    },
  })
  const { persistCanvasState, retryCanvasSave } = loadCanvasFunctions(
    ['mergeFailedCanvasSaveOperations', 'persistCanvasState', 'retryCanvasSave'],
    dependencies,
  )

  assert.equal((await persistCanvasState({ groupsOnly: true, reportError: false })).ok, false)
  assert.equal((await persistCanvasState({ layoutOnly: true, reportError: false })).ok, false)
  const mergedFailure = failedCanvasSaveOperation.value

  assert.equal(mergedFailure.writesLayout, true)
  assert.equal(mergedFailure.writesGroups, true)
  assert.deepEqual(mergedFailure.layoutPayload, layout)
  assert.deepEqual(mergedFailure.groupsPayload, workflowGroups.value)
  assert.equal((await retryCanvasSave()).ok, true)
  assert.deepEqual(requests[2].slice(1, 3), [layout, workflowGroups.value])
  assert.equal(failedCanvasSaveOperation.value, null)
})

test('a successful scope restores the error reason for the failure that remains', async () => {
  let saveCalls = 0
  const failedCanvasSaveOperation = { value: null }
  const layoutSaveError = { value: '' }
  const workflowGroups = { value: [{ id: 'group-a', storyboardIds: [1] }] }
  const dependencies = saveDependencies({
    failedCanvasSaveOperation,
    layoutSaveError,
    workflowGroups,
    safeFreeCanvasError: (error) => error.message,
    dramaAPI: {
      async saveCanvasLayout() {
        saveCalls += 1
        if (saveCalls === 1) throw new Error('layout L failed')
        if (saveCalls === 2) throw new Error('groups G failed')
        return { metadata: '{}' }
      },
    },
  })
  const { persistCanvasState } = loadCanvasFunctions(['persistCanvasState'], dependencies)

  assert.equal((await persistCanvasState({ layoutOnly: true, reportError: false })).ok, false)
  assert.equal(layoutSaveError.value, 'layout L failed')
  assert.equal((await persistCanvasState({ groupsOnly: true, reportError: false })).ok, false)
  assert.equal(layoutSaveError.value, 'groups G failed')
  workflowGroups.value = [{ id: 'group-a', storyboardIds: [1, 2] }]
  assert.equal((await persistCanvasState({ groupsOnly: true, reportError: false })).ok, true)

  assert.equal(failedCanvasSaveOperation.value.writesLayout, true)
  assert.equal(failedCanvasSaveOperation.value.writesGroups, false)
  assert.equal(layoutSaveError.value, 'layout L failed')
})

test('abandoning a rolled-back group save removes only that failed intent', () => {
  const failedCanvasSaveOperation = {
    value: Object.freeze({
      targetDramaId: 101,
      writesLayout: true,
      writesGroups: true,
      writesFreeCanvas: false,
      layoutOperationId: 7,
      groupsOperationId: 9,
      layoutPayload: { version: 1 },
      groupsPayload: [{ id: 'rolled-back-order' }],
    }),
  }
  const layoutSaveState = { value: 'error' }
  const layoutSaveError = { value: 'save failed' }
  const abandonCanvasSaveOperation = loadCanvasFunction('abandonCanvasSaveOperation', {
    failedCanvasSaveOperation,
    layoutSaveState,
    layoutSaveError,
    Object,
  })

  abandonCanvasSaveOperation({
    targetDramaId: 101,
    writesGroups: true,
    groupsOperationId: 9,
  })

  assert.equal(failedCanvasSaveOperation.value.writesLayout, true)
  assert.equal(failedCanvasSaveOperation.value.writesGroups, false)
  assert.deepEqual(failedCanvasSaveOperation.value.layoutPayload, { version: 1 })
  assert.equal(failedCanvasSaveOperation.value.groupsPayload, undefined)
  assert.equal(layoutSaveState.value, 'error')
  assert.equal(layoutSaveError.value, 'save failed')
})

test('abandoning the last failed intent clears retry UI state', () => {
  const operation = Object.freeze({
    targetDramaId: 101,
    writesLayout: false,
    writesGroups: true,
    writesFreeCanvas: false,
    groupsOperationId: 9,
    groupsPayload: [{ id: 'rolled-back-order' }],
  })
  const failedCanvasSaveOperation = { value: operation }
  const layoutSaveState = { value: 'error' }
  const layoutSaveError = { value: 'save failed' }
  const abandonCanvasSaveOperation = loadCanvasFunction('abandonCanvasSaveOperation', {
    failedCanvasSaveOperation,
    layoutSaveState,
    layoutSaveError,
    Object,
  })

  abandonCanvasSaveOperation(operation)

  assert.equal(failedCanvasSaveOperation.value, null)
  assert.equal(layoutSaveState.value, 'idle')
  assert.equal(layoutSaveError.value, '')
})

test('a failed request from the previous project cannot pollute the active project', async () => {
  const pendingSave = deferred()
  const canvasProjectId = { value: 101 }
  const failedCanvasSaveOperation = { value: null }
  const layoutSaveState = { value: 'idle' }
  const layoutSaveError = { value: '' }
  const dependencies = saveDependencies({
    canvasProjectId,
    failedCanvasSaveOperation,
    layoutSaveState,
    layoutSaveError,
    dramaAPI: { saveCanvasLayout: () => pendingSave.promise },
  })
  const { persistCanvasState } = loadCanvasFunctions(
    ['mergeFailedCanvasSaveOperations', 'persistCanvasState'],
    dependencies,
  )

  const save = persistCanvasState({ groupsOnly: true, reportError: false })
  canvasProjectId.value = 202
  layoutSaveState.value = 'idle'
  pendingSave.reject(new Error('old project failed'))

  assert.deepEqual(await save, { ok: false, cancelled: true })
  assert.equal(failedCanvasSaveOperation.value, null)
  assert.equal(layoutSaveState.value, 'idle')
  assert.equal(layoutSaveError.value, '')
})

test('a stale unrelated failure keeps the retained retry state visible', async () => {
  const laterSave = deferred()
  let saveCalls = 0
  const failedCanvasSaveOperation = { value: null }
  const layoutSaveState = { value: 'idle' }
  const layoutSaveError = { value: '' }
  const dependencies = saveDependencies({
    failedCanvasSaveOperation,
    layoutSaveState,
    layoutSaveError,
    setTimeout: () => 1,
    clearTimeout: () => {},
    dramaAPI: {
      async saveCanvasLayout() {
        saveCalls += 1
        if (saveCalls === 1) throw new Error('first failed')
        return laterSave.promise
      },
    },
  })
  const { persistCanvasState, scheduleLayoutSave } = loadCanvasFunctions(
    ['persistCanvasState', 'cancelScheduledCanvasSave', 'scheduleLayoutSave'],
    dependencies,
  )

  assert.equal((await persistCanvasState({ layoutOnly: true, reportError: false })).ok, false)
  const retainedFailure = failedCanvasSaveOperation.value
  const retainedReason = layoutSaveError.value
  const pending = persistCanvasState({ layoutOnly: true, reportError: false })
  scheduleLayoutSave()
  laterSave.reject(new Error('stale failed'))
  assert.equal((await pending).ok, false)

  assert.equal(failedCanvasSaveOperation.value, retainedFailure)
  assert.equal(layoutSaveError.value, retainedReason)
  assert.equal(layoutSaveState.value, 'error')
})

test('canvas errors never expose password, cookie, client_secret, or arbitrary backend text', () => {
  const safeFreeCanvasError = loadCanvasFunction('safeFreeCanvasError', {})
  const fallback = '保存失败，请重试'
  for (const message of [
    'password=hunter2',
    'Cookie: session=private-value',
    'client_secret=top-secret',
    'database host internal-db-01 refused the request',
  ]) {
    const result = safeFreeCanvasError(new Error(message), fallback)
    assert.equal(result, fallback)
    assert.equal(result.includes(message), false)
  }
})

test('save-as-asset refreshes current-project inventory and aborts when media is stale', async () => {
  const freeCanvas = {
    value: {
      nodes: [{
        id: 'free:image:1',
        type: 'image',
        title: '旧图片',
        storageKey: 'dramas/7/frame.png',
      }],
      edges: [],
    },
  }
  const projectAssets = {
    value: [{ id: 10, drama_id: 7, type: 'image', local_path: 'dramas/7/frame.png' }],
  }
  let assetCreates = 0
  let assetRefreshes = 0
  let mediaRefreshes = 0
  const warnings = []
  const saveFreeCanvasNodeAsAsset = loadCanvasFunction('saveFreeCanvasNodeAsAsset', {
    freeInspectorBusy: { value: false },
    freeInspectorAction: { value: '' },
    freeCanvas,
    dramaId: { value: 7 },
    canvasInstanceActive: { value: true },
    drama: { value: { id: 7, episodes: [] } },
    filterEpisodeId: { value: null },
    projectAssets,
    imagesBySbId: { value: {} },
    videosBySbId: { value: {} },
    mediaStatusBySbId: { value: {} },
    getFreeCanvasAssetSaveEligibility,
    buildFreeCanvasStoryboardMediaItems,
    async loadProjectAssets() {
      assetRefreshes += 1
      projectAssets.value = []
    },
    async loadForDrama() { mediaRefreshes += 1 },
    persistCanvasState: async () => ({ ok: true }),
    assetsAPI: {
      async create() {
        assetCreates += 1
        return { id: 11, drama_id: 7 }
      },
    },
    ElMessage: {
      warning: (message) => warnings.push(message),
      error: () => {},
      success: () => {},
    },
    commitFreeCanvasState() {},
    safeFreeCanvasError: (_error, fallback) => fallback,
    Number,
  })

  await saveFreeCanvasNodeAsAsset({ id: 'free:image:1' })

  assert.equal(assetRefreshes, 1)
  assert.equal(mediaRefreshes, 1)
  assert.equal(assetCreates, 0)
  assert.equal(warnings.length, 1)
})

function freeCanvasDropHarness() {
  const dragType = freeCanvasMedia.FREE_CANVAS_MEDIA_DRAG_TYPE
  const libraryItem = {
    id: 44,
    drama_id: 7,
    type: 'image',
    local_path: 'dramas/7/frame.png',
  }
  const additions = []
  const uploads = []
  const controller = loadCanvasFunctions(['screenToFlowPosition', 'onFreeCanvasDrop'], {
    canvasMode: { value: 'free' },
    dramaId: { value: 7 },
    canvasMainRef: {
      value: { getBoundingClientRect: () => ({ left: 100, top: 50 }) },
    },
    currentViewport: { value: { x: -200, y: 100, zoom: 2 } },
    projectAssets: { value: [libraryItem] },
    freeStoryboardMediaItems: { value: [] },
    FREE_CANVAS_MEDIA_DRAG_TYPE: dragType,
    parseFreeCanvasMediaDragPayload: freeCanvasMedia.parseFreeCanvasMediaDragPayload,
    createFreeNodeFromLibraryItem: (item, position) => additions.push({ item, position }),
    uploadFreeCanvasFiles: (files, position) => uploads.push({ files, position }),
  })
  function eventFor({ raw = '', projectId = 7, files = [] } = {}) {
    const payload = raw || JSON.stringify({
      version: 1,
      projectId,
      kind: 'project-asset',
      mediaId: '44',
    })
    return {
      clientX: 500,
      clientY: 350,
      defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true },
      dataTransfer: {
        files,
        types: files.length ? ['Files'] : [dragType],
        getData: (type) => type === dragType ? payload : '',
      },
    }
  }
  return { ...controller, additions, eventFor, libraryItem, uploads }
}

test('structured media drop uses transformed position and the click-equivalent library path', () => {
  const harness = freeCanvasDropHarness()
  const event = harness.eventFor()

  harness.onFreeCanvasDrop(event)

  assert.equal(event.defaultPrevented, true)
  assert.deepEqual(harness.additions, [{
    item: harness.libraryItem,
    position: { x: 300, y: 100 },
  }])
  assert.deepEqual(harness.uploads, [])
})

test('structured media drop rejects foreign and malformed payloads', () => {
  const harness = freeCanvasDropHarness()

  harness.onFreeCanvasDrop(harness.eventFor({ projectId: 8 }))
  harness.onFreeCanvasDrop(harness.eventFor({ raw: '{bad json' }))

  assert.deepEqual(harness.additions, [])
  assert.deepEqual(harness.uploads, [])
})

test('file drop still uploads files at the transformed position', () => {
  const harness = freeCanvasDropHarness()
  const file = { name: 'frame.png', type: 'image/png' }
  const event = harness.eventFor({ files: [file] })

  harness.onFreeCanvasDrop(event)

  assert.equal(event.defaultPrevented, true)
  assert.deepEqual(harness.uploads, [{ files: [file], position: { x: 300, y: 100 } }])
  assert.deepEqual(harness.additions, [])
})

test('a failed canvas flush blocks navigation when discard is cancelled', async () => {
  let confirmations = 0
  const flushCanvasSaveBeforeLeave = loadCanvasFunction('flushCanvasSaveBeforeLeave', {
    canvasProjectId: { value: 101 },
    layoutDirty: { value: true },
    failedCanvasSaveOperation: { value: null },
    hasPendingCanvasSaves: () => false,
    waitForCanvasSaveSettlement: async () => {},
    saveTimer: null,
    clearTimeout,
    cancelScheduledCanvasSave: () => {},
    retryCanvasSave: async () => ({ ok: true }),
    persistCanvasState: async () => ({
      ok: false,
      cancelled: false,
      error: new Error('save failed'),
    }),
    ElMessageBox: {
      async confirm() {
        confirmations += 1
        throw new Error('stay on page')
      },
    },
  })

  assert.equal(await flushCanvasSaveBeforeLeave(), false)
  assert.equal(confirmations, 1)
})

test('confirming discard clears pending save intent before component teardown', async () => {
  const layoutDirty = { value: true }
  const failedCanvasSaveOperation = { value: { targetDramaId: 101, writesLayout: true } }
  const layoutSaveState = { value: 'error' }
  const layoutSaveError = { value: 'save failed' }
  const flushCanvasSaveBeforeLeave = loadCanvasFunction('flushCanvasSaveBeforeLeave', {
    canvasProjectId: { value: 101 },
    layoutDirty,
    failedCanvasSaveOperation,
    layoutSaveState,
    layoutSaveError,
    hasPendingCanvasSaves: () => false,
    waitForCanvasSaveSettlement: async () => {},
    cancelScheduledCanvasSave: () => {},
    retryCanvasSave: async () => ({ ok: false, error: new Error('still failed') }),
    persistCanvasState: async () => ({ ok: false, error: new Error('still failed') }),
    ElMessageBox: { confirm: async () => {} },
  })

  assert.equal(await flushCanvasSaveBeforeLeave(), true)
  assert.equal(layoutDirty.value, false)
  assert.equal(failedCanvasSaveOperation.value, null)
  assert.equal(layoutSaveState.value, 'idle')
  assert.equal(layoutSaveError.value, '')
})

test('leaving retries a failed non-layout save even when the layout is clean', async () => {
  let retries = 0
  const failedOperation = { targetDramaId: 101, writesGroups: true }
  const flushCanvasSaveBeforeLeave = loadCanvasFunction('flushCanvasSaveBeforeLeave', {
    canvasProjectId: { value: 101 },
    layoutDirty: { value: false },
    failedCanvasSaveOperation: { value: failedOperation },
    hasPendingCanvasSaves: () => false,
    waitForCanvasSaveSettlement: async () => {},
    cancelScheduledCanvasSave: () => {},
    retryCanvasSave: async () => {
      retries += 1
      return { ok: true }
    },
    persistCanvasState: async () => ({ ok: true }),
    ElMessageBox: { confirm: async () => {} },
  })

  assert.equal(await flushCanvasSaveBeforeLeave(), true)
  assert.equal(retries, 1)
})

test('leaving waits for an in-flight non-layout save to settle', async () => {
  const dependencies = {
    canvasSaveCoordinator: createCanvasSaveCoordinator(),
    canvasProjectId: { value: 101 },
    layoutDirty: { value: false },
    failedCanvasSaveOperation: { value: null },
    cancelScheduledCanvasSave: () => {},
    retryCanvasSave: async () => ({ ok: true }),
    persistCanvasState: async () => ({ ok: true }),
    ElMessageBox: { confirm: async () => {} },
    Number,
    Promise,
  }
  const {
    beginCanvasSaveSettlement,
    flushCanvasSaveBeforeLeave,
  } = loadCanvasFunctions([
    'beginCanvasSaveSettlement',
    'hasPendingCanvasSaves',
    'waitForCanvasSaveSettlement',
    'flushCanvasSaveBeforeLeave',
  ], dependencies)
  const completeSave = beginCanvasSaveSettlement(101)
  let leaveSettled = false
  const leaving = flushCanvasSaveBeforeLeave().then((result) => {
    leaveSettled = true
    return result
  })

  await Promise.resolve()
  assert.equal(leaveSettled, false)
  completeSave()

  assert.equal(await leaving, true)
})

test('a superseded cancelled retry does not show a false data-loss warning', async () => {
  let confirmations = 0
  const failedCanvasSaveOperation = { value: { targetDramaId: 101, writesGroups: true } }
  const flushCanvasSaveBeforeLeave = loadCanvasFunction('flushCanvasSaveBeforeLeave', {
    canvasProjectId: { value: 101 },
    layoutDirty: { value: false },
    failedCanvasSaveOperation,
    cancelScheduledCanvasSave: () => {},
    waitForCanvasSaveSettlement: async () => {},
    retryCanvasSave: async () => {
      failedCanvasSaveOperation.value = null
      return { ok: false, cancelled: true }
    },
    persistCanvasState: async () => ({ ok: true }),
    ElMessageBox: { async confirm() { confirmations += 1 } },
  })

  assert.equal(await flushCanvasSaveBeforeLeave(), true)
  assert.equal(confirmations, 0)
})

test('beforeunload warns when only a failed non-layout save remains', () => {
  const event = {
    defaultPrevented: false,
    returnValue: undefined,
    preventDefault() { this.defaultPrevented = true },
  }
  const handleCanvasBeforeUnload = loadCanvasFunction('handleCanvasBeforeUnload', {
    hasFocusedNodePendingWork: () => false,
    layoutDirty: { value: false },
    failedCanvasSaveOperation: { value: { writesGroups: true } },
    freeCanvasUploading: { value: false },
  })

  handleCanvasBeforeUnload(event)

  assert.equal(event.defaultPrevented, true)
  assert.equal(event.returnValue, '')
})

test('beforeunload warns while the current project has an in-flight save', () => {
  const event = {
    defaultPrevented: false,
    returnValue: undefined,
    preventDefault() { this.defaultPrevented = true },
  }
  const handleCanvasBeforeUnload = loadCanvasFunction('handleCanvasBeforeUnload', {
    hasFocusedNodePendingWork: () => false,
    hasPendingCanvasSaves: (projectId) => projectId === 101,
    canvasProjectId: { value: 101 },
    layoutDirty: { value: false },
    failedCanvasSaveOperation: { value: null },
    freeCanvasUploading: { value: false },
  })

  handleCanvasBeforeUnload(event)

  assert.equal(event.defaultPrevented, true)
  assert.equal(event.returnValue, '')
})

function canvasWorkflowActionDependencies(overrides = {}) {
  return {
    canvasProjectId: { value: 101 },
    drama: { value: { id: 101 } },
    canvasMode: { value: 'production' },
    selectedStoryboardIds: { value: [11] },
    pipelineSteps: { value: ['image'] },
    workflowGroups: { value: [] },
    activeGroupId: { value: null },
    ensureProductionPipelineReady: () => true,
    createWorkflowGroup: (groups, input) => [...groups, { id: 'group-new', ...input }],
    deleteWorkflowGroup: (groups, id) => groups.filter((group) => group.id !== id),
    normalizePipeline: (steps) => steps,
    persistCanvasState: async () => ({ ok: true }),
    rebuildGraph: () => {},
    ElMessageBox: {
      prompt: async () => ({ value: '新工作流' }),
      confirm: async () => {},
    },
    ElMessage: { warning: () => {}, success: () => {} },
    Number,
    ...overrides,
  }
}

test('workflow creation aborts when its prompt resolves in another project', async () => {
  const canvasProjectId = { value: 101 }
  let persists = 0
  let successes = 0
  const workflowGroups = { value: [] }
  const onCreateWorkflowGroup = loadCanvasFunction('onCreateWorkflowGroup', canvasWorkflowActionDependencies({
    canvasProjectId,
    workflowGroups,
    persistCanvasState: async () => { persists += 1; return { ok: true } },
    ElMessageBox: {
      async prompt() {
        canvasProjectId.value = 202
        return { value: '旧项目工作流' }
      },
    },
    ElMessage: { warning: () => {}, success: () => { successes += 1 } },
  }))

  await onCreateWorkflowGroup()

  assert.deepEqual(workflowGroups.value, [])
  assert.equal(persists, 0)
  assert.equal(successes, 0)
})

test('workflow creation and deletion reject an already mismatched route and loaded project', async () => {
  let prompts = 0
  let confirmations = 0
  let persists = 0
  const workflowGroups = { value: [{ id: 'group-a', storyboard_ids: [11] }] }
  const activeGroupId = { value: 'group-a' }
  const dependencies = canvasWorkflowActionDependencies({
    canvasProjectId: { value: 202 },
    drama: { value: { id: 101 } },
    workflowGroups,
    activeGroupId,
    persistCanvasState: async () => { persists += 1; return { ok: true } },
    ElMessageBox: {
      async prompt() { prompts += 1; return { value: 'wrong project' } },
      async confirm() { confirmations += 1 },
    },
  })
  const { onCreateWorkflowGroup, onDeleteActiveGroup } = loadCanvasFunctions(
    ['onCreateWorkflowGroup', 'onDeleteActiveGroup'],
    dependencies,
  )

  await onCreateWorkflowGroup()
  await onDeleteActiveGroup()

  assert.equal(prompts, 0)
  assert.equal(confirmations, 0)
  assert.equal(persists, 0)
  assert.deepEqual(workflowGroups.value, [{ id: 'group-a', storyboard_ids: [11] }])
})

test('workflow create and delete never report success after save failure', async () => {
  let rebuilds = 0
  const successes = []
  const workflowGroups = { value: [{ id: 'group-a', storyboard_ids: [11] }] }
  const activeGroupId = { value: 'group-a' }
  const dependencies = canvasWorkflowActionDependencies({
    workflowGroups,
    activeGroupId,
    persistCanvasState: async () => ({ ok: false, error: new Error('save failed') }),
    rebuildGraph: () => { rebuilds += 1 },
    ElMessage: { warning: () => {}, success: (message) => successes.push(message) },
  })
  const { onCreateWorkflowGroup, onDeleteActiveGroup } = loadCanvasFunctions(
    ['onCreateWorkflowGroup', 'onDeleteActiveGroup'],
    dependencies,
  )

  await onCreateWorkflowGroup()
  await onDeleteActiveGroup()

  assert.equal(rebuilds, 0)
  assert.deepEqual(successes, [])
})

function alignActionDependencies(overrides = {}) {
  return {
    canvasProjectId: { value: 101 },
    drama: { value: { id: 101 } },
    nodes: { value: [{ id: 'node-a', position: { x: 0, y: 0 } }] },
    aligningNodes: { value: false },
    canvasMode: { value: 'production' },
    setFocusedCanvasNode: async () => true,
    computeAutoLayoutPositions: () => ({ positions: { 'node-a': { x: 100, y: 80 } } }),
    filterEpisodeId: { value: null },
    workflowGroups: { value: [] },
    imagesBySbId: { value: {} },
    videosBySbId: { value: {} },
    syncProductionGraphPositions: () => {},
    layoutCache: { value: null },
    nextTick: async () => {},
    canvasFlowApi: { value: null },
    MIN_READABLE_CANVAS_ZOOM: 0.3,
    onViewportChange: () => {},
    persistCanvasState: async () => ({ ok: true }),
    ElMessage: { info: () => {}, success: () => {}, error: () => {} },
    Number,
    ...overrides,
  }
}

test('auto-align aborts after an awaited project switch', async () => {
  const canvasProjectId = { value: 101 }
  let persists = 0
  let successes = 0
  const onAlignNodes = loadCanvasFunction('onAlignNodes', alignActionDependencies({
    canvasProjectId,
    setFocusedCanvasNode: async () => {
      canvasProjectId.value = 202
      return true
    },
    persistCanvasState: async () => { persists += 1; return { ok: true } },
    ElMessage: { info: () => {}, success: () => { successes += 1 }, error: () => {} },
  }))

  await onAlignNodes()

  assert.equal(persists, 0)
  assert.equal(successes, 0)
})

test('auto-align rejects an already mismatched route and loaded project', async () => {
  let focusCalls = 0
  let layoutCalls = 0
  let persists = 0
  const nodes = { value: [{ id: 'node-a', position: { x: 0, y: 0 } }] }
  const onAlignNodes = loadCanvasFunction('onAlignNodes', alignActionDependencies({
    canvasProjectId: { value: 202 },
    drama: { value: { id: 101 } },
    nodes,
    setFocusedCanvasNode: async () => { focusCalls += 1; return true },
    computeAutoLayoutPositions: () => { layoutCalls += 1; return { positions: {} } },
    persistCanvasState: async () => { persists += 1; return { ok: true } },
  }))

  await onAlignNodes()

  assert.equal(focusCalls, 0)
  assert.equal(layoutCalls, 0)
  assert.equal(persists, 0)
  assert.deepEqual(nodes.value, [{ id: 'node-a', position: { x: 0, y: 0 } }])
})

function workflowRunDependencies(overrides = {}) {
  return {
    canvasProjectId: { value: 101 },
    drama: { value: { id: 101, episodes: [] } },
    canvasMode: { value: 'production' },
    workflowGroups: { value: [{ id: 'group-a', storyboard_ids: [11] }] },
    activeGroupId: { value: 'group-a' },
    activeWorkflowSteps: { value: ['image'] },
    ensureProductionPipelineReady: () => true,
    pipelineTouchesBillableMedia: () => false,
    ensureKnownStoryboardMedia: () => true,
    ElMessageBox: { confirm: async () => {} },
    workflowRunning: { value: false },
    workflowRunStarting: { value: false },
    workflowProgress: { value: '' },
    workflowRunSequence: 0,
    activeWorkflowRun: { value: null },
    workflowOutcomeUnknown: { value: false },
    AbortController,
    runWorkflowGroup: async () => ({ ok: [11], failed: [] }),
    getCanvasGenerationOptions: () => ({}),
    loadCanvasProject: async () => true,
    findStoryboardInDrama: () => ({ storyboard: { id: 11 } }),
    ElMessage: { warning: () => {}, error: () => {}, success: () => {} },
    Number,
    ...overrides,
  }
}

test('whole-group run rejects an already mismatched route and loaded project', async () => {
  let confirms = 0
  let runs = 0
  const onRunActiveGroup = loadCanvasFunction('onRunActiveGroup', workflowRunDependencies({
    canvasProjectId: { value: 202 },
    drama: { value: { id: 101, episodes: [] } },
    ElMessageBox: { confirm: async () => { confirms += 1 } },
    runWorkflowGroup: async () => { runs += 1; return { ok: [], failed: [] } },
  }))

  await onRunActiveGroup()

  assert.equal(confirms, 0)
  assert.equal(runs, 0)
})

test('whole-group run aborts when confirmation resolves in another project', async () => {
  const canvasProjectId = { value: 101 }
  let runs = 0
  const onRunActiveGroup = loadCanvasFunction('onRunActiveGroup', workflowRunDependencies({
    canvasProjectId,
    ElMessageBox: {
      async confirm() {
        canvasProjectId.value = 202
      },
    },
    runWorkflowGroup: async () => { runs += 1; return { ok: [], failed: [] } },
  }))

  await onRunActiveGroup()

  assert.equal(runs, 0)
})

test('whole-group run admits only one confirmation and one billable execution at a time', async () => {
  const confirmation = deferred()
  let confirms = 0
  let runs = 0
  const warnings = []
  const dependencies = workflowRunDependencies({
    ElMessageBox: {
      async confirm() {
        confirms += 1
        return confirmation.promise
      },
    },
    runWorkflowGroup: async () => {
      runs += 1
      return { ok: [11], failed: [] }
    },
    ElMessage: { warning: (message) => warnings.push(message), error: () => {}, success: () => {} },
  })
  const onRunActiveGroup = loadCanvasFunction('onRunActiveGroup', dependencies)

  const first = onRunActiveGroup()
  await Promise.resolve()
  const second = onRunActiveGroup()
  await Promise.resolve()

  assert.equal(confirms, 1)
  assert.equal(runs, 0)
  assert.deepEqual(warnings, ['工作流正在启动或执行，请等待当前任务完成'])

  confirmation.resolve()
  await Promise.all([first, second])
  assert.equal(runs, 1)
})

test('whole-group run passes an abort signal and detached callbacks cannot update the page', async () => {
  const running = deferred()
  const progress = []
  const errors = []
  let capturedHooks
  const dependencies = workflowRunDependencies({
    runWorkflowGroup: async (_drama, _group, hooks) => {
      capturedHooks = hooks
      return running.promise
    },
    workflowProgress: {
      get value() { return progress.at(-1) || '' },
      set value(next) { progress.push(next) },
    },
    ElMessage: { warning: () => {}, success: () => {}, error: (message) => errors.push(message) },
  })
  const onRunActiveGroup = loadCanvasFunction('onRunActiveGroup', dependencies)

  const pending = onRunActiveGroup()
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(capturedHooks.signal instanceof AbortSignal, true)

  dependencies.activeWorkflowRun.value = null
  capturedHooks.onStepStart({ storyboardId: 11, step: 'image' })
  capturedHooks.onStoryboardError({ storyboardId: 11, error: new Error('late error') })
  assert.equal(progress.some((value) => value.includes('分镜 #11')), false)
  assert.deepEqual(errors, [])

  running.resolve({ ok: [11], failed: [] })
  await pending
})

test('beforeunload warns while a whole-group workflow is running', () => {
  const event = {
    defaultPrevented: false,
    returnValue: undefined,
    preventDefault() { this.defaultPrevented = true },
  }
  const handleCanvasBeforeUnload = loadCanvasFunction('handleCanvasBeforeUnload', {
    hasFocusedNodePendingWork: () => false,
    layoutDirty: { value: false },
    failedCanvasSaveOperation: { value: null },
    hasPendingCanvasSaves: () => false,
    canvasProjectId: { value: 101 },
    freeCanvasUploading: { value: false },
    workflowRunning: { value: true },
  })

  handleCanvasBeforeUnload(event)

  assert.equal(event.defaultPrevented, true)
  assert.equal(event.returnValue, '')
})

test('route navigation can detach from a whole-group workflow with an explicit billing warning', async () => {
  const controller = new AbortController()
  const workflowRunning = { value: true }
  const workflowProgress = { value: '生成中' }
  const activeWorkflowRun = { value: { token: 7, controller } }
  const confirmations = []
  const ensureWorkflowFinished = loadCanvasFunction('ensureWorkflowFinished', {
    workflowRunning,
    workflowProgress,
    activeWorkflowRun,
    ElMessageBox: {
      async confirm(message, title) { confirmations.push({ message, title }) },
    },
  })

  assert.equal(await ensureWorkflowFinished(), true)
  assert.equal(controller.signal.aborted, true)
  assert.equal(activeWorkflowRun.value, null)
  assert.equal(workflowRunning.value, false)
  assert.equal(workflowProgress.value, '')
  assert.match(confirmations[0].message, /后台任务及供应商计费可能继续/)
  assert.match(confirmations[0].title, /工作流仍在执行/)
})

test('route navigation stays put when workflow detach is cancelled', async () => {
  const controller = new AbortController()
  const activeWorkflowRun = { value: { token: 7, controller } }
  const ensureWorkflowFinished = loadCanvasFunction('ensureWorkflowFinished', {
    workflowRunning: { value: true },
    workflowProgress: { value: '生成中' },
    activeWorkflowRun,
    ElMessageBox: { confirm: async () => { throw new Error('stay') } },
  })

  assert.equal(await ensureWorkflowFinished(), false)
  assert.equal(controller.signal.aborted, false)
  assert.notEqual(activeWorkflowRun.value, null)
})

test('navigation barrier awaits the workflow detach decision before continuing', async () => {
  let uploadChecks = 0
  const runCanvasNavigationBarrier = loadCanvasFunction('runCanvasNavigationBarrier', {
    canvasProjectId: { value: 101 },
    canvasSaveCoordinator: {
      runNavigationBarrier(_projectId, barrier) { return barrier() },
    },
    ensureWorkflowFinished: async () => false,
    ensureNodeGenerationFinished: async () => true,
    ensureFreeCanvasUploadFinished: () => { uploadChecks += 1; return true },
    confirmFocusedNodeLeave: async () => true,
    flushCanvasSaveBeforeLeave: async () => true,
    Number,
  })

  assert.equal(await runCanvasNavigationBarrier(), false)
  assert.equal(uploadChecks, 0)
})

test('auto-align never reports success after its layout save fails', async () => {
  let successes = 0
  const onAlignNodes = loadCanvasFunction('onAlignNodes', alignActionDependencies({
    persistCanvasState: async () => ({ ok: false, error: new Error('save failed') }),
    ElMessage: { info: () => {}, success: () => { successes += 1 }, error: () => {} },
  }))

  await onAlignNodes()

  assert.equal(successes, 0)
})

test('a disposed canvas ignores a late project load before it can replace state', async () => {
  const request = deferred()
  const canvasInstanceActive = { value: true }
  const drama = { value: null }
  const loadCanvasProject = loadCanvasFunction('loadCanvasProject', {
    canvasInstanceActive,
    isCanvasReady: { value: false },
    dramaId: { value: 101 },
    canvasLoadRequestId: 0,
    loading: { value: false },
    canvasLoadState: { value: 'idle' },
    canvasLoadError: { value: '' },
    canvasLoadNotFound: { value: false },
    coreCanvasDramaAPI: { get: () => request.promise },
    drama,
    layoutCache: { value: null },
    parseCanvasLayout: () => null,
    syncWorkflowFromDrama: () => {},
    resolveViewport: () => ({ x: 0, y: 0, zoom: 1 }),
    currentViewport: { value: null },
    route: { query: {} },
    filterEpisodeId: { value: null },
    loadForDrama: async () => {},
    rebuildGraph: () => {},
    friendlyCanvasProjectLoadError: (error) => error.message,
    nextTick: async () => {},
    canvasLoadFailureRef: { value: null },
    Number,
  })

  const pendingLoad = loadCanvasProject()
  canvasInstanceActive.value = false
  request.resolve({ id: 101, metadata: '{}' })

  assert.equal(await pendingLoad, false)
  assert.equal(drama.value, null)
})
