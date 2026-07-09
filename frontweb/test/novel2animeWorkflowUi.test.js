import test from 'node:test'
import assert from 'node:assert/strict'

import { buildSourceIntakePayload, inferSourceTypeFromFilename, normalizeSourceType } from '../src/utils/sourceIntakeAdapter.js'
import { createWorkflowGroup, normalizePipeline } from '../src/utils/canvasWorkflow.js'
import { normalizeWorkflowRun, workflowStepLabel } from '../src/utils/workflowRunStatus.js'
import { normalizeQaReport } from '../src/utils/qaReport.js'
import { formatDuration, normalizeTimelineSummary } from '../src/utils/timelineSummary.js'
import { assetImageUrl, audioUrl } from '../src/utils/mediaUrl.js'
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

test('inferSourceTypeFromFilename detects common multi-source file names', () => {
  assert.equal(inferSourceTypeFromFilename('storyboard_shots.csv'), 'storyboard')
  assert.equal(inferSourceTypeFromFilename('episode-script.md'), 'script')
  assert.equal(inferSourceTypeFromFilename('captions.srt'), 'transcript')
  assert.equal(inferSourceTypeFromFilename('漫画-panels.txt'), 'comic')
  assert.equal(inferSourceTypeFromFilename('story.txt'), 'novel')
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
  assert.equal(workflowStepLabel('image_generation'), '生图（占位）')
  assert.equal(workflowStepLabel('video_generation'), '视频（占位）')
  assert.equal(workflowStepLabel('audio_generation'), '配音（占位）')
  assert.equal(workflowStepLabel('post_composite'), '合成（占位）')

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
  assert.equal(paused.canCancel, false)
  assert.equal(paused.canPause, false)
  assert.equal(paused.canResume, true)

  const placeholder = normalizeWorkflowRun({
    id: 'run-4',
    type: 'novel2anime',
    status: 'completed',
    steps: [{ step_key: 'post_composite', status: 'completed' }],
  })
  assert.equal(placeholder.label, '占位流程完成')
  assert.equal(placeholder.novel2animePlaceholder, true)
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
