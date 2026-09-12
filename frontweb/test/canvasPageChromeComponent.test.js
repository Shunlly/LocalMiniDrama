import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { defineComponent, h, nextTick } from 'vue'

import {
  buttonByAriaLabel,
  click,
  compileIconStub,
  compileSfc,
  createHostRenderer,
  loadCompiledSfc,
  mountHarness,
  textContent,
  vueUrl,
} from './helpers/vueComponentHarness.js'

const chromeUrl = new URL('../src/components/dramaCanvas/CanvasPageChrome.vue', import.meta.url)
const headerUrl = new URL('../src/components/dramaCanvas/CanvasPageHeader.vue', import.meta.url)
const toolbarUrl = new URL('../src/components/dramaCanvas/CanvasDesktopToolbar.vue', import.meta.url)
const toolbarGroupUrl = new URL('../src/components/dramaCanvas/CanvasToolbarGroup.vue', import.meta.url)
const workflowToolbarUrl = new URL('../src/components/dramaCanvas/CanvasWorkflowToolbarGroup.vue', import.meta.url)
const actionGateUrl = new URL('../src/components/dramaCanvas/CanvasActionGate.vue', import.meta.url)
const freeCanvasUxUrl = new URL('../src/components/dramaCanvas/freeCanvasUx.js', import.meta.url)
const canvasUiStateUrl = new URL('../src/utils/canvasUiState.js', import.meta.url)
const canvasExperienceCopyUrl = new URL('../src/components/dramaCanvas/canvasExperienceCopy.js', import.meta.url)

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

const compiledActionGateUrl = compileSfc(
  actionGateUrl,
  'canvas-page-chrome-action-gate',
  new Map([['vue', vueUrl]]),
)
const compiledToolbarGroupUrl = compileSfc(
  toolbarGroupUrl,
  'canvas-page-chrome-toolbar-group',
  new Map([['vue', vueUrl]]),
)
const compiledWorkflowToolbarUrl = compileSfc(
  workflowToolbarUrl,
  'canvas-page-chrome-workflow-toolbar',
  new Map([
    ['vue', vueUrl],
    ['@element-plus/icons-vue', iconStubUrl],
    ['./CanvasToolbarGroup.vue', compiledToolbarGroupUrl],
    ['./CanvasActionGate.vue', compiledActionGateUrl],
    ['@/utils/canvasUiState', canvasUiStateUrl.href],
  ]),
)
const compiledDesktopToolbarUrl = compileSfc(
  toolbarUrl,
  'canvas-page-chrome-desktop-toolbar',
  new Map([
    ['vue', vueUrl],
    ['@element-plus/icons-vue', iconStubUrl],
    ['./CanvasToolbarGroup.vue', compiledToolbarGroupUrl],
    ['./CanvasWorkflowToolbarGroup.vue', compiledWorkflowToolbarUrl],
    ['./CanvasActionGate.vue', compiledActionGateUrl],
    ['./freeCanvasUx.js', freeCanvasUxUrl.href],
  ]),
)
const compiledHeaderUrl = compileSfc(
  headerUrl,
  'canvas-page-chrome-header',
  new Map([
    ['vue', vueUrl],
    ['./canvasExperienceCopy.js', canvasExperienceCopyUrl.href],
  ]),
)
const CanvasPageChrome = await loadCompiledSfc(
  chromeUrl,
  'canvas-page-chrome-component',
  new Map([
    ['vue', vueUrl],
    ['./CanvasPageHeader.vue', compiledHeaderUrl],
    ['./CanvasDesktopToolbar.vue', compiledDesktopToolbarUrl],
    ['./canvasExperienceCopy.js', canvasExperienceCopyUrl.href],
  ]),
)
const CanvasDesktopToolbar = await loadCompiledSfc(
  toolbarUrl,
  'canvas-desktop-toolbar-component',
  new Map([
    ['vue', vueUrl],
    ['@element-plus/icons-vue', iconStubUrl],
    ['./CanvasToolbarGroup.vue', compiledToolbarGroupUrl],
    ['./CanvasWorkflowToolbarGroup.vue', compiledWorkflowToolbarUrl],
    ['./CanvasActionGate.vue', compiledActionGateUrl],
    ['./freeCanvasUx.js', freeCanvasUxUrl.href],
  ]),
)

const renderer = createHostRenderer()
const ElCheckboxGroupStub = defineComponent({
  name: 'ElCheckboxGroupStub',
  setup(_props, { slots }) {
    return () => h('checkbox-group', {}, slots.default?.())
  },
})
const extraStubs = {
  'el-checkbox-group': ElCheckboxGroupStub,
  ElCheckboxGroup: ElCheckboxGroupStub,
}
function chromeHandlers(events) {
  return {
    goProjectList: () => events.push(['go-project-list']),
    requestEpisodeFilterChange: (value) => events.push(['filter-episode', value]),
    retryCanvasSave: () => events.push(['retry-save']),
    cancelEpisodeGenerate: () => events.push(['cancel-generate']),
    goListMode: () => events.push(['go-list-mode']),
    retryUnknownStoryboardMedia: () => events.push(['retry-media']),
    focusScriptNode: () => events.push(['edit-script']),
    openCreateDialog: (type) => events.push(['create', type]),
    onAlignNodes: () => events.push(['align']),
    toggleTheme: () => events.push(['toggle-theme']),
    setCanvasMode: (mode) => events.push(['set-mode', mode]),
    setPipelineSteps: (value) => events.push(['pipeline', value]),
    setActiveGroupId: (value) => events.push(['active-group', value]),
    onCreateWorkflowGroup: () => events.push(['create-workflow']),
    onRunActiveGroup: () => events.push(['run-workflow']),
    cancelActiveWorkflow: () => events.push(['cancel-workflow']),
    onDeleteActiveGroup: () => events.push(['delete-workflow']),
    aiGenerateStoryboards: () => events.push(['generate-storyboards']),
    batchGenerateImages: () => events.push(['batch-images']),
    batchGenerateVideos: () => events.push(['batch-videos']),
  }
}

function mountChrome(initialProps = {}) {
  const events = []
  const props = {
    drama: { title: '演示短剧', episodes: [{ id: 11, title: '开场', episode_number: 1 }] },
    filterEpisodeId: 11,
    actionReasons: {},
    actionConfigServices: {},
    selectedStoryboardIds: [],
    workflowGroups: [],
    pipelineSteps: ['image'],
    canvasMode: 'production',
    ...chromeHandlers(events),
    ...initialProps,
  }
  const mounted = mountHarness(renderer, () => h(CanvasPageChrome, props), { components: extraStubs })
  return { ...mounted, events, props }
}

function mountToolbar(initialProps = {}) {
  const events = []
  const props = {
    selectedStoryboardCount: 0,
    workflowGroups: [],
    pipelineSteps: ['image'],
    actionReasons: {},
    actionConfigServices: {},
    canvasMode: 'production',
    onEditScript: () => events.push(['edit-script']),
    onCreate: (type) => events.push(['create', type]),
    onGenerateStoryboards: () => events.push(['generate-storyboards']),
    onBatchImages: () => events.push(['batch-images']),
    onBatchVideos: () => events.push(['batch-videos']),
    onAlign: () => events.push(['align']),
    onListMode: () => events.push(['list-mode']),
    onToggleTheme: () => events.push(['toggle-theme']),
    onSetMode: (mode) => events.push(['set-mode', mode]),
    ...initialProps,
  }
  const mounted = mountHarness(renderer, () => h(CanvasDesktopToolbar, props), { components: extraStubs })
  return { ...mounted, events }
}

test('桌面工具条可见 AI 分镜，无障碍名是 AI 生成分镜', async () => {
  const harness = mountToolbar()
  try {
    await nextTick()
    const storyboard = buttonByAriaLabel(harness.root, 'AI 生成分镜')
    assert.ok(storyboard, '工具条必须露出 AI 生成分镜')
    assert.equal(textContent(storyboard).replace(/\s+/g, ' ').trim(), 'AI 分镜')
    click(storyboard)
    assert.deepEqual(harness.events, [['generate-storyboards']])
  } finally {
    harness.app.unmount()
  }
})

test('页头闭合区块挂上真实工具条后仍能看到 AI 分镜', async () => {
  const harness = mountChrome()
  try {
    await nextTick()
    const pageText = textContent(harness.root)
    assert.match(pageText, /本地短剧助手/)
    assert.match(pageText, /画布模式/)
    assert.match(pageText, /演示短剧/)
    const logo = buttonByAriaLabel(harness.root, '本地短剧助手，返回项目列表')
    assert.ok(logo)
    click(logo)
    const storyboard = buttonByAriaLabel(harness.root, 'AI 生成分镜')
    assert.ok(storyboard, '页头工具条必须可见 AI 生成分镜')
    assert.equal(textContent(storyboard).replace(/\s+/g, ' ').trim(), 'AI 分镜')
    click(storyboard)
    assert.deepEqual(harness.events, [['go-project-list'], ['generate-storyboards']])
  } finally {
    harness.app.unmount()
  }
})

test('工具条源码合同保持 AI 分镜可见名', () => {
  const toolbarSource = readFileSync(toolbarUrl, 'utf8')
  const chromeSource = readFileSync(chromeUrl, 'utf8')
  assert.match(toolbarSource, /aria-label="AI 生成分镜"/)
  assert.match(toolbarSource, />\s*AI 分镜\s*</)
  assert.match(chromeSource, /@generate-storyboards="aiGenerateStoryboards"/)
})

test('选中空集时工具条给出中文下一步，有分镜后不再提示', async () => {
  const empty = mountChrome({
    drama: {
      title: '演示短剧',
      episodes: [{ id: 11, title: '开场', episode_number: 1, script_content: '', storyboards: [] }],
    },
    filterEpisodeId: 11,
  })
  try {
    await nextTick()
    assert.match(textContent(empty.root), /这一集还是空的，下一步可先写剧本或新建分镜/)
    assert.match(textContent(empty.root), /AI 分镜/)
  } finally {
    empty.app.unmount()
  }

  const filled = mountChrome({
    drama: {
      title: '演示短剧',
      episodes: [{
        id: 11,
        title: '开场',
        episode_number: 1,
        script_content: '对白',
        storyboards: [{ id: 101, title: '镜1' }],
      }],
    },
    filterEpisodeId: 11,
  })
  try {
    await nextTick()
    assert.doesNotMatch(textContent(filled.root), /这一集还是空的/)
    assert.doesNotMatch(textContent(filled.root), /还没有分镜，下一步/)
  } finally {
    filled.app.unmount()
  }
})
