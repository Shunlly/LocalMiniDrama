import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { getNodesInside } from '@vue-flow/core'

import { buildFreeCanvasGraph } from '../src/utils/freeCanvasAdapter.js'
import { readDramaCanvasRuntimeSource } from './helpers/dramaCanvasPageSource.js'

function read(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8')
}

test('Vue Flow 只渲染可见节点，且自由画布不另做第二层虚拟化', () => {
  const flowStageSource = read('../src/components/dramaCanvas/CanvasFlowStage.vue')
  const composable = read('../src/composables/useDramaCanvasFreeCanvas.js')
  const runtime = readDramaCanvasRuntimeSource()
  assert.match(flowStageSource, /:only-render-visible-elements="true"/)
  assert.match(runtime, /:only-render-visible-elements="true"/)
  assert.doesNotMatch(flowStageSource, /only-render-visible-elements="!focusedNodeId/)
  assert.doesNotMatch(composable, /virtualiz/)
})

test('自由画布大图只把视口内节点送进可见集合', () => {
  const graph = buildFreeCanvasGraph({
    nodes: Array.from({ length: 120 }, (_, index) => ({
      id: `free:text:${index + 1}`,
      type: 'text',
      position: { x: (index % 4) * 320, y: Math.floor(index / 4) * 240 },
    })),
  })
  const parsed = graph.nodes.map((node) => ({
    ...node,
    computedPosition: { x: node.position.x, y: node.position.y, z: 0 },
  }))
  const visible = getNodesInside(
    parsed,
    { x: 0, y: 0, width: 960, height: 540 },
    { x: 0, y: 0, zoom: 1 },
    true,
  )
  assert.equal(graph.nodes.length, 120)
  assert.ok(visible.length >= 1)
  assert.ok(visible.length < 120)
  assert.ok(visible.length <= 24)
  assert.equal(visible.some((node) => node.id === 'free:text:1'), true)
  assert.equal(visible.some((node) => node.id === 'free:text:120'), false)
  assert.ok(visible.every((node) => node.position.y < 540 + 180))
})
