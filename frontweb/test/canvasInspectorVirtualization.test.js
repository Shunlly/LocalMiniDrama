import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse } from '@vue/compiler-sfc'
import { readDramaCanvasRuntimeSource } from './helpers/dramaCanvasPageSource.js'

function read(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8')
}

const dramaCanvasViewSource = read('../src/views/DramaCanvas.vue')
const dramaCanvasSource = readDramaCanvasRuntimeSource()
const flowStageSource = read('../src/components/dramaCanvas/CanvasFlowStage.vue')
const overlayHostSource = read('../src/components/dramaCanvas/CanvasOverlayHost.vue')
const inspectorDockSource = read('../src/components/dramaCanvas/CanvasInspectorDock.vue')
const storyboardNodeSource = read('../src/components/dramaCanvas/CanvasStoryboardNode.vue')
const scriptNodeSource = read('../src/components/dramaCanvas/CanvasScriptNode.vue')
const mediaNodeSource = read('../src/components/dramaCanvas/CanvasMediaNode.vue')
const assetNodeSource = read('../src/components/dramaCanvas/CanvasAssetNode.vue')
const freeCanvasUxSource = read('../src/components/dramaCanvas/freeCanvasUx.js')

function templateOf(source, filename) {
  const { descriptor, errors } = parse(source, { filename })
  assert.deepEqual(errors, [])
  return descriptor.template?.content || ''
}

function vueFlowSlot(source) {
  const start = source.indexOf('<VueFlow')
  const end = source.indexOf('</VueFlow>')
  assert.ok(start >= 0, 'missing <VueFlow')
  assert.ok(end > start, 'missing </VueFlow>')
  return source.slice(start, end)
}

test('VueFlow keeps only-render-visible-elements true even when inspectors are open', () => {
  assert.match(dramaCanvasSource, /:only-render-visible-elements="true"/)
  assert.doesNotMatch(dramaCanvasSource, /only-render-visible-elements="!focusedNodeId/)
  assert.doesNotMatch(dramaCanvasSource, /!focusedNodeId && !selectedFreeNodeId/)
})

test('workflow and free inspector docks are mounted outside the VueFlow default slot', () => {
  const canvasTemplate = templateOf(dramaCanvasViewSource, 'DramaCanvas.vue')
  const flowTemplate = templateOf(flowStageSource, 'CanvasFlowStage.vue')
  const overlayTemplate = templateOf(overlayHostSource, 'CanvasOverlayHost.vue')
  const slot = vueFlowSlot(flowTemplate)
  assert.doesNotMatch(slot, /canvas-inspector-dock/)
  assert.doesNotMatch(slot, /free-canvas-inspector-dock/)
  assert.doesNotMatch(slot, /<CanvasInspectorDock/)
  assert.doesNotMatch(slot, /<FreeCanvasInspector/)

  assert.match(canvasTemplate, /<CanvasOverlayHost/)
  assert.match(overlayTemplate, /<CanvasInspectorDock[\s\S]*focusedInspectorNode/)
  assert.match(overlayTemplate, /<FreeCanvasInspector[\s\S]*class="free-canvas-inspector-dock"/)
  assert.match(inspectorDockSource, /class="canvas-inspector-dock"/)
})

test('focused production inspector is hosted by the stable dock instead of node trees', () => {
  assert.match(dramaCanvasSource, /const focusedInspectorNode = computed\(/)
  assert.match(dramaCanvasSource, /PANEL_NODE_TYPES\.has\(node\.type\)/)
  assert.doesNotMatch(storyboardNodeSource, /<Teleport\s+to="body">/)
  assert.doesNotMatch(storyboardNodeSource, /class="canvas-inspector-dock"/)
  assert.doesNotMatch(storyboardNodeSource, /CanvasStoryboardPanel/)
  assert.doesNotMatch(scriptNodeSource, /CanvasScriptPanel/)
  assert.doesNotMatch(mediaNodeSource, /CanvasMediaPanel/)
  assert.doesNotMatch(assetNodeSource, /CanvasAssetPanel/)
  assert.match(inspectorDockSource, /<CanvasStoryboardPanel/)
  assert.match(inspectorDockSource, /<CanvasScriptPanel/)
  assert.match(inspectorDockSource, /<CanvasMediaPanel/)
  assert.match(inspectorDockSource, /<CanvasAssetPanel/)
})

test('inspector chrome stays editable: focus restore, close, and blank-click ignore both docks', () => {
  assert.match(dramaCanvasSource, /document\.querySelector\('\.canvas-inspector-dock \.canvas-node-panel'\)\?\.focus/)
  assert.match(inspectorDockSource, /@keydown\.esc\.stop\.prevent="closeInspector"/)
  assert.match(inspectorDockSource, /await ctx\?\.clearFocusedNode\?\.\(\{ restoreFocus: true \}\)/)
  assert.match(dramaCanvasSource, /async function onPaneClick\([\s\S]*\.canvas-inspector-dock[\s\S]*\.free-canvas-inspector-dock/)
  assert.match(freeCanvasUxSource, /\.canvas-inspector-dock/)
  assert.match(freeCanvasUxSource, /\.free-canvas-inspector-dock/)
})

test('inspector navigation and media retry titles explain why controls are disabled', () => {
  assert.match(
    inspectorDockSource,
    /:disabled="!inspectorNavigation\.previousId"\s*\n\s*aria-label="上一镜"\s*\n\s*:title="inspectorNavigation\.previousId \? '上一镜' : '已经是第一镜'"/,
  )
  assert.match(
    inspectorDockSource,
    /:disabled="!inspectorNavigation\.nextId"\s*\n\s*aria-label="下一镜"\s*\n\s*:title="inspectorNavigation\.nextId \? '下一镜' : '已经是最后一镜'"/,
  )
  assert.doesNotMatch(inspectorDockSource, /\stitle="上一镜"/)
  assert.doesNotMatch(inspectorDockSource, /\stitle="下一镜"/)
  assert.match(
    inspectorDockSource,
    /class="media-query-retry"\s*\n\s*:disabled="retryingMedia"\s*\n\s*:title="retryingMedia \? '正在重试媒体查询，请稍候' : undefined"/,
  )
})
