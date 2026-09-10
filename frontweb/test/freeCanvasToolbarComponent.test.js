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
  'FullScreen',
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
    assert.equal(undo.props.title, '撤销')
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
    assert.equal(remove.props.title, '删除所选节点')
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