import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { h, nextTick } from 'vue'

import { setFreeCanvasUxState } from '../src/components/dramaCanvas/freeCanvasUx.js'
import {
  buttonByAriaLabel,
  buttonByText,
  compileIconStub,
  compileSfc,
  createHostRenderer,
  findByClass,
  loadCompiledSfc,
  mountHarness,
  textContent,
  vueUrl,
} from './helpers/vueComponentHarness.js'

const toolbarUrl = new URL('../src/components/dramaCanvas/FreeCanvasToolbar.vue', import.meta.url)
const canvasActionGateUrl = new URL('../src/components/dramaCanvas/CanvasActionGate.vue', import.meta.url)
const freeCanvasUxUrl = new URL('../src/components/dramaCanvas/freeCanvasUx.js', import.meta.url)
const freeCanvasComposableSource = readFileSync(
  new URL('../src/composables/useDramaCanvasFreeCanvas.js', import.meta.url),
  'utf8',
)

const iconStubUrl = compileIconStub([
  'CopyDocument',
  'Delete',
  'Document',
  'FolderOpened',
  'Hide',
  'FullScreen',
  'View',
  'Link',
  'Picture',
  'Plus',
  'RefreshLeft',
  'RefreshRight',
  'Setting',
  'VideoPlay',
])
const compiledCanvasActionGateUrl = compileSfc(
  canvasActionGateUrl,
  'free-canvas-toolbar-action-gate',
  new Map([['vue', vueUrl]]),
)
const FreeCanvasToolbar = await loadCompiledSfc(
  toolbarUrl,
  'free-canvas-toolbar-component',
  new Map([
    ['vue', vueUrl],
    ['@element-plus/icons-vue', iconStubUrl],
    ['./CanvasActionGate.vue', compiledCanvasActionGateUrl],
    ['./freeCanvasUx.js', freeCanvasUxUrl.href],
  ]),
)

const renderer = createHostRenderer()
const toolbarEventListeners = {
  onCreateNode: (value, events) => events.push(['create-node', value]),
  onUndo: (_value, events) => events.push(['undo']),
  onRedo: (_value, events) => events.push(['redo']),
  onFitView: (_value, events) => events.push(['fit-view']),
  onSetBackground: (value, events) => events.push(['set-background', value]),
  onToggleLibrary: (_value, events) => events.push(['toggle-library']),
  onSetMode: (value, events) => events.push(['set-mode', value]),
  onCopySelection: (_value, events) => events.push(['copy-selection']),
  onDeleteSelection: (_value, events) => events.push(['delete-selection']),
  onToggleHideProduction: (value, events) => events.push(['toggle-hide-production', value]),
}

function mountToolbar(initialProps = {}) {
  const events = []
  const props = {
    mode: 'free',
    canUndo: false,
    canRedo: false,
    backgroundMode: 'dots',
    showModeSwitch: false,
    libraryVisible: false,
    selectionCount: 0,
    ...initialProps,
  }
  const mounted = mountHarness(renderer, () => {
    const listeners = {}
    for (const [name, listener] of Object.entries(toolbarEventListeners)) {
      listeners[name] = (value) => listener(value, events)
    }
    return h(FreeCanvasToolbar, { ...props, ...listeners })
  })
  return { ...mounted, events, props }
}

test('没有历史时撤销入口展示中文不可用原因，有历史才发出撤销', () => {
  setFreeCanvasUxState({ nodeCount: 3, readonly: false, selectionCount: 0 })
  const disabled = mountToolbar({ canUndo: false, canRedo: false, selectionCount: 0 })
  try {
    const undo = buttonByAriaLabel(disabled.root, '撤销不可用：没有可撤销的操作')
    assert.ok(undo)
    assert.equal(undo.props.disabled, true)
    assert.equal(undo.props.title, '没有可撤销的操作')
    const redo = buttonByAriaLabel(disabled.root, '重做不可用：没有可重做的操作')
    assert.ok(redo)
    assert.equal(redo.props.disabled, true)
  } finally {
    disabled.app.unmount()
  }

  const enabled = mountToolbar({ canUndo: true, canRedo: true, selectionCount: 0 })
  try {
    const undo = buttonByAriaLabel(enabled.root, '撤销')
    assert.ok(undo)
    assert.notEqual(undo.props.disabled, true)
    assert.match(String(undo.props.title), /撤销/)
    undo.props.onClick()
    assert.deepEqual(enabled.events, [['undo']])
  } finally {
    enabled.app.unmount()
  }
})

test('多选删除入口文案是删除所选节点，确认框标题和按钮保持中文', async () => {
  setFreeCanvasUxState({ nodeCount: 4, readonly: false, selectionCount: 2 })
  const single = mountToolbar({ selectionCount: 1 })
  try {
    assert.match(textContent(single.root), /已选 1 项/)
    assert.equal(buttonByAriaLabel(single.root, '删除所选节点'), undefined)
  } finally {
    single.app.unmount()
  }

  const multi = mountToolbar({ selectionCount: 2 })
  try {
    await nextTick()
    assert.match(textContent(multi.root), /已选 2 项/)
    const remove = buttonByAriaLabel(multi.root, '删除所选节点')
    assert.ok(remove)
    assert.match(String(remove.props.title), /删除所选节点/)
    remove.props.onClick()
    assert.deepEqual(multi.events, [['delete-selection']])
  } finally {
    multi.app.unmount()
  }

  assert.match(freeCanvasComposableSource, /async function deleteFreeCanvasSelection/)
  assert.match(freeCanvasComposableSource, /ElMessageBox\.confirm\(/)
  assert.match(freeCanvasComposableSource, /'删除确认'/)
  assert.match(freeCanvasComposableSource, /confirmButtonText: '删除'/)
  assert.match(freeCanvasComposableSource, /cancelButtonText: '取消'/)
  assert.match(freeCanvasComposableSource, /确定删除/)
  assert.match(freeCanvasComposableSource, /此操作不可恢复/)
})

test('只读或未多选时对齐入口展示中文原因', () => {
  setFreeCanvasUxState({ nodeCount: 3, readonly: true, selectionCount: 2 })
  const readonly = mountToolbar({ selectionCount: 2 })
  try {
    const align = buttonByText(readonly.root, '对齐')
    assert.ok(align)
    assert.equal(align.props.disabled, true)
    assert.equal(align.props.title, '当前自由画布为只读，无法对齐节点')
    const [gate] = findByClass(readonly.root, 'canvas-action-gate')
    assert.ok(gate)
    assert.match(textContent(gate), /当前自由画布为只读，无法对齐节点/)
  } finally {
    readonly.app.unmount()
    setFreeCanvasUxState({ readonly: false })
  }

  setFreeCanvasUxState({ nodeCount: 3, readonly: false, selectionCount: 1 })
  const few = mountToolbar({ selectionCount: 1 })
  try {
    const align = buttonByText(few.root, '对齐')
    assert.ok(align)
    assert.equal(align.props.disabled, true)
    assert.equal(align.props.title, '请先框选至少 2 个节点再对齐')
  } finally {
    few.app.unmount()
  }
})
test('隐藏制作节点后工具条露出可点的显示制作节点', () => {
  setFreeCanvasUxState({ nodeCount: 0, readonly: false, selectionCount: 0 })
  const hidden = mountToolbar({ hideProductionNodes: true, selectionCount: 0 })
  try {
    assert.match(textContent(hidden.root), /制作节点已隐藏，下一步可显示回来或新建自由节点/)
    const reveal = buttonByAriaLabel(hidden.root, '显示制作节点')
    assert.ok(reveal)
    reveal.props.onClick()
    assert.equal(hidden.events[0][0], 'toggle-hide-production')
    assert.equal(hidden.events[0][1], false)
  } finally {
    hidden.app.unmount()
  }
})

test('节点较多时提示可见区域，达到上限后禁用新建', async () => {
  setFreeCanvasUxState({ nodeCount: 120, readonly: false, selectionCount: 0 })
  const density = mountToolbar({ selectionCount: 0 })
  try {
    await nextTick()
    assert.match(textContent(density.root), /节点较多（120\/500），当前只渲染可见区域/)
    const create = buttonByAriaLabel(density.root, '新建自由节点')
    assert.ok(create)
    assert.notEqual(create.props.disabled, true)
  } finally {
    density.app.unmount()
  }

  setFreeCanvasUxState({ nodeCount: 400, readonly: false, selectionCount: 0 })
  const warning = mountToolbar({ selectionCount: 0 })
  try {
    await nextTick()
    assert.match(textContent(warning.root), /自由画布节点较多（400\/500），继续添加可能影响操作流畅度/)
    const create = buttonByAriaLabel(warning.root, '新建自由节点')
    assert.ok(create)
    assert.notEqual(create.props.disabled, true)
  } finally {
    warning.app.unmount()
  }

  setFreeCanvasUxState({ nodeCount: 500, readonly: false, selectionCount: 0 })
  const limit = mountToolbar({ selectionCount: 0 })
  try {
    await nextTick()
    assert.match(textContent(limit.root), /自由画布已达到 500 个节点上限，请先整理后再添加/)
    const create = buttonByAriaLabel(limit.root, '自由画布已达到 500 个节点上限，请先整理后再添加')
    assert.ok(create)
    assert.equal(create.props.disabled, true)
    create.props.onClick?.()
    assert.deepEqual(limit.events, [])
  } finally {
    limit.app.unmount()
    setFreeCanvasUxState({ nodeCount: 0 })
  }
})
