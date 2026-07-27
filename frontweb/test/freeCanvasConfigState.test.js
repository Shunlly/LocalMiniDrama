import test from 'node:test'
import assert from 'node:assert/strict'

import { buildFreeCanvasConfigRuntime } from '../src/utils/freeCanvasConfigState.js'

function canvasWithConfig(overrides = {}) {
  return {
    nodes: [
      { id: 'text-1', type: 'text', title: '镜头描述', content: '雨夜中的旧剧院' },
      { id: 'image-1', type: 'image', title: '人物参考图', storageKey: 'library/actor.png' },
      { id: 'config-1', type: 'config', title: '生成配置', status: 'idle', ...overrides },
    ],
    edges: [
      { id: 'edge-1', source: 'text-1', target: 'config-1' },
      { id: 'edge-2', source: 'image-1', target: 'config-1' },
    ],
  }
}

test('config runtime summarizes upstream text and media while exposing a missing provider gate', () => {
  const runtime = buildFreeCanvasConfigRuntime('config-1', canvasWithConfig(), {
    gate: {
      ready: false,
      status: 'missing',
      reason: '视频生成未就绪：缺少启用的视频生成配置。请前往 AI 配置完成配置。',
      serviceType: 'video',
    },
  })

  assert.equal(runtime.status, 'blocked')
  assert.equal(runtime.statusLabel, '需要配置')
  assert.equal(runtime.serviceType, 'video')
  assert.match(runtime.inputSummary, /镜头描述：雨夜中的旧剧院/)
  assert.match(runtime.inputSummary, /图片：人物参考图/)
  assert.match(runtime.reason, /AI 配置/)
  assert.equal(runtime.canConfigure, true)
  assert.equal(runtime.canCancel, false)
})

test('config runtime labels mock providers without reporting a completed generation', () => {
  const runtime = buildFreeCanvasConfigRuntime('config-1', canvasWithConfig(), {
    gate: { ready: true, status: 'ready', reason: '', serviceType: 'video' },
    capability: { config: { provider: 'mock-video', name: '本地 Mock' } },
  })

  assert.equal(runtime.status, 'mock')
  assert.equal(runtime.statusLabel, 'Mock 预演')
  assert.match(runtime.reason, /不会产生正式视频/)
  assert.equal(runtime.providerLabel, '本地 Mock')
  assert.equal(runtime.canConfigure, true)
})

test('config runtime preserves running, failed, and cancelled operation controls', () => {
  const gate = { ready: true, status: 'ready', reason: '', serviceType: 'video' }
  const running = buildFreeCanvasConfigRuntime('config-1', canvasWithConfig({ status: 'running' }), { gate })
  assert.equal(running.status, 'running')
  assert.equal(running.canCancel, true)
  assert.equal(running.canRetry, false)

  const failed = buildFreeCanvasConfigRuntime('config-1', canvasWithConfig({
    status: 'failed',
    metadata: { lastError: '上次生成失败，请检查配置' },
  }), { gate })
  assert.equal(failed.status, 'failed')
  assert.equal(failed.canRetry, true)
  assert.match(failed.reason, /上次生成失败/)

  const cancelled = buildFreeCanvasConfigRuntime('config-1', canvasWithConfig({ status: 'cancelled' }), { gate })
  assert.equal(cancelled.status, 'cancelled')
  assert.equal(cancelled.canRetry, true)
  assert.equal(cancelled.statusLabel, '已取消')
})

test('config runtime fails closed when provider configuration cannot be confirmed', () => {
  const gate = { ready: true, status: 'ready', reason: '', serviceType: 'video' }
  const runtime = buildFreeCanvasConfigRuntime('config-1', canvasWithConfig(), {
    gate,
    capability: {
      ready: false,
      status: 'error',
      reason: '无法确认视频模型配置，请刷新后重试或前往 AI 配置检查。',
      config: null,
    },
  })

  assert.equal(runtime.status, 'error')
  assert.equal(runtime.statusLabel, '检查失败')
  assert.equal(runtime.canRetry, true)
  assert.match(runtime.reason, /无法确认视频模型配置/)
})
