import test from 'node:test'
import assert from 'node:assert/strict'

import { getPipelineCompactAction, getPipelineCompactSecondaryAction, getPipelineControlReasons, getPipelineRetryAction } from '../src/utils/filmPipelineAction.js'

test('pipeline compact command follows readiness and execution state', () => {
  assert.deepEqual(
    getPipelineCompactAction({ readinessState: 'missing', serviceType: 'video' }),
    {
      key: 'draft-preview',
      label: '先跑草稿预演',
      event: 'start-text-framework',
    },
  )
  assert.deepEqual(
    getPipelineCompactSecondaryAction({ readinessState: 'missing', serviceType: 'video' }),
    {
      key: 'configure',
      label: '配置缺失服务',
      event: 'open-ai-config',
      payload: 'video',
    },
  )
  assert.equal(getPipelineCompactAction({ readinessState: 'error' }).event, 'retry-readiness')
  assert.equal(getPipelineCompactAction({ readinessState: 'ready' }).event, 'start-one-click')
  assert.equal(getPipelineCompactAction({ running: true, paused: true }).event, 'resume')
  assert.equal(getPipelineCompactAction({ running: true, paused: false }), null)
  assert.equal(getPipelineCompactAction({ readinessState: 'checking' }), null)
  assert.equal(getPipelineCompactAction({ readinessState: 'ready', draftReason: '缺少剧本' }), null)
  assert.equal(getPipelineCompactAction({ readinessState: 'ready', productionReason: '缺少图片' }), null)
})

test('pipeline compact commands use concise labels for direct actions', () => {
  assert.equal(getPipelineCompactAction({ readinessState: 'error' }).label, '重试能力检查')
  assert.equal(getPipelineCompactAction({ readinessState: 'ready' }).label, '一键生成成片')
  assert.equal(getPipelineCompactAction({ running: true, paused: true }).label, '继续生成')
})
test('缺少剧集时紧凑标题提供添加一集', () => {
  assert.deepEqual(
    getPipelineCompactAction({
      readinessState: 'missing',
      serviceType: 'video',
      hasEpisode: false,
      draftReason: '请先创建或选择剧集',
    }),
    {
      key: 'add-episode',
      label: '添加一集',
      event: 'add-episode',
    },
  )
  assert.equal(getPipelineCompactAction({ readinessState: 'ready', draftReason: '缺少剧本' }), null)
})

test('失败后的紧凑操作变成重试全流程', () => {
  assert.deepEqual(
    getPipelineCompactAction({ readinessState: 'ready', hasError: true }),
    { key: 'retry-run', label: '重试全流程', event: 'start-one-click' },
  )
  assert.equal(getPipelineCompactAction({ readinessState: 'ready' }).label, '一键生成成片')
})

test('草稿预演失败后重试仍走草稿，不开正式成片', () => {
  assert.deepEqual(
    getPipelineRetryAction({ lastPipelineMode: 'draft' }),
    { key: 'retry-draft', label: '重试草稿预演', event: 'start-text-framework' },
  )
  assert.deepEqual(
    getPipelineCompactAction({ readinessState: 'ready', hasError: true, lastPipelineMode: 'draft' }),
    { key: 'retry-draft', label: '重试草稿预演', event: 'start-text-framework' },
  )
  assert.deepEqual(
    getPipelineRetryAction({ lastPipelineMode: 'production' }),
    { key: 'retry-run', label: '重试全流程', event: 'start-one-click' },
  )
})

test('暂停和停止按钮在停止中给出可见的禁用原因', () => {
  const stopping = getPipelineControlReasons({ running: true, stopping: true })
  assert.match(stopping.pause, /正在停止全流程/)
  assert.match(stopping.cancel, /正在停止全流程/)
  assert.equal(getPipelineControlReasons({ running: true, paused: false }).pause, '')
  assert.equal(getPipelineControlReasons({ running: true, paused: true }).resume, '')
  assert.match(getPipelineControlReasons({ running: true, stopRequired: true }).pause, /停止未完成/)
})

test('未配齐生产能力时主按钮是草稿预演，配置缺失服务降为次按钮', () => {
  const missing = { readinessState: 'missing', serviceType: 'tts' }
  assert.equal(getPipelineCompactAction(missing).label, '先跑草稿预演')
  assert.equal(getPipelineCompactAction(missing).event, 'start-text-framework')
  assert.equal(getPipelineCompactSecondaryAction(missing).label, '配置缺失服务')
  assert.equal(getPipelineCompactSecondaryAction(missing).event, 'open-ai-config')
  assert.equal(getPipelineCompactSecondaryAction(missing).payload, 'tts')
  assert.equal(getPipelineCompactSecondaryAction({ readinessState: 'ready' }), null)
  assert.equal(getPipelineCompactAction({
    readinessState: 'missing',
    draftReason: '当前集还没有剧本，请先编写或导入剧本',
  }).label, '先跑草稿预演')
})
