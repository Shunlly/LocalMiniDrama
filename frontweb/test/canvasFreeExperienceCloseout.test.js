import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { resolveFreeCanvasInspectorFocusTarget } from '../src/components/dramaCanvas/dramaCanvasRouteFocus.js'
import { getFreeCreateCapabilityNotice, toFreeCreateUserError } from '../src/utils/freeCreate.js'
import { toFreeCanvasConfigUserReason } from '../src/utils/freeCanvasConfigState.js'
import { remainingExtractNamedFunction } from './helpers/remainingSourceBetween.js'

function read(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8')
}

function mockInspector({ editor = null, primary = null, close = null } = {}) {
  return {
    id: 'inspector-panel',
    querySelector(selector) {
      if (String(selector).includes('input:not([disabled])')) return editor
      if (String(selector).includes('data-inspector-primary-action')) return primary
      if (String(selector).includes('button')) return close
      return this
    },
  }
}

test('自由画布检查器焦点跳过关闭按钮，优先编辑框再落到主操作', () => {
  const close = { id: 'close' }
  const editor = { id: 'title' }
  const primary = { id: 'stop-waiting' }
  assert.equal(resolveFreeCanvasInspectorFocusTarget(mockInspector({ editor, primary, close })), editor)
  assert.equal(resolveFreeCanvasInspectorFocusTarget(mockInspector({ primary, close })), primary)
  const panel = mockInspector({ close })
  assert.equal(resolveFreeCanvasInspectorFocusTarget(panel), panel)
  assert.equal(resolveFreeCanvasInspectorFocusTarget(null), null)

  const routeFocus = read('../src/components/dramaCanvas/dramaCanvasRouteFocus.js')
  assert.match(routeFocus, /resolveFreeCanvasInspectorFocusTarget\(inspector\)/)
  assert.doesNotMatch(
    routeFocus,
    /querySelector\('input:not\(\[disabled\]\), textarea:not\(\[disabled\]\), button:not\(\[disabled\]\)'\)/,
  )
})

test('空态新建自由节点后把焦点交给检查器，键盘 Enter 也打开设置', () => {
  const composable = read('../src/composables/useDramaCanvasFreeCanvas.js')
  const clipboard = read('../src/composables/useDramaCanvasFreeCanvasClipboard.js')
  const create = remainingExtractNamedFunction(composable, 'createFreeCanvasNode')
  const keydown = remainingExtractNamedFunction(clipboard, 'handleFreeCanvasKeydown')
  assert.match(create, /activateFreeCanvasNode\(node\.id\)/)
  assert.match(keydown, /event\.key === 'Enter' \|\| event\.key === ' '/)
  assert.match(keydown, /activateFreeCanvasNode\(nodeId\)/)
  assert.doesNotMatch(keydown, /focusInspector: false/)
})

test('自由节点操作可键盘到达，点击不会误开检查器', () => {
  const node = read('../src/components/dramaCanvas/FreeCanvasNode.vue')
  assert.match(node, /:aria-label="accessibleLabel"/)
  assert.match(node, /按 Enter 或空格打开设置/)
  assert.match(node, /tabindex="0"/)
  assert.match(node, /@keydown\.enter="onActivateKey"/)
  assert.match(node, /@keydown\.space="onActivateKey"/)
  assert.match(node, /emit\('request-activate', props\.node\.id\)/)
  assert.match(read('../src/components/dramaCanvas/CanvasFlowStage.vue'), /@request-activate="openFreeCanvasInspectorFor"/)
  assert.match(node, /@click\.stop="emit\('request-configure', node\.id\)"/)
  assert.match(node, /@click\.stop="emit\('request-retry-config', node\.id\)"/)
  assert.match(node, /@click\.stop="retryMedia"/)
  assert.match(node, /@click\.stop="emit\('request-convert', node\.id\)"/)
  assert.match(node, /@click\.stop="emit\('request-delete', node\.id\)"/)
  assert.match(node, /@click\.stop="emit\('request-cancel-config', node\.id\)"/)
})

test('配置节点失败原因是中文警告，停止等待失败也不再说取消生成', () => {
  const node = read('../src/components/dramaCanvas/FreeCanvasNode.vue')
  const inspector = read('../src/components/dramaCanvas/FreeCanvasInspector.vue')
  const composable = read('../src/composables/useDramaCanvasFreeCanvas.js')
  assert.match(node, /\['failed', 'error'\]\.includes\(configRuntime\.status\) \? 'alert'/)
  assert.match(inspector, /data-inspector-primary-action="generate"/)
  assert.match(inspector, /data-inspector-primary-action="cancel"/)
  assert.match(inspector, /data-inspector-primary-action="retry"/)
  assert.match(inspector, /aria-label="停止等待"/)
  assert.doesNotMatch(inspector, /取消生成/)
  assert.match(composable, /停止等待失败，请稍后重试/)
  assert.doesNotMatch(remainingExtractNamedFunction(composable, 'cancelFreeCanvasConfig'), /取消生成失败/)
})

test('生成失败英文技术原文回落到中文下一步', () => {
  assert.equal(
    toFreeCreateUserError('Image generation did not complete', '生成失败，请稍后重试'),
    '生成失败，请稍后重试',
  )
  assert.equal(
    toFreeCreateUserError('fetch failed', '生成失败，请稍后重试'),
    '生成失败，请稍后重试',
  )
  assert.equal(
    toFreeCanvasConfigUserReason('生成失败: image generation did not complete', '生成失败，请稍后重试'),
    '生成失败，请稍后重试',
  )
  assert.doesNotMatch(
    toFreeCanvasConfigUserReason('This model does not support image generation', '上次生成失败，请检查输入与 AI 配置后重试。'),
    /This model does not support/i,
  )
})

test('自由创作空态下一步、失败态和进行中文案保持中文省略号', () => {
  const result = read('../src/components/freeCreate/FreeCreateResultPanel.vue')
  const input = read('../src/components/freeCreate/FreeCreateInputPanel.vue')
  const page = read('../src/views/FreeCreate.vue')
  assert.match(result, /aria-label="空结果下一步"/)
  assert.match(result, /aria-label="前往 AI 配置"/)
  assert.match(result, /item\.status === 'failed'[\s\S]*role="alert"/)
  assert.match(result, /正在取消生成…/)
  assert.match(result, /正在生成，请稍候…/)
  assert.match(result, /生成中…/)
  assert.match(result, /排队中…/)
  assert.doesNotMatch(result, /正在生成，请稍候\.\.\./)
  assert.match(input, /生成中…/)
  assert.match(page, /@open-ai-config="openAiConfig"/)
  assert.equal(getFreeCreateCapabilityNotice({ status: 'loading', serviceLabel: '视频' }), '正在检查视频服务…')
})
