import test from 'node:test'
import assert from 'node:assert/strict'
import * as sourceIntakeAdapter from '../src/utils/sourceIntakeAdapter.js'

import {
  buildSourceIntakePayload,
  inferSourceTypeFromFilename,
  normalizeSourceType,
  sourceRelationLabel,
  sourceTypeLabel,
} from '../src/utils/sourceIntakeAdapter.js'
import { createWorkflowGroup, normalizePipeline } from '../src/utils/canvasWorkflow.js'
import { normalizeWorkflowRun, workflowStepLabel, workflowTypeLabel } from '../src/utils/workflowRunStatus.js'
import { buildQaPresentation, normalizeQaReport, qaCheckLabel } from '../src/utils/qaReport.js'
import { formatDuration, normalizeTimelineSummary, timelineTrackTypeLabel } from '../src/utils/timelineSummary.js'
import { assetImageUrl, audioUrl, isSafeImagePreviewUrl, probeImageSource, storyboardImageUrl } from '../src/utils/mediaUrl.js'
import { hasStoryboardImage, hasStoryboardVideo, resolveSbVideoRecord, videoRecordUrl } from '../src/utils/storyboardMedia.js'
import { sanitizeConfigForExport, stripMaskedSecretsFromSettings } from '../src/utils/aiConfigExport.js'

test('buildSourceIntakePayload normalizes form data for backend source intake', () => {
  const payload = buildSourceIntakePayload({
    title: '',
    source_type: 'SCRIPT',
    target_episode_count: '3',
    text: '  Episode 1\nCharacter dialogue  ',
  }, {
    title: 'Workflow Test',
    style: 'anime style',
    metadata: { aspect_ratio: '9:16' },
  })

  assert.equal(payload.title, 'Workflow Test 素材')
  assert.equal(payload.source_type, 'script')
  assert.equal(payload.target_episode_count, 3)
  assert.equal(payload.style, 'anime style')
  assert.equal(payload.text, 'Episode 1\nCharacter dialogue')
  assert.equal(payload.metadata.aspect_ratio, '9:16')
  assert.equal(normalizeSourceType('bad-type'), '')
})

test('buildSourceIntakePayload preserves automatic source classification by default', () => {
  const payload = buildSourceIntakePayload({
    title: 'Auto classify',
    source_type: '',
    target_episode_count: 1,
    text: 'shot 1 wide exterior gate action',
  }, { title: 'Workflow Test', metadata: {} })

  assert.equal(payload.source_type, '')
  assert.equal(payload.title, 'Auto classify')
})

test('web source payload lets the fetched page title replace the automatic project title', () => {
  assert.equal(typeof sourceIntakeAdapter.buildWebSourceIntakePayload, 'function')
  const { buildWebSourceIntakePayload } = sourceIntakeAdapter
  const drama = { title: 'Workflow Test', metadata: {} }
  const automatic = buildWebSourceIntakePayload({
    title: 'Workflow Test 素材',
    source_type: '',
    source_url: ' https://example.com/story ',
    target_episode_count: 1,
    text: 'stale pasted text',
  }, drama)

  assert.equal('title' in automatic, false)
  assert.equal(automatic.source_url, 'https://example.com/story')
  assert.equal(automatic.text, '')

  const custom = buildWebSourceIntakePayload({
    title: '我的网页素材',
    source_url: 'https://example.com/story',
    target_episode_count: 1,
  }, drama)
  assert.equal(custom.title, '我的网页素材')
})

test('source provenance labels distinguish web, file, and pasted imports', () => {
  assert.equal(typeof sourceIntakeAdapter.sourceProvenanceLabel, 'function')
  const { sourceProvenanceLabel } = sourceIntakeAdapter
  assert.equal(sourceProvenanceLabel({
    metadata: { imported_from: 'source_intake_url', source_url: 'https://example.com/story' },
  }), '网页 · example.com')
  assert.equal(sourceProvenanceLabel({
    metadata: { imported_from: 'source_intake_upload' },
  }), '本地文件')
  assert.equal(sourceProvenanceLabel({
    metadata: { imported_from: 'source_intake_panel' },
  }), '粘贴文本')
  assert.equal(sourceProvenanceLabel({ metadata: {} }), '')
})

test('inferSourceTypeFromFilename detects common multi-source file names', () => {
  assert.equal(inferSourceTypeFromFilename('storyboard_shots.csv'), 'storyboard')
  assert.equal(inferSourceTypeFromFilename('episode-script.md'), 'script')
  assert.equal(inferSourceTypeFromFilename('captions.srt'), 'transcript')
  assert.equal(inferSourceTypeFromFilename('漫画-panels.txt'), 'comic')
  assert.equal(inferSourceTypeFromFilename('story.txt'), 'novel')
})

test('source and workflow technical enums have stable Chinese display labels', () => {
  assert.equal(sourceTypeLabel('SCRIPT'), '剧本')
  assert.equal(sourceTypeLabel(''), '自动识别')
  assert.equal(sourceTypeLabel('vendor-specific'), '其他素材')
  assert.equal(sourceRelationLabel('next'), '顺承')
  assert.equal(sourceRelationLabel('cause'), '因果')
  assert.equal(sourceRelationLabel('conflict'), '冲突')
  assert.equal(sourceRelationLabel('reveal'), '揭示')
  assert.equal(sourceRelationLabel('hook'), '悬念')
  assert.equal(sourceRelationLabel('vendor-specific'), '事件关系')
  assert.equal(workflowTypeLabel('novel2anime'), '故事转动画')
  assert.equal(workflowTypeLabel('unknown'), '内容制作流程')
  assert.equal(workflowStepLabel('asset_bible'), '资产设定')
  assert.equal(qaCheckLabel('source_intake'), '素材导入')
  assert.equal(qaCheckLabel('vendor_specific'), '其他检查')
  assert.equal(timelineTrackTypeLabel('video'), '视频')
  assert.equal(timelineTrackTypeLabel('subtitle'), '字幕')
  assert.equal(timelineTrackTypeLabel('vendor_specific'), '其他轨道')
})

test('normalizeWorkflowRun exposes retry, pause, resume and cancel states', () => {
  const failed = normalizeWorkflowRun({
    id: 'run-1',
    status: 'failed',
    progress: 42,
    steps: [
      { step_key: 'source_intake', status: 'completed' },
      { step_key: 'qa_audit', status: 'failed', error: 'QA gate failed' },
    ],
  })

  assert.equal(failed.label, '失败')
  assert.equal(failed.canRetry, true)
  assert.equal(failed.canCancel, false)
  assert.equal(failed.canPause, false)
  assert.equal(failed.canResume, false)
  assert.equal(failed.failedStep.step_key, 'qa_audit')
  assert.equal(workflowStepLabel('timeline_plan'), '时间线')
  assert.equal(workflowStepLabel('image_generation'), '分镜生图')
  assert.equal(workflowStepLabel('video_generation'), '分镜视频')
  assert.equal(workflowStepLabel('audio_generation'), '对白与旁白配音')
  assert.equal(workflowStepLabel('post_composite'), '成片合成')

  const active = normalizeWorkflowRun({
    id: 'run-2',
    status: 'processing',
    steps: [
      { step_key: 'source_intake', status: 'completed' },
      { step_key: 'adaptation_plan', status: 'processing' },
    ],
  })
  assert.equal(active.active, true)
  assert.equal(active.canCancel, true)
  assert.equal(active.canPause, true)
  assert.equal(active.canResume, false)
  assert.equal(active.activeStep.step_key, 'adaptation_plan')

  const paused = normalizeWorkflowRun({
    id: 'run-3',
    status: 'paused',
    steps: [{ step_key: 'video_generation', status: 'pending' }],
  })
  assert.equal(paused.active, false)
  assert.equal(paused.canCancel, true)
  assert.equal(paused.canPause, false)
  assert.equal(paused.canResume, true)

  const placeholder = normalizeWorkflowRun({
    id: 'run-4',
    type: 'novel2anime',
    status: 'completed',
    steps: [{ step_key: 'post_composite', status: 'completed' }],
  })
  assert.equal(placeholder.label, '草稿预演 · 已完成')
  assert.equal(placeholder.novel2animePlaceholder, true)
  assert.equal(
    workflowStepLabel(
      { step_key: 'post_composite', status: 'completed' },
      { input_json: { qa_mode: 'draft' } },
    ),
    '成片合成（草稿占位）',
  )

  const productionStep = {
    step_key: 'video_generation',
    status: 'completed',
    output_json: { mode: 'production', video_created: 1, video_reused: 0 },
    provider_invocations: [{ provider_name: 'seedance', mode: 'production', status: 'success' }],
  }
  const productionRun = {
    id: 'run-5',
    type: 'novel2anime',
    status: 'completed',
    input_json: { qa_mode: 'production' },
    steps: [productionStep],
  }
  const production = normalizeWorkflowRun(productionRun)
  assert.equal(production.label, '正式制作 · 已完成')
  assert.equal(production.novel2animePlaceholder, false)
  assert.equal(production.productionPlaceholder, false)
  assert.equal(workflowStepLabel(productionStep, productionRun), '分镜视频（正式产出）')

  const productionWithMock = normalizeWorkflowRun({
    ...productionRun,
    id: 'run-6',
    steps: [{
      step_key: 'image_generation',
      status: 'completed',
      output_json: { image_url: 'mock://storyboard/1/image' },
    }],
  })
  assert.equal(productionWithMock.label, '正式制作 · 检测到占位产物')
  assert.equal(productionWithMock.productionPlaceholder, true)
})

test('normalizeQaReport counts severities and remediation actions', () => {
  const normalized = normalizeQaReport({
    id: 7,
    run_id: 'run-1',
    score: 75,
    passed: false,
    report_json: {
      issues: [
        { code: 'missing_source', severity: 'error', message: 'missing source' },
        { code: 'missing_media', severity: 'warning', message: 'missing media' },
      ],
      recommendations: ['retry failed steps'],
      remediation_actions: [
        { code: 'start_or_retry_workflow', label: 'Retry workflow', automated: true },
      ],
    },
    created_at: '2026-01-01T00:00:00.000Z',
  })

  assert.equal(normalized.id, 7)
  assert.equal(normalized.run_id, 'run-1')
  assert.equal(normalized.score, 75)
  assert.equal(normalized.passed, false)
  assert.equal(normalized.issueCount, 2)
  assert.deepEqual(normalized.severityCounts, { error: 1, warning: 1 })
  assert.equal(normalized.recommendations[0], 'retry failed steps')
  assert.equal(normalized.remediationActions.length, 1)
  assert.equal(normalized.canRemediate, true)
})

test('draft QA presentation cannot be mistaken for production delivery approval', () => {
  const draft = buildQaPresentation({
    score: 100,
    passed: true,
    report_json: { mode: 'draft' },
  })
  assert.equal(draft.scoreLabel, '草稿结构检查 100 分')
  assert.equal(draft.statusLabel, '草稿结构检查已通过')
  assert.match(draft.notice, /不计为可交付成片/)

  const production = buildQaPresentation({ score: 92, passed: true }, 'production')
  assert.equal(production.scoreLabel, '正式交付检查 92 分')
  assert.equal(production.statusLabel, '正式交付检查已通过')
  assert.equal(production.notice, '')
})

test('normalizeTimelineSummary summarizes timeline tracks and duration', () => {
  const summary = normalizeTimelineSummary({
    summary: {
      episode_count: 2,
      track_count: 14,
      item_count: 28,
      duration_sec: 95,
      track_types: ['video', 'subtitle', 'voice', 'dialogue', 'effect', 'bgm', 'transition'],
    },
  })

  assert.equal(summary.episodeCount, 2)
  assert.equal(summary.trackCount, 14)
  assert.equal(summary.itemCount, 28)
  assert.equal(summary.hasRequiredTracks, true)
  assert.equal(formatDuration(summary.durationSec), '1:35')
})

test('normalizeTimelineSummary flags all-placeholder timeline items', () => {
  const summary = normalizeTimelineSummary({
    episodes: [
      {
        summary: { track_count: 2, item_count: 2, duration_sec: 10, track_types: ['video', 'voice'] },
        tracks: [
          { items: [{ source_path: 'mock://storyboard/1/video' }] },
          { items: [{ source_path: 'mock://storyboard/1/voice', metadata: { placeholder: true } }] },
        ],
      },
    ],
  })

  assert.equal(summary.itemCount, 2)
  assert.equal(summary.placeholderItemCount, 2)
  assert.equal(summary.hasPlaceholderItems, true)
  assert.equal(summary.hasOnlyPlaceholderItems, true)

  const mixed = normalizeTimelineSummary({
    summary: {
      episode_count: 1,
      track_count: 7,
      item_count: 3,
      track_types: ['video', 'subtitle', 'voice', 'dialogue', 'effect', 'bgm', 'transition'],
    },
    episodes: [
      {
        tracks: [
          { items: [{ source_path: 'mock://storyboard/1/video' }] },
          { items: [{ source_path: 'subtitles/1.srt' }, { source_path: 'media/audio/1.wav' }] },
        ],
      },
    ],
  })
  assert.equal(mixed.hasRequiredTracks, true)
  assert.equal(mixed.hasPlaceholderItems, true)
  assert.equal(mixed.hasOnlyPlaceholderItems, false)
})

test('canvas workflow keeps explicit empty pipeline invalid instead of defaulting to all steps', () => {
  assert.deepEqual(normalizePipeline([], { allowEmpty: true }), [])
  assert.deepEqual(normalizePipeline([]), ['image', 'video', 'audio'])
  assert.throws(
    () => createWorkflowGroup([], { title: 'empty', storyboardIds: [1], pipeline: [] }),
    /workflow step/
  )
})

test('media helpers do not treat mock placeholders as usable assets', () => {
  assert.equal(assetImageUrl({ local_path: 'mock://storyboard/1/image', image_url: 'placeholder://storyboard/1/image' }), '')
  assert.equal(assetImageUrl({ local_path: 'mock://storyboard/1/image', image_url: 'https://example.com/real.png' }), 'https://example.com/real.png')
  assert.equal(storyboardImageUrl({
    local_path: 'mock://storyboard/1/local',
    composed_image: 'placeholder://storyboard/1/composed',
    image_url: 'mock://storyboard/1/image',
  }), '')
  assert.equal(storyboardImageUrl({
    local_path: 'mock://storyboard/1/local',
    composed_image: 'https://example.com/composed.png',
    image_url: 'https://example.com/fallback.png',
  }), 'https://example.com/composed.png')
  assert.equal(audioUrl('placeholder://storyboard/1/audio'), '')

  const sb = {
    id: 1,
    image_url: 'mock://storyboard/1/image',
    local_path: 'placeholder://storyboard/1/local',
    video_url: 'mock://storyboard/1/video',
  }
  assert.equal(hasStoryboardImage(sb, {}, {}), false)
  assert.equal(hasStoryboardVideo(sb, {}), false)
  assert.equal(resolveSbVideoRecord(sb, {}), null)
  assert.equal(videoRecordUrl({ video_url: 'mock://storyboard/1/video' }), '')

  const realVideo = { id: 1, video_url: 'https://example.com/real.mp4', status: 'completed' }
  assert.equal(hasStoryboardVideo({ id: 1 }, { 1: [realVideo] }), true)
  assert.equal(videoRecordUrl(realVideo), 'https://example.com/real.mp4')

  const separatedMedia = {
    id: 2,
    local_path: 'images/storyboard.png',
    video_local_path: 'videos/storyboard.mp4',
  }
  const selectedVideo = resolveSbVideoRecord(separatedMedia, {})
  assert.equal(selectedVideo.local_path, 'videos/storyboard.mp4')
  assert.equal(videoRecordUrl(selectedVideo), '/static/videos/storyboard.mp4')
})

test('image preview probes reject placeholders and require positive decoded dimensions', async () => {
  let placeholderProbeCreated = false
  assert.equal(await probeImageSource('mock://storyboard/1/image', {
    createImage() {
      placeholderProbeCreated = true
      return {}
    },
  }), false)
  assert.equal(placeholderProbeCreated, false)
  assert.equal(isSafeImagePreviewUrl('data:text/html;base64,PGgxPk5PPC9oMT4='), false)
  assert.equal(isSafeImagePreviewUrl('javascript:alert(1)'), false)

  const createImage = (naturalWidth, naturalHeight) => {
    const image = { naturalWidth, naturalHeight, onload: null, onerror: null }
    Object.defineProperty(image, 'src', {
      set() { queueMicrotask(() => image.onload?.()) },
    })
    return image
  }
  assert.equal(await probeImageSource('https://example.com/real.png', {
    createImage: () => createImage(640, 360),
    timeoutMs: 500,
  }), true)
  assert.equal(await probeImageSource('/static/images/broken.png', {
    createImage: () => createImage(0, 0),
    timeoutMs: 500,
  }), false)
})

test('AI config export and import helpers strip masked settings secrets', () => {
  const settings = JSON.stringify({
    auth_mode: 'volc_sign',
    access_key_id: '********',
    secret_access_key: '********',
    nested: { token: '********', safe: 'visible' },
  })
  const cleaned = JSON.parse(stripMaskedSecretsFromSettings(settings))
  assert.equal(cleaned.access_key_id, '')
  assert.equal(cleaned.secret_access_key, '')
  assert.equal(cleaned.nested.token, '')
  assert.equal(cleaned.nested.safe, 'visible')

  const exported = sanitizeConfigForExport({
    id: 1,
    created_at: '2026-01-01',
    updated_at: '2026-01-02',
    api_key: '********',
    api_key_set: true,
    name: 'cfg',
    settings,
  })
  assert.equal(exported.api_key, '')
  assert.equal('id' in exported, false)
  assert.equal(JSON.parse(exported.settings).secret_access_key, '')
})
