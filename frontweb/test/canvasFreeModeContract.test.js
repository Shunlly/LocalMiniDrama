import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')

const toolbarSource = read('../src/components/dramaCanvas/FreeCanvasToolbar.vue')
const nodeSource = read('../src/components/dramaCanvas/FreeCanvasNode.vue')
const inspectorSource = read('../src/components/dramaCanvas/FreeCanvasInspector.vue')
const desktopToolbarSource = read('../src/components/dramaCanvas/CanvasDesktopToolbar.vue')
const contextMenuSource = read('../src/components/dramaCanvas/CanvasContextMenu.vue')

test('free canvas toolbar names every icon-only action and exposes mode selection', () => {
  for (const label of ['撤销', '重做', '适配视图', '切换背景', '打开素材库']) {
    assert.match(toolbarSource, new RegExp(`aria-label="${label}"`))
    assert.match(toolbarSource, new RegExp(`title="${label}"`))
  }
  assert.match(toolbarSource, /:aria-pressed="mode === 'free'"/)
  assert.match(toolbarSource, /:aria-pressed="mode === 'production'"/)
  for (const event of ['create-node', 'undo', 'redo', 'fit-view', 'set-background', 'toggle-library']) {
    assert.match(toolbarSource, new RegExp(`'${event}'`))
  }
})

test('free mode node renders text safely and protects editor gestures from the canvas', () => {
  assert.doesNotMatch(nodeSource, /v-html/)
  assert.match(nodeSource, /\{\{\s*displayContent\b/)
  assert.match(nodeSource, /v-if="isFreeMode"/)
  assert.match(nodeSource, /<Handle[^>]+v-if="isFreeMode"[^>]+type="target"/)
  assert.match(nodeSource, /<Handle[^>]+v-if="isFreeMode"[^>]+type="source"/)
  assert.match(nodeSource, /nodrag nopan/)
  assert.match(nodeSource, /'update-content', 'request-convert', 'request-delete', 'request-retry'/)
})

test('free canvas inspector exposes an explicit production conversion target', () => {
  assert.match(inspectorSource, /aria-label="转换目标"/)
  assert.match(inspectorSource, /v-model="conversionTarget"/)
  assert.match(inspectorSource, /@click="emitConvertReference"/)
  assert.match(inspectorSource, /'update-node', 'convert-reference', 'save-asset', 'close'/)
  assert.doesNotMatch(inspectorSource, /dramaAPI|fetch\(|axios|request\(/)
})

test('desktop toolbar and context menu expose free mode entry points without replacing production actions', () => {
  assert.match(desktopToolbarSource, /FreeCanvasToolbar/)
  assert.match(desktopToolbarSource, /@create-node="emit\('create-node', \$event\)"/)
  assert.match(contextMenuSource, /free-node/)
  assert.match(contextMenuSource, /'text'/)
  assert.match(contextMenuSource, /'image'/)
})
