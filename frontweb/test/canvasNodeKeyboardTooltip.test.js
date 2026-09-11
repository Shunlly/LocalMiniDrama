import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { defineComponent, h, nextTick, provide } from 'vue'

import { CANVAS_CONTEXT_KEY } from '../src/composables/useCanvasContext.js'
import {
  buttonByAriaLabel,
  compileIconStub,
  compileSfc,
  createHostRenderer,
  findAll,
  loadCompiledSfc,
  mountHarness,
  textContent,
  vueUrl,
} from './helpers/vueComponentHarness.js'

function read(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8')
}

const overlayUrl = new URL('../src/components/dramaCanvas/CanvasNodeStatusOverlay.vue', import.meta.url)
const toolbarUrl = new URL('../src/components/dramaCanvas/CanvasDesktopToolbar.vue', import.meta.url)
const toolbarGroupUrl = new URL('../src/components/dramaCanvas/CanvasToolbarGroup.vue', import.meta.url)
const workflowToolbarUrl = new URL('../src/components/dramaCanvas/CanvasWorkflowToolbarGroup.vue', import.meta.url)
const actionGateUrl = new URL('../src/components/dramaCanvas/CanvasActionGate.vue', import.meta.url)
const freeCanvasUxUrl = new URL('../src/components/dramaCanvas/freeCanvasUx.js', import.meta.url)
const canvasUiStateUrl = new URL('../src/utils/canvasUiState.js', import.meta.url)
const headerUrl = new URL('../src/components/dramaCanvas/CanvasPageHeader.vue', import.meta.url)
const contextUrl = new URL('../src/composables/useCanvasContext.js', import.meta.url)

const overlaySource = read('../src/components/dramaCanvas/CanvasNodeStatusOverlay.vue')
const scriptNodeSource = read('../src/components/dramaCanvas/CanvasScriptNode.vue')
const storyboardNodeSource = read('../src/components/dramaCanvas/CanvasStoryboardNode.vue')
const assetNodeSource = read('../src/components/dramaCanvas/CanvasAssetNode.vue')
const mediaNodeSource = read('../src/components/dramaCanvas/CanvasMediaNode.vue')
const desktopToolbarSource = read('../src/components/dramaCanvas/CanvasDesktopToolbar.vue')
const pageHeaderSource = read('../src/components/dramaCanvas/CanvasPageHeader.vue')
const emptyStateSource = read('../src/components/dramaCanvas/CanvasEmptyState.vue')
const freeToolbarSource = read('../src/components/dramaCanvas/FreeCanvasToolbar.vue')

test('制作节点加载层始终露出中文状态，不只转圈', () => {
  assert.match(overlaySource, /role="status"/)
  assert.match(overlaySource, /aria-live="polite"/)
  assert.match(overlaySource, /aria-busy="true"/)
  assert.match(overlaySource, /aria-hidden="true"/)
  assert.match(overlaySource, /class="spinner"/)
  assert.match(overlaySource, /class="msg"/)
  assert.match(overlaySource, /处理中…/)
  assert.match(overlaySource, /fallbackMessage/)
  assert.match(overlaySource, /fromStatus \|\| fallbackText\.value \|\| '处理中…'/)
})

test('制作节点在生成或加载时把中文状态交给 overlay，并标明 Enter/空格', () => {
  for (const source of [scriptNodeSource, storyboardNodeSource, assetNodeSource, mediaNodeSource]) {
    assert.match(source, /:aria-label="accessibleLabel"/)
    assert.match(source, /:title="accessibleLabel"/)
    assert.match(source, /:fallback-message="busyFallback"/)
    assert.match(source, /@keydown\.enter\.stop\.prevent="openPanel"/)
    assert.match(source, /@keydown\.space\.stop\.prevent="openPanel"/)
    assert.match(source, /按 Enter 或空格展开/)
  }
  assert.match(scriptNodeSource, /处理中…/)
  assert.match(storyboardNodeSource, /生成中/)
  assert.match(assetNodeSource, /正在加载预览/)
  assert.match(assetNodeSource, /label: '加载中'/)
  assert.match(mediaNodeSource, /正在加载预览/)
  assert.match(mediaNodeSource, /storyboard\?\.status === 'processing'/)
})

test('关键按钮补中文 title，已有快捷键才写快捷键，不编造', () => {
  assert.match(desktopToolbarSource, /:title="actionReasons.editScript \|\| '编辑剧本'"/)
  assert.match(desktopToolbarSource, /:title="actionReasons.createStoryboard \|\| '新建分镜'"/)
  assert.match(desktopToolbarSource, /aria-label="新建剧集" title="新建剧集"/)
  assert.match(desktopToolbarSource, /:title="actionReasons.generateStoryboards \|\| 'AI 生成分镜'"/)
  assert.match(desktopToolbarSource, /aria-label="AI 生成分镜"/)
  assert.match(desktopToolbarSource, />\s*AI 分镜\s*</)
  assert.match(desktopToolbarSource, /aria-label="返回列表模式" title="返回列表模式"/)
  assert.match(desktopToolbarSource, />\s*列表模式\s*</)
  assert.match(desktopToolbarSource, /:title="alignTooltip"/)
  assert.doesNotMatch(desktopToolbarSource, /编辑剧本（Ctrl/)
  assert.doesNotMatch(desktopToolbarSource, /AI 生成分镜（Ctrl/)
  assert.doesNotMatch(desktopToolbarSource, /返回列表模式（/)
  assert.doesNotMatch(desktopToolbarSource, /新建分镜（Ctrl/)
  assert.match(pageHeaderSource, /aria-label="返回列表模式" title="返回列表模式"/)
  assert.match(emptyStateSource, /aria-label="返回列表模式"\s+title="返回列表模式"/)
  assert.match(freeToolbarSource, /撤销（Ctrl\+Z）/)
  assert.match(freeToolbarSource, /重做（Ctrl\+Y）/)
  assert.match(freeToolbarSource, /复制所选节点（Ctrl\+C）/)
  assert.match(freeToolbarSource, /删除所选节点（Delete）/)
})

test('制作/自由短文案保留，无障碍名区分剧集画布和自由画布', () => {
  for (const source of [desktopToolbarSource, freeToolbarSource]) {
    assert.match(source, />\s*制作\s*</)
    assert.match(source, />\s*自由\s*</)
    assert.match(source, /aria-label="剧集画布"/)
    assert.match(source, /title="剧集画布"/)
    assert.match(source, /aria-label="自由画布"/)
    assert.match(source, /title="自由画布不跑本集生成"/)
    assert.doesNotMatch(source, />剧集画布</)
    assert.doesNotMatch(source, />自由画布</)
  }
})

const CanvasNodeStatusOverlay = await loadCompiledSfc(
  overlayUrl,
  'canvas-node-status-overlay',
  new Map([
    ['vue', vueUrl],
    ['@/composables/useCanvasContext', contextUrl.href],
  ]),
)

const renderer = createHostRenderer()

function mountOverlay({ map = {}, nodeId = 'sb:1', fallbackMessage = '' } = {}) {
  const Harness = defineComponent({
    setup() {
      provide(CANVAS_CONTEXT_KEY, { nodeStatus: { map } })
      return () => h(CanvasNodeStatusOverlay, { nodeId, fallbackMessage })
    },
  })
  const mounted = mountHarness(renderer, () => h(Harness))
  return mounted
}

test('overlay 空 message 仍显示处理中，fallback 可在无 nodeStatus 时露出生成中', async () => {
  const emptyMessage = mountOverlay({
    map: { 'sb:1': { step: 'image', message: '' } },
  })
  const fallbackOnly = mountOverlay({
    map: {},
    fallbackMessage: '生成中',
  })
  const hidden = mountOverlay({ map: {} })
  try {
    await nextTick()
    assert.match(textContent(emptyMessage.root), /处理中…/)
    assert.equal(findAll(emptyMessage.root, (node) => node.props?.class === 'spinner').length, 1)
    const status = findAll(emptyMessage.root, (node) => node.props?.role === 'status')[0]
    assert.ok(status)
    assert.equal(status.props['aria-live'], 'polite')
    assert.match(textContent(fallbackOnly.root), /生成中/)
    assert.doesNotMatch(textContent(hidden.root), /处理中…/)
    assert.equal(findAll(hidden.root, (node) => node.props?.class === 'spinner').length, 0)
  } finally {
    emptyMessage.app.unmount()
    fallbackOnly.app.unmount()
    hidden.app.unmount()
  }
})

const iconStubUrl = compileIconStub([
  'ArrowDown',
  'Box',
  'Delete',
  'Document',
  'Grid',
  'List',
  'MagicStick',
  'Moon',
  'Picture',
  'Plus',
  'Refresh',
  'Sunny',
  'Tickets',
  'VideoPlay',
])
const compiledActionGateUrl = compileSfc(actionGateUrl, 'canvas-tooltip-action-gate', new Map([['vue', vueUrl]]))
const compiledToolbarGroupUrl = compileSfc(toolbarGroupUrl, 'canvas-tooltip-toolbar-group', new Map([['vue', vueUrl]]))
const compiledWorkflowToolbarUrl = compileSfc(
  workflowToolbarUrl,
  'canvas-tooltip-workflow-toolbar',
  new Map([
    ['vue', vueUrl],
    ['@element-plus/icons-vue', iconStubUrl],
    ['./CanvasToolbarGroup.vue', compiledToolbarGroupUrl],
    ['./CanvasActionGate.vue', compiledActionGateUrl],
    ['@/utils/canvasUiState', canvasUiStateUrl.href],
  ]),
)
const CanvasDesktopToolbar = await loadCompiledSfc(
  toolbarUrl,
  'canvas-tooltip-desktop-toolbar',
  new Map([
    ['vue', vueUrl],
    ['@element-plus/icons-vue', iconStubUrl],
    ['./CanvasToolbarGroup.vue', compiledToolbarGroupUrl],
    ['./CanvasWorkflowToolbarGroup.vue', compiledWorkflowToolbarUrl],
    ['./CanvasActionGate.vue', compiledActionGateUrl],
    ['./freeCanvasUx.js', freeCanvasUxUrl.href],
  ]),
)
const CanvasPageHeader = await loadCompiledSfc(
  headerUrl,
  'canvas-tooltip-page-header',
  new Map([['vue', vueUrl]]),
)

test('桌面工具条按钮 title 与模式切换无障碍名可在真实入口读到', async () => {
  const events = []
  const harness = mountHarness(renderer, () => h(CanvasDesktopToolbar, {
    selectedStoryboardCount: 0,
    workflowGroups: [],
    pipelineSteps: ['image'],
    actionReasons: {},
    actionConfigServices: {},
    canvasMode: 'production',
    onEditScript: () => events.push('edit-script'),
    onCreate: (type) => events.push(['create', type]),
    onGenerateStoryboards: () => events.push('generate-storyboards'),
    onListMode: () => events.push('list-mode'),
    onSetMode: (mode) => events.push(['set-mode', mode]),
    onAlign: () => events.push('align'),
  }))
  try {
    await nextTick()
    const script = buttonByAriaLabel(harness.root, '编辑剧本')
    const storyboard = buttonByAriaLabel(harness.root, '新建分镜')
    const ai = buttonByAriaLabel(harness.root, 'AI 生成分镜')
    const listMode = buttonByAriaLabel(harness.root, '返回列表模式')
    const productionMode = buttonByAriaLabel(harness.root, '剧集画布')
    const freeMode = buttonByAriaLabel(harness.root, '自由画布')
    const align = buttonByAriaLabel(harness.root, '对齐节点')
    assert.ok(script)
    assert.equal(script.props.title, '编辑剧本')
    assert.ok(storyboard)
    assert.equal(storyboard.props.title, '新建分镜')
    assert.ok(ai)
    assert.equal(ai.props.title, 'AI 生成分镜')
    assert.equal(textContent(ai).replace(/\s+/g, ' ').trim(), 'AI 分镜')
    assert.ok(listMode)
    assert.equal(listMode.props.title, '返回列表模式')
    assert.equal(textContent(listMode).replace(/\s+/g, ' ').trim(), '列表模式')
    assert.ok(productionMode)
    assert.equal(productionMode.props.title, '剧集画布')
    assert.equal(textContent(productionMode).replace(/\s+/g, ' ').trim(), '制作')
    assert.ok(freeMode)
    assert.equal(freeMode.props.title, '自由画布不跑本集生成')
    assert.equal(textContent(freeMode).replace(/\s+/g, ' ').trim(), '自由')
    assert.ok(align)
    assert.equal(align.props.title, '自动对齐并适配全部节点')
  } finally {
    harness.app.unmount()
  }
})

test('禁用原因会覆盖默认 title，页头列表模式仍叫返回列表模式', async () => {
  const toolbar = mountHarness(renderer, () => h(CanvasDesktopToolbar, {
    actionReasons: { editScript: '请先选择一集', generateStoryboards: '当前集还没有剧本' },
    canvasMode: 'production',
  }))
  const header = mountHarness(renderer, () => h(CanvasPageHeader, {
    pageTitle: '演示短剧',
    freeCanvasReadOnly: true,
    freeCanvasCompatibilityMessage: '当前自由画布版本不兼容，只能查看',
    goProjectList() {},
    requestEpisodeFilterChange() {},
    retryCanvasSave() {},
    cancelEpisodeGenerate() {},
    goListMode() {},
    retryUnknownStoryboardMedia() {},
  }))
  try {
    await nextTick()
    assert.equal(buttonByAriaLabel(toolbar.root, '编辑剧本').props.title, '请先选择一集')
    assert.equal(buttonByAriaLabel(toolbar.root, 'AI 生成分镜').props.title, '当前集还没有剧本')
    const listMode = buttonByAriaLabel(header.root, '返回列表模式')
    assert.ok(listMode)
    assert.equal(listMode.props.title, '返回列表模式')
    assert.equal(textContent(listMode).trim(), '列表模式')
  } finally {
    toolbar.app.unmount()
    header.app.unmount()
  }
})
