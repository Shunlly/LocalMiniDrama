import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { compileScript, parse } from '@vue/compiler-sfc'

import { getPipelineControlReasons } from '../src/utils/filmPipelineAction.js'
import { remainingExtractNamedFunction } from './helpers/remainingSourceBetween.js'

const pipelinePanelSource = readFileSync(
  new URL('../src/components/filmCreate/FilmCreatePipelinePanel.vue', import.meta.url),
  'utf8',
).replace(/\r\n?/g, '\n')

const toPipelineDisabledReason = new Function(
  `'use strict'; ${remainingExtractNamedFunction(pipelinePanelSource, 'toPipelineDisabledReason')}; return toPipelineDisabledReason;`,
)()

const describePipelinePanelUx = new Function(
  'getPipelineControlReasons',
  'toPipelineDisabledReason',
  `'use strict'; ${remainingExtractNamedFunction(pipelinePanelSource, 'describePipelinePanelUx')}; return describePipelinePanelUx;`,
)(getPipelineControlReasons, toPipelineDisabledReason)

const describePipelineErrorLog = new Function(
  'toPipelineDisabledReason',
  `'use strict'; ${remainingExtractNamedFunction(pipelinePanelSource, 'describePipelineErrorLog')}; return describePipelineErrorLog;`,
)(toPipelineDisabledReason)

function compileVue(source, filename, id) {
  const parsed = parse(source, { filename })
  assert.deepEqual(parsed.errors.map((error) => String(error)), [])
  assert.doesNotThrow(() => compileScript(parsed.descriptor, { id, inlineTemplate: true }))
}

test('\u5168\u6d41\u7a0b\u9762\u677f\u53ef\u4ee5\u72ec\u7acb\u7f16\u8bd1', () => {
  compileVue(pipelinePanelSource, 'FilmCreatePipelinePanel.vue', 'film-create-pipeline-ux')
})

test('\u6682\u505c\u3001\u7ee7\u7eed\u3001\u505c\u6b62\u7981\u7528\u539f\u56e0\u4fdd\u6301\u4e2d\u6587\u53ef\u89c1', () => {
  const stopping = describePipelinePanelUx({ running: true, stopping: true })
  assert.match(stopping.pauseDisabledReason, /\u6b63\u5728\u505c\u6b62\u5168\u6d41\u7a0b/)
  assert.match(stopping.cancelDisabledReason, /\u6b63\u5728\u505c\u6b62\u5168\u6d41\u7a0b/)
  assert.match(stopping.pauseDisabledReason, /[\u4e00-\u9fff]/)
  assert.doesNotMatch(stopping.pauseDisabledReason, /please|stopping|network error/i)
  assert.doesNotMatch(stopping.cancelDisabledReason, /please|stopping|network error/i)

  const resumeStopping = describePipelinePanelUx({ running: true, paused: true, stopping: true })
  assert.match(resumeStopping.resumeDisabledReason, /\u6b63\u5728\u505c\u6b62\u5168\u6d41\u7a0b/)
  assert.match(resumeStopping.resumeDisabledReason, /[\u4e00-\u9fff]/)
  assert.doesNotMatch(resumeStopping.resumeDisabledReason, /please|resume|network error/i)

  const running = describePipelinePanelUx({ running: true, paused: false })
  assert.equal(running.pauseDisabledReason, '')
  assert.equal(running.cancelDisabledReason, '')

  const paused = describePipelinePanelUx({ running: true, paused: true })
  assert.equal(paused.resumeDisabledReason, '')

  const english = describePipelinePanelUx({
    running: true,
    stopping: true,
    controlReasons: {
      pause: 'Network Error',
      resume: 'Failed to fetch',
      cancel: 'HTTP Error',
    },
  })
  assert.equal(english.pauseDisabledReason, '\u5f53\u524d\u4e0d\u80fd\u6682\u505c\u5168\u6d41\u7a0b')
  assert.equal(english.cancelDisabledReason, '\u5f53\u524d\u4e0d\u80fd\u505c\u6b62\u5168\u6d41\u7a0b')
  assert.doesNotMatch(JSON.stringify(english), /Network Error|HTTP Error|Failed to fetch/i)

  const englishResume = describePipelinePanelUx({
    running: true,
    paused: true,
    stopping: true,
    controlReasons: {
      pause: 'Network Error',
      resume: 'Failed to fetch',
      cancel: 'HTTP Error',
    },
  })
  assert.equal(englishResume.resumeDisabledReason, '\u5f53\u524d\u4e0d\u80fd\u7ee7\u7eed\u5168\u6d41\u7a0b')

  assert.equal(toPipelineDisabledReason(''), '')
  assert.equal(toPipelineDisabledReason('\u6b63\u5728\u505c\u6b62\u5168\u6d41\u7a0b\uff0c\u8bf7\u7a0d\u5019\u3002'), '\u6b63\u5728\u505c\u6b62\u5168\u6d41\u7a0b\uff0c\u8bf7\u7a0d\u5019\u3002')
  assert.equal(toPipelineDisabledReason('Network Error', '\u5f53\u524d\u4e0d\u80fd\u6682\u505c\u5168\u6d41\u7a0b'), '\u5f53\u524d\u4e0d\u80fd\u6682\u505c\u5168\u6d41\u7a0b')

  assert.match(pipelinePanelSource, /label="\u6682\u505c" :reason="pauseDisabledReason"/)
  assert.match(pipelinePanelSource, /label="\u7ee7\u7eed" :reason="resumeDisabledReason"/)
  assert.match(pipelinePanelSource, /:reason="cancelDisabledReason"/)
  assert.match(pipelinePanelSource, /:title="compactDisabledReason"/)
  assert.match(pipelinePanelSource, /class="pipeline-compact-gate"/)
  assert.match(pipelinePanelSource, /:reason="compactDisabledReason"/)
})

test('\u8fdb\u884c\u4e2d\u72b6\u6001\u4e0e\u7a7a\u95f2\u6001\u533a\u5206\uff0c\u65e0\u6b65\u9aa4\u65f6\u4ecd\u6709\u4e2d\u6587\u8fdb\u5ea6', () => {
  const idle = describePipelinePanelUx({})
  assert.equal(idle.progressKicker, '')
  assert.equal(idle.progressStatusText, '')

  const running = describePipelinePanelUx({ running: true, currentStep: '' })
  assert.equal(running.progressKicker, '\u8fdb\u884c\u4e2d')
  assert.equal(running.progressStatusText, '\u6b63\u5728\u6267\u884c\u5168\u6d41\u7a0b\u751f\u6210')

  const stepped = describePipelinePanelUx({
    running: true,
    currentStep: '[\u6b65\u9aa4 2/5] \u6b63\u5728\u751f\u6210\u5206\u955c',
  })
  assert.equal(stepped.progressKicker, '\u8fdb\u884c\u4e2d')
  assert.equal(stepped.progressStatusText, '\u6b63\u5728\u751f\u6210\u5206\u955c')

  const paused = describePipelinePanelUx({ running: true, paused: true })
  assert.equal(paused.progressKicker, '\u5df2\u6682\u505c')
  assert.equal(paused.progressStatusText, '\u5168\u6d41\u7a0b\u751f\u6210\u5df2\u6682\u505c')

  const starting = describePipelinePanelUx({ starting: true })
  assert.equal(starting.progressKicker, '\u8fdb\u884c\u4e2d')
  assert.match(starting.compactDisabledReason, /\u6b63\u5728\u786e\u8ba4\u5b8c\u6574\u6210\u7247\u7684\u8fd0\u884c\u6761\u4ef6/)

  assert.match(pipelinePanelSource, /progressStatusText \|\| currentStep/)
  assert.match(pipelinePanelSource, /progressStatusText \|\| cleanCurrentStep/)
})

test('\u6ca1\u6709\u5267\u96c6\u65f6\u4e0b\u4e00\u6b65\u6307\u5411\u6dfb\u52a0\u4e00\u96c6', () => {
  const empty = describePipelinePanelUx({ hasEpisode: false })
  assert.equal(empty.emptyNextStep, '\u6dfb\u52a0\u4e00\u96c6\u540e\u518d\u4fdd\u5b58\u5267\u672c\u6216\u542f\u52a8\u751f\u6210')
  assert.match(empty.emptyGuidanceText, /\u4e0b\u4e00\u6b65/)
  assert.match(empty.emptyGuidanceText, /\u6dfb\u52a0\u4e00\u96c6\u540e\u518d\u4fdd\u5b58\u5267\u672c\u6216\u542f\u52a8\u751f\u6210/)
  assert.equal(empty.emptyActionLabel, '\u6dfb\u52a0\u4e00\u96c6')

  const ready = describePipelinePanelUx({ hasEpisode: true })
  assert.equal(ready.emptyNextStep, '')
  assert.equal(ready.emptyGuidanceText, '')
  assert.equal(ready.emptyActionLabel, '')

  assert.match(pipelinePanelSource, /data-testid="film-pipeline-empty"/)
  assert.match(pipelinePanelSource, /data-testid="film-pipeline-empty-action"/)
  assert.match(pipelinePanelSource, /\$emit\('add-episode'\)/)
  assert.match(pipelinePanelSource, /white-space: normal/)
})

test('空剧本的全流程阻断原因保持中文', () => {
  assert.equal(
    toPipelineDisabledReason('当前集还没有剧本，请先编写或导入剧本'),
    '当前集还没有剧本，请先编写或导入剧本',
  )
  assert.match(pipelinePanelSource, /<ActionGate label="一键生成成片" :reason="productionReason">/)
  assert.match(pipelinePanelSource, /<ActionGate label="仅生成文本框架" :reason="draftReason">/)
  assert.match(pipelinePanelSource, /if \(draftReason\.value\) return draftReason\.value/)
  assert.doesNotMatch(pipelinePanelSource, /处理当前阻断后再启动生成/)
})

test('全流程错误日志和阻断原因把英文技术失败收成中文', () => {
  const log = describePipelineErrorLog([
    { time: '12:00:00', step: '提取角色', message: 'Network Error' },
    { time: '12:00:01', step: '生成分镜', message: '请先配置图片模型' },
  ])
  assert.equal(log[0].message, '操作失败，请稍后重试')
  assert.equal(log[1].message, '请先配置图片模型')
  assert.doesNotMatch(JSON.stringify(log), /Network Error/)
  assert.match(pipelinePanelSource, /displayErrorLog/)
  assert.match(pipelinePanelSource, /toPipelineDisabledReason\(\s*props\.productionDisabledReason \|\| props\.disabledReason/)
  assert.match(pipelinePanelSource, /toPipelineDisabledReason\(controlReasons\.value\.retry/)
})

test('制作页离开保护覆盖批量生图生视频和单条生成', () => {
  const filmCreateSource = readFileSync(
    new URL('../src/views/FilmCreate.vue', import.meta.url),
    'utf8',
  ).replace(/\r\n?/g, '\n')
  const guardsSource = readFileSync(
    new URL('../src/composables/filmCreate/useFilmCreateNavigationGuards.js', import.meta.url),
    'utf8',
  ).replace(/\r\n?/g, '\n')
  const batchSource = readFileSync(
    new URL('../src/composables/filmCreate/useFilmCreateBatchGeneration.js', import.meta.url),
    'utf8',
  ).replace(/\r\n?/g, '\n')
  const call = filmCreateSource.match(/useFilmCreateNavigationGuards\(\{[\s\S]*?\}\)/)?.[0] || ''
  assert.match(call, /batchImageRunning/)
  assert.match(call, /batchImageStopping/)
  assert.match(call, /batchVideoRunning/)
  assert.match(call, /batchVideoStopping/)
  assert.match(call, /generatingSbImageIds/)
  assert.match(call, /generatingSbVideoIds/)
  assert.match(guardsSource, /hasActiveMediaGenerationWork/)
  assert.match(guardsSource, /媒体生成仍在执行/)
  assert.match(guardsSource, /计费可能继续/)
  assert.match(batchSource, /export function hasActiveMediaGenerationWork/)
  assert.match(filmCreateSource, /onBeforeRouteLeave\(allowNavigationAfterDraftFlush\)/)
})
