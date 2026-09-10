import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { buildDramaCanvasGraph } from '../src/utils/dramaCanvasAdapter.js'
import { getStoryboardMediaAvailability } from '../src/utils/storyboardMedia.js'

function read(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8')
}

const canvasRuntimeSource = [
  read('../src/views/DramaCanvas.vue'),
  read('../src/views/DramaCanvas.css'),
  read('../src/composables/useDramaCanvasFreeCanvas.js'),
  read('../src/composables/useDramaCanvasPersist.js'),
  read('../src/composables/useDramaCanvasProjectLoad.js'),
  read('../src/composables/useDramaCanvasWorkflow.js'),
  read('../src/composables/useDramaCanvasGraph.js'),
  read('../src/composables/useDramaCanvasViewport.js'),
].join('\n')

const expandableNodeSources = [
  read('../src/components/dramaCanvas/CanvasAssetNode.vue'),
  read('../src/components/dramaCanvas/CanvasScriptNode.vue'),
  read('../src/components/dramaCanvas/CanvasStoryboardNode.vue'),
  read('../src/components/dramaCanvas/CanvasMediaNode.vue'),
]

test('expandable canvas nodes expose names and Enter/Space expansion', () => {
  for (const source of expandableNodeSources) {
    assert.match(source, /role="button"/)
    assert.match(source, /tabindex="0"/)
    assert.match(source, /:aria-label="accessibleLabel"/)
    assert.match(source, /:aria-expanded="showPanel"/)
    assert.match(source, /@keydown\.enter\.stop\.prevent="openPanel"/)
    assert.match(source, /@keydown\.space\.stop\.prevent="openPanel"/)
  }
})

test('canvas disabled actions associate reasons with aria-describedby', () => {
  const gate = read('../src/components/dramaCanvas/CanvasActionGate.vue')
  const toolbar = read('../src/components/dramaCanvas/CanvasDesktopToolbar.vue')
  const workflowToolbar = read('../src/components/dramaCanvas/CanvasWorkflowToolbarGroup.vue')
  const storyboardPanel = read('../src/components/dramaCanvas/CanvasStoryboardPanel.vue')
  const mediaPanel = read('../src/components/dramaCanvas/CanvasMediaPanel.vue')

  assert.match(gate, /v-bind="\{ 'aria-describedby': descriptionId \}"/)
  assert.match(gate, /:id="descriptionId"/)
  assert.match(gate, /tabindex="0"/)
  assert.match(gate, /前往 AI 配置/)
  assert.match(gate, /openAiConfigHandler\?\.\(props\.configServiceType\)/)
  assert.match(toolbar, /description-id="canvas-reason-batch-videos"/)
  assert.match(toolbar, /aria-label="编辑剧本"/)
  assert.match(toolbar, /aria-label="新建剧集"/)
  assert.match(toolbar, /aria-label="新建素材"/)
  assert.match(toolbar, /aria-label="AI 生成分镜"/)
  assert.match(toolbar, />\s*AI 分镜\s*</)
  assert.match(toolbar, /:title="actionReasons.generateStoryboards \|\| undefined"/)
  assert.match(toolbar, /:title="actionReasons.batchImages \|\| undefined"/)
  assert.match(toolbar, /:title="actionReasons.batchVideos \|\| undefined"/)
  assert.match(toolbar, /aria-label="批量生成图片"/)
  assert.match(toolbar, /aria-label="批量生成视频"/)
  assert.match(toolbar, /description-id="canvas-reason-align-nodes"/)
  assert.match(toolbar, /正在对齐节点，请稍候/)
  assert.match(toolbar, /:config-service-type="actionConfigServices\.batchVideos"/)
  assert.match(workflowToolbar, /description-id="canvas-reason-run-workflow"/)
  assert.match(workflowToolbar, /config-service-type="video"/)
  assert.match(workflowToolbar, /config-service-type="tts"/)
  assert.match(workflowToolbar, /:title="actionReasons.runWorkflow \|\| undefined"/)
  assert.match(storyboardPanel, /:reason="videoAction\.reason"/)
  assert.match(storyboardPanel, /:reason="ttsAction\.reason"/)
  assert.match(storyboardPanel, /:title="audioActionDisabledReason \|\| undefined"/)
  assert.match(mediaPanel, /:reason="videoAction\.reason"/)
  assert.match(mediaPanel, /:reason="ttsAction\.reason"/)
  assert.match(mediaPanel, /:title="audioActionDisabledReason \|\| undefined"/)
})

test('canvas production actions load authoritative readiness and guard execution entry points', () => {
  const canvas = canvasRuntimeSource
  const storyboardPanel = read('../src/components/dramaCanvas/CanvasStoryboardPanel.vue')
  const mediaPanel = read('../src/components/dramaCanvas/CanvasMediaPanel.vue')

  assert.match(canvas, /workflowRunsAPI\.getNovel2AnimeReadiness\(\{[\s\S]*?qa_mode: 'production'/)
  assert.match(canvas, /normalizeCanvasProductionReadiness\(response\)/)
  assert.match(canvas, /productionReadinessState\.value = \{ status: 'loading', data: null \}/)
  assert.match(canvas, /status: 'error'/)
  assert.match(canvas, /if \(!ensureProductionStepReady\('video'\)\) return/)
  assert.match(canvas, /if \(!ensureProductionPipelineReady\(workflowSteps\)\) return/)
  assert.match(storyboardPanel, /ctx\?\.ensureProductionStepReady\?\.\(step\)/)
  assert.match(mediaPanel, /ctx\?\.ensureProductionStepReady\?\.\(step\)/)
})

test('placeholder media cannot produce media-ready canvas nodes', () => {
  const storyboard = {
    id: 11,
    episode_id: 1,
    storyboard_number: 1,
    status: 'media_ready',
    image_url: 'mock://storyboard/11/image',
    video_url: 'placeholder://storyboard/11/video',
  }
  const drama = {
    id: 1,
    title: 'Draft project',
    characters: [],
    scenes: [],
    props: [],
    episodes: [{ id: 1, episode_number: 1, storyboards: [storyboard] }],
  }
  const graph = buildDramaCanvasGraph(drama)
  const storyboardNode = graph.nodes.find((node) => node.id === 'sb:11')

  assert.deepEqual(storyboardNode.data.mediaAvailability, {
    imageReady: false,
    videoReady: false,
    ready: false,
  })
  assert.equal(graph.nodes.some((node) => node.id === 'sbimg:11'), false)
  assert.equal(graph.nodes.some((node) => node.id === 'sbvid:11'), false)
})

test('real local media produces consistent image and video availability', () => {
  assert.deepEqual(getStoryboardMediaAvailability({
    id: 12,
    image_url: '/static/images/12.png',
    video_local_path: 'videos/12.mp4',
  }, {}, {}, null), {
    imageReady: true,
    videoReady: true,
    ready: true,
  })
})

test('Vue Flow mounts only after its container reports a non-zero size', () => {
  const canvas = read('../src/views/DramaCanvas.vue')
  assert.match(canvas, /v-if="canvasViewportReady && \(nodes\.length \|\| canvasMode === 'free'\)"/)
  assert.match(canvas, /new ResizeObserver\(updateCanvasViewportReady\)/)
  assert.match(canvas, /rect\.width > 0 && rect\.height > 0/)
})

test('canvas viewport controls are named and initial fitting keeps nodes readable', () => {
  const canvas = canvasRuntimeSource
  const aligner = read('../src/components/dramaCanvas/CanvasFlowAligner.vue')

  for (const label of ['放大画布', '缩小画布', '适配可读视图']) {
    assert.match(canvas, new RegExp(`aria-label="${label}"`))
    assert.match(canvas, new RegExp(`title="${label}"`))
  }
  assert.match(canvas, /:aria-label="canvasInteractive \? '锁定画布' : '解锁画布'"/)
  assert.match(canvas, /:aria-pressed="!canvasInteractive"/)
  assert.match(canvas, /MIN_READABLE_CANVAS_ZOOM = 0\.9/)
  assert.match(canvas, /minZoom: MIN_READABLE_CANVAS_ZOOM/)
  assert.match(canvas, /FOCUSED_NODE_MIN_ZOOM = 0\.9/)
  assert.match(canvas, /nodes: \[nodeId\]/)
  assert.match(canvas, /const changed = await setFocusedCanvasNode\(node\.id\)/)
  assert.match(canvas, /if \(!changed\) \{[\s\S]*restoreFocusedNodeSelection\(\)/)
  assert.match(canvas, /setFocusedNode: setFocusedCanvasNode/)
  assert.match(canvas, /querySelector\('\.canvas-node-panel'\)\?\.focus/)
  assert.match(canvas, /@nodes-initialized="onCanvasNodesInitialized"/)
  assert.match(canvas, /\.vue-flow__controls button:focus-visible/)
  for (const name of ['setInteractive', 'setViewport', 'screenToFlowCoordinate', 'zoomIn', 'zoomOut']) {
    assert.match(aligner, new RegExp(`\\b${name}\\b`))
  }
})

test('canvas project header localizes stored style identifiers', () => {
  const header = read('../src/components/dramaCanvas/CanvasDramaHeaderNode.vue')
  assert.match(header, /findStyleOption\(value\)\?\.label \|\| value/)
  assert.match(header, /风格 \{\{ styleLabel \}\}/)
})

test('video nodes hide the player until positive metadata is available', () => {
  const mediaNode = read('../src/components/dramaCanvas/CanvasMediaNode.vue')
  assert.match(mediaNode, /preload="metadata"/)
  assert.match(mediaNode, /@loadedmetadata="onVideoMetadata"/)
  assert.match(mediaNode, /@error="onVideoError"/)
  assert.match(mediaNode, /duration > 0 \? 'ready' : 'invalid'/)
  assert.match(mediaNode, /\.media-vid\.is-checking[\s\S]*visibility: hidden/)
})

test('删除工作流确认框使用中文按钮', () => {
  const workflow = read('../src/composables/useDramaCanvasWorkflow.js')
  assert.match(workflow, /确定删除该工作流？/)
  assert.match(workflow, /confirmButtonText: '删除'/)
  assert.match(workflow, /cancelButtonText: '取消'/)
})
