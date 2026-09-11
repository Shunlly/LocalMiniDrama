import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { h, nextTick } from 'vue'

import {
  LIST_WINDOW_MIN_RENDERED,
} from '../src/utils/listWindow.js'
import {
  buttonByAriaLabel,
  compileIconStub,
  compileSfc,
  createHostRenderer,
  findAll,
  findByType,
  loadCompiledSfc,
  mountHarness,
  textContent,
  vueUrl,
} from './helpers/vueComponentHarness.js'

const windowedListUrl = new URL('../src/components/dramaCanvas/CanvasWindowedList.vue', import.meta.url)
const listWindowHref = new URL('../src/utils/listWindow.js', import.meta.url).href
const compiledWindowedListUrl = compileSfc(
  windowedListUrl,
  'canvas-windowed-list',
  new Map([['@/utils/listWindow.js', listWindowHref]]),
)

const productionSidebarUrl = new URL('../src/components/dramaCanvas/CanvasProductionSidebar.vue', import.meta.url)
const workflowListUrl = new URL('../src/components/dramaCanvas/CanvasWorkflowSidebarList.vue', import.meta.url)
const assetSidebarUrl = new URL('../src/components/dramaCanvas/FreeCanvasAssetSidebar.vue', import.meta.url)
const iconStubUrl = compileIconStub(['ArrowDown', 'ArrowUp', 'Rank', 'Close', 'FolderOpened', 'Search', 'Upload'])
const compiledWorkflowListUrl = compileSfc(
  workflowListUrl,
  'canvas-workflow-sidebar-list-window',
  new Map([
    ['vue', vueUrl],
    ['@element-plus/icons-vue', iconStubUrl],
  ]),
)

const CanvasProductionSidebar = await loadCompiledSfc(
  productionSidebarUrl,
  'canvas-production-sidebar-window',
  new Map([
    ['vue', vueUrl],
    ['@/components/dramaCanvas/CanvasWindowedList.vue', compiledWindowedListUrl],
    ['@/components/dramaCanvas/CanvasWorkflowSidebarList.vue', compiledWorkflowListUrl],
  ]),
)

const FreeCanvasAssetSidebar = await loadCompiledSfc(
  assetSidebarUrl,
  'free-canvas-asset-sidebar-window',
  new Map([
    ['vue', vueUrl],
    ['@element-plus/icons-vue', iconStubUrl],
    ['@/components/dramaCanvas/CanvasWindowedList.vue', compiledWindowedListUrl],
    ['@/utils/freeCanvasMedia', new URL('../src/utils/freeCanvasMedia.js', import.meta.url).href],
  ]),
)

const renderer = createHostRenderer()

function namedWindow(root, name) {
  return findAll(root, (node) => node.props?.['data-window-name'] === name)[0]
}

function buttonsWithPrefix(root, prefix) {
  return findByType(root, 'button').filter((node) => String(node.props?.['aria-label'] || '').startsWith(prefix))
}

function manyItems(count, factory) {
  return Array.from({ length: count }, (_, index) => factory(index))
}

function emitHostScroll(node, scrollTop, clientHeight = 256) {
  const handler = node.props.onScrollPassive || node.props.onScroll
  assert.equal(typeof handler, 'function', 'scroll handler missing: ' + Object.keys(node.props || {}).join(','))
  handler({ target: { scrollTop, clientHeight } })
}

test('制作页源码没有接入画布侧栏窗口，停止等待文案保持不变', () => {
  const filmCreate = readFileSync(new URL('../src/views/FilmCreate.vue', import.meta.url), 'utf8')
  const nodeSource = readFileSync(new URL('../src/components/dramaCanvas/FreeCanvasNode.vue', import.meta.url), 'utf8')
  const inspector = readFileSync(new URL('../src/components/dramaCanvas/FreeCanvasInspector.vue', import.meta.url), 'utf8')
  assert.doesNotMatch(filmCreate, /CanvasWindowedList/)
  assert.doesNotMatch(filmCreate, /listWindow/)
  assert.match(nodeSource, />\s*停止等待\s*</)
  assert.match(inspector, /aria-label="停止等待"/)
})

test('制作侧栏 80 个角色只挂载窗口内项，滚动后换窗', async () => {
  const characters = manyItems(80, (index) => ({ id: 1000 + index, name: `角色${index + 1}` }))
  const harness = mountHarness(renderer, () => h(CanvasProductionSidebar, {
    drama: { id: 9, characters, scenes: [], props: [] },
    canvasMode: 'production',
    highlightAssetId: null,
    workflowGroups: [],
    activeGroupId: null,
    workflowStoryboardDetails: {},
    workflowOrderSaving: false,
    workflowRunning: false,
    focusScriptNode() {},
    openCreateDialog() {},
    clearAssetHighlight() {},
    selectSidebarAsset() {},
    setActiveGroupId() {},
    reorderWorkflowStoryboards() {},
  }))
  try {
    await nextTick()
    const windowRoot = namedWindow(harness.root, 'characters')
    assert.ok(windowRoot)
    const rendered = buttonsWithPrefix(harness.root, '定位角色')
    assert.ok(rendered.length < 80)
    assert.ok(rendered.length >= LIST_WINDOW_MIN_RENDERED)
    assert.equal(Number(windowRoot.props['data-window-total']), 80)
    assert.equal(Number(windowRoot.props['data-window-count']), rendered.length)
    assert.ok(buttonByAriaLabel(harness.root, '定位角色角色1'))
    assert.equal(buttonByAriaLabel(harness.root, '定位角色角色80'), undefined)

    emitHostScroll(windowRoot, 40 * 32)
    await nextTick()
    const afterScroll = buttonsWithPrefix(harness.root, '定位角色')
    assert.ok(afterScroll.length < 80)
    assert.equal(buttonByAriaLabel(harness.root, '定位角色角色1'), undefined)
    assert.ok(afterScroll.length >= LIST_WINDOW_MIN_RENDERED)
    assert.match(afterScroll.map((node) => textContent(node)).join(','), /角色4[0-9]/)
  } finally {
    harness.app.unmount()
  }
})

test('制作侧栏高亮最后一项时只把窗口挪过去，不整表挂载', async () => {
  const characters = manyItems(80, (index) => ({ id: 2000 + index, name: `角色${index + 1}` }))
  const harness = mountHarness(renderer, () => h(CanvasProductionSidebar, {
    drama: { id: 9, characters, scenes: [], props: [] },
    canvasMode: 'production',
    highlightAssetId: 'char:2079',
    workflowGroups: [],
    activeGroupId: null,
    workflowStoryboardDetails: {},
    workflowOrderSaving: false,
    workflowRunning: false,
    focusScriptNode() {},
    openCreateDialog() {},
    clearAssetHighlight() {},
    selectSidebarAsset() {},
    setActiveGroupId() {},
    reorderWorkflowStoryboards() {},
  }))
  try {
    await nextTick()
    const rendered = buttonsWithPrefix(harness.root, '定位角色')
    assert.ok(rendered.length < 80)
    assert.ok(buttonByAriaLabel(harness.root, '定位角色角色80'))
    assert.equal(buttonByAriaLabel(harness.root, '定位角色角色1'), undefined)
  } finally {
    harness.app.unmount()
  }
})

test('自由画布素材栏 80 个项目素材只渲染窗口内项', async () => {
  const assets = manyItems(80, (index) => ({
    id: 3000 + index,
    drama_id: 7,
    type: index % 2 ? 'video' : 'image',
    name: `项目素材${index + 1}`,
  }))
  const harness = mountHarness(renderer, () => h(FreeCanvasAssetSidebar, {
    projectId: 7,
    characters: manyItems(80, (index) => ({ id: 4000 + index, name: `角色${index + 1}` })),
    scenes: [],
    propsList: [],
    storyboardMedia: [],
    assets,
  }))
  try {
    await nextTick()
    const assetWindow = namedWindow(harness.root, 'project-assets')
    const characterWindow = namedWindow(harness.root, 'characters')
    assert.ok(assetWindow)
    assert.ok(characterWindow)
    const assetButtons = buttonsWithPrefix(harness.root, '添加项目素材')
    const characterButtons = buttonsWithPrefix(harness.root, '添加角色')
    assert.ok(assetButtons.length < 80)
    assert.ok(characterButtons.length < 80)
    assert.ok(assetButtons.length >= 1)
    assert.equal(Number(assetWindow.props['data-window-total']), 80)
    assert.equal(Number(assetWindow.props['data-window-count']), assetButtons.length)
    assert.ok(buttonByAriaLabel(harness.root, '添加项目素材项目素材1'))
    assert.equal(buttonByAriaLabel(harness.root, '添加项目素材项目素材80'), undefined)

    emitHostScroll(assetWindow, 50 * 32)
    await nextTick()
    assert.equal(buttonByAriaLabel(harness.root, '添加项目素材项目素材1'), undefined)
    const scrolled = buttonsWithPrefix(harness.root, '添加项目素材')
    assert.ok(scrolled.length < 80)
    assert.match(scrolled.map((node) => textContent(node)).join(','), /项目素材5[0-9]/)
  } finally {
    harness.app.unmount()
  }
})
