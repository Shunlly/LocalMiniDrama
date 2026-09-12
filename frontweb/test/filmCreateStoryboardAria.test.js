import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (name) => readFileSync(new URL(`../src/components/filmCreate/${name}`, import.meta.url), 'utf8')

const imageColumn = read('FilmCreateStoryboardImageColumn.vue')
const videoColumn = read('FilmCreateStoryboardVideoColumn.vue')
const configBar = read('FilmCreateStoryboardConfigBar.vue')
const scriptColumn = read('FilmCreateStoryboardScriptColumn.vue')
const emptyState = read('FilmCreateStoryboardEmptyState.vue')
const pipelineStatus = read('FilmCreatePipelineStatus.vue')

test('分镜图列按分镜编号命名生成、上传和超分', () => {
  assert.match(imageColumn, /生成分镜\$\{sb\.storyboard_number \|\| i \+ 1\}全能提示词/)
  assert.match(imageColumn, /生成分镜\$\{sb\.storyboard_number \|\| i \+ 1\}首帧/)
  assert.match(imageColumn, /生成分镜\$\{sb\.storyboard_number \|\| i \+ 1\}尾帧/)
  assert.match(imageColumn, /上传分镜\$\{sb\.storyboard_number \|\| i \+ 1\}图片/)
  assert.match(imageColumn, /超分分镜\$\{sb\.storyboard_number \|\| i \+ 1\}图片/)
})

test('分镜视频列和脚本列保持中文操作名', () => {
  assert.match(videoColumn, /生成分镜\$\{sb\.storyboard_number\}视频/)
  assert.match(videoColumn, /切换到\$\{item\.label\}/)
  assert.match(videoColumn, /对白配音/)
  assert.match(scriptColumn, /编辑分镜\$\{sb\.storyboard_number\}提示词/)
  assert.match(scriptColumn, /解说配音/)
})

test('分镜配置条批量、导出和停止有中文名称', () => {
  assert.match(configBar, /导出分镜表/)
  assert.match(configBar, /导出解说 SRT/)
  assert.match(configBar, /aria-label="停止批量生成图片"/)
  assert.match(configBar, /aria-label="停止批量生成视频"/)
  assert.match(configBar, /批量生成分镜图/)
  assert.match(emptyState, /storyboardActionDisabledReason \|\| '生成分镜'/)
  assert.match(pipelineStatus, /label="立即开始下一阶段"/)
  assert.match(pipelineStatus, /:aria-label="skipCountdownAriaLabel"/)
  assert.match(pipelineStatus, /立即开始下一阶段/)
  assert.match(pipelineStatus, /pauseDisabledReason \|\| '暂停倒计时'/)
})
