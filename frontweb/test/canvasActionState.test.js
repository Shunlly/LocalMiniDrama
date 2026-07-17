import test from 'node:test'
import assert from 'node:assert/strict'

import {
  episodeHasProductionContent,
  getCanvasActionDisabledReasons,
  getCanvasPipelineProductionGate,
  getCanvasProductionActionState,
  getCanvasStartMode,
  normalizeCanvasProductionReadiness,
} from '../src/utils/canvasActionState.js'

function productionReadiness(overrides = {}) {
  const capabilities = [
    { key: 'video', label: '视频生成', service_type: 'video', ready: true, detail: '已配置视频模型' },
    { key: 'tts', label: '语音合成', service_type: 'tts', ready: true, detail: '已配置 TTS 模型' },
    { key: 'ffmpeg', label: 'FFmpeg / FFprobe', service_type: '', ready: true, detail: '工具可用' },
  ].map((capability) => ({
    ...capability,
    ...(overrides[capability.key] || {}),
  }))
  const missing = capabilities
    .filter((capability) => !capability.ready)
    .map(({ key, label, service_type, detail }) => ({ key, label, service_type, detail }))
  return {
    qa_mode: 'production',
    ready: missing.length === 0,
    capabilities,
    missing_capabilities: missing,
  }
}

test('canvas actions explain missing workflow and episode prerequisites', () => {
  const reasons = getCanvasActionDisabledReasons({
    selectedStoryboardCount: 0,
    pipelineSteps: ['image'],
    episodeCount: 0,
    storyboardCount: 0,
  })

  assert.match(reasons.editScript, /新建一集/)
  assert.match(reasons.createStoryboard, /新建一集/)
  assert.match(reasons.createAsset, /新建一集/)
  assert.match(reasons.createWorkflow, /选择分镜/)
  assert.match(reasons.runWorkflow, /选择一个工作流/)
  assert.match(reasons.deleteWorkflow, /选择一个工作流/)
  assert.match(reasons.generateStoryboards, /选择一集/)
  assert.match(reasons.batchImages, /选择一集/)
  assert.match(reasons.batchVideos, /选择一集/)
})

test('canvas actions expose exact content prerequisites after selecting an episode', () => {
  const reasons = getCanvasActionDisabledReasons({
    selectedStoryboardCount: 2,
    pipelineSteps: ['image'],
    activeWorkflowSteps: ['image'],
    activeGroupId: 'wg-1',
    episodeCount: 2,
    episodeId: 12,
    episodeHasScript: false,
    storyboardCount: 0,
  })

  assert.equal(reasons.editScript, '')
  assert.equal(reasons.createStoryboard, '')
  assert.equal(reasons.createAsset, '')
  assert.equal(reasons.createWorkflow, '')
  assert.equal(reasons.runWorkflow, '')
  assert.equal(reasons.deleteWorkflow, '')
  assert.match(reasons.generateStoryboards, /还没有剧本/)
  assert.match(reasons.batchImages, /还没有分镜/)
  assert.match(reasons.batchVideos, /还没有分镜/)
})

test('canvas actions block conflicting generation work with a single reason', () => {
  const reasons = getCanvasActionDisabledReasons({
    selectedStoryboardCount: 1,
    pipelineSteps: ['image'],
    activeGroupId: 'wg-1',
    episodeCount: 1,
    episodeId: 12,
    episodeHasScript: true,
    storyboardCount: 3,
    episodeGenerating: true,
  })

  assert.equal(reasons.editScript, '')
  assert.equal(reasons.createWorkflow, '')
  assert.match(reasons.runWorkflow, /本集生成任务正在执行/)
  assert.equal(reasons.deleteWorkflow, '')
  assert.match(reasons.generateStoryboards, /本集生成任务正在执行/)
  assert.match(reasons.batchImages, /本集生成任务正在执行/)
})

test('canvas production actions consume authoritative video, tts and composite capabilities', () => {
  const productionActions = getCanvasProductionActionState({
    status: 'loaded',
    data: productionReadiness({
      video: { ready: false, detail: '缺少启用的视频生成配置' },
      tts: { ready: false, detail: '缺少启用的语音合成配置' },
    }),
  })

  assert.equal(productionActions.video.ready, false)
  assert.equal(productionActions.video.serviceType, 'video')
  assert.match(productionActions.video.reason, /缺少启用的视频生成配置/)
  assert.equal(productionActions.tts.ready, false)
  assert.equal(productionActions.tts.serviceType, 'tts')
  assert.match(productionActions.tts.reason, /缺少启用的语音合成配置/)
  assert.equal(productionActions.composite.ready, false)

  const reasons = getCanvasActionDisabledReasons({
    selectedStoryboardCount: 1,
    pipelineSteps: ['image'],
    activeWorkflowSteps: ['image'],
    activeGroupId: 'wg-image-only',
    episodeCount: 1,
    episodeId: 12,
    episodeHasScript: true,
    storyboardCount: 3,
    productionActions,
  })
  assert.equal(reasons.batchImages, '')
  assert.match(reasons.batchVideos, /视频生成/)
  assert.equal(reasons.createWorkflow, '')
  assert.equal(reasons.runWorkflow, '')
})

test('canvas production readiness fails closed while loading, after failure, and for invalid responses', () => {
  const loading = getCanvasProductionActionState({ status: 'loading', data: null })
  const failed = getCanvasProductionActionState({ status: 'error', data: null })
  const invalid = getCanvasProductionActionState({
    status: 'loaded',
    data: { qa_mode: 'production', ready: true, capabilities: [], missing_capabilities: [] },
  })

  assert.match(loading.video.reason, /正在检查/)
  assert.match(failed.video.reason, /无法确认/)
  assert.match(invalid.tts.reason, /无法确认/)
  assert.equal(getCanvasPipelineProductionGate(['image'], failed).ready, true)
  assert.equal(getCanvasPipelineProductionGate(['video'], loading).ready, false)
  assert.equal(getCanvasPipelineProductionGate(['audio'], failed).ready, false)
})

test('canvas production readiness accepts valid capability responses and rejects draft or incomplete data', () => {
  const ready = productionReadiness()
  assert.deepEqual(normalizeCanvasProductionReadiness(ready), ready)

  const productionActions = getCanvasProductionActionState({ status: 'loaded', data: ready })
  assert.equal(productionActions.video.ready, true)
  assert.equal(productionActions.tts.ready, true)
  assert.equal(productionActions.composite.ready, true)
  assert.equal(getCanvasPipelineProductionGate(['image', 'video', 'audio'], productionActions).ready, true)

  const inconsistent = getCanvasProductionActionState({
    status: 'loaded',
    data: {
      ...ready,
      ready: false,
      missing_capabilities: [{
        key: 'video',
        label: '视频生成',
        service_type: 'video',
        detail: '权威结果仍标记为缺失',
      }],
    },
  })
  assert.equal(inconsistent.video.ready, false)
  assert.match(inconsistent.video.reason, /权威结果仍标记为缺失/)

  assert.throws(
    () => normalizeCanvasProductionReadiness({ ...ready, qa_mode: 'draft' }),
    /响应无效/,
  )
  assert.throws(
    () => normalizeCanvasProductionReadiness({
      ...ready,
      capabilities: ready.capabilities.filter((capability) => capability.key !== 'tts'),
    }),
    /缺少 tts 状态/,
  )
})

test('canvas start mode keeps selection as the only empty-canvas gate', () => {
  assert.equal(getCanvasStartMode(null), 'unavailable')
  assert.equal(getCanvasStartMode({ episodes: [] }), 'create-episode')

  const emptyEpisodes = {
    episodes: [
      { id: 1, script_content: '', storyboards: [] },
      { id: 2, script_content: ' ', storyboards: [] },
    ],
  }
  assert.equal(getCanvasStartMode(emptyEpisodes), 'select-episode')
  assert.equal(getCanvasStartMode(emptyEpisodes, 1), '')
  assert.equal(getCanvasStartMode(emptyEpisodes, 999), 'select-episode')
  assert.equal(getCanvasStartMode({ episodes: [{ id: 1, script_content: '', storyboards: [] }] }), 'select-episode')
  assert.equal(getCanvasStartMode({ episodes: [{ id: 1, script_content: '', storyboards: [] }] }, 1), '')

  const populated = { episodes: [{ id: 1, script_content: '第一场', storyboards: [] }] }
  assert.equal(episodeHasProductionContent(populated.episodes[0]), true)
  assert.equal(getCanvasStartMode(populated, 1), '')
})
