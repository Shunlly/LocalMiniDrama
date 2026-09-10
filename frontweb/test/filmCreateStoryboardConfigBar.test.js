import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { compileScript, parse } from '@vue/compiler-sfc'

const panelSource = readFileSync(
  new URL('../src/components/filmCreate/FilmCreateStoryboardPanel.vue', import.meta.url),
  'utf8',
)
const configBarSource = readFileSync(
  new URL('../src/components/filmCreate/FilmCreateStoryboardConfigBar.vue', import.meta.url),
  'utf8',
)

test('分镜配置条可独立编译', () => {
  const parsed = parse(configBarSource, { filename: 'FilmCreateStoryboardConfigBar.vue' })
  assert.deepEqual(parsed.errors, [])
  assert.doesNotThrow(() => compileScript(parsed.descriptor, { id: 'storyboard-config-bar' }))
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
  assert.match(configBarSource, /aria-label="分镜序列图模式"/)
  assert.match(configBarSource, /<el-option label="单张" value="single" \/>/)
  assert.match(configBarSource, /<el-option label="四宫格" value="quad_grid" \/>/)
  assert.match(configBarSource, /<el-option label="九宫格" value="nine_grid" \/>/)
  assert.match(configBarSource, /首尾帧模式下使用单张图，序列宫格暂不可用/)
  assert.match(configBarSource, /四\/九宫格自动按视角拆分/)
  assert.match(configBarSource, /首尾帧参考图（生成首帧和尾帧，帮助视频保持镜头衔接）/)
  assert.match(configBarSource, /多段分镜模式（每镜生成可直接用于长提示词的分段描述）/)
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
  assert.match(configBarSource, /连贯帧模式（自动衔接相邻视频帧）/)

  assert.doesNotMatch(panelSource, /aria-label="分镜数量（生成设置）"/)
  assert.doesNotMatch(panelSource, /aria-label="分镜序列图模式"/)
  assert.doesNotMatch(panelSource, /label="批量生成分镜图"/)
  assert.doesNotMatch(panelSource, /label="导出分镜表"/)
  assert.doesNotMatch(panelSource, /首尾帧模式下使用单张图，序列宫格暂不可用/)
})
