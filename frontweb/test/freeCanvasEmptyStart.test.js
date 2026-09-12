import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { h } from 'vue'
import { readDramaCanvasPageSource } from './helpers/dramaCanvasPageSource.js'

import {
  buttonByText,
  click,
  compileIconStub,
  createHostRenderer,
  loadCompiledSfc,
  mountHarness,
  textContent,
  vueUrl,
} from './helpers/vueComponentHarness.js'

const componentUrl = new URL('../src/components/dramaCanvas/FreeCanvasEmptyStart.vue', import.meta.url)
const viewSource = readDramaCanvasPageSource()
const componentSource = readFileSync(componentUrl, 'utf8')

const iconStubUrl = compileIconStub(['Document', 'FolderOpened', 'Setting', 'View'])
const FreeCanvasEmptyStart = await loadCompiledSfc(
  componentUrl,
  'free-canvas-empty-start',
  new Map([
    ['vue', vueUrl],
    ['@element-plus/icons-vue', iconStubUrl],
  ]),
)

const renderer = createHostRenderer()

function mountEmptyStart(extraProps = {}) {
  const created = []
  const opened = []
  const revealed = []
  const harness = mountHarness(renderer, () => h(FreeCanvasEmptyStart, {
    createFreeCanvasNode: (type) => created.push(type),
    openFreeCanvasMediaPicker: () => opened.push(true),
    setHideProductionNodes: (value) => revealed.push(value),
    ...extraProps,
  }))
  return { ...harness, created, opened, revealed }
}

test('DramaCanvas 把自由画布空态交给独立起步组件，制作空态仍走 CanvasEmptyState', () => {
  assert.match(viewSource, /<CanvasEmptyState/)
  assert.match(viewSource, /<FreeCanvasEmptyStart/)
  assert.match(viewSource, /v-if="canvasMode === 'free' && !loading && !freeNodeCount"/)
  assert.match(viewSource, /:create-free-canvas-node="createFreeCanvasNode"/)
  assert.match(viewSource, /:open-free-canvas-media-picker="openFreeCanvasMediaPicker"/)
  assert.match(viewSource, /:hide-production-nodes="hideProductionNodes"/)
  assert.match(viewSource, /:set-hide-production-nodes="setHideProductionNodes"/)
  assert.match(componentSource, /class="free-canvas-empty-state"/)
  assert.match(componentSource, /id="free-canvas-empty-desc"/)
  assert.match(componentSource, /@click="createFreeCanvasNode\('text'\)"/)
  assert.match(componentSource, /@click="createFreeCanvasNode\('config'\)"/)
  assert.match(componentSource, /@click="openFreeCanvasMediaPicker"/)
})

test('自由画布空态说明可见，并可新建文本、配置或导入媒体', () => {
  const harness = mountEmptyStart()
  try {
    const copy = textContent(harness.root)
    assert.match(copy, /开始自由创作/)
    assert.match(copy, /还没有自由节点/)
    click(buttonByText(harness.root, '新建文本'))
    click(buttonByText(harness.root, '新建配置'))
    click(buttonByText(harness.root, '导入媒体'))
    assert.deepEqual(harness.created, ['text', 'config'])
    assert.deepEqual(harness.opened, [true])
  } finally {
    harness.app.unmount()
  }
})

test('隐藏制作节点后空态下一步可显示回来', () => {
  const harness = mountEmptyStart({ hideProductionNodes: true })
  try {
    const copy = textContent(harness.root)
    assert.match(copy, /制作节点已隐藏/)
    assert.match(copy, /可先显示回来/)
    click(buttonByText(harness.root, '显示制作节点'))
    assert.deepEqual(harness.revealed, [false])
  } finally {
    harness.app.unmount()
  }
})

test('空态主操作可自动聚焦，隐藏制作节点时优先显示回来', () => {
  assert.match(componentSource, /:autofocus="!hideProductionNodes"/)
  assert.match(componentSource, /autofocus\s+aria-label="显示制作节点"/)
})
