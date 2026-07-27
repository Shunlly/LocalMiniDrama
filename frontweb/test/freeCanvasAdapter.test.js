import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildFreeCanvasGraph,
  mergeCanvasGraphs,
} from '../src/utils/freeCanvasAdapter.js'

test('free adapter preserves stable IDs, applies default positions, and summarizes selected references', () => {
  const freeCanvas = {
    nodes: [
      {
        id: 'free:text:idea',
        type: 'text',
        title: 'Opening idea',
        content: 'A quiet establishing shot.',
        asset_ref: 'asset-7',
        storyboard_ref: 'storyboard-12',
      },
      {
        id: 'free:image:reference',
        type: 'image',
        position: { x: 420, y: 96 },
        width: 120,
        height: 90,
      },
    ],
    edges: [
      { id: 'edge:valid', source: 'free:text:idea', target: 'free:image:reference', label: 'inspires' },
      { id: 'edge:orphan', source: 'free:text:idea', target: 'missing' },
    ],
  }
  const context = {
    selectedNodeId: 'free:text:idea',
    assetsById: new Map([['asset-7', { id: 'asset-7', name: 'Lead portrait' }]]),
    storyboardsById: new Map([['storyboard-12', { id: 'storyboard-12', title: 'Shot 12' }]]),
  }

  const graph = buildFreeCanvasGraph(freeCanvas, context)
  const selected = graph.nodes[0]

  assert.equal(selected.id, 'free:text:idea')
  assert.equal(selected.type, 'freeCanvas')
  assert.deepEqual(selected.position, { x: 0, y: 0 })
  assert.deepEqual(selected.dimensions, { width: 280, height: 180 })
  assert.equal(selected.selected, true)
  assert.deepEqual(selected.data.freeNode, {
    id: 'free:text:idea',
    type: 'text',
    title: 'Opening idea',
    content: 'A quiet establishing shot.',
    asset_ref: 'asset-7',
    storyboard_ref: 'storyboard-12',
    position: { x: 0, y: 0 },
  })
  assert.deepEqual(selected.data.referenceSummary, {
    asset: { id: 'asset-7', label: 'Lead portrait' },
    storyboard: { id: 'storyboard-12', label: 'Shot 12' },
  })
  assert.deepEqual(graph.nodes[1].dimensions, { width: 280, height: 180 })
  assert.deepEqual(graph.edges, [{
    id: 'edge:valid',
    source: 'free:text:idea',
    target: 'free:image:reference',
    type: 'default',
    label: 'inspires',
    animated: false,
  }])
  assert.equal(freeCanvas.nodes[0].position, undefined)
  assert.equal(Object.hasOwn(freeCanvas.nodes[1], 'dimensions'), false)
  assert.equal(Object.hasOwn(freeCanvas.edges[0], 'type'), false)
})

test('free adapter resolves object reference maps without retaining production objects', () => {
  const graph = buildFreeCanvasGraph({
    nodes: [{
      id: 'free:reference:1',
      type: 'reference',
      asset_ref: 'asset-2',
      storyboard_ref: 'storyboard-3',
    }],
  }, {
    references: {
      assets: { 'asset-2': { id: 'asset-2', title: 'Costume board', secret: 'do not copy' } },
      storyboards: { 'storyboard-3': { id: 'storyboard-3', name: 'Rain arrival', raw: { large: true } } },
    },
  })

  const summary = graph.nodes[0].data.referenceSummary
  assert.deepEqual(summary, {
    asset: { id: 'asset-2', label: 'Costume board' },
    storyboard: { id: 'storyboard-3', label: 'Rain arrival' },
  })
  assert.equal(JSON.stringify(graph).includes('do not copy'), false)
  assert.equal(JSON.stringify(graph).includes('large'), false)
})

test('free adapter merges visible graphs by mode without mutating graph fixtures', () => {
  const productionGraph = {
    nodes: [{ id: 'production:1', type: 'canvasStoryboard', data: { title: 'Production' } }],
    edges: [{ id: 'production-edge', source: 'production:1', target: 'production:1' }],
  }
  const freeGraph = {
    nodes: [{ id: 'free:text:1', type: 'freeCanvas', data: { label: 'Idea' } }],
    edges: [{ id: 'free-edge', source: 'free:text:1', target: 'free:text:1' }],
  }

  const production = mergeCanvasGraphs(productionGraph, freeGraph, 'production')
  const free = mergeCanvasGraphs(productionGraph, freeGraph, 'free')

  assert.deepEqual(production.nodes.map((node) => node.id), ['production:1'])
  assert.deepEqual(production.edges.map((edge) => edge.id), ['production-edge'])
  assert.deepEqual(free.nodes.map((node) => node.id), ['production:1', 'free:text:1'])
  assert.deepEqual(free.edges.map((edge) => edge.id), ['production-edge', 'free-edge'])
  assert.notEqual(free.nodes[0], productionGraph.nodes[0])
  assert.notEqual(free.nodes[1], freeGraph.nodes[0])

  free.nodes[0].data.title = 'Changed only in output'
  assert.equal(productionGraph.nodes[0].data.title, 'Production')
})

test('free adapter drops cross-layer ID collisions and their free edges by canonical ID', () => {
  const productionGraph = {
    nodes: [{ id: 7, type: 'canvasStoryboard' }],
    edges: [],
  }
  const freeGraph = {
    nodes: [
      { id: '7', type: 'freeCanvas' },
      { id: 'free:text:kept', type: 'freeCanvas' },
    ],
    edges: [
      { id: 'free-edge:collision-string', source: 'free:text:kept', target: '7' },
      { id: 'free-edge:collision-number', source: 'free:text:kept', target: 7 },
      { id: 'free-edge:self', source: 'free:text:kept', target: 'free:text:kept' },
    ],
  }

  const graph = mergeCanvasGraphs(productionGraph, freeGraph, 'free')

  assert.deepEqual(graph.nodes.map((node) => node.id), [7, 'free:text:kept'])
  assert.deepEqual(graph.edges.map((edge) => edge.id), ['free-edge:self'])
  assert.equal(graph.edges.every((edge) => edge.source !== 7 && edge.target !== 7), true)
  assert.equal(graph.edges.every((edge) => edge.source !== '7' && edge.target !== '7'), true)
  assert.deepEqual(freeGraph.nodes.map((node) => node.id), ['7', 'free:text:kept'])
  assert.equal(freeGraph.edges.length, 3)
})
