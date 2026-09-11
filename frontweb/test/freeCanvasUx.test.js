import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  alignFreeCanvasNodePositions,
  getFreeCanvasAlignDisabledReason,
  getFreeCanvasNodeCapacityHint,
  getFreeCanvasNodeCapacityWarning,
  isFreeCanvasDeleteShortcutBlocked,
} from '../src/components/dramaCanvas/freeCanvasUx.js'
import { remainingExtractNamedFunction } from './helpers/remainingSourceBetween.js'

function read(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8')
}

function targetFor(selectorToken) {
  return {
    closest(selector) {
      return String(selector).includes(selectorToken) ? this : null
    },
  }
}

test('delete shortcut stays blocked for inspector, select and typing chrome, but not toolbar buttons', () => {
  assert.equal(isFreeCanvasDeleteShortcutBlocked({
    target: targetFor('.free-canvas-inspector-dock'),
  }), true)
  assert.equal(isFreeCanvasDeleteShortcutBlocked({
    target: { closest() { return null } },
    activeElement: targetFor('.el-select'),
  }), true)
  assert.equal(isFreeCanvasDeleteShortcutBlocked({
    target: targetFor('textarea'),
  }), true)
  assert.equal(isFreeCanvasDeleteShortcutBlocked({
    target: targetFor('button'),
  }), false)
})

test('align reason and node layout stay in Chinese and only move selected nodes', () => {
  assert.match(getFreeCanvasAlignDisabledReason({ selectionCount: 1 }), /至少 2 个节点/)
  assert.match(getFreeCanvasAlignDisabledReason({ selectionCount: 2, readonly: true }), /只读/)
  assert.equal(getFreeCanvasAlignDisabledReason({ selectionCount: 2 }), '')

  const nodes = [
    { id: 'a', position: { x: 40, y: 10 }, width: 280, height: 208 },
    { id: 'b', position: { x: 200, y: 90 }, width: 280, height: 208 },
    { id: 'c', position: { x: 8, y: 300 }, width: 280, height: 208 },
  ]
  const aligned = alignFreeCanvasNodePositions(nodes, ['a', 'b'], 'left')
  assert.equal(aligned[0].position.x, 40)
  assert.equal(aligned[1].position.x, 40)
  assert.equal(aligned[2].position.x, 8)
  assert.equal(alignFreeCanvasNodePositions(nodes, ['a'], 'left'), nodes)
})

test('node capacity hints stay in Chinese and do not invent a second virtualization layer', () => {
  assert.equal(getFreeCanvasNodeCapacityHint(20), '')
  assert.match(getFreeCanvasNodeCapacityHint(120), /只渲染可见区域/)
  assert.match(getFreeCanvasNodeCapacityWarning(400), /节点较多（400\/500）/)
  assert.match(getFreeCanvasNodeCapacityWarning(500), /500 个节点上限/)

  const composable = read('../src/composables/useDramaCanvasFreeCanvas.js')
  assert.match(composable, /自由画布节点较多（\$\{freeCanvas\.value\.nodes\.length\}\/500）/)
  assert.doesNotMatch(composable, /virtualiz/)
})

test('toolbar empty next steps and generation cancel remain Chinese and clickable', () => {
  const toolbar = read('../src/components/dramaCanvas/FreeCanvasToolbar.vue')
  const node = read('../src/components/dramaCanvas/FreeCanvasNode.vue')
  const inspector = read('../src/components/dramaCanvas/FreeCanvasInspector.vue')
  const desktop = read('../src/components/dramaCanvas/CanvasDesktopToolbar.vue')

  assert.match(toolbar, /画布是空的，下一步可直接开始/)
  assert.match(toolbar, /aria-label="新建文本"/)
  assert.match(toolbar, /aria-label="新建配置"/)
  assert.match(toolbar, /aria-label="打开素材栏"/)
  assert.match(toolbar, /emit\('create-node', 'text'\)/)
  assert.match(toolbar, /已选 \{\{ selectionCount \}\} 项/)

  assert.match(node, />\s*停止等待\s*</)
  assert.match(node, /configRuntime.canCancel && !readonly/)
  assert.match(inspector, /aria-label="停止等待"/)
  assert.match(desktop, /正在对齐节点，请稍候/)
  assert.match(desktop, /description-id="canvas-reason-align-nodes"/)
  assert.match(desktop, /aria-label="AI 生成分镜"/)
  assert.match(desktop, />\s*AI 分镜\s*</)
})

test('free canvas delete asks for Chinese confirmation before removing nodes', () => {
  const composable = [
    read('../src/composables/useDramaCanvasFreeCanvas.js'),
    read('../src/composables/useDramaCanvasFreeCanvasClipboard.js'),
  ].join('\n')
  const node = read('../src/components/dramaCanvas/FreeCanvasNode.vue')
  assert.match(composable, /确定删除/)
  assert.match(composable, /此操作不可恢复/)
  assert.match(composable, /confirmButtonText: '删除'/)
  assert.match(composable, /cancelButtonText: '取消'/)
  assert.match(composable, /async function deleteFreeCanvasSelection/)
  assert.match(composable, /isEditableKeyTarget\(event.target\)/)
  assert.match(node, /tabindex="0"/)
  assert.match(node, /free-canvas-node:focus-visible/)
})

test('inspector disabled controls expose Chinese reasons and stay untitled when enabled', () => {
  const inspector = read('../src/components/dramaCanvas/FreeCanvasInspector.vue')
  const describeFreeCanvasInspectorDisabledReason = new Function(
    `'use strict'; ${remainingExtractNamedFunction(inspector, 'describeFreeCanvasInspectorDisabledReason')}; return describeFreeCanvasInspectorDisabledReason;`,
  )()

  assert.equal(describeFreeCanvasInspectorDisabledReason({ readonly: true }), '当前为只读，不能编辑')
  assert.equal(describeFreeCanvasInspectorDisabledReason({ busy: true }), '节点忙碌时不能编辑')
  assert.equal(
    describeFreeCanvasInspectorDisabledReason({ configRunning: true }),
    '生成任务正在运行，不能编辑',
  )
  assert.equal(
    describeFreeCanvasInspectorDisabledReason({ missingConversionTarget: true }),
    '请先选择转换目标',
  )
  assert.equal(describeFreeCanvasInspectorDisabledReason({}), undefined)
  assert.equal(
    describeFreeCanvasInspectorDisabledReason({
      readonly: true,
      busy: true,
      configRunning: true,
      missingConversionTarget: true,
    }),
    '当前为只读，不能编辑',
  )
  assert.equal(
    describeFreeCanvasInspectorDisabledReason({
      configRunning: true,
      missingConversionTarget: true,
    }),
    '生成任务正在运行，不能编辑',
  )

  assert.equal(
    (inspector.match(/:title="editorDisabled \? editorDisabledReason : undefined"/g) || []).length,
    5,
  )
  assert.equal(
    (inspector.match(/:title="\(readonly \|\| busy\) \? configActionDisabledReason : undefined"/g) || []).length,
    2,
  )
  assert.match(
    inspector,
    /:title="\(editorDisabled \|\| !conversionTarget\) \? convertDisabledReason : undefined"/,
  )
  assert.match(inspector, /title="停止当前页面等待；已提交任务可能继续执行或计费"/)
  assert.match(inspector, /:aria-describedby="\(readonly \|\| busy\) \? 'free-inspector-config-action-reason' : undefined"/)
  assert.match(inspector, /id="free-inspector-editor-reason"/)
  assert.match(inspector, /:deep\(\.el-select \.el-input__wrapper\.is-focus\)/)
  assert.match(inspector, /:title="saveAssetEligibility\.reason \|\| '保存为素材'"/)
  assert.match(
    inspector,
    /const configActionDisabledReason = computed\(\(\) => describeFreeCanvasInspectorDisabledReason\(\{\s*readonly: props\.readonly,\s*busy: props\.busy,\s*\}\)\)/,
  )
  assert.doesNotMatch(
    inspector,
    /configActionDisabledReason = computed\(\(\) => describeFreeCanvasInspectorDisabledReason\(\{[^}]*configRunning/,
  )
})
