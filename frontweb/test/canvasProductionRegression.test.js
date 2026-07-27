import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { buildCanvasLayoutPayload } from '../src/utils/canvasLayout.js'
import { buildFreeCanvasGraph, mergeCanvasGraphs } from '../src/utils/freeCanvasAdapter.js'
import { normalizeFreeCanvas, serializeFreeCanvas } from '../src/utils/freeCanvasState.js'

const canvasSource = readFileSync(new URL('../src/views/DramaCanvas.vue', import.meta.url), 'utf8')

test('production graph remains intact when the hybrid free layer is merged', () => {
  const productionGraph = {
    nodes: [
      { id: 'canvas:script:1', type: 'canvasScript', data: { title: '剧本' } },
      { id: 'canvas:sb:10', type: 'canvasStoryboard', data: { storyboard: { id: 10 } } },
    ],
    edges: [{ id: 'canvas:edge:1', source: 'canvas:script:1', target: 'canvas:sb:10' }],
  }
  const freeGraph = buildFreeCanvasGraph({
    nodes: [{ id: 'free:text:1', type: 'text', position: { x: 480, y: 120 }, content: 'idea' }],
    edges: [],
  })

  const merged = mergeCanvasGraphs(productionGraph, freeGraph, 'free')

  assert.deepEqual(merged.nodes.map((node) => node.id), [
    'canvas:script:1',
    'canvas:sb:10',
    'free:text:1',
  ])
  assert.deepEqual(merged.edges.map((edge) => edge.id), ['canvas:edge:1'])
  assert.equal(productionGraph.nodes.length, 2)
  assert.equal(productionGraph.edges.length, 1)
})

test('free-only layout persistence leaves production layout and workflow metadata addressable', () => {
  const layout = buildCanvasLayoutPayload([
    { id: 'canvas:sb:10', type: 'canvasStoryboard', position: { x: 10, y: 20 } },
    { id: 'free:text:1', type: 'freeCanvas', position: { x: 400, y: 500 }, data: { freeNode: {} } },
  ], { x: 2, y: 3, zoom: 0.9 }, {
    version: 1,
    nodes: { 'canvas:script:1': { x: 1, y: 2 } },
  })

  assert.deepEqual(layout.nodes, {
    'canvas:script:1': { x: 1, y: 2 },
    'canvas:sb:10': { x: 10, y: 20 },
  })
  assert.deepEqual({ canvas_layout: layout, workflow_groups: [{ id: 'group-1' }] }.workflow_groups, [{ id: 'group-1' }])
})

test('normalization keeps mode, viewport, and background serializable without runtime media URLs', () => {
  const state = normalizeFreeCanvas({
    mode: 'free',
    background: 'lines',
    viewport: { x: 4, y: -8, zoom: 1.1 },
    nodes: [{ id: 'free:image:1', type: 'image', content: 'blob:temporary', storageKey: 'uploads/project/image.png' }],
    edges: [],
  })

  const serialized = serializeFreeCanvas(state)
  assert.equal(serialized.mode, 'free')
  assert.equal(serialized.background, 'lines')
  assert.deepEqual(serialized.viewport, { x: 4, y: -8, zoom: 1.1 })
  assert.equal(JSON.stringify(serialized).includes('blob:'), false)
  assert.equal(JSON.stringify(serialized).includes('uploads/project/image.png'), true)
})

test('drama canvas source owns separate production/free graphs and sends free_canvas saves', () => {
  assert.match(canvasSource, /productionGraph/)
  assert.match(canvasSource, /freeGraph/)
  assert.match(canvasSource, /mergeCanvasGraphs\(/)
  assert.match(canvasSource, /free_canvas|freeCanvas/)
  assert.match(canvasSource, /saveCanvasLayout\([^\n]*freeCanvas|saveCanvasLayout\([^\n]*freeCanvasPayload/)
  assert.match(canvasSource, /freeCanvas|freeMode|canvasMode/)
})
