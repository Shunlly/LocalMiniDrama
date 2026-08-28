import test from 'node:test'
import assert from 'node:assert/strict'

import { getPipelineCompactAction } from '../src/utils/filmPipelineAction.js'

test('pipeline compact command follows readiness and execution state', () => {
  assert.deepEqual(
    getPipelineCompactAction({ readinessState: 'missing', serviceType: 'video' }),
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
