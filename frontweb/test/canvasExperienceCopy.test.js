import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  getCanvasEpisodeEmptyNextCopy,
  toCanvasChineseMessage,
} from '../src/components/dramaCanvas/canvasExperienceCopy.js'

function read(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8')
}

test('空集下一步按剧本和分镜给出中文指引，有内容时不再提示', () => {
  assert.equal(getCanvasEpisodeEmptyNextCopy(null), '')
  assert.equal(
    getCanvasEpisodeEmptyNextCopy({ script_content: '  ', storyboards: [] }),
    '这一集还是空的，下一步可先写剧本或新建分镜',
  )
  assert.equal(
    getCanvasEpisodeEmptyNextCopy({ script_content: '对白', storyboards: [] }),
    '还没有分镜，下一步可新建分镜或用 AI 生成分镜',
  )
  assert.equal(
    getCanvasEpisodeEmptyNextCopy({ script_content: '', storyboards: [{ id: 1 }] }),
    '还没有剧本，下一步可先编辑剧本',
  )
  assert.equal(
    getCanvasEpisodeEmptyNextCopy({ script_content: '对白', storyboards: [{ id: 1 }] }),
    '',
  )
})

test('英文技术原文回落到中文，中文原因原样保留', () => {
  assert.equal(toCanvasChineseMessage('Failed to fetch', '处理中…'), '处理中…')
  assert.equal(toCanvasChineseMessage('Internal Server Error', '当前画布暂时无法打开'), '当前画布暂时无法打开')
  assert.equal(toCanvasChineseMessage('生成失败: Internal Server Error', '生成失败'), '生成失败')
  assert.equal(toCanvasChineseMessage('画布布局保存失败，请稍后重试', '保存失败'), '画布布局保存失败，请稍后重试')
  assert.equal(toCanvasChineseMessage('', '处理中…'), '处理中…')
})

test('剧集画布空下一步、节点上限和停止等待文案没有回退', () => {
  const toolbar = read('../src/components/dramaCanvas/CanvasDesktopToolbar.vue')
  const chrome = read('../src/components/dramaCanvas/CanvasPageChrome.vue')
  const freeToolbar = read('../src/components/dramaCanvas/FreeCanvasToolbar.vue')
  const node = read('../src/components/dramaCanvas/FreeCanvasNode.vue')
  const inspector = read('../src/components/dramaCanvas/FreeCanvasInspector.vue')
  const derived = read('../src/components/dramaCanvas/dramaCanvasDerivedState.js')

  assert.match(toolbar, /aria-label="空剧集下一步"/)
  assert.match(chrome, /getCanvasEpisodeEmptyNextCopy/)
  assert.match(freeToolbar, /atNodeLimit/)
  assert.match(freeToolbar, /getFreeCanvasNodeCapacityWarning/)
  assert.match(freeToolbar, /aria-label="剧集画布"/)
  assert.match(freeToolbar, /aria-label="自由画布"/)
  assert.match(node, />\s*停止等待\s*</)
  assert.match(inspector, /aria-label="停止等待"/)
  assert.doesNotMatch(node, /取消生成/)
  assert.doesNotMatch(inspector, /取消生成/)
  assert.match(derived, /label: `分镜 · \$\{storyboard.label\}`/)
})

test('画布新建按钮可见文案不含重复加号', () => {
  const adapter = read('../src/utils/dramaCanvasAdapter.js')
  const addButton = read('../src/components/dramaCanvas/CanvasAddButtonNode.vue')
  assert.match(adapter, /label: '新建'/)
  assert.match(adapter, /label: '新建分镜'/)
  assert.doesNotMatch(adapter, /label: '\+ 新建'/)
  assert.match(addButton, /class="add-icon">\+</)
  assert.match(addButton, /const visibleLabel = computed/)
  assert.match(addButton, /replace\(\/\^\\\+\\s\*\//)
})
