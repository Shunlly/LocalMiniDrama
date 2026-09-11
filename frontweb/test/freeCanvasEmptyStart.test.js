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

const iconStubUrl = compileIconStub(['Document', 'FolderOpened', 'Setting'])
const FreeCanvasEmptyStart = await loadCompiledSfc(
  componentUrl,
  'free-canvas-empty-start',
  new Map([
    ['vue', vueUrl],
    ['@element-plus/icons-vue', iconStubUrl],
  ]),
)

const renderer = createHostRenderer()

function mountEmptyStart() {
  const created = []
  const opened = []
  const harness = mountHarness(renderer, () => h(FreeCanvasEmptyStart, {
    createFreeCanvasNode: (type) => created.push(type),
    openFreeCanvasMediaPicker: () => opened.push(true),
  }))
  return { ...harness, created, opened }
}

test('DramaCanvas 把自由画布空态交给独立起步组件，制作空态仍走 CanvasEmptyState', () => {
  assert.match(viewSource, /<CanvasEmptyState/)
  assert.match(viewSource, /<FreeCanvasEmptyStart/)
  assert.match(viewSource, /v-if="canvasMode === 'free' && !loading && !freeNodeCount"/)
  assert.match(viewSource, /:create-free-canvas-node="createFreeCanvasNode"/)
  assert.match(viewSource, /:open-free-canvas-media-picker="openFreeCanvasMediaPicker"/)
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
