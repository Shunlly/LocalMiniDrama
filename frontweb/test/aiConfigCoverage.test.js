import test from 'node:test'
import assert from 'node:assert/strict'

import {
  AI_SERVICE_COVERAGE_DEFINITIONS,
  buildAiServiceCoverage,
  getAiServiceCoverageActions,
  getConfigTestStatus,
} from '../src/utils/aiConfigCoverage.js'

test('empty configs report all required services as missing', () => {
  const coverage = buildAiServiceCoverage([])

  assert.equal(coverage.totalCount, 5)
  assert.equal(coverage.readyCount, 0)
  assert.equal(coverage.missingCount, 5)
  assert.equal(coverage.attentionCount, 5)
  assert.equal(coverage.untestedCount, 5)
  assert.deepEqual(
    coverage.services.map((item) => item.type),
    AI_SERVICE_COVERAGE_DEFINITIONS.map((item) => item.type),
  )
  assert.ok(coverage.services.every((item) => item.state === 'missing'))
})

test('coverage distinguishes configured services from active defaults', () => {
  const coverage = buildAiServiceCoverage([
    { id: 1, service_type: 'text', is_active: true, is_default: true },
    { id: 2, service_type: 'image', is_active: true, is_default: false },
    { id: 3, service_type: 'video', is_active: false, is_default: true },
    { id: 4, service_type: 'jimeng2_character_auth', is_active: true, is_default: true },
  ])

  const byType = Object.fromEntries(coverage.services.map((item) => [item.type, item]))
  assert.equal(byType.text.state, 'default')
  assert.equal(byType.text.ready, true)
  assert.equal(byType.image.state, 'configured')
  assert.equal(byType.image.issue, 'no_default')
  assert.equal(byType.video.state, 'configured')
  assert.equal(byType.video.issue, 'inactive')
  assert.equal(byType.storyboard_image.state, 'missing')
  assert.equal(coverage.readyCount, 1)
  assert.equal(coverage.configuredCount, 3)
  assert.equal(coverage.missingCount, 2)
  assert.equal(coverage.attentionCount, 4)
})

test('test status follows the default config and prefers this-page session results', () => {
  const configs = [
    {
      id: 10,
      service_type: 'text',
      is_active: true,
      is_default: true,
      last_test_status: 'success',
      last_tested_at: '2026-07-09T10:00:00.000Z',
    },
    {
      id: 11,
      service_type: 'text',
      is_active: true,
      is_default: false,
      last_test_status: 'failed',
    },
  ]

  const persisted = buildAiServiceCoverage(configs).services[0]
  assert.deepEqual(persisted.test, {
    status: 'passed',
    source: 'persisted',
    testedAt: '2026-07-09T10:00:00.000Z',
  })

  const session = buildAiServiceCoverage(configs, {
    10: { status: 'failed', testedAt: '2026-07-10T08:00:00.000Z' },
  }).services[0]
  assert.deepEqual(session.test, {
    status: 'failed',
    source: 'session',
    testedAt: '2026-07-10T08:00:00.000Z',
  })
})

test('coverage summary counts passed, failed, and unknown tests separately', () => {
  const coverage = buildAiServiceCoverage([
    {
      id: 1,
      service_type: 'text',
      is_active: true,
      is_default: true,
      last_test_status: 'success',
    },
    {
      id: 2,
      service_type: 'image',
      is_active: true,
      is_default: true,
      last_test_status: 'failed',
    },
    {
      id: 3,
      service_type: 'storyboard_image',
      is_active: true,
      is_default: true,
    },
  ])

  assert.equal(coverage.testPassedCount, 1)
  assert.equal(coverage.testFailedCount, 1)
  assert.equal(coverage.untestedCount, 3)
})

test('coverage actions expose add, view, edit, and test CTAs for the UI', () => {
  const missingService = {
    state: 'missing',
    label: '视频生成',
    targetConfig: null,
    test: { status: 'unknown' },
  }
  assert.deepEqual(getAiServiceCoverageActions(missingService, { vendorLocked: false }), [
    {
      key: 'add',
      label: '添加视频生成配置',
      action: 'add',
      emphasis: 'primary',
    },
    {
      key: 'view',
      label: '查看配置',
      action: 'view',
      emphasis: 'secondary',
    },
  ])

  const noDefaultService = {
    state: 'configured',
    issue: 'no_default',
    label: '素材图片',
    targetConfig: { id: 2 },
    test: { status: 'failed' },
  }
  assert.deepEqual(getAiServiceCoverageActions(noDefaultService), [
    {
      key: 'fix-default',
      label: '补齐默认',
      action: 'edit',
      emphasis: 'primary',
    },
    {
      key: 'view',
      label: '查看配置',
      action: 'view',
      emphasis: 'secondary',
    },
    {
      key: 'test',
      label: '立即测试',
      action: 'test',
      emphasis: 'secondary',
    },
  ])

  const readyService = {
    state: 'default',
    issue: null,
    label: '文本生成',
    targetConfig: { id: 1 },
    test: { status: 'passed' },
  }
  assert.deepEqual(getAiServiceCoverageActions(readyService, { vendorLocked: true }), [
    {
      key: 'view',
      label: '查看配置',
      action: 'view',
      emphasis: 'primary',
    },
    {
      key: 'test',
      label: '重新测试',
      action: 'test',
      emphasis: 'secondary',
    },
  ])
})

test('unknown status remains explicit when the API exposes no test fields', () => {
  assert.deepEqual(getConfigTestStatus({ id: 20 }), {
    status: 'unknown',
    source: 'none',
    testedAt: null,
  })
})
