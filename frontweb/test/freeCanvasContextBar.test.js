import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { getFreeCanvasContextBarModel } from '../src/utils/freeCanvasContextBar.js'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')

test('selected config node context bar exposes generate, AI config and stop-waiting in Chinese', () => {
  const hidden = getFreeCanvasContextBarModel({ node: null })
  assert.equal(hidden.visible, false)

  const ready = getFreeCanvasContextBarModel({
    node: { id: 'config-1', type: 'config', title: '镜头配置' },
    configRuntime: {
      canGenerate: true,
      canCancel: false,
      generateAriaLabel: '生成',
      generateDisabledReason: '',
    },
  })
  assert.equal(ready.visible, true)
  assert.equal(ready.title, '镜头配置')
  assert.deepEqual(ready.actions.map((action) => action.id), ['copy', 'delete', 'generate', 'configure'])
  assert.equal(ready.actions.find((action) => action.id === 'generate').disabled, false)
  assert.equal(ready.actions.find((action) => action.id === 'generate').ariaLabel, '生成')
  assert.equal(ready.actions.find((action) => action.id === 'configure').label, 'AI 配置')

  const running = getFreeCanvasContextBarModel({
    node: { id: 'config-1', type: 'config', title: '镜头配置' },
    configRuntime: { canGenerate: false, canCancel: true },
  })
  assert.deepEqual(running.actions.map((action) => action.id), ['copy', 'delete', 'cancel'])
  assert.equal(running.actions.find((action) => action.id === 'cancel').label, '停止等待')
  assert.doesNotMatch(running.actions.find((action) => action.id === 'cancel').label, /取消生成/)

  const readonly = getFreeCanvasContextBarModel({
    node: { id: 'image-1', type: 'image', title: '参考图' },
    readonly: true,
    saveAssetEligibility: { eligible: true },
  })
  assert.equal(readonly.actions.find((action) => action.id === 'copy').disabled, true)
  assert.match(readonly.actions.find((action) => action.id === 'copy').reason, /只读/)
  assert.equal(readonly.actions.some((action) => action.id === 'save-asset'), true)
})

test('context bar is wired through overlay bindings and keeps generate-config plus copy/delete', () => {
  const overlay = read('../src/components/dramaCanvas/CanvasOverlayHost.vue')
  const bar = read('../src/components/dramaCanvas/FreeCanvasContextBar.vue')
  const toolbar = read('../src/components/dramaCanvas/FreeCanvasToolbar.vue')
  const graph = read('../src/composables/useDramaCanvasGraph.js')
  assert.match(overlay, /<FreeCanvasContextBar/)
  assert.match(overlay, /@generate="generateFreeCanvasConfig"/)
  assert.match(overlay, /@copy="copyFreeCanvasSelection"/)
  assert.match(overlay, /@delete="deleteFreeCanvasSelection"/)
  assert.match(overlay, /@cancel="cancelFreeCanvasConfig"/)
  assert.match(bar, /role="toolbar"/)
  assert.match(bar, /节点操作/)
  assert.match(toolbar, /hideProductionActionLabel/)
  assert.match(toolbar, /toggle-hide-production/)
  assert.match(toolbar, /隐藏制作节点/)
  assert.match(graph, /hideProductionNodes: canvasMode\.value === 'free' && Boolean\(freeCanvas\.value\.hideProductionNodes\)/)
  assert.match(graph, /function setHideProductionNodes/)
})
