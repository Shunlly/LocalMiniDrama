import test from 'node:test'
import assert from 'node:assert/strict'

import { buildSourceIntakePayload, inferSourceTypeFromFilename, normalizeSourceType } from '../src/utils/sourceIntakeAdapter.js'
import { normalizeWorkflowRun, workflowStepLabel } from '../src/utils/workflowRunStatus.js'
import { normalizeQaReport } from '../src/utils/qaReport.js'
import { formatDuration, normalizeTimelineSummary } from '../src/utils/timelineSummary.js'

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
  assert.equal(workflowStepLabel('image_generation'), '生图')
  assert.equal(workflowStepLabel('video_generation'), '生成视频')
  assert.equal(workflowStepLabel('audio_generation'), '配音')
  assert.equal(workflowStepLabel('post_composite'), '合成')

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
