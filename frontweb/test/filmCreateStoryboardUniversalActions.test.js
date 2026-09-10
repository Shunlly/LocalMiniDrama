import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { compileScript, parse } from '@vue/compiler-sfc'

import { remainingExtractNamedFunction } from './helpers/remainingSourceBetween.js'

const imageColumn = readFileSync(
  new URL('../src/components/filmCreate/FilmCreateStoryboardImageColumn.vue', import.meta.url),
  'utf8',
).replace(/\r\n?/g, '\n')

const describeUniversalSegmentActionDisabledReason = new Function(
  `'use strict'; ${remainingExtractNamedFunction(imageColumn, 'describeUniversalSegmentActionDisabledReason')}; return describeUniversalSegmentActionDisabledReason;`,
)()

function dropdownItem(source, command) {
  const marker = `command="${command}"`
  const markerIndex = source.indexOf(marker)
  assert.ok(markerIndex >= 0, `缺少 command="${command}" 的下拉项`)
  const start = source.lastIndexOf('<el-dropdown-item', markerIndex)
  const end = source.indexOf('</el-dropdown-item>', markerIndex)
  assert.ok(start >= 0 && end > start, `无法截取 command="${command}" 的 el-dropdown-item`)
  return source.slice(start, end + '</el-dropdown-item>'.length)
}

function dropdownMenu(source) {
  const start = source.indexOf('<el-dropdown-menu>')
  const end = source.indexOf('</el-dropdown-menu>')
  assert.ok(start >= 0 && end > start, '缺少全能提示词下拉菜单')
  return source.slice(start, end + '</el-dropdown-menu>'.length)
}

test('全能提示词下拉可独立编译', () => {
  const parsed = parse(imageColumn, { filename: 'FilmCreateStoryboardImageColumn.vue' })
  assert.deepEqual(parsed.errors, [])
  assert.doesNotThrow(() => compileScript(parsed.descriptor, { id: 'storyboard-universal-actions' }))
})

test('全能提示词禁用项给出请先生成的中文原因，Grok 菜单文案可读', () => {
  const menu = dropdownMenu(imageColumn)
  const generate = dropdownItem(menu, 'generate')
  const generateForce = dropdownItem(menu, 'generate-force')
  const polish = dropdownItem(menu, 'polish')
  const polishForce = dropdownItem(menu, 'polish-force')
  const grok = dropdownItem(menu, 'to-grok-video-tags')

  assert.match(generate, />\s*生成全能提示词\s*<\/el-dropdown-item>/)
  assert.doesNotMatch(generate, /:disabled=/)
  assert.doesNotMatch(generate, /universalSegmentActionDisabledReason/)
  assert.match(generateForce, />\s*不查图片强制生成\s*<\/el-dropdown-item>/)
  assert.doesNotMatch(generateForce, /:disabled=/)

  for (const item of [polish, polishForce, grok]) {
    assert.match(item, /:disabled="!sbUniversalSegmentTrimmed\(sb\)"/)
    assert.match(item, /:title="universalSegmentActionDisabledReason"/)
  }

  assert.match(polish, />\s*润色全能提示词\s*</)
  assert.match(polishForce, />\s*不查图片强制润色\s*</)
  assert.match(grok, />\s*改为 Grok 视频格式\s*</)
  assert.doesNotMatch(menu, /改为 grok视频格式/)
  assert.doesNotMatch(menu, /grok视频/)

  assert.equal(describeUniversalSegmentActionDisabledReason(false), '请先生成全能提示词')
  assert.equal(describeUniversalSegmentActionDisabledReason(''), '请先生成全能提示词')
  assert.equal(describeUniversalSegmentActionDisabledReason(0), '请先生成全能提示词')
  assert.equal(describeUniversalSegmentActionDisabledReason(true), '')
  assert.equal(describeUniversalSegmentActionDisabledReason('@图片1 推门'), '')
  assert.match(
    imageColumn,
    /const universalSegmentActionDisabledReason = computed\(\(\) => \(\s*describeUniversalSegmentActionDisabledReason\(Boolean\(props\.sbUniversalSegmentTrimmed\(props\.sb\)\)\)\s*\)\)/,
  )
})

test('全能提示词禁用原因不改写生图和超分按钮', () => {
  assert.match(imageColumn, /<ActionGate :reason="imageGenerateDisabledReason" label="生成分镜参考图">/)
  assert.match(imageColumn, /<ActionGate :reason="upscaleDisabledReason" label="超分">/)
  assert.match(imageColumn, /<ActionGate :reason="upscaleDisabledReason" label="超分\(首帧\)">/)
  assert.doesNotMatch(imageColumn, /<ActionGate :reason="universalSegmentActionDisabledReason"/)
  assert.doesNotMatch(imageColumn, /<ActionGate[^>]*label="润色全能提示词"/)
})
