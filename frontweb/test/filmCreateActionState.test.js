import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  batchGenerationDisabledReason,
  composeVideoDisabledReason,
  episodeResourceDisabledReason,
  pipelineDisabledReason,
  projectResourceDisabledReason,
  storyboardDisabledReason,
} from '../src/utils/filmCreateActionState.js'

test('resource actions explain missing context and active work', () => {
  assert.equal(projectResourceDisabledReason({ hasProject: false }), '请先创建或打开项目')
  assert.equal(
    projectResourceDisabledReason({ hasProject: true, running: true, label: '角色' }),
    '正在处理角色，请等待完成',
  )
  assert.equal(episodeResourceDisabledReason({ hasEpisode: false }), '请先创建或选择剧集')
  assert.equal(episodeResourceDisabledReason({ hasEpisode: true }), '')
})

test('pipeline and storyboard actions expose the first blocking reason', () => {
  assert.equal(pipelineDisabledReason({ hasEpisode: false, pipelineRunning: false }), '请先创建或选择剧集')
  assert.match(pipelineDisabledReason({ hasEpisode: true, pipelineRunning: true }), /全流程任务/)
  assert.match(
    storyboardDisabledReason({ hasEpisode: true, storyboardGenerating: true, omniPolishing: false }),
    /正在生成分镜/,
  )
  assert.equal(
    storyboardDisabledReason({ hasEpisode: true, storyboardGenerating: false, omniPolishing: false }),
    '',
  )
})

test('batch generation prioritizes the active pipeline and generation tasks', () => {
  assert.match(batchGenerationDisabledReason({
    hasEpisode: true,
    pipelineRunning: true,
    storyboardGenerating: true,
    omniPolishing: false,
    batchImageRunning: false,
    batchVideoRunning: false,
  }), /全流程任务/)
  assert.match(batchGenerationDisabledReason({
    hasEpisode: true,
    pipelineRunning: false,
    storyboardGenerating: false,
    omniPolishing: false,
    batchImageRunning: false,
    batchVideoRunning: true,
  }), /分镜视频/)
})

test('compose action requires an episode and at least one storyboard', () => {
  assert.equal(composeVideoDisabledReason({ hasEpisode: false, storyboardCount: 2 }), '请先创建或选择剧集')
  assert.equal(composeVideoDisabledReason({ hasEpisode: true, storyboardCount: 0 }), '请先生成或添加分镜')
  assert.match(composeVideoDisabledReason({ hasEpisode: true, storyboardCount: 2, videoGenerating: true }), /正在合成视频/)
  assert.match(composeVideoDisabledReason({
    hasEpisode: true,
    storyboardCount: 2,
    videoGenerating: false,
    pipelineRunning: false,
    batchVideoRunning: true,
  }), /分镜视频/)
  assert.equal(composeVideoDisabledReason({ hasEpisode: true, storyboardCount: 2, videoGenerating: false }), '')
})

test('FilmCreate delegates pipeline UI and wraps major gated actions', () => {
  const filmCreateSource = readFileSync(new URL('../src/views/FilmCreate.vue', import.meta.url), 'utf8')
  const pipelinePanelSource = readFileSync(
    new URL('../src/components/filmCreate/FilmCreatePipelinePanel.vue', import.meta.url),
    'utf8',
  )

  assert.match(filmCreateSource, /<FilmCreatePipelinePanel/)
  assert.doesNotMatch(filmCreateSource, /class="one-click-actions"/)
  assert.match(filmCreateSource, /:reason="characterGenerationDisabledReason"/)
  assert.match(filmCreateSource, /:reason="batchActionDisabledReason"/)
  assert.match(filmCreateSource, /:reason="composeActionDisabledReason"/)
  assert.match(filmCreateSource, /if \(composeActionDisabledReason\.value\)/)
  assert.match(pipelinePanelSource, /高级|生成设置/)
  assert.match(pipelinePanelSource, /<ActionGate label="一键生成成片" :reason="disabledReason">/)
  assert.match(pipelinePanelSource, /<ActionGate label="仅生成文本框架" :reason="disabledReason">/)
})
