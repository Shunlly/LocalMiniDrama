import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { remainingExtractNamedFunction } from './helpers/remainingSourceBetween.js'

import {
  ProductionReadinessError,
  buildAiConfigLocation,
  buildWorkflowLaunchPayload,
  isValidHttpSourceUrl,
  launchSourceWorkflow,
} from '../src/utils/sourceWorkflowLaunch.js'

function readyDto() {
  return {
    qa_mode: 'production',
    ready: true,
    capabilities: [
      { key: 'text', label: 'Text Model', required: true, ready: true },
      { key: 'image', label: 'Storyboard Image', required: true, ready: true },
    ],
    missing_capabilities: [],
  }
}

test('production launch sends qa_mode=production through readiness and start payloads', async () => {
  const calls = []
  const result = await launchSourceWorkflow({
    mode: 'production',
    payload: { drama_id: 7, source_id: 11, qa_mode: 'draft' },
    checkReadiness: async (payload) => {
      calls.push(['readiness', payload])
      return readyDto()
    },
    start: async (payload) => {
      calls.push(['start', payload])
      return { id: 'run-production' }
    },
  })

  assert.equal(result.payload.qa_mode, 'production')
  assert.equal(calls[0][1].qa_mode, 'production')
  assert.equal(calls[1][1].qa_mode, 'production')
  assert.equal(result.run.id, 'run-production')
})

test('source URL validation accepts only complete credential-free HTTP(S) URLs', () => {
  assert.equal(isValidHttpSourceUrl('https://example.com/story?id=1'), true)
  assert.equal(isValidHttpSourceUrl(' http://example.com/path '), true)
  for (const value of [
    '',
    'not-a-valid-url',
    'ftp://example.com/story.txt',
    'javascript:alert(1)',
    'https://user:password@example.com/story',
    '//example.com/story',
  ]) {
    assert.equal(isValidHttpSourceUrl(value), false, value)
  }
})

test('production readiness gaps prevent workflow submission and remain available to the UI', async () => {
  const readiness = {
    qa_mode: 'production',
    ready: false,
    capabilities: [],
    missing_capabilities: [
      { key: 'video', label: 'Video Generation', service_type: 'video', detail: 'Missing enabled video provider' },
    ],
  }
  let startCalls = 0

  await assert.rejects(
    launchSourceWorkflow({
      mode: 'production',
      payload: { drama_id: 7 },
      checkReadiness: async () => readiness,
      start: async () => {
        startCalls += 1
        return { id: 'must-not-start' }
      },
    }),
    (error) => {
      assert.equal(error instanceof ProductionReadinessError, true)
      assert.equal(error.code, 'WORKFLOW_NOT_READY')
      assert.equal(error.readiness.missing_capabilities[0].label, 'Video Generation')
      return true
    },
  )
  assert.equal(startCalls, 0)
})

test('workflow submission errors propagate unchanged and draft skips readiness', async () => {
  const expected = new Error('provider rejected request')
  let readinessCalls = 0

  await assert.rejects(
    launchSourceWorkflow({
      mode: 'draft',
      payload: { drama_id: 3 },
      checkReadiness: async () => {
        readinessCalls += 1
        return readyDto()
      },
      start: async (payload) => {
        assert.equal(payload.qa_mode, 'draft')
        throw expected
      },
    }),
    (error) => error === expected,
  )
  assert.equal(readinessCalls, 0)
  assert.equal(buildWorkflowLaunchPayload({ qa_mode: 'production' }, 'bad-mode').qa_mode, 'draft')
})

test('AI config location preserves a safe explicit workspace return and the first missing service', () => {
  const location = buildAiConfigLocation({
    dramaId: 12,
    readiness: {
      missing_capabilities: [
        { key: 'ffmpeg', service_type: '' },
        { key: 'image', service_type: 'storyboard_image' },
      ],
    },
  })
  assert.deepEqual(location, {
    name: 'ai-config',
    query: {
      service_type: 'storyboard_image',
      returnTo: '/drama/12#source-intake-workflow',
    },
  })
  assert.deepEqual(
    buildAiConfigLocation({ dramaId: 'https://evil.test', serviceType: 'video' }),
    { name: 'ai-config', query: { service_type: 'video' } },
  )
  assert.deepEqual(
    buildAiConfigLocation({
      dramaId: 12,
      serviceType: 'video',
      returnTo: '/film/12/canvas?episode=8&focus=sb%3A42',
    }),
    {
      name: 'ai-config',
      query: {
        service_type: 'video',
        returnTo: '/film/12/canvas?episode=8&focus=sb%3A42',
      },
    },
  )
  assert.equal(
    buildAiConfigLocation({ dramaId: 12, returnTo: '//evil.test/steal' }).query.returnTo,
    '/drama/12#source-intake-workflow',
  )
})

test('source workflow panel exposes mode, readiness remediation, and a throwing source launcher', () => {
  const source = readFileSync(new URL('../src/components/SourceIntakeWorkflowPanel.vue', import.meta.url), 'utf8')

  assert.match(source, /草稿预演/)
  assert.match(source, /正式制作/)
  assert.match(source, /getNovel2AnimeReadiness\(payload\)/)
  assert.match(source, /前往 AI 配置/)
  assert.match(source, /buildAiConfigLocation/)
  assert.match(source, /startingSourceId === source\.id/)
  assert.match(source, /const productionLaunchReason = computed/)
  assert.match(source, /async function handleWorkflowModeChange\(\)[\s\S]*checkProductionReadiness\(\{[\s\S]*qa_mode: 'production'/)
  assert.match(source, /start: sourceUrlValidationMessage\.value \|\| baseActionReasons\.value\.start \|\| productionLaunchReason\.value/)
  assert.match(source, /:disabled="isWorkflowLaunchBusy"/)
  assert.doesNotMatch(source, /:disabled="isWorkflowLaunchBusy \|\| Boolean\(newWorkflowRunReason\)"/)
  assert.match(source, /onBeforeRouteLeave\(\(\) => confirmSourceInputLeave\(\)\)/)
  assert.match(source, /window\.addEventListener\('beforeunload', handleBeforeUnload\)/)
  const launcher = remainingExtractNamedFunction(source, 'startWorkflowFromSource')
  assert.match(launcher, /throw new Error\('素材记录无效/)
  assert.doesNotMatch(launcher, /catch\s*\(/)
  assert.doesNotMatch(launcher, /return null/)
})

test('source workflow polling surfaces failure, persists load errors, and offers recovery', () => {
  const source = readFileSync(new URL('../src/components/SourceIntakeWorkflowPanel.vue', import.meta.url), 'utf8')
  assert.match(source, /workflowDataError = ref\(''\)/)
  assert.match(source, /pollState = ref\('idle'\)/)
  assert.match(source, /pollError = ref\(''\)/)
  assert.match(source, /class="workflow-status-banner workflow-status-banner--error"/)
  assert.match(source, /class="poll-status-banner"/)
  assert.match(source, /async function resumePolling\(\)/)
  assert.match(source, /pollState\.value = 'error'/)
  assert.match(source, /shouldIgnoreSourceWorkflowPollError\(error, sourceWorkflowLifecycle\)/)
  assert.match(source, /describeServiceLoadError\(error, \{[\s\S]*fallback: '处理状态刷新失败，自动轮询已暂停。'/)
  assert.match(source, /shouldIgnoreSourceWorkflowPollError\(e, sourceWorkflowLifecycle\)/)
  assert.match(source, /describeServiceLoadError\(e, \{[\s\S]*fallback: '加载素材流程状态失败，请稍后重试。'/)
  assert.match(source, /SOURCE_WORKFLOW_CANCEL_REASON/)
  assert.match(source, /SOURCE_WORKFLOW_PAUSE_REASON/)
  assert.match(source, /@click="resumePolling"/)
})
