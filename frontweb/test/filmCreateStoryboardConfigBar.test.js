import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { compileScript, parse } from '@vue/compiler-sfc'

import { describeStoryboardConfigControls } from '../src/components/filmCreate/filmCreateStoryboardConfigBarCopy.js'

const panelSource = readFileSync(
  new URL('../src/components/filmCreate/FilmCreateStoryboardPanel.vue', import.meta.url),
  'utf8',
) + '\n' + readFileSync(
  new URL('../src/components/filmCreate/FilmCreateStoryboardPanel.css', import.meta.url),
  'utf8',
)
const configBarVue = readFileSync(
  new URL('../src/components/filmCreate/FilmCreateStoryboardConfigBar.vue', import.meta.url),
  'utf8',
).replace(/\r\n?/g, '\n')
const configBarCopy = readFileSync(
  new URL('../src/components/filmCreate/filmCreateStoryboardConfigBarCopy.js', import.meta.url),
  'utf8',
).replace(/\r\n?/g, '\n')
const configBarSource = configBarVue + '\n' + configBarCopy

test('分镜配置条可独立编译', () => {
  const parsed = parse(configBarVue, { filename: 'FilmCreateStoryboardConfigBar.vue' })
  assert.deepEqual(parsed.errors, [])
  assert.doesNotThrow(() => compileScript(parsed.descriptor, { id: 'storyboard-config-bar' }))
})

test('分镜列组件与状态条可独立编译', () => {
  const names = [
    'FilmCreateStoryboardPanel.vue',
    'FilmCreateStoryboardScriptColumn.vue',
    'FilmCreateStoryboardImageColumn.vue',
    'FilmCreateStoryboardVideoColumn.vue',
    'FilmCreateStoryboardStatusStrip.vue',
  ]
  for (const name of names) {
    const source = readFileSync(new URL(`../src/components/filmCreate/${name}`, import.meta.url), 'utf8')
    const parsed = parse(source, { filename: name })
    assert.deepEqual(parsed.errors, [], name)
    assert.doesNotThrow(() => compileScript(parsed.descriptor, { id: name }), name)
  }
})

test('分镜面板真实引用顶部配置条组件', () => {
  assert.match(
    panelSource,
    /import FilmCreateStoryboardConfigBar from '@\/components\/filmCreate\/FilmCreateStoryboardConfigBar\.vue'/,
  )
  assert.match(panelSource, /<FilmCreateStoryboardConfigBar[\s\S]*v-model:grid-mode="gridMode"/)
  assert.match(panelSource, /v-model:storyboard-use-first-last-frame="storyboardUseFirstLastFrame"/)
  assert.match(panelSource, /v-model:storyboard-universal-omni="storyboardUniversalOmni"/)
  assert.match(panelSource, /:start-batch-image-generation="startBatchImageGeneration"/)
  assert.match(panelSource, /:start-batch-video-generation="startBatchVideoGeneration"/)
  assert.match(panelSource, /@save-settings="emit\('save-settings'\)"/)
  assert.match(panelSource, /id="anchor-storyboard"/)
  assert.doesNotMatch(panelSource, /id="anchor-storyboard-images"/)
})

test('宫格、首尾帧、批量操作和无障碍标签都留在配置条', () => {
  assert.match(configBarSource, /aria-label="分镜数量（生成设置）"/)
  assert.match(configBarSource, /aria-label="分镜视频总时长（秒）"/)
  assert.match(configBarSource, /:aria-label="configControlState.gridModeAriaLabel"/)
  assert.match(configBarSource, /:aria-label="configControlState.firstLastFrameAriaLabel"/)
  assert.match(configBarSource, /:aria-label="configControlState.universalOmniAriaLabel"/)
  assert.match(configBarSource, /aria-describedby="sb-grid-mode-hint"/)
  assert.match(configBarSource, /id="sb-grid-mode-hint"/)
  assert.match(configBarSource, /:disabled="Boolean\(configControlState.gridModeDisabledReason\)"/)
  assert.match(configBarSource, /:title="configControlState.gridModeDisabledReason \|\| configControlState.gridModeHint"/)
  assert.match(configBarSource, /<el-option label="单张" value="single" \/>/)
  assert.match(configBarSource, /<el-option label="四宫格" value="quad_grid" \/>/)
  assert.match(configBarSource, /<el-option label="九宫格" value="nine_grid" \/>/)
  assert.match(configBarSource, /首尾帧模式下使用单张图，序列宫格暂不可用/)
  assert.match(configBarSource, /四\/九宫格自动按视角拆分/)
  assert.match(configBarSource, /首尾帧参考图（生成首帧和尾帧，帮助视频保持镜头衔接）/)
  assert.match(configBarSource, /全能模式（每镜生成可直接用于长提示词的分段描述）/)
  assert.doesNotMatch(configBarSource, /多段分镜模式/)
  assert.match(configBarSource, /同时生成解说旁白（与对白分轨，便于配音和字幕）/)
  assert.match(configBarSource, /label="导出分镜表"/)
  assert.match(configBarSource, /label="导出解说 SRT"/)
  assert.match(configBarSource, /label="批量生成分镜图"/)
  assert.match(configBarSource, /label="批量生成分镜视频"/)
  assert.match(configBarSource, /:label="storyboards.length > 0 \? '重新生成分镜' : 'AI 生成分镜'"/)
  assert.match(configBarSource, /label="添加一个分镜"/)
  assert.match(configBarSource, /id="anchor-storyboard-images"/)
  assert.match(configBarSource, /role="alert"/)
  assert.match(configBarSource, /前往 AI 配置/)
  assert.match(configBarSource, /aria-label="前往 AI 配置"/)
  assert.match(configBarSource, /连贯帧模式（自动衔接相邻视频帧）/)

  assert.doesNotMatch(panelSource, /aria-label="分镜数量（生成设置）"/)
  assert.doesNotMatch(panelSource, /aria-label="分镜序列图模式"/)
  assert.doesNotMatch(panelSource, /label="批量生成分镜图"/)
  assert.doesNotMatch(panelSource, /label="导出分镜表"/)
  assert.doesNotMatch(panelSource, /首尾帧模式下使用单张图，序列宫格暂不可用/)
})

test('宫格、首尾帧和全能模式开关提供中文说明、禁用原因和 aria-label', () => {
  const idle = describeStoryboardConfigControls({ storyboardUseFirstLastFrame: false })
  const firstLastOn = describeStoryboardConfigControls({ storyboardUseFirstLastFrame: true })
  const truthy = describeStoryboardConfigControls({ storyboardUseFirstLastFrame: 1 })
  const empty = describeStoryboardConfigControls({})

  assert.equal(idle.gridModeDisabledReason, '')
  assert.equal(idle.gridModeHint, '四/九宫格自动按视角拆分')
  assert.equal(idle.gridModeAriaLabel, '分镜序列图模式')
  assert.equal(idle.firstLastFrameAriaLabel, '首尾帧参考图（生成首帧和尾帧，帮助视频保持镜头衔接）')
  assert.equal(idle.universalOmniAriaLabel, '全能模式（每镜生成可直接用于长提示词的分段描述）')
  assert.match(idle.gridModeAriaLabel, /[\u4e00-\u9fff]/)
  assert.match(idle.firstLastFrameAriaLabel, /[\u4e00-\u9fff]/)
  assert.match(idle.universalOmniAriaLabel, /[\u4e00-\u9fff]/)

  assert.equal(firstLastOn.gridModeDisabledReason, '首尾帧模式下使用单张图，序列宫格暂不可用')
  assert.equal(firstLastOn.gridModeHint, firstLastOn.gridModeDisabledReason)
  assert.equal(
    firstLastOn.gridModeAriaLabel,
    `分镜序列图模式不可用：${firstLastOn.gridModeDisabledReason}`,
  )
  assert.match(firstLastOn.gridModeDisabledReason, /[\u4e00-\u9fff]/)
  assert.notEqual(idle.gridModeAriaLabel, firstLastOn.gridModeAriaLabel)
  assert.equal(truthy.gridModeDisabledReason, firstLastOn.gridModeDisabledReason)
  assert.equal(empty.gridModeDisabledReason, '')
  assert.equal(empty.firstLastFrameAriaLabel, idle.firstLastFrameAriaLabel)
  assert.equal(empty.universalOmniAriaLabel, idle.universalOmniAriaLabel)
})
