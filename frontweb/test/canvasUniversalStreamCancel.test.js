import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { canvasUserError, isCanvasUserAbort } from '../src/composables/useCanvasUserError.js'

function readSource(url) {
  return readFileSync(url, 'utf8').replace(/\r\n?/g, '\n')
}

function sourceBetween(source, start, end) {
  const startIndex = source.indexOf(start)
  const endIndex = source.indexOf(end, startIndex + start.length)
  assert.ok(startIndex >= 0, `missing ${start}`)
  assert.ok(endIndex > startIndex, `missing ${end}`)
  return source.slice(startIndex, endIndex)
}

const source = readSource(new URL('../src/components/dramaCanvas/CanvasStoryboardPanel.vue', import.meta.url))

test('runUniversalPrompt 用 AbortController.signal 作为流式第 4 参，取消走中文错误', () => {
  const runUniversalPrompt = sourceBetween(source, 'async function runUniversalPrompt(mode) {', 'async function runStep(step) {')
  assert.match(runUniversalPrompt, /AbortController/)
  assert.match(runUniversalPrompt, /signal/)
  assert.match(runUniversalPrompt, /const controller = new AbortController\(\)/)
  assert.match(runUniversalPrompt, /\{ signal: controller\.signal \}/)
  assert.match(
    runUniversalPrompt,
    /await stream\(props\.storyboard\.id, body, \(delta\) => \{[\s\S]*\}, \{ signal: controller\.signal \}\)/,
  )
  assert.match(runUniversalPrompt, /canvasUserError\(/)
  assert.match(runUniversalPrompt, /isCanvasUserAbort\(e\) \|\| controller\.signal\.aborted/)
  assert.match(runUniversalPrompt, /canvasUserError\(error, polishing \? '全能词润色失败' : '全能词生成失败'\)/)
  assert.match(runUniversalPrompt, /DOMException\('操作已取消', 'AbortError'\)/)
  assert.doesNotMatch(runUniversalPrompt, /The user aborted/i)
  assert.doesNotMatch(runUniversalPrompt, /ElMessage\.error\(e\)/)
  assert.match(source, /generateUniversalSegmentPromptStream/)
  assert.match(source, /polishUniversalSegmentPromptStream/)
})

test('关闭、离开和卸载都会 abort 全能词流式请求', () => {
  assert.match(source, /function abortUniversalPrompt\(\) \{\s*universalPromptRun\?\.abort\(\)/)
  assert.match(source, /onBeforeUnmount\(\(\) => \{[\s\S]*abortUniversalPrompt\(\)/)
  assert.match(source, /async function closePanel\(\) \{\s*abortUniversalPrompt\(\)/)
  assert.match(source, /if \(universalBusy\) abortUniversalPrompt\(\)/)
})

test('取消错误经 canvasUserError 显示操作已取消，而不是英文 aborted', () => {
  assert.equal(canvasUserError('cancel'), '操作已取消')
  assert.equal(canvasUserError({ name: 'AbortError', message: 'The user aborted a request.' }), '操作已取消')
  assert.equal(canvasUserError({ name: 'AbortError', message: 'aborted' }), '操作已取消')
  assert.equal(isCanvasUserAbort({ name: 'AbortError' }), true)
  assert.match(canvasUserError({ name: 'AbortError', message: 'aborted' }), /[\u4e00-\u9fff]/)
  assert.doesNotMatch(canvasUserError({ name: 'AbortError', message: 'aborted' }), /aborted/i)
})
