import test from 'node:test'
import assert from 'node:assert/strict'

import { getCanvasProductionActionState } from '../src/utils/canvasActionState.js'
import { buildFreeCreateGenerationPayload } from '../src/utils/freeCreate.js'
import {
  applyFreeCanvasConfigGenerationResult,
  buildFreeCanvasConfigRuntime,
  collectFreeCanvasConfigGenerationInput,
  resolveFreeCanvasConfigGenerationOutcome,
  resolveFreeCanvasConfigServiceType,
  restoreFreeCanvasConfigOperationAfterReload,
} from '../src/utils/freeCanvasConfigState.js'

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
  assert.equal(runtime.canGenerate, false)
  assert.match(runtime.generateDisabledReason, /AI 配置/)
  assert.match(runtime.generateAriaLabel, /AI 配置/)
})

test('config runtime labels mock providers without reporting a completed generation', () => {
  const runtime = buildFreeCanvasConfigRuntime('config-1', canvasWithConfig(), {
    gate: { ready: true, status: 'ready', reason: '', serviceType: 'video' },
    capability: { config: { provider: 'mock-video', name: '本地 Mock' } },
  })

  assert.equal(runtime.status, 'mock')
  assert.equal(runtime.statusLabel, '预演配置')
  assert.match(runtime.reason, /不会产生正式视频/)
  assert.doesNotMatch(runtime.reason, /Mock Provider/)
  assert.equal(runtime.providerLabel, '本地 Mock')
  assert.equal(runtime.canConfigure, true)
  assert.equal(runtime.canGenerate, false)
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
  assert.equal(runtime.canGenerate, false)
  assert.match(runtime.reason, /无法确认视频模型配置/)
})

function textOnlyCanvas() {
  return {
    nodes: [
      { id: 'text-1', type: 'text', title: '镜头描述', content: '雨夜中的旧剧院' },
      { id: 'config-1', type: 'config', title: '生成配置', status: 'idle' },
    ],
    edges: [{ id: 'edge-1', source: 'text-1', target: 'config-1' }],
  }
}

test('config runtime selects image for text upstream and video for image upstream', () => {
  const videoGate = {
    ready: false,
    status: 'missing',
    reason: '视频生成未就绪：缺少启用的视频生成配置。请前往 AI 配置完成配置。',
    serviceType: 'video',
  }
  const imageRuntime = buildFreeCanvasConfigRuntime('config-1', textOnlyCanvas(), { gate: videoGate })
  assert.equal(resolveFreeCanvasConfigServiceType('config-1', textOnlyCanvas()), 'image')
  assert.equal(imageRuntime.serviceType, 'image')
  assert.equal(imageRuntime.status, 'blocked')
  assert.equal(imageRuntime.canGenerate, false)
  assert.match(imageRuntime.reason, /图片生成未就绪/)
  assert.match(imageRuntime.generateDisabledReason, /AI 配置/)

  const readyImageRuntime = buildFreeCanvasConfigRuntime('config-1', textOnlyCanvas(), {
    gates: {
      image: { ready: true, status: 'ready', reason: '', serviceType: 'image' },
      video: videoGate,
    },
    capabilities: {
      image: { ready: true, status: 'ready', reason: '', config: { name: '通义万象', provider: 'dashscope' } },
    },
  })
  assert.equal(readyImageRuntime.status, 'ready')
  assert.equal(readyImageRuntime.canGenerate, true)
  assert.equal(readyImageRuntime.generateAriaLabel, '生成')
  assert.equal(readyImageRuntime.providerLabel, '通义万象')

  const videoRuntime = buildFreeCanvasConfigRuntime('config-1', canvasWithConfig(), {
    gate: { ready: true, status: 'ready', reason: '', serviceType: 'video' },
  })
  assert.equal(resolveFreeCanvasConfigServiceType('config-1', canvasWithConfig()), 'video')
  assert.equal(videoRuntime.serviceType, 'video')
  assert.equal(videoRuntime.status, 'ready')
  assert.equal(videoRuntime.canGenerate, true)
  assert.equal(collectFreeCanvasConfigGenerationInput('config-1', canvasWithConfig()).referenceImagePath, 'library/actor.png')

  const imageInput = collectFreeCanvasConfigGenerationInput('config-1', textOnlyCanvas())
  const imageBody = buildFreeCreateGenerationPayload({
    mode: imageInput.serviceType,
    prompt: imageInput.prompt,
    aspectRatio: '16:9',
  })
  assert.equal(imageInput.serviceType, 'image')
  assert.equal(imageBody.prompt, '雨夜中的旧剧院')
  assert.equal(imageBody.first_frame_url, undefined)

  const videoInput = collectFreeCanvasConfigGenerationInput('config-1', canvasWithConfig())
  const videoBody = buildFreeCreateGenerationPayload({
    mode: videoInput.serviceType,
    prompt: videoInput.prompt,
    aspectRatio: '16:9',
    duration: 5,
    referenceUploadStatus: 'success',
    referenceImageLocalPath: videoInput.referenceImagePath,
  })
  assert.equal(videoInput.serviceType, 'video')
  assert.match(videoBody.first_frame_url, /library\/actor\.png/)
  assert.match(videoBody.image_url, /library\/actor\.png/)
})

test('config runtime disables generation until the matching provider is ready', () => {
  const runtime = buildFreeCanvasConfigRuntime('config-1', canvasWithConfig(), {
    gate: {
      ready: false,
      status: 'missing',
      reason: '视频生成未就绪：缺少启用的视频生成配置。请前往 AI 配置完成配置。',
      serviceType: 'video',
    },
  })
  assert.equal(runtime.canGenerate, false)
  assert.match(runtime.generateDisabledReason, /请前往 AI 配置/)
  assert.notEqual(runtime.generateAriaLabel, '生成')
})

test('cancelled generation never attaches a success result even if the task later completes', () => {
  const outcome = resolveFreeCanvasConfigGenerationOutcome({
    cancelRequested: true,
    itemStatus: 'completed',
    resultPath: 'library/result.png',
    resultUrl: '/static/library/result.png',
  })
  assert.equal(outcome.status, 'cancelled')
  assert.equal(outcome.createResult, false)

  const next = applyFreeCanvasConfigGenerationResult(canvasWithConfig({ status: 'running' }), {
    nodeId: 'config-1',
    outcome: { ...outcome, createResult: true },
    resultNode: { id: 'result-1', type: 'image', storageKey: 'library/result.png' },
    resultEdge: { id: 'edge-result', source: 'config-1', target: 'result-1' },
  })
  assert.equal(next.nodes.some((node) => node.id === 'result-1'), false)
  assert.equal(next.nodes.find((node) => node.id === 'config-1').status, 'cancelled')
})

test('reload does not treat an interrupted running config as a successful generation', () => {
  const interrupted = restoreFreeCanvasConfigOperationAfterReload({
    type: 'config',
    status: 'running',
    metadata: {},
  })
  assert.equal(interrupted.resume, false)
  assert.equal(interrupted.status, 'failed')
  assert.match(interrupted.lastError, /请重新生成/)

  const resumable = restoreFreeCanvasConfigOperationAfterReload({
    type: 'config',
    status: 'running',
    metadata: { operationId: 'task-123' },
  })
  assert.equal(resumable.resume, true)
  assert.equal(resumable.status, 'running')
  assert.equal(resumable.operationId, 'task-123')
})

test('英文失败原因回落到中文下一步，不把技术原文展示给用户', () => {
  const gate = { ready: true, status: 'ready', reason: '', serviceType: 'video' }
  const failed = buildFreeCanvasConfigRuntime('config-1', canvasWithConfig({
    status: 'failed',
    metadata: { lastError: 'Internal Server Error' },
  }), { gate })
  assert.equal(failed.status, 'failed')
  assert.match(failed.reason, /上次生成失败/)
  assert.doesNotMatch(failed.reason, /Internal Server Error/)

  const blocked = buildFreeCanvasConfigRuntime('config-1', canvasWithConfig(), {
    gate: { ready: false, status: 'error', reason: 'Failed to fetch', serviceType: 'video' },
  })
  assert.match(blocked.reason, /请前往 AI 配置/)
  assert.doesNotMatch(blocked.reason, /Failed to fetch/)

  const outcome = resolveFreeCanvasConfigGenerationOutcome({
    itemStatus: 'failed',
    error: 'network error',
  })
  assert.equal(outcome.status, 'failed')
  assert.match(outcome.lastError, /生成失败/)
  assert.doesNotMatch(outcome.lastError, /network error/i)
})

test('隔离形态的正式能力响应把未连线配置节点标成需要配置，而不是检查失败', () => {
  const readinessState = {
    status: 'loaded',
    data: {
      qa_mode: 'production',
      ready: false,
      capabilities: [
        { key: 'image', service_type: 'image', ready: false, detail: 'missing' },
        { key: 'video', service_type: 'video', ready: false, detail: 'missing' },
        { key: 'tts', service_type: 'tts', ready: false, detail: 'missing' },
        { key: 'ffmpeg', ready: true },
      ],
      missing_capabilities: [
        { key: 'image', service_type: 'image', detail: 'missing' },
        { key: 'video', service_type: 'video', detail: 'missing' },
        { key: 'tts', service_type: 'tts', detail: 'missing' },
      ],
    },
  }
  const actions = getCanvasProductionActionState(readinessState)
  const canvas = { nodes: [{ id: 'config-1', type: 'config' }], edges: [] }
  const runtime = buildFreeCanvasConfigRuntime('config-1', canvas, {
    gates: { image: actions.image, video: actions.video },
    capabilities: { image: actions.image, video: actions.video },
    gate: actions.video,
    capability: actions.video,
  })
  assert.equal(runtime.serviceType, 'image')
  assert.equal(runtime.status, 'blocked')
  assert.equal(runtime.statusLabel, '需要配置')
  assert.equal(runtime.canConfigure, true)

  const stale = getCanvasProductionActionState({
    status: 'loaded',
    data: {
      qa_mode: 'production',
      ready: false,
      capabilities: [
        { key: 'video', service_type: 'video', ready: false, detail: 'missing' },
        { key: 'tts', service_type: 'tts', ready: false, detail: 'missing' },
        { key: 'ffmpeg', ready: true },
      ],
      missing_capabilities: [
        { key: 'video', service_type: 'video', detail: 'missing' },
        { key: 'tts', service_type: 'tts', detail: 'missing' },
      ],
    },
  })
  const staleRuntime = buildFreeCanvasConfigRuntime('config-1', canvas, {
    gates: { image: stale.image, video: stale.video },
    capabilities: { image: stale.image, video: stale.video },
    gate: stale.video,
    capability: stale.video,
  })
  assert.equal(staleRuntime.statusLabel, '检查失败')
})
