import test from 'node:test'
import assert from 'node:assert/strict'

import {
  coverageConfigDetail,
  coverageInventoryLabel,
  coverageStateLabel,
  coverageStateTagType,
  coverageTestLabel,
  useAiConfigCoverage,
} from '../src/composables/useAiConfigCoverage.js'

const TEXT_ID = 41
const IMAGE_ID = 77
assert.notEqual(TEXT_ID, IMAGE_ID)

function refOf(value) {
  return { value }
}

function createCoverage(overrides = {}) {
  const calls = {
    selectConfigWorkspaceView: [],
    openAddForService: [],
    openEdit: [],
    openTest: [],
    abortConnectionTest: 0,
    scrollIntoView: [],
    nextTick: 0,
    cardFocus: [],
    workspaceFocus: [],
  }
  const vendorLock = overrides.vendorLock || refOf({ enabled: false })
  const configWriteLocked = overrides.configWriteLocked || refOf(false)
  const testingConfigId = overrides.testingConfigId || refOf(null)
  const canAutoOpenMissingService = overrides.canAutoOpenMissingService || refOf(true)
  const configWorkspaceView = overrides.configWorkspaceView || refOf('coverage')
  const activeServiceFilter = overrides.activeServiceFilter || refOf('')
  const serviceCoverage = overrides.serviceCoverage || refOf({ services: [] })
  const coverageCardRefs = overrides.coverageCardRefs || new Map()
  const lastTestedCoverageServiceType = overrides.lastTestedCoverageServiceType || refOf('')
  const coverageWorkspaceModeRef = overrides.coverageWorkspaceModeRef || refOf({
    focus() { calls.workspaceFocus.push('workspace') },
  })
  const configListSectionRef = overrides.configListSectionRef || refOf({
    scrollIntoView(opts) { calls.scrollIntoView.push(opts) },
  })

  const api = useAiConfigCoverage({
    vendorLock,
    configWriteLocked,
    testingConfigId,
    canAutoOpenMissingService,
    configWorkspaceView,
    activeServiceFilter,
    serviceCoverage,
    coverageWorkspaceModeRef,
    configListSectionRef,
    coverageCardRefs,
    lastTestedCoverageServiceType,
    selectConfigWorkspaceView(view, options) {
      calls.selectConfigWorkspaceView.push({ view, options })
    },
    normalizeInitialServiceType: overrides.normalizeInitialServiceType || ((value) => {
      const normalized = String(value || '').trim()
      return ['text', 'image', 'storyboard_image', 'video', 'tts'].includes(normalized) ? normalized : ''
    }),
    openAddForService(type) { calls.openAddForService.push(type) },
    async openEdit(config, options) { calls.openEdit.push({ config, options }) },
    async openTest(config) { calls.openTest.push(config) },
    abortConnectionTest() { calls.abortConnectionTest += 1 },
    nextTick: async () => { calls.nextTick += 1 },
  })

  return {
    api,
    calls,
    vendorLock,
    configWriteLocked,
    testingConfigId,
    canAutoOpenMissingService,
    configWorkspaceView,
    activeServiceFilter,
    serviceCoverage,
    coverageCardRefs,
    lastTestedCoverageServiceType,
    coverageWorkspaceModeRef,
    configListSectionRef,
  }
}

test('coverage card copy names readiness and missing credentials', () => {
  assert.equal(coverageStateLabel({ ready: true }), '可用')
  assert.equal(coverageStateLabel({ issue: 'missing_credentials' }), '缺少凭据')
  assert.equal(coverageStateLabel({ issue: 'missing_model' }), '缺少模型')
  assert.equal(coverageStateLabel({ issue: 'missing_workflow' }), '缺少工作流')
  assert.equal(coverageStateLabel({ issue: 'connection_failed' }), '连接失败')
  assert.equal(coverageStateLabel({ issue: 'inactive' }), '未启用')
  assert.equal(coverageStateLabel({ state: 'configured' }), '缺少默认')
  assert.equal(coverageStateLabel({ state: 'missing' }), '未配置')

  assert.equal(coverageStateTagType({ ready: true }), 'success')
  assert.equal(coverageStateTagType({ state: 'configured' }), 'warning')
  assert.equal(coverageStateTagType({ state: 'missing' }), 'danger')
})

test('coverage card detail and inventory stay user-facing Chinese', () => {
  assert.equal(coverageConfigDetail({ state: 'missing' }), '尚无配置')
  assert.equal(coverageConfigDetail({ issue: 'inactive', configuredCount: 2 }), '2 个配置，均未启用')
  assert.equal(coverageConfigDetail({ activeCount: 3 }), '3 个启用配置，请设置默认项')
  assert.equal(coverageConfigDetail({ defaultConfig: {}, issue: 'missing_credentials' }), '默认配置缺少凭据')
  assert.equal(coverageConfigDetail({ defaultConfig: {}, issue: 'missing_model' }), '默认配置缺少模型')
  assert.equal(coverageConfigDetail({ defaultConfig: {}, issue: 'missing_workflow' }), '默认配置缺少工作流')
  assert.equal(coverageConfigDetail({ defaultConfig: {}, issue: 'connection_failed' }), '默认配置最近连接失败')
  assert.equal(
    coverageConfigDetail({ defaultConfig: { name: '通义', default_model: 'qwen' } }),
    '通义 · qwen',
  )
  assert.equal(
    coverageConfigDetail({ defaultConfig: { provider: 'seedance', model: ['v1', 'v2'] } }),
    'seedance · v1',
  )
  assert.equal(coverageConfigDetail({ defaultConfig: {} }), '默认配置')

  assert.equal(coverageInventoryLabel({ state: 'missing' }), '未配置')
  assert.equal(coverageInventoryLabel({ configuredCount: 2, activeCount: 1 }), '已配置 2 条 · 启用 1')
  assert.equal(coverageInventoryLabel({ configuredCount: 1, activeCount: 0 }), '已配置 1 条 · 启用 0')
})

test('coverage test labels distinguish this-session results from persisted ones', () => {
  assert.equal(coverageTestLabel({ status: 'passed', source: 'session' }), '本次测试通过')
  assert.equal(coverageTestLabel({ status: 'passed', source: 'persisted' }), '最近测试通过')
  assert.equal(coverageTestLabel({ status: 'failed', source: 'session' }), '本次测试失败')
  assert.equal(coverageTestLabel({ status: 'failed', source: 'persisted' }), '最近测试失败')
  assert.equal(coverageTestLabel({ status: 'unknown' }), '尚无测试记录')
})

test('coverage actions forward vendor lock and write lock together', () => {
  const { api, vendorLock, configWriteLocked } = createCoverage()
  const service = {
    state: 'configured',
    issue: 'no_default',
    targetConfig: { id: TEXT_ID },
  }
  vendorLock.value.enabled = true
  configWriteLocked.value = false
  assert.deepEqual(api.coverageActions(service), [])

  vendorLock.value.enabled = false
  configWriteLocked.value = true
  assert.deepEqual(api.coverageActions(service), [])

  configWriteLocked.value = false
  assert.deepEqual(api.coverageActions(service), [{
    key: 'fix-default',
    label: '补齐默认',
    action: 'edit',
    emphasis: 'primary',
  }])
})

test('coverage action pending state compares config ids as strings and does not mix services', () => {
  const { api, testingConfigId, configWriteLocked } = createCoverage({
    testingConfigId: refOf(String(TEXT_ID)),
  })
  const textItem = { targetConfig: { id: TEXT_ID } }
  const imageItem = { targetConfig: { id: IMAGE_ID } }
  const testAction = { action: 'test' }
  const editAction = { action: 'edit' }

  assert.equal(api.isCoverageActionTesting(textItem, testAction), true)
  assert.equal(api.isCoverageActionTesting(imageItem, testAction), false)
  assert.equal(api.isCoverageActionTesting(textItem, editAction), false)

  assert.equal(api.isCoverageActionDisabled(textItem, testAction), true)
  assert.equal(api.isCoverageActionDisabled(imageItem, testAction), true)
  configWriteLocked.value = true
  assert.equal(api.isCoverageActionDisabled(textItem, editAction), true)
  configWriteLocked.value = false
  assert.equal(api.isCoverageActionDisabled(textItem, { action: 'view' }), false)
})

test('missing service auto-opens only after dependencies are ready and vendor is unlocked', () => {
  const { api, canAutoOpenMissingService, vendorLock } = createCoverage()
  const missing = { state: 'missing', type: 'text' }
  assert.equal(api.shouldAutoOpenRequestedService(missing), true)

  canAutoOpenMissingService.value = false
  assert.equal(api.shouldAutoOpenRequestedService(missing), false)
  canAutoOpenMissingService.value = true
  vendorLock.value.enabled = true
  assert.equal(api.shouldAutoOpenRequestedService(missing), false)
  vendorLock.value.enabled = false
  assert.equal(api.shouldAutoOpenRequestedService({ state: 'configured', type: 'text' }), false)
  assert.equal(api.shouldAutoOpenRequestedService(null), false)
})

test('selecting a coverage card opens add for missing services otherwise focuses config list', async () => {
  const missing = createCoverage()
  await missing.api.onCoverageSelect({ type: 'text', state: 'missing' })
  assert.deepEqual(missing.calls.openAddForService, ['text'])
  assert.equal(missing.calls.selectConfigWorkspaceView.length, 0)

  const configured = createCoverage()
  await configured.api.onCoverageSelect({ type: 'image', state: 'configured' })
  assert.deepEqual(configured.calls.openAddForService, [])
  assert.deepEqual(configured.calls.selectConfigWorkspaceView, [{ view: 'configs', options: { focus: true } }])
  assert.equal(configured.activeServiceFilter.value, 'image')
  assert.deepEqual(configured.calls.scrollIntoView, [{ behavior: 'smooth', block: 'nearest' }])
})

test('coverage actions dispatch add, edit, test and ignore locked writes', async () => {
  const harness = createCoverage()
  const textConfig = { id: TEXT_ID, service_type: 'text' }
  const imageConfig = { id: IMAGE_ID, service_type: 'image' }
  assert.notEqual(textConfig.id, imageConfig.id)

  await harness.api.onCoverageAction({ type: 'text' }, { action: 'add' })
  await harness.api.onCoverageAction(
    { type: 'text', targetConfig: textConfig, issue: 'missing_model' },
    { action: 'edit' },
  )
  await harness.api.onCoverageAction({ type: 'image' }, { action: 'edit' })
  await harness.api.onCoverageAction(
    { type: 'image', targetConfig: imageConfig },
    { action: 'test' },
  )
  assert.deepEqual(harness.calls.openAddForService, ['text', 'image'])
  assert.deepEqual(harness.calls.openEdit, [{ config: textConfig, options: { repairIssue: 'missing_model' } }])
  assert.deepEqual(harness.calls.openTest, [imageConfig])
  assert.equal(harness.lastTestedCoverageServiceType.value, 'image')

  harness.configWriteLocked.value = true
  await harness.api.onCoverageAction({ type: 'tts' }, { action: 'add' })
  await harness.api.onCoverageAction({ type: 'tts', targetConfig: { id: 9 } }, { action: 'edit' })
  await harness.api.onCoverageAction({ type: 'tts', targetConfig: { id: 9 } }, { action: 'test' })
  assert.deepEqual(harness.calls.openAddForService, ['text', 'image'])
  assert.equal(harness.calls.openEdit.length, 1)
  assert.equal(harness.calls.openTest.length, 2)
})

test('requested service auto-opens missing, repairs incomplete, otherwise focuses list', async () => {
  const missing = createCoverage({
    serviceCoverage: refOf({ services: [{ type: 'text', state: 'missing' }] }),
  })
  await missing.api.applyRequestedService('text')
  assert.equal(missing.configWorkspaceView.value, 'configs')
  assert.deepEqual(missing.calls.openAddForService, ['text'])
  assert.equal(missing.calls.openEdit.length, 0)

  const target = { id: IMAGE_ID }
  const repair = createCoverage({
    serviceCoverage: refOf({
      services: [{ type: 'image', state: 'configured', ready: false, issue: 'missing_credentials', targetConfig: target }],
    }),
  })
  await repair.api.applyRequestedService('image')
  assert.deepEqual(repair.calls.openEdit, [{ config: target, options: { repairIssue: 'missing_credentials' } }])
  assert.equal(repair.calls.selectConfigWorkspaceView.length, 0)

  const locked = createCoverage({
    configWriteLocked: refOf(true),
    serviceCoverage: refOf({
      services: [{ type: 'image', state: 'configured', ready: false, issue: 'missing_credentials', targetConfig: target }],
    }),
  })
  await locked.api.applyRequestedService('image')
  assert.equal(locked.calls.openEdit.length, 0)
  assert.deepEqual(locked.calls.selectConfigWorkspaceView, [{ view: 'configs', options: { focus: false } }])

  const empty = createCoverage()
  empty.configWorkspaceView.value = 'coverage'
  await empty.api.applyRequestedService('')
  assert.equal(empty.configWorkspaceView.value, 'coverage')
  assert.equal(empty.activeServiceFilter.value, '')
  assert.equal(empty.calls.openAddForService.length, 0)
})

test('tested coverage card focus is restored after aborting the connection test', async () => {
  const card = { focus() { } }
  const focused = []
  card.focus = () => { focused.push('text') }
  const harness = createCoverage({
    lastTestedCoverageServiceType: refOf('text'),
  })
  harness.api.setCoverageCardRef('text', card)
  harness.api.setCoverageCardRef('image', null)

  await harness.api.restoreTestedCoverageCardFocus()
  assert.equal(harness.calls.abortConnectionTest, 1)
  assert.equal(harness.calls.nextTick, 1)
  assert.deepEqual(focused, ['text'])
  assert.equal(harness.lastTestedCoverageServiceType.value, '')
  assert.equal(harness.calls.workspaceFocus.length, 0)

  await harness.api.restoreTestedCoverageCardFocus()
  assert.equal(harness.calls.abortConnectionTest, 2)
  assert.equal(harness.calls.nextTick, 1)
  assert.equal(harness.calls.workspaceFocus.length, 0)

  harness.lastTestedCoverageServiceType.value = 'video'
  await harness.api.restoreTestedCoverageCardFocus()
  assert.deepEqual(harness.calls.workspaceFocus, ['workspace'])
})
