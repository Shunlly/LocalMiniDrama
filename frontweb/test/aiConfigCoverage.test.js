import test from 'node:test'
import assert from 'node:assert/strict'

import {
  AI_SERVICE_COVERAGE_DEFINITIONS,
  buildAiServiceCoverage,
  getAiServiceCoverageActions,
  getConfigTestStatus,
  sortAiServiceCoverage,
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

test('coverage sorts exceptions first without mutating services or tie order', () => {
  const services = [
    { type: 'healthy', state: 'default', issue: null, test: { status: 'passed' } },
    { type: 'untested-a', state: 'default', issue: null, test: { status: 'unknown' } },
    { type: 'missing', state: 'missing', issue: 'missing', test: { status: 'unknown' } },
    { type: 'inactive', state: 'configured', issue: 'inactive', test: { status: 'unknown' } },
    { type: 'failed', state: 'default', issue: null, test: { status: 'failed' } },
    { type: 'no-default', state: 'configured', issue: 'no_default', test: { status: 'unknown' } },
    { type: 'untested-b', state: 'default', issue: null, test: { status: 'unknown' } },
  ]
  const before = structuredClone(services)

  const ordered = sortAiServiceCoverage(services)

  assert.notStrictEqual(ordered, services)
  assert.deepEqual(ordered.map((service) => service.type), [
    'failed',
    'inactive',
    'no-default',
    'missing',
    'untested-a',
    'untested-b',
    'healthy',
  ])
  assert.deepEqual(services, before)
})

test('coverage exposes at most one context action for the recovery matrix', () => {
  const targetConfig = { id: 9 }
  const cases = [
    {
      name: 'missing unlocked',
      service: { state: 'missing', issue: 'missing', targetConfig: null, test: { status: 'unknown' } },
      options: { vendorLocked: false },
      expected: [],
    },
    {
      name: 'missing vendor locked',
      service: { state: 'missing', issue: 'missing', targetConfig: null, test: { status: 'unknown' } },
      options: { vendorLocked: true },
      expected: [],
    },
    {
      name: 'no default unlocked',
      service: { state: 'configured', issue: 'no_default', targetConfig, test: { status: 'unknown' } },
      options: { vendorLocked: false },
      expected: [{ key: 'fix-default', label: '补齐默认', action: 'edit', emphasis: 'primary' }],
    },
    {
      name: 'inactive unlocked',
      service: { state: 'configured', issue: 'inactive', targetConfig, test: { status: 'unknown' } },
      options: { vendorLocked: false },
      expected: [{ key: 'activate', label: '启用默认', action: 'edit', emphasis: 'primary' }],
    },
    {
      name: 'broken vendor locked',
      service: { state: 'configured', issue: 'no_default', targetConfig, test: { status: 'unknown' } },
      options: { vendorLocked: true },
      expected: [],
    },
    {
      name: 'no default while writes locked',
      service: { state: 'configured', issue: 'no_default', targetConfig, test: { status: 'unknown' } },
      options: { vendorLocked: false, writesLocked: true },
      expected: [],
    },
    {
      name: 'inactive while writes locked',
      service: { state: 'configured', issue: 'inactive', targetConfig, test: { status: 'unknown' } },
      options: { vendorLocked: false, writesLocked: true },
      expected: [],
    },
    {
      name: 'untested default',
      service: { state: 'default', issue: null, targetConfig, test: { status: 'unknown' } },
      options: { vendorLocked: false },
      expected: [{ key: 'test', label: '立即测试', action: 'test', emphasis: 'primary' }],
    },
    {
      name: 'untested default while writes locked',
      service: { state: 'default', issue: null, targetConfig, test: { status: 'unknown' } },
      options: { vendorLocked: false, writesLocked: true },
      expected: [{ key: 'test', label: '立即测试', action: 'test', emphasis: 'primary' }],
    },
    {
      name: 'failed default while vendor locked',
      service: { state: 'default', issue: null, targetConfig, test: { status: 'failed' } },
      options: { vendorLocked: true },
      expected: [{ key: 'test', label: '重新测试', action: 'test', emphasis: 'primary' }],
    },
    {
      name: 'failed default while writes locked',
      service: { state: 'default', issue: null, targetConfig, test: { status: 'failed' } },
      options: { vendorLocked: false, writesLocked: true },
      expected: [{ key: 'test', label: '重新测试', action: 'test', emphasis: 'primary' }],
    },
    {
      name: 'tested healthy',
      service: { state: 'default', issue: null, targetConfig, test: { status: 'passed' } },
      options: { vendorLocked: false },
      expected: [],
    },
  ]

  for (const scenario of cases) {
    const actions = getAiServiceCoverageActions(scenario.service, scenario.options)
    assert.ok(actions.length <= 1, `${scenario.name} must not expose competing actions`)
    assert.deepEqual(actions, scenario.expected, scenario.name)
  }
})

test('unknown status remains explicit when the API exposes no test fields', () => {
  assert.deepEqual(getConfigTestStatus({ id: 20 }), {
    status: 'unknown',
    source: 'none',
    testedAt: null,
  })
})
