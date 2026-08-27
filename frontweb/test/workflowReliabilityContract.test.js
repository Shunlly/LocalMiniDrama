import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  createStoryboardDraftFingerprint,
  hasStoryboardDraftChanges,
} from '../src/utils/storyboardDraft.js'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const batchImportSource = read('../src/components/EpisodeBatchImportDialog.vue')
const dramaDetailSource = read('../src/views/DramaDetail.vue')
const sourceWorkflowSource = read('../src/components/SourceIntakeWorkflowPanel.vue')
const storyboardPanelSource = read('../src/components/dramaCanvas/CanvasStoryboardPanel.vue')
const storyboardNodeSource = read('../src/components/dramaCanvas/CanvasStoryboardNode.vue')
const dramaCanvasSource = read('../src/views/DramaCanvas.vue')

test('storyboard draft fingerprint distinguishes unsaved text and relation changes', () => {
  const saved = createStoryboardDraftFingerprint({
    title: '镜头一',
    image_prompt: '雨夜',
    characterIds: [2, 1],
    sceneId: 4,
    propIds: [8],
  })
  assert.equal(hasStoryboardDraftChanges(saved, { title: '镜头一', image_prompt: '雨夜', characterIds: [1, 2], sceneId: 4, propIds: [8] }), false)
  assert.equal(hasStoryboardDraftChanges(saved, { title: '镜头一（修改）', image_prompt: '雨夜', characterIds: [1, 2], sceneId: 4, propIds: [8] }), true)
})

test('batch import routes the explicit parent handler and event fallback through its lifecycle', () => {
  assert.match(batchImportSource, /importHandler:\s*\{\s*type:\s*Function/)
  assert.match(
    batchImportSource,
    /await batchImportLifecycle\.execute\(\(\) => \([\s\S]*props\.importHandler[\s\S]*props\.importHandler\(payload\)[\s\S]*emit\('import', payload\)/,
  )
  assert.match(dramaDetailSource, /:import-handler="onBatchImportEpisodes"/)
  assert.doesNotMatch(batchImportSource, /emit\('import', previewEpisodes\.value\.map/)
})

test('source intake protects active upload and workflow operations before unload', () => {
  assert.match(sourceWorkflowSource, /const sourceOperationActive = computed\(/)
  assert.match(sourceWorkflowSource, /if \(!hasUnsavedSourceInput\.value && !sourceOperationActive\.value\) return/)
  assert.doesNotMatch(sourceWorkflowSource, /if \(!hasUnsavedSourceInput\.value \|\| sourceSaving\.value \|\| workflowStarting\.value\) return/)
  assert.match(sourceWorkflowSource, /sourceFileReading\.value/)
})

test('canvas storyboard panel delegates close, navigation, and focus switching to one dirty guard', () => {
  assert.match(storyboardPanelSource, /const hasUnsavedDraft = computed\(/)
  assert.match(storyboardPanelSource, /const hasPendingStoryboardWork = computed\(/)
  assert.match(storyboardPanelSource, /async function confirmStoryboardLeave\(/)
  assert.match(storyboardPanelSource, /registerFocusGuard\?\.\(confirmStoryboardLeave,\s*hasPendingStoryboardWork\)/)
  assert.match(storyboardPanelSource, /await ctx\?\.clearFocusedNode\?\.\(\{ restoreFocus: true \}\)/)
  assert.doesNotMatch(storyboardPanelSource, /openListMode\(\)[\s\S]{0,220}confirmStoryboardLeave/)
  assert.match(storyboardNodeSource, /await ctx\?\.setFocusedNode\?\.\(props\.id\)/)
  assert.match(dramaCanvasSource, /registerFocusGuard/)
  assert.match(dramaCanvasSource, /await focusedNodeGuard\(\)/)
})

test('expanded storyboard editor is teleported to a bounded inspector dock', () => {
  assert.match(storyboardNodeSource, /<Teleport\s+to="body">/)
  assert.match(storyboardNodeSource, /class="canvas-inspector-dock"/)
  assert.match(storyboardNodeSource, /max-height:\s*min\(/)
  assert.match(storyboardNodeSource, /overflow-y:\s*auto/)
})

test('storyboard inspector exposes guarded shot navigation, progress, and media summary', () => {
  assert.match(storyboardNodeSource, /class="inspector-context"/)
  assert.match(storyboardNodeSource, /镜头 \{\{ inspectorNavigation\.index \}\} \/ \{\{ inspectorNavigation\.total \}\}/)
  assert.match(storyboardNodeSource, /aria-label="上一镜"/)
  assert.match(storyboardNodeSource, /aria-label="下一镜"/)
  assert.match(storyboardNodeSource, /图片 \{\{ mediaSummary\.imageCount \}\}/)
  assert.match(storyboardNodeSource, /视频 \{\{ mediaSummary\.videoCount \}\}/)
  assert.match(storyboardNodeSource, /配音 \{\{ mediaSummary\.audioReady \? '就绪' : '缺失' \}\}/)
  assert.match(storyboardNodeSource, /await ctx\?\.setFocusedNode\?\.\(`sb:\$\{storyboardId\}`\)/)
})

test('teleported storyboard inspector keeps theme tokens outside the canvas scope', () => {
  assert.match(storyboardNodeSource, /--canvas-panel-surface:\s*var\(--bg-card/)
  assert.match(storyboardNodeSource, /--canvas-text-primary:\s*var\(--text-primary/)
  assert.match(storyboardNodeSource, /:global\(html\.light\)\s+\.canvas-inspector-dock/)
})

test('every canvas inspector exit uses the shared dirty guard', () => {
  assert.match(
    dramaCanvasSource,
    /function runCanvasNavigationBarrier\(\)[\s\S]*?ensureFreeCanvasUploadFinished\(\)[\s\S]*?confirmFocusedNodeLeave\(\)[\s\S]*?flushCanvasSaveBeforeLeave\(projectId\)/,
  )
  assert.match(dramaCanvasSource, /onBeforeRouteLeave\(\(\) => runCanvasNavigationBarrier\(\)\)/)
  assert.match(dramaCanvasSource, /async function guardCanvasRouteUpdate\(to\)[\s\S]*?return runCanvasNavigationBarrier\(\)/)
  assert.match(dramaCanvasSource, /onBeforeRouteUpdate\(guardCanvasRouteUpdate\)/)
  assert.match(dramaCanvasSource, /window\.addEventListener\('beforeunload', handleCanvasBeforeUnload\)/)
  assert.match(dramaCanvasSource, /async function onPaneClick\(/)
  assert.match(dramaCanvasSource, /await setFocusedCanvasNode\(null, \{ restoreFocus: true \}\)/)
  assert.match(dramaCanvasSource, /clearFocusedNode:\s*\(options\) => setFocusedCanvasNode\(null, options\)/)
  assert.doesNotMatch(dramaCanvasSource, /clearFocusedNode:\s*\(\) => \{\s*focusedNodeId\.value = null/)
  assert.match(storyboardPanelSource, /registerFocusGuard\?\.\(confirmStoryboardLeave,\s*hasPendingStoryboardWork\)/)
  assert.match(dramaCanvasSource, /:model-value="filterEpisodeId"/)
  assert.match(dramaCanvasSource, /@update:model-value="requestEpisodeFilterChange"/)
  assert.match(dramaCanvasSource, /async function requestEpisodeFilterChange\(/)
  assert.match(dramaCanvasSource, /delete query\.focus[\s\S]*?await router\.replace\(\{ query \}\)[\s\S]*?await canvasRouteSynchronization/)
})

test('canvas inspector restores keyboard and selection context when closing or cancelling', () => {
  assert.match(storyboardNodeSource, /@keydown\.esc\.stop\.prevent="closeInspector"/)
  assert.match(storyboardNodeSource, /右侧检查器可编辑与生成/)
  assert.match(dramaCanvasSource, /async function focusCanvasNodeTrigger\(/)
  assert.match(dramaCanvasSource, /function restoreFocusedNodeSelection\(/)
  assert.match(dramaCanvasSource, /if \(!changed\) \{[\s\S]*restoreFocusedNodeSelection\(\)/)
})

test('free canvas shortcuts ignore interactive controls and inspector content', () => {
  assert.match(
    dramaCanvasSource,
    /function isEditableKeyTarget\(target\)[\s\S]*?input, textarea, select, button, video, audio,[\s\S]*?\.free-canvas-inspector-dock/,
  )
  assert.match(dramaCanvasSource, /if \(isEditableKeyTarget\(event\.target\)\) return/)
})

test('open inspector reserves canvas space so the minimap remains usable', () => {
  assert.match(dramaCanvasSource, /'inspector-open': focusedNodeId/)
  assert.match(dramaCanvasSource, /\.drama-canvas-page\.inspector-open \.canvas-main\s*\{[\s\S]*margin-right:\s*480px/)
  assert.match(dramaCanvasSource, /'free-inspector-open': selectedFreeNodeId/)
  assert.match(dramaCanvasSource, /\.drama-canvas-page\.free-inspector-open \.canvas-main\s*\{[\s\S]*margin-right:\s*380px/)
})

test('canvas keeps the focused teleported inspector mounted while panning', () => {
  assert.match(dramaCanvasSource, /:only-render-visible-elements="!focusedNodeId && !selectedFreeNodeId"/)
})

test('canvas saves an immutable draft snapshot and locks generation before persistence', () => {
  assert.match(storyboardPanelSource, /function markDraftSaved\(draft = currentDraftValue\(\)\)/)
  assert.match(storyboardPanelSource, /const draftSnapshot = currentDraftValue\(\)[\s\S]*await persistForm\(false, draftSnapshot\)[\s\S]*markDraftSaved\(draftSnapshot\)/)
  assert.match(storyboardPanelSource, /async function persistForm\(silent = false, draftValue = currentDraftValue\(\)\)/)
  assert.match(storyboardPanelSource, /const draft = draftValue \|\| currentDraftValue\(\)[\s\S]*character_ids:\s*draft\.characterIds/)
  assert.match(storyboardPanelSource, /async function runStep\(step\) \{[\s\S]*busyStep\.value = step[\s\S]*await persistForm\(true, draftSnapshot\)/)
})

test('canvas guards same-route context changes and carries all return context', () => {
  assert.match(dramaCanvasSource, /async function guardCanvasRouteUpdate\(to\)[\s\S]*canvasRouteContext\(route\)[\s\S]*canvasRouteContext\(to\)/)
  assert.match(dramaCanvasSource, /currentContext\.focusNodeId !== nextContext\.focusNodeId[\s\S]*currentContext\.episodeId !== nextContext\.episodeId[\s\S]*return runCanvasNavigationBarrier\(\)/)
  assert.match(dramaCanvasSource, /onBeforeRouteUpdate\(guardCanvasRouteUpdate\)/)
  assert.match(dramaCanvasSource, /routeFocusNodeId\(\), routeEpisodeId\(\)[\s\S]*startCanvasRouteSynchronization\(\{ resetProject \}\)/)
  assert.match(dramaCanvasSource, /const projectListReturnTo = computed\(\(\) => normalizeProjectListReturnTo\(route\.query\.returnTo\)\)/)
  assert.match(dramaCanvasSource, /function goProjectList\(\)/)
  assert.match(dramaCanvasSource, /function goListMode\(\)[\s\S]*returnTo/)
  assert.match(dramaCanvasSource, /function navigateToStoryboard\([\s\S]*returnTo/)
  assert.match(dramaCanvasSource, /function buildCanvasReturnTo\([\s\S]*routeEpisodeId\(\)[\s\S]*routeFocusNodeId\(\)[\s\S]*name: 'film-canvas'/)
  assert.match(dramaCanvasSource, /function goMediaLibrary\(\)[\s\S]*returnTo: buildCanvasReturnTo\(\)/)
})
