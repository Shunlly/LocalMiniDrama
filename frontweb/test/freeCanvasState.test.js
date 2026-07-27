import test from 'node:test'
import assert from 'node:assert/strict'
import { createCanvasHistory } from '../src/utils/canvasHistory.js'
import { buildFreeCanvasGraph } from '../src/utils/freeCanvasAdapter.js'
import * as freeCanvasState from '../src/utils/freeCanvasState.js'
import {
  createEmptyFreeCanvas,
  normalizeFreeCanvas,
  serializeFreeCanvas,
  createFreeNode,
  createFreeEdge,
  removeFreeSelection,
  cloneFreeSelection,
  findFreeNodeSpawnPosition,
  inspectFreeCanvasCompatibility,
} from '../src/utils/freeCanvasState.js'

test('keyboard activation synchronizes visual and internal selection before delete and undo', () => {
  assert.equal(typeof freeCanvasState.synchronizeFreeCanvasSelection, 'function')
  const initial = normalizeFreeCanvas({
    mode: 'free',
    nodes: [
      { id: 'config-a', type: 'config', position: { x: 20, y: 20 } },
      { id: 'text-b', type: 'text', position: { x: 340, y: 20 }, content: 'B' },
    ],
    edges: [],
  })
  const history = createCanvasHistory(initial)
  const graph = buildFreeCanvasGraph(initial, { selectedNodeIds: ['config-a'] })

  const activated = freeCanvasState.synchronizeFreeCanvasSelection(graph.nodes, 'text-b')
  assert.equal(activated.focusedNodeId, 'text-b')
  assert.deepEqual(activated.nodeIds, ['text-b'])
  assert.deepEqual(activated.edgeIds, [])
  assert.deepEqual(
    activated.nodes.filter((node) => node.selected).map((node) => node.id),
    ['text-b'],
  )

  const afterDelete = history.commit(removeFreeSelection(initial, activated.nodeIds), 'delete')
  assert.deepEqual(afterDelete.nodes.map((node) => node.id), ['config-a'])
  assert.deepEqual(history.undo().nodes.map((node) => node.id), ['config-a', 'text-b'])
})

test('normalizes an absent free canvas without changing production metadata', () => {
  const state = normalizeFreeCanvas(null)
  assert.equal(state.version, 1)
  assert.equal(state.mode, 'production')
  assert.deepEqual(state.nodes, [])
  assert.deepEqual(state.edges, [])
})

test('drops invalid edge references without mutating valid nodes', () => {
  const input = {
    nodes: [{ id: 'n1', type: 'text', content: 'kept' }],
    edges: [{ id: 'e1', source: 'n1', target: 'missing' }],
  }
  const state = normalizeFreeCanvas(input)
  assert.equal(state.nodes[0].content, 'kept')
  assert.deepEqual(state.edges, [])
  assert.equal(input.edges.length, 1)
})

test('rejects unsupported versions and unknown node types without downgrading data', () => {
  const future = {
    version: 2,
    mode: 'free',
    nodes: [{ id: 'future', type: 'future-generator', content: 'must survive' }],
    edges: [],
    future_setting: { enabled: true },
  }
  const compatibility = inspectFreeCanvasCompatibility(future)
  assert.equal(compatibility.compatible, false)
  assert.equal(compatibility.code, 'UNSUPPORTED_VERSION')
  assert.throws(
    () => normalizeFreeCanvas(future),
    (error) => error?.code === 'UNSUPPORTED_VERSION',
  )
  assert.equal(future.version, 2)
  assert.equal(future.nodes[0].type, 'future-generator')

  assert.throws(
    () => normalizeFreeCanvas({
      version: 1,
      nodes: [{ id: 'unknown', type: 'future-generator' }],
      edges: [],
    }),
    (error) => error?.code === 'UNSUPPORTED_NODE_TYPE',
  )
})

test('rejects oversized text without truncating the caller state', () => {
  const content = 'x'.repeat(50001)
  const input = { nodes: [{ id: 'n1', type: 'text', content }], edges: [] }
  assert.throws(
    () => normalizeFreeCanvas(input),
    (error) => error?.code === 'TEXT_LIMIT_EXCEEDED',
  )
  assert.equal(input.nodes[0].content.length, 50001)
})

test('serialization contains no runtime URLs or undefined fields', () => {
  const value = serializeFreeCanvas(createEmptyFreeCanvas({
    nodes: [{
      type: 'image',
      url: 'blob:runtime',
      dataUrl: 'data:image/png;base64,abc',
      storageKey: 'stored-image',
      asset_ref: 'asset-1',
      storyboard_ref: 'storyboard-1',
      description: [undefined, 'kept'],
    }],
  }))
  const serialized = JSON.stringify(value)
  assert.equal(serialized.includes('blob:'), false)
  assert.equal(serialized.includes('data:image'), false)
  assert.equal(serialized.includes('undefined'), false)
  assert.equal(value.nodes[0].storageKey, 'stored-image')
  assert.equal(value.nodes[0].asset_ref, 'asset-1')
  assert.equal(value.nodes[0].storyboard_ref, 'storyboard-1')
  assert.deepEqual(value.nodes[0].description, ['kept'])
})

test('drops nested credentials, headers, and provider responses from public state', () => {
  const state = normalizeFreeCanvas({
    apiKey: 'top-secret',
    nodes: [{
      id: 'n1',
      type: 'image',
      content: 'safe',
      metadata: {
        apiKey: 'nested-secret',
        headers: { authorization: 'Bearer secret' },
        providerResponse: { raw: 'provider payload' },
      },
    }],
    edges: [{
      id: 'e1',
      source: 'n1',
      target: 'n1',
      requestHeaders: { authorization: 'Bearer edge-secret' },
      rawProviderResponse: { token: 'edge-token' },
    }],
  })
  const serialized = JSON.stringify(state)
  assert.equal(serialized.includes('secret'), false)
  assert.equal(serialized.includes('provider'), false)
  assert.equal(serialized.includes('apiKey'), false)
  assert.deepEqual(state.nodes[0], {
    id: 'n1',
    type: 'image',
    content: 'safe',
    position: { x: 0, y: 0 },
  })
  assert.deepEqual(state.edges[0], { id: 'e1', source: 'n1', target: 'n1' })
})

test('returns JSON-compatible values for hostile input types and cycles', () => {
  const cyclic = {}
  cyclic.self = cyclic
  const state = normalizeFreeCanvas({
    nodes: [{
      id: 'n1',
      type: 'text',
      content: 1n,
      label: () => 'not-json',
      title: Symbol('not-json'),
      metadata: cyclic,
      position: { x: Infinity, y: Symbol('bad') },
    }],
  })
  assert.doesNotThrow(() => JSON.stringify(state))
  assert.deepEqual(state.nodes[0].position, { x: 0, y: 0 })
  assert.equal(Object.hasOwn(state.nodes[0], 'metadata'), false)
  assert.equal(Object.hasOwn(state.nodes[0], 'content'), false)
  assert.equal(Object.hasOwn(state.nodes[0], 'label'), false)
  assert.equal(Object.hasOwn(state.nodes[0], 'title'), false)
})

test('preserves bounded config operation state without persisting provider secrets', () => {
  const state = serializeFreeCanvas({
    nodes: [{
      id: 'config-1',
      type: 'config',
      position: { x: 10, y: 20 },
      status: 'failed',
      metadata: {
        lastError: '上次生成失败',
        operationId: 'operation-1',
        startedAt: '2026-07-27T08:00:00.000Z',
        apiKey: 'secret',
        providerResponse: { authorization: 'Bearer secret' },
        arbitrary: 'drop-me',
      },
    }],
    edges: [],
  })

  assert.equal(state.nodes[0].status, 'failed')
  assert.deepEqual(state.nodes[0].metadata, {
    lastError: '上次生成失败',
    operationId: 'operation-1',
    startedAt: '2026-07-27T08:00:00.000Z',
  })
  assert.equal(JSON.stringify(state).includes('secret'), false)
  assert.equal(JSON.stringify(state).includes('drop-me'), false)
})

test('rejects node and edge limits without mutating source arrays', () => {
  const input = {
    nodes: Array.from({ length: 501 }, (_, index) => ({ id: `n${index}`, type: 'text' })),
    edges: Array.from({ length: 1001 }, (_, index) => ({
      id: `e${index}`,
      source: 'n0',
      target: 'n1',
    })),
  }
  const compatibility = inspectFreeCanvasCompatibility(input)
  assert.equal(compatibility.compatible, false)
  assert.equal(compatibility.code, 'NODE_LIMIT_EXCEEDED')
  assert.throws(
    () => normalizeFreeCanvas(input),
    (error) => error?.code === 'NODE_LIMIT_EXCEEDED',
  )
  assert.equal(input.nodes.length, 501)
  assert.equal(input.edges.length, 1001)

  assert.throws(
    () => normalizeFreeCanvas({ nodes: input.nodes.slice(0, 500), edges: input.edges }),
    (error) => error?.code === 'EDGE_LIMIT_EXCEEDED',
  )
})

test('creates bounded nodes and edges with stable caller fields', () => {
  const node = createFreeNode('text', {
    id: 'node-1',
    position: { x: 'bad', y: 12 },
    content: 'hello',
    storageKey: 'asset-key',
  })
  const edge = createFreeEdge('node-1', 'node-2', { id: 'edge-1', label: 'next' })
  assert.equal(node.id, 'node-1')
  assert.equal(node.type, 'text')
  assert.deepEqual(node.position, { x: 0, y: 12 })
  assert.equal(node.storageKey, 'asset-key')
  assert.equal(edge.source, 'node-1')
  assert.equal(edge.target, 'node-2')
  assert.equal(edge.id, 'edge-1')
})

test('removes selected nodes and their connected edges without mutation', () => {
  const input = {
    nodes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    edges: [{ id: 'ab', source: 'a', target: 'b' }, { id: 'bc', source: 'b', target: 'c' }],
  }
  const result = removeFreeSelection(input, ['b'])
  assert.deepEqual(result.nodes.map((node) => node.id), ['a', 'c'])
  assert.deepEqual(result.edges, [])
  assert.equal(input.nodes.length, 3)
  assert.equal(input.edges.length, 2)
})

test('clones selected nodes with offset and remaps internal edges', () => {
  const input = {
    nodes: [
      { id: 'a', type: 'text', position: { x: 10, y: 20 } },
      { id: 'b', type: 'image', position: { x: 30, y: 40 } },
    ],
    edges: [{ id: 'ab', source: 'a', target: 'b' }],
  }
  const result = cloneFreeSelection(input, ['a', 'b'], { x: 100, y: -5 })
  assert.equal(result.nodes.length, 4)
  assert.deepEqual(result.nodes.slice(2).map((node) => node.position), [
    { x: 110, y: 15 },
    { x: 130, y: 35 },
  ])
  assert.equal(result.edges.length, 2)
  assert.notEqual(result.edges[1].source, 'a')
  assert.notEqual(result.edges[1].target, 'b')
  assert.equal(input.nodes.length, 2)
})

test('adds no clones when the normalized canvas has reached node capacity', () => {
  const input = {
    nodes: Array.from({ length: 500 }, (_, index) => ({ id: `n${index}`, type: 'text' })),
    edges: [],
  }
  const result = cloneFreeSelection(input, ['n0', 'n1'], { x: 10, y: 10 })
  assert.equal(result.nodes.length, 500)
  assert.deepEqual(result.nodes.slice(0, 2), input.nodes.slice(0, 2).map((node) => ({
    ...node,
    position: { x: 0, y: 0 },
  })))
})

test('keeps the original selection unchanged when every clone cannot fit', () => {
  const input = {
    nodes: Array.from({ length: 499 }, (_, index) => ({ id: `n${index}`, type: 'text' })),
    edges: [],
  }
  const result = cloneFreeSelection(input, ['n0', 'n1'], { x: 10, y: 10 })
  assert.equal(result.nodes.length, 499)
  assert.equal(result.edges.length, 0)
})

test('places new free nodes at the preferred point or the nearest open grid slot', () => {
  const preferred = { x: 100, y: 200 }
  assert.deepEqual(findFreeNodeSpawnPosition(preferred, []), preferred)

  const firstOccupied = [{ position: preferred, width: 280, height: 208 }]
  assert.deepEqual(findFreeNodeSpawnPosition(preferred, firstOccupied), { x: 404, y: 200 })

  const rightOccupied = [
    ...firstOccupied,
    { position: { x: 404, y: 200 }, width: 280, height: 208 },
  ]
  assert.deepEqual(findFreeNodeSpawnPosition(preferred, rightOccupied), { x: 404, y: 432 })
})

test('places nodes inside collision-free safe areas for every accepted desktop viewport', () => {
  const viewports = [
    { width: 1280, height: 720 },
    { width: 1366, height: 768 },
    { width: 1440, height: 900 },
  ]
  for (const viewport of viewports) {
    const bounds = {
      left: 64,
      top: 24,
      right: viewport.width - 240 - 180,
      bottom: viewport.height - 110 - 96,
    }
    const clampedCorner = { x: bounds.right - 280, y: bounds.bottom - 208 }
    const obstacles = [
      { id: 'production', position: clampedCorner, dimensions: { width: 280, height: 208 } },
      { id: 'free', position: { x: bounds.left, y: bounds.top }, width: 280, height: 208 },
    ]
    const result = findFreeNodeSpawnPosition(
      { x: bounds.right + 500, y: bounds.bottom + 500 },
      obstacles,
      { bounds },
    )

    assert.ok(result.x >= bounds.left, `${viewport.width}: left`)
    assert.ok(result.y >= bounds.top, `${viewport.width}: top`)
    assert.ok(result.x + 280 <= bounds.right, `${viewport.width}: right`)
    assert.ok(result.y + 208 <= bounds.bottom, `${viewport.width}: bottom`)
    assert.notDeepEqual(result, clampedCorner, `${viewport.width}: avoids production node`)
  }
})

test('converts accepted viewport screen rectangles into transformed flow bounds', () => {
  const cases = [
    { width: 1280, height: 720, viewport: { x: -128, y: 48, zoom: 0.5 } },
    { width: 1366, height: 768, viewport: { x: 90, y: -60, zoom: 1 } },
    { width: 1440, height: 900, viewport: { x: -216, y: 72, zoom: 1.5 } },
  ]
  for (const entry of cases) {
    const rect = {
      left: 37,
      top: 53,
      right: 37 + entry.width,
      bottom: 53 + entry.height,
      width: entry.width,
      height: entry.height,
    }
    const result = freeCanvasState.screenRectToFreeCanvasBounds?.(rect, entry.viewport, {
      insets: { left: 64, top: 24, right: 180, bottom: 96 },
    })
    assert.deepEqual(result, {
      left: (64 - entry.viewport.x) / entry.viewport.zoom,
      top: (24 - entry.viewport.y) / entry.viewport.zoom,
      right: (entry.width - 180 - entry.viewport.x) / entry.viewport.zoom,
      bottom: (entry.height - 96 - entry.viewport.y) / entry.viewport.zoom,
    }, `${entry.width}x${entry.height}`)
  }
})

test('rejects 1280x720 high-zoom bounds narrowed below one node by the sidebar and inspector', () => {
  const result = freeCanvasState.screenRectToFreeCanvasBounds?.({
    left: 240,
    top: 0,
    right: 900,
    bottom: 720,
    width: 660,
    height: 720,
  }, { x: 0, y: 0, zoom: 2 }, {
    insets: { left: 64, top: 24, right: 180, bottom: 96 },
  })

  assert.equal(result, null)
})

test('rejects 1366x768 high-zoom bounds narrowed below one node by the sidebar and inspector', () => {
  const result = freeCanvasState.screenRectToFreeCanvasBounds?.({
    left: 240,
    top: 0,
    right: 986,
    bottom: 768,
    width: 746,
    height: 768,
  }, { x: 0, y: 0, zoom: 2 }, {
    insets: { left: 64, top: 24, right: 180, bottom: 96 },
  })

  assert.equal(result, null)
})

test('keeps nearby 1440x900 high-zoom bounds when one scaled node fits', () => {
  const result = freeCanvasState.screenRectToFreeCanvasBounds?.({
    left: 240,
    top: 0,
    right: 1060,
    bottom: 900,
    width: 820,
    height: 900,
  }, { x: 0, y: 0, zoom: 2 }, {
    insets: { left: 64, top: 24, right: 180, bottom: 96 },
  })

  assert.deepEqual(result, {
    left: 32,
    top: 12,
    right: 320,
    bottom: 402,
  })
})

test('ranks equally near safe top and bottom slots deterministically', () => {
  const bounds = { left: 0, top: 0, right: 280, bottom: 672 }
  const preferred = { x: 0, y: 232 }
  const center = { position: preferred, width: 280, height: 208 }

  assert.deepEqual(
    findFreeNodeSpawnPosition(preferred, [center], { bounds }),
    { x: 0, y: 0 },
  )
  assert.deepEqual(
    findFreeNodeSpawnPosition(preferred, [
      center,
      { position: { x: 0, y: 0 }, width: 280, height: 208 },
    ], { bounds }),
    { x: 0, y: 464 },
  )
})

test('finds a bounds-anchored bottom opening missed by the preferred-position ring', () => {
  const bounds = { left: 0, top: 0, right: 280, bottom: 558 }
  const preferred = { x: 0, y: 175 }
  const obstacle = { position: { x: 0, y: 125 }, width: 280, height: 50 }

  assert.deepEqual(
    findFreeNodeSpawnPosition(preferred, [obstacle], { bounds }),
    { x: 0, y: 232 },
  )
})

test('returns null when the bounded safe area is genuinely full', () => {
  const bounds = { left: 20, top: 30, right: 300, bottom: 238 }
  const occupied = [{ position: { x: 20, y: 30 }, width: 280, height: 208 }]

  assert.equal(findFreeNodeSpawnPosition({ x: 160, y: 134 }, occupied, { bounds }), null)
})
