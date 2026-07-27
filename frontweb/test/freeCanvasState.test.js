import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createEmptyFreeCanvas,
  normalizeFreeCanvas,
  serializeFreeCanvas,
  createFreeNode,
  createFreeEdge,
  removeFreeSelection,
  cloneFreeSelection,
} from '../src/utils/freeCanvasState.js'

test('normalizes an absent free canvas without changing production metadata', () => {
  const state = normalizeFreeCanvas(null)
  assert.equal(state.version, 1)
  assert.equal(state.mode, 'production')
  assert.deepEqual(state.nodes, [])
  assert.deepEqual(state.edges, [])
})

test('drops invalid edge references and clamps oversized text', () => {
  const state = normalizeFreeCanvas({
    nodes: [{ id: 'n1', type: 'text', content: 'x'.repeat(60000) }],
    edges: [{ id: 'e1', source: 'n1', target: 'missing' }],
  })
  assert.equal(state.nodes[0].content.length, 50000)
  assert.deepEqual(state.edges, [])
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

test('bounds nodes and edges without mutating source arrays', () => {
  const input = {
    nodes: Array.from({ length: 501 }, (_, index) => ({ id: `n${index}`, type: 'text' })),
    edges: Array.from({ length: 1001 }, (_, index) => ({
      id: `e${index}`,
      source: 'n0',
      target: 'n1',
    })),
  }
  const state = normalizeFreeCanvas(input)
  assert.equal(state.nodes.length, 500)
  assert.equal(state.edges.length, 1000)
  assert.equal(input.nodes.length, 501)
  assert.equal(input.edges.length, 1001)
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

test('adds only the fitting portion of a selection near node capacity', () => {
  const input = {
    nodes: Array.from({ length: 499 }, (_, index) => ({ id: `n${index}`, type: 'text' })),
    edges: [],
  }
  const result = cloneFreeSelection(input, ['n0', 'n1'], { x: 10, y: 10 })
  assert.equal(result.nodes.length, 500)
  assert.deepEqual(result.nodes[499].position, { x: 10, y: 10 })
})
