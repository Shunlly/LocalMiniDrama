import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  createStoryboardDraftFingerprint,
  hasStoryboardDraftChanges,
} from '../src/utils/storyboardDraft.js'

import {
  pollTaskSimple,
  runImageStep,
  runWorkflowGroup,
} from '../src/composables/useCanvasWorkflowRunner.js'

import { readDramaCanvasRuntimeSource } from './helpers/dramaCanvasPageSource.js'
import { readSourceIntakeWorkflowSources } from './helpers/sourceIntakeWorkflowSources.js'
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const batchImportSource = read('../src/components/EpisodeBatchImportDialog.vue')
const dramaDetailSource = read('../src/views/DramaDetail.vue')
const dramaDetailEpisodeListSource = read('../src/components/dramaDetail/DramaDetailEpisodeList.vue')
const sourceWorkflowSource = readSourceIntakeWorkflowSources()
const storyboardPanelSource = read('../src/components/dramaCanvas/CanvasStoryboardPanel.vue')
const storyboardNodeSource = read('../src/components/dramaCanvas/CanvasStoryboardNode.vue')
const inspectorDockSource = read('../src/components/dramaCanvas/CanvasInspectorDock.vue')
const dramaCanvasSource = readDramaCanvasRuntimeSource()

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
  assert.match(dramaDetailEpisodeListSource, /:import-handler="onBatchImportEpisodes"/)
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

test('expanded storyboard editor is hosted in a bounded inspector dock outside VueFlow', () => {
  assert.doesNotMatch(storyboardNodeSource, /<Teleport\s+to="body">/)
  assert.match(inspectorDockSource, /class="canvas-inspector-dock"/)
  assert.match(inspectorDockSource, /max-height:\s*min\(/)
  assert.match(inspectorDockSource, /overflow-y:\s*auto/)
  assert.match(dramaCanvasSource, /<CanvasInspectorDock/)
  assert.match(dramaCanvasSource, /:only-render-visible-elements="true"/)
})

test('storyboard inspector exposes guarded shot navigation, progress, and media summary', () => {
  assert.match(inspectorDockSource, /class="inspector-context"/)
  assert.match(inspectorDockSource, /镜头 \{\{ inspectorNavigation\.index \}\} \/ \{\{ inspectorNavigation\.total \}\}/)
  assert.match(inspectorDockSource, /aria-label="上一镜"/)
  assert.match(inspectorDockSource, /aria-label="下一镜"/)
  assert.match(inspectorDockSource, /图片 \{\{ mediaSummary\.imageCount \}\}/)
  assert.match(inspectorDockSource, /视频 \{\{ mediaSummary\.videoCount \}\}/)
  assert.match(inspectorDockSource, /配音 \{\{ mediaSummary\.audioReady \? '就绪' : '缺失' \}\}/)
  assert.match(inspectorDockSource, /await ctx\?\.setFocusedNode\?\.\(`sb:\$\{storyboardId\}`\)/)
})

test('hosted storyboard inspector keeps theme tokens outside the canvas scope', () => {
  assert.match(inspectorDockSource, /--canvas-panel-surface:\s*var\(--bg-card/)
  assert.match(inspectorDockSource, /--canvas-text-primary:\s*var\(--text-primary/)
  assert.match(inspectorDockSource, /:global\(html\.light\)\s+\.canvas-inspector-dock/)
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
  assert.match(dramaCanvasSource, /clearFocusedNode:\s*\(options\) => (?:ctx\.)?setFocusedCanvasNode\(null, options\)/)
  assert.doesNotMatch(dramaCanvasSource, /clearFocusedNode:\s*\(\) => \{\s*focusedNodeId\.value = null/)
  assert.match(storyboardPanelSource, /registerFocusGuard\?\.\(confirmStoryboardLeave,\s*hasPendingStoryboardWork\)/)
  assert.match(dramaCanvasSource, /:model-value="filterEpisodeId"/)
  assert.match(dramaCanvasSource, /@update:model-value="requestEpisodeFilterChange"/)
  assert.match(dramaCanvasSource, /async function requestEpisodeFilterChange\(/)
  assert.match(dramaCanvasSource, /delete query\.focus[\s\S]*?await router\.replace\(\{ query \}\)[\s\S]*?await canvasRouteSynchronization/)
})

test('canvas inspector restores keyboard and selection context when closing or cancelling', () => {
  assert.match(inspectorDockSource, /@keydown\.esc\.stop\.prevent="closeInspector"/)
  assert.match(storyboardNodeSource, /右侧检查器可编辑与生成/)
  assert.match(dramaCanvasSource, /async function focusCanvasNodeTrigger\(/)
  assert.match(dramaCanvasSource, /function restoreFocusedNodeSelection\(/)
  assert.match(dramaCanvasSource, /if \(!changed\) \{[\s\S]*restoreFocusedNodeSelection\(\)/)
})

test('free canvas shortcuts ignore interactive controls and inspector content', () => {
  assert.match(
    dramaCanvasSource,
    /function isTypingTarget\(target\)[\s\S]*?input, textarea, select,[\s\S]*?\.el-textarea/,
  )
  assert.match(dramaCanvasSource, /if \(isEditableKeyTarget\(event\.target\)\) return/)
  assert.match(dramaCanvasSource, /if \(isTypingTarget\(event\.target\)\) return/)
  assert.match(dramaCanvasSource, /function currentVisualFreeCanvasSelection\(/)
  assert.match(dramaCanvasSource, /const \{ nodeIds \} = syncVisualFreeCanvasSelection\(\)/)
  assert.match(dramaCanvasSource, /window.addEventListener\('keydown', handleFreeCanvasKeydown, true\)/)
  assert.match(dramaCanvasSource, /const \{ nodeIds, edgeIds \} = currentVisualFreeCanvasSelection\(\)/)
})

test('open inspector reserves canvas space so the minimap remains usable', () => {
  assert.match(dramaCanvasSource, /'inspector-open': focusedNodeId/)
  assert.match(dramaCanvasSource, /\.drama-canvas-page\.inspector-open[\s\S]*canvas-main[\s\S]*margin-right:\s*480px/)
  assert.match(dramaCanvasSource, /'free-inspector-open': selectedFreeNodeId/)
  assert.match(dramaCanvasSource, /\.drama-canvas-page\.free-inspector-open[\s\S]*canvas-main[\s\S]*margin-right:\s*380px/)
})

test('canvas keeps node virtualization on while the lifted inspector stays mounted', () => {
  assert.match(dramaCanvasSource, /:only-render-visible-elements="true"/)
  assert.doesNotMatch(dramaCanvasSource, /only-render-visible-elements="!focusedNodeId/)
  assert.match(dramaCanvasSource, /<CanvasInspectorDock/)
  assert.match(dramaCanvasSource, /class="free-canvas-inspector-dock"/)
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
  assert.match(dramaCanvasSource, /function goListMode\(\)[\s\S]*(?:ctx\.)?filterEpisodeId\.value \|\| (?:ctx\.)?routeEpisodeId\(\)/)
  assert.match(dramaCanvasSource, /function goListMode\(\)[\s\S]*returnTo/)
  assert.match(dramaCanvasSource, /function navigateToStoryboard\([\s\S]*returnTo/)
  assert.match(dramaCanvasSource, /function buildCanvasReturnTo\([\s\S]*routeEpisodeId\(\)[\s\S]*routeFocusNodeId\(\)[\s\S]*name: 'film-canvas'/)
  assert.match(dramaCanvasSource, /function goMediaLibrary\(\)[\s\S]*returnTo: buildCanvasReturnTo\(\)/)
})


const PROVIDER_SECRET = 'sk-test-not-a-real-key-aaaaaaaaaaaaaaaaaaaaaaaaaaaa'

function workflowDrama() {
  return {
    id: 7,
    metadata: {},
    episodes: [{
      id: 3,
      storyboards: [{
        id: 11,
        storyboard_number: 1,
        image_prompt: '\u96e8\u591c',
        dialogue: '\u53f0\u8bcd',
      }],
    }],
  }
}

function isChineseWithoutSecret(text) {
  return /[\u4e00-\u9fff]/.test(String(text || ''))
    && !String(text).includes(PROVIDER_SECRET)
    && !/sk-[A-Za-z0-9._-]{6,}/i.test(String(text))
    && !/api[_-]?key/i.test(String(text))
    && !/Invalid API key/i.test(String(text))
}

test('workflow polling sanitizes failed provider English and secrets', async () => {
  const result = await pollTaskSimple('task-provider-fail', {
    interval: 0,
    deadlineMs: 1000,
    getTask: async () => ({
      status: 'failed',
      error: { message: `Invalid API key ${PROVIDER_SECRET}` },
    }),
  })
  assert.equal(result.status, 'failed')
  assert.equal(isChineseWithoutSecret(result.error), true)
})

test('workflow image step does not leak provider errors into thrown messages', async () => {
  const drama = workflowDrama()
  const storyboard = drama.episodes[0].storyboards[0]
  await assert.rejects(
    runImageStep(drama, storyboard, { aspectRatio: '16:9' }, {
      createImage: async () => {
        throw new Error(`provider 500 api_key=${PROVIDER_SECRET}`)
      },
    }),
    (error) => isChineseWithoutSecret(error.message),
  )
})

test('workflow group records sanitized Chinese failures and remains cancellable', async () => {
  const drama = workflowDrama()
  const summary = await runWorkflowGroup(
    drama,
    { id: 'group-a', storyboard_ids: [11], pipeline: ['image'] },
    {
      createImage: async () => {
        throw new Error(`Invalid API key ${PROVIDER_SECRET}`)
      },
    },
  )
  assert.equal(summary.ok.length, 0)
  assert.equal(summary.failed.length, 1)
  assert.equal(isChineseWithoutSecret(summary.failed[0].error), true)

  const controller = new AbortController()
  controller.abort()
  await assert.rejects(
    runWorkflowGroup(
      drama,
      { id: 'group-a', storyboard_ids: [11], pipeline: ['image'] },
      { signal: controller.signal },
    ),
    (error) => error?.name === 'AbortError' && /\u53d6\u6d88/.test(error.message),
  )
})

test('canvas batch generation remains cancellable from the page and leave barrier', () => {
  assert.match(dramaCanvasSource, /abortEpisodeGenerate/)
  assert.match(dramaCanvasSource, /function cancelEpisodeGenerate\(\) \{[\s\S]*abortEpisodeGenerate\(\)/)
  assert.match(dramaCanvasSource, /ensureEpisodeGenerationFinished/)
  assert.match(dramaCanvasSource, /if \(!await ensureEpisodeGenerationFinished\(\)\) return false/)
  assert.match(dramaCanvasSource, /&& !episodeGenerating\.value/)
  assert.match(dramaCanvasSource, /abortEpisodeGenerate\(\)/)
})

test('canvas workflow execution remains cancellable from the page toolbar', () => {
  const workflowToolbar = read('../src/components/dramaCanvas/CanvasWorkflowToolbarGroup.vue')
  const desktopToolbar = read('../src/components/dramaCanvas/CanvasDesktopToolbar.vue')
  assert.match(dramaCanvasSource, /function cancelActiveWorkflow\(\)/)
  assert.match(dramaCanvasSource, /workflowProgress\.value = '\u6b63\u5728\u53d6\u6d88\u2026'/)
  assert.match(dramaCanvasSource, /run\.controller\.abort\(\)/)
  assert.match(dramaCanvasSource, /isWorkflowAbortError/)
  assert.match(dramaCanvasSource, /@cancel-workflow="cancelActiveWorkflow"/)
  assert.match(desktopToolbar, /@cancel-workflow="emit\('cancel-workflow'\)"/)
  assert.match(desktopToolbar, /:workflow-progress="workflowProgress"/)
  assert.match(workflowToolbar, /aria-label="\u53d6\u6d88\u6267\u884c"/)
  assert.match(workflowToolbar, /@click="emit\('cancel-workflow'\)"/)
  assert.match(workflowToolbar, />\s*\u53d6\u6d88\u6267\u884c\s*</)
  const cancelAt = workflowToolbar.indexOf("emit('cancel-workflow')")
  assert.ok(cancelAt >= 0, 'missing cancel-workflow emit')
  const cancelStart = workflowToolbar.lastIndexOf('<el-button', cancelAt)
  const cancelEnd = workflowToolbar.indexOf('</el-button>', cancelAt)
  const around = workflowToolbar.slice(cancelStart, cancelEnd)
  assert.match(around, /v-if="workflowRunning"/)
  assert.doesNotMatch(around, /CanvasActionGate/)
  assert.doesNotMatch(around, /actionReasons\.runWorkflow/)
  assert.doesNotMatch(around, /:disabled=/)
  assert.match(workflowToolbar, /props\.workflowRunning && props\.workflowProgress/)
})

test('工作流轮询缺少任务编号时使用简体中文且不暴露字段名', async () => {
  const source = read('../src/composables/useCanvasWorkflowRunner.js')
  assert.doesNotMatch(source, /缺少 task_id/)
  assert.doesNotMatch(source, /supports_grid_reference/)
  assert.match(source, /error: '缺少任务编号'/)
  const result = await pollTaskSimple('')
  assert.deepEqual(result, { status: 'failed', error: '缺少任务编号' })
})
