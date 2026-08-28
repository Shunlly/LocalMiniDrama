import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  coverageInventoryLabel,
  coverageStateLabel,
  useAiConfigCoverage,
} from '../src/composables/useAiConfigCoverage.js'
import {
  createAiConfigConnectionStatusStore,
} from '../src/utils/aiConfigConnectionStatusStore.js'
import {
  confirmAiConfigBulkKeyResult,
  confirmAiConfigMutationInList,
  confirmAiConfigMutationResult,
  isAiConfigBulkKeyResult,
  runAiConfigCreateBatch,
} from '../src/utils/aiConfigMutations.js'
import { applyAiConfigRepairTarget } from '../src/utils/aiConfigRepairTarget.js'
import {
  getConfigWorkspaceKeyTarget,
  shouldApplyConfigWorkspaceRequest,
} from '../src/utils/aiConfigWorkspace.js'

function readSource(url) {
  return readFileSync(url, 'utf8').replace(/\r\n?/g, '\n')
}

const vueSource = readSource(new URL('../src/components/AIConfigContent.vue', import.meta.url))
const pageSource = readSource(new URL('../src/views/AiConfig.vue', import.meta.url))
const detailSource = readSource(new URL('../src/views/DramaDetail.vue', import.meta.url))
const viteSource = readSource(new URL('../vite.config.js', import.meta.url))

const DRAMA_ID = 11
const EPISODE_ID = 22
const CONFIG_ID = 41
// 三个 ID 必须保持不相等，禁止把 drama/episode/config 当成同一个键。
assert.notEqual(DRAMA_ID, EPISODE_ID)
assert.notEqual(EPISODE_ID, CONFIG_ID)
assert.notEqual(DRAMA_ID, CONFIG_ID)

function refOf(value) {
  return { value }
}

// 只装配 composable 依赖，不复制页面里的 loadList / 连接测试 handler。
function createCoverageHarness(overrides = {}) {
  const calls = {
    selectConfigWorkspaceView: [],
    openAddForService: [],
    openEdit: [],
    openTest: [],
    abortConnectionTest: 0,
    scrollIntoView: [],
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
    normalizeInitialServiceType: (value) => {
      const normalized = String(value || '').trim()
      return ['text', 'image', 'storyboard_image', 'video', 'tts'].includes(normalized) ? normalized : ''
    },
    openAddForService(type) { calls.openAddForService.push(type) },
    async openEdit(config, options) { calls.openEdit.push({ config, options }) },
    async openTest(config) { calls.openTest.push(config) },
    abortConnectionTest() { calls.abortConnectionTest += 1 },
    nextTick: async () => {},
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
    lastTestedCoverageServiceType,
    coverageCardRefs,
  }
}

function createMemoryStorage() {
  const values = new Map()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  }
}

test('AI config dialog keeps advanced API settings collapsed by default', () => {
  assert.match(vueSource, /const advancedFormSections = ref\(\[\]\)/)
  assert.match(vueSource, /<el-collapse v-model="advancedFormSections" class="advanced-config-collapse">/)
  assert.match(vueSource, /<strong>高级接口设置<\/strong>/)
})

test('AI config dialog stays grouped into basic, provider, model, and policy sections', () => {
  assert.match(vueSource, /<h4>基础信息<\/h4>/)
  assert.match(vueSource, /<h4>厂商与认证<\/h4>/)
  assert.match(vueSource, /<h4>模型<\/h4>/)
  assert.match(vueSource, /<h4>调用策略<\/h4>/)
})

test('service coverage panel exposes summary cards and per-service action links', () => {
  assert.match(vueSource, /coverageSummaryCards/)
  assert.match(vueSource, /const orderedCoverageServices = computed\(\(\) => sortAiServiceCoverage\(serviceCoverage\.value\.services\)\)/)
  assert.match(vueSource, /v-for="item in orderedCoverageServices"/)
  assert.match(vueSource, /coverageInventoryLabel\(item\)/)
  assert.match(vueSource, /coverageActions\(item\)/)
  assert.match(vueSource, /onCoverageAction\(item, action\)/)
  assert.doesNotMatch(vueSource, /<button[^>]*class="coverage-item"/)
  assert.match(vueSource, /<article[\s\S]*class="coverage-item"/)
  assert.match(vueSource, /class="coverage-select"/)
  assert.equal(coverageInventoryLabel({ state: 'missing' }), '未配置')
  assert.equal(coverageInventoryLabel({ configuredCount: 2, activeCount: 1 }), '已配置 2 条 · 启用 1')
})

test('coverage copy defines usable readiness and names missing credentials', () => {
  assert.match(vueSource, /类可用/)
  assert.match(vueSource, /默认配置还需凭据、模型或工作流完整/)
  assert.match(vueSource, /\{\{ coverageStateLabel\(item\) \}\}/)
  assert.equal(coverageStateLabel({ ready: true }), '可用')
  assert.equal(coverageStateLabel({ issue: 'missing_credentials' }), '缺少凭据')
  assert.equal(coverageStateLabel({ issue: 'missing_model' }), '缺少模型')
  assert.equal(coverageStateLabel({ issue: 'missing_workflow' }), '缺少工作流')
})

test('AI config mutations emit one reliable change notification only after real successes', async () => {
  assert.match(vueSource, /import \{[\s\S]*runAiConfigCreateBatch,[\s\S]*\} from '@\/utils\/aiConfigMutations\.js'/)
  assert.match(vueSource, /const emit = defineEmits\(\['configuration-changed'\]\)/)
  assert.equal((vueSource.match(/emit\('configuration-changed'\)/g) || []).length, 1)
  assert.match(vueSource, /function notifyConfigurationChanged\(\) \{\s*emit\('configuration-changed'\)\s*\}/)
  assert.equal((vueSource.match(/^[ \t]*notifyConfigurationChanged\(\)$/gm) || []).length, 7)

  assert.match(vueSource, /await aiAPI\.update[\s\S]*await aiAPI\.create[\s\S]*notifyConfigurationChanged\(\)/)
  assert.match(
    vueSource,
    /confirmAiConfigMutationResult\(mutationResult, payload, previous \|\| \{\}\)[\s\S]*confirmAiConfigMutationInList\(serverConfirmation, list\.value\)/,
  )
  assert.match(vueSource, /服务端返回的配置快照与本次提交不一致/)
  assert.match(
    vueSource,
    /const listConfirmed = await loadList\(\)\s*const listMatches = listConfirmed && confirmAiConfigMutationInList\(serverConfirmation, list\.value\)/,
  )
  assert.match(
    vueSource,
    /notifyConfigurationChanged\(\)\s*configDialogSaved\.value = true[\s\S]*dialogVisible\.value = false/,
  )

  assert.match(vueSource, /isAiConfigBulkKeyResult\(res\)/)
  assert.match(vueSource, /confirmAiConfigBulkKeyResult\(res, list\.value\)/)
  assert.match(
    vueSource,
    /if \(Number\(res\?\.updated\) > 0\) \{\s*invalidateConnectionTestResults\(\)\s*notifyConfigurationChanged\(\)\s*\}\s*bulkKeyVisible\.value = false/,
  )

  assert.match(vueSource, /ElMessage\.success\('已删除'\)\s*invalidateConnectionTestResults\(\)\s*notifyConfigurationChanged\(\)\s*await loadList\(\)/)
  assert.match(
    vueSource,
    /if \(success > 0\) \{\s*invalidateConnectionTestResults\(\)\s*notifyConfigurationChanged\(\)\s*\}/,
  )

  assert.match(vueSource, /runAiConfigCreateBatch\(configs, createOne\)/)
  assert.match(vueSource, /createdIds\.every\(\(id\) => list\.value\.some/)
  assert.match(vueSource, /预设配置已写入但列表尚未确认，请勿重复提交。请点击“重试”刷新列表。/)
  assert.match(
    vueSource,
    /if \(result\.success > 0\) \{\s*invalidateConnectionTestResults\(\)\s*notifyConfigurationChanged\(\)\s*closeDialog\(\)/,
  )
  assert.match(vueSource, /预设配置完成：\$\{result\.success\} 条成功，\$\{result\.failed\} 条失败/)
  assert.match(vueSource, /await submitPresetConfigs\(TONGYI_CONFIGS, apiKey/)
  assert.match(vueSource, /await submitPresetConfigs\(VOLCENGINE_CONFIGS, apiKey/)
  assert.match(vueSource, /await submitPresetConfigs\(AGNES_CONFIGS, apiKey/)

  assert.match(vueSource, /if \(listConfirmed && \(result\.success === 0 \|\| createdVisible\)\)/)
  assert.match(vueSource, /配置已导入但列表未确认，请勿重复导入。请点击“重试”刷新列表。/)
  assert.match(vueSource, /async function retryConfigDependencies\(\) \{\s*await Promise\.all\(\[loadVendorLock\(\), loadList\(\)\]\)\s*\}/)
  assert.doesNotMatch(
    vueSource,
    /async function retryConfigDependencies\(\) \{[\s\S]{0,80}(?:importConfigs|runAiConfigCreateBatch|aiAPI\.create)/,
  )

  const payload = {
    service_type: 'video',
    provider: 'minimax',
    api_protocol: 'minimax',
    name: '合成测试配置',
    base_url: 'https://api.minimaxi.com/v1',
    endpoint: '/video_generation',
    query_endpoint: '/query/video_generation/{taskId}',
    model: ['MiniMax-Hailuo-2.3'],
    default_model: 'MiniMax-Hailuo-2.3',
    priority: 10,
    is_default: true,
    api_key: 'fixture-key-new',
    drama_id: DRAMA_ID,
    episode_id: EPISODE_ID,
  }
  const server = {
    id: CONFIG_ID,
    ...payload,
    api_key: '********',
    api_key_set: true,
    updated_at: '2026-08-29T00:00:00.001Z',
  }
  const confirmation = confirmAiConfigMutationResult(server, payload)
  assert.deepEqual(confirmation, {
    id: CONFIG_ID,
    updated_at: '2026-08-29T00:00:00.001Z',
    api_key_set: true,
  })
  const confusedList = [
    { id: DRAMA_ID, drama_id: CONFIG_ID, config_id: CONFIG_ID, updated_at: server.updated_at, api_key_set: true },
    { id: EPISODE_ID, episode_id: CONFIG_ID, updated_at: server.updated_at, api_key_set: true },
  ]
  assert.equal(confirmAiConfigMutationInList(confirmation, confusedList), false)
  assert.equal(
    confirmAiConfigMutationInList(confirmation, [{
      id: CONFIG_ID,
      drama_id: DRAMA_ID,
      episode_id: EPISODE_ID,
      updated_at: server.updated_at,
      api_key_set: true,
    }]),
    true,
  )

  const bulk = {
    updated: 2,
    confirmations: [
      { id: CONFIG_ID, updated_at: '2026-08-29T00:00:00.010Z', api_key_set: true },
      { id: CONFIG_ID + 1, updated_at: '2026-08-29T00:00:00.011Z', api_key_set: true },
    ],
  }
  assert.equal(isAiConfigBulkKeyResult(bulk), true)
  assert.equal(confirmAiConfigBulkKeyResult(bulk, [
    { id: DRAMA_ID, config_id: CONFIG_ID, updated_at: '2026-08-29T00:00:00.010Z', api_key_set: true },
    { id: EPISODE_ID, config_id: CONFIG_ID + 1, updated_at: '2026-08-29T00:00:00.011Z', api_key_set: true },
  ]), false)
  assert.equal(confirmAiConfigBulkKeyResult(bulk, [
    { id: CONFIG_ID, drama_id: DRAMA_ID, updated_at: '2026-08-29T00:00:00.010Z', api_key_set: true },
    { id: CONFIG_ID + 1, episode_id: EPISODE_ID, updated_at: '2026-08-29T00:00:00.011Z', api_key_set: true },
  ]), true)
})

test('every successful configuration mutation invalidates persisted connection semantics', () => {
  assert.match(vueSource, /async function initializeConnectionStatusStore\(\)[\s\S]*resolveAiConfigConnectionStatusScope/)
  assert.match(viteSource, /['"]\/health['"]:\s*\{[\s\S]*?target: backendProxyTarget/)
  assert.match(
    vueSource,
    /function invalidateConnectionTestResults\(\) \{\s*connectionStatusStore\.invalidateAll\(\)\s*sessionTestStatusById\.value = \{\}/,
  )
  assert.match(
    vueSource,
    /async function handleSd2AssetSaved\(\) \{\s*invalidateConnectionTestResults\(\)\s*notifyConfigurationChanged\(\)\s*await loadList\(\)/,
  )
  assert.match(
    vueSource,
    /const listMatches = listConfirmed && confirmAiConfigMutationInList\(serverConfirmation, list\.value\)\s*invalidateConnectionTestResults\(\)/,
  )
  assert.match(
    vueSource,
    /const listMatches = listConfirmed && confirmAiConfigBulkKeyResult\(res, list\.value\)[\s\S]{0,80}invalidateConnectionTestResults\(\)/,
  )
  assert.match(
    vueSource,
    /await aiAPI\.delete\(row\.id\)[\s\S]{0,120}invalidateConnectionTestResults\(\)/,
  )
  assert.match(
    vueSource,
    /if \(success > 0\) \{\s*invalidateConnectionTestResults\(\)\s*notifyConfigurationChanged\(\)/,
  )
  assert.match(
    vueSource,
    /if \(result\.success > 0\) \{\s*invalidateConnectionTestResults\(\)\s*notifyConfigurationChanged\(\)\s*closeDialog\(\)/,
  )
  assert.match(
    vueSource,
    /if \(result\.success > 0\) \{\s*invalidateConnectionTestResults\(\)\s*notifyConfigurationChanged\(\)\s*ElMessage\.success\(message\)/,
  )

  const store = createAiConfigConnectionStatusStore({
    storage: createMemoryStorage(),
    scope: 'runtime-a',
  })
  store.set(CONFIG_ID, 'passed', '2026-08-29T00:00:00.000Z')
  store.set(DRAMA_ID, 'failed', '2026-08-29T00:00:00.000Z')
  assert.deepEqual(store.forConfigs([{ id: CONFIG_ID }]), {
    [CONFIG_ID]: { status: 'passed', testedAt: '2026-08-29T00:00:00.000Z' },
  })
  assert.deepEqual(store.forConfigs([{
    id: EPISODE_ID,
    drama_id: CONFIG_ID,
    episode_id: CONFIG_ID,
    config_id: CONFIG_ID,
  }]), {})
  store.invalidateAll()
  assert.deepEqual(store.forConfigs([{ id: CONFIG_ID }, { id: DRAMA_ID }]), {})
})

test('SD2 saved notifies once and refreshes through a bounded parent handler', () => {
  assert.match(vueSource, /<Sd2AssetManagement[^>]*@saved="handleSd2AssetSaved"/)
  assert.doesNotMatch(vueSource, /<Sd2AssetManagement[^>]*@saved="loadList"/)
  assert.match(
    vueSource,
    /async function handleSd2AssetSaved\(\) \{\s*invalidateConnectionTestResults\(\)\s*notifyConfigurationChanged\(\)\s*await loadList\(\)\s*\}/,
  )
})

test('coverage actions receive both vendor and dependency write locks', () => {
  assert.match(
    vueSource,
    /useAiConfigCoverage\(\{[\s\S]*vendorLock,[\s\S]*configWriteLocked,/,
  )
  const harness = createCoverageHarness()
  const service = {
    state: 'configured',
    issue: 'missing_credentials',
    targetConfig: { id: CONFIG_ID, drama_id: DRAMA_ID, episode_id: EPISODE_ID },
  }
  harness.vendorLock.value.enabled = true
  assert.deepEqual(harness.api.coverageActions(service), [])
  harness.vendorLock.value.enabled = false
  harness.configWriteLocked.value = true
  assert.deepEqual(harness.api.coverageActions(service), [])
  harness.configWriteLocked.value = false
  assert.deepEqual(harness.api.coverageActions(service), [{
    key: 'fix-credentials',
    label: '补充凭据',
    action: 'edit',
    emphasis: 'primary',
  }])
})

test('coverage testing restores the keyed service card and keeps results perceivable after sorting', async () => {
  assert.match(vueSource, /:ref="\(element\) => setCoverageCardRef\(item\.type, element\)"/)
  assert.match(vueSource, /tabindex="-1"/)
  assert.match(vueSource, /:aria-label="`\$\{item\.label\}，\$\{coverageStateLabel\(item\)\}，\$\{coverageTestLabel\(item\.test\)\}`"/)
  assert.match(vueSource, /<AccessibleDialog v-model="testVisible"[\s\S]*@closed="restoreTestedCoverageCardFocus"/)
  assert.match(vueSource, /role="status" aria-live="polite"[\s\S]*\{\{ testResultAnnouncement \}\}/)
  assert.match(vueSource, /testResultAnnouncement\.value = '连接测试通过'/)
  assert.match(vueSource, /testResultAnnouncement\.value = `连接测试失败：\$\{testError\.value\}`/)
  assert.match(vueSource, /restoreTestedCoverageCardFocus: restoreCoverageCardFocus/)
  assert.match(
    vueSource,
    /async function restoreTestedCoverageCardFocus\(\) \{\s*connectionTestAbortController\?\.abort\(\)\s*await restoreCoverageCardFocus\(\)/,
  )

  const harness = createCoverageHarness({
    lastTestedCoverageServiceType: refOf('image'),
  })
  const card = { focus() { harness.calls.cardFocus.push('image') } }
  harness.api.setCoverageCardRef('text', { focus() { harness.calls.cardFocus.push('text') } })
  harness.api.setCoverageCardRef('image', card)
  await harness.api.restoreTestedCoverageCardFocus()
  assert.equal(harness.calls.abortConnectionTest, 1)
  assert.deepEqual(harness.calls.cardFocus, ['image'])
  assert.equal(harness.lastTestedCoverageServiceType.value, '')

  const testing = createCoverageHarness({
    testingConfigId: refOf(String(CONFIG_ID)),
  })
  const testAction = { action: 'test' }
  assert.equal(testing.api.isCoverageActionTesting({ targetConfig: { id: CONFIG_ID } }, testAction), true)
  assert.equal(testing.api.isCoverageActionTesting({ targetConfig: { id: DRAMA_ID } }, testAction), false)
  assert.equal(testing.api.isCoverageActionTesting({ targetConfig: { id: EPISODE_ID } }, testAction), false)
})

test('coverage grid stays readable on desktop and identity columns retain tooltips', () => {
  assert.match(vueSource, /\.coverage-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(auto-fit, minmax\(220px, 1fr\)\);/)
  assert.match(vueSource, /\.coverage-item\s*\{[\s\S]*?min-height:\s*132px;[\s\S]*?padding:\s*10px;/)
  assert.match(vueSource, /\.coverage-select\s*\{[\s\S]*?min-height:\s*32px;/)
  assert.match(vueSource, /\.coverage-action-link\s*\{[\s\S]*?min-height:\s*32px;/)
  assert.match(vueSource, /\.coverage-config-detail\s*\{[\s\S]*?overflow-wrap:\s*anywhere;/)
  assert.match(vueSource, /@media \(max-width: 1120px\) \{[\s\S]*?\.coverage-grid\s*\{[\s\S]*?repeat\(2, minmax\(0, 1fr\)\)/)
  assert.match(vueSource, /<el-table-column prop="name"[^>]*min-width="220"[^>]*show-overflow-tooltip/)
  assert.match(vueSource, /<el-table-column prop="provider"[^>]*min-width="180"[^>]*show-overflow-tooltip/)
})

test('project readiness service links are consumed as an AI configuration filter', async () => {
  assert.match(detailSource, /service_type:\s*action\.serviceType\s*\|\|\s*''/)
  assert.match(detailSource, /returnTo:\s*route\.fullPath/)
  assert.match(pageSource, /<AIConfigContent\s+ref="aiConfigContentRef"\s+:initial-service-type="initialServiceType"\s*\/>/)
  assert.match(pageSource, /route\.query\.service_type/)
  assert.match(vueSource, /activeServiceFilter\s*=\s*ref\(normalizeInitialServiceType\(props\.initialServiceType\)\)/)
  assert.match(vueSource, /if \(activeServiceFilter\.value\) await applyRequestedService\(activeServiceFilter\.value\)/)
  assert.match(vueSource, /shouldApplyConfigWorkspaceRequest\(/)
  assert.match(vueSource, /await applyRequestedService\(normalized\)/)

  const missing = createCoverageHarness({
    serviceCoverage: refOf({
      services: [
        { type: 'text', state: 'missing' },
        { type: 'image', state: 'configured', ready: false, issue: 'missing_credentials', targetConfig: { id: CONFIG_ID } },
      ],
    }),
  })
  await missing.api.applyRequestedService('text')
  assert.deepEqual(missing.calls.openAddForService, ['text'])
  assert.equal(missing.calls.openEdit.length, 0)

  const repair = createCoverageHarness({
    serviceCoverage: refOf({
      services: [
        { type: 'text', state: 'configured', ready: false, issue: 'missing_model', targetConfig: { id: DRAMA_ID } },
        { type: 'image', state: 'configured', ready: false, issue: 'missing_credentials', targetConfig: { id: CONFIG_ID } },
        { type: 'video', state: 'configured', ready: false, issue: 'missing_workflow', targetConfig: { id: EPISODE_ID } },
      ],
    }),
  })
  await repair.api.applyRequestedService('image')
  assert.deepEqual(repair.calls.openEdit, [{
    config: { id: CONFIG_ID },
    options: { repairIssue: 'missing_credentials' },
  }])
  assert.equal(repair.calls.openAddForService.length, 0)
  assert.equal(repair.calls.selectConfigWorkspaceView.length, 0)
})

test('ComfyUI configuration exposes a validated workflow editor and persists the parsed object', () => {
  assert.match(vueSource, /v-if="isComfyUiForm" prop="comfy_workflow_json" label="Workflow JSON"/)
  assert.match(vueSource, /function parseComfyWorkflowJson\(value\)/)
  assert.match(vueSource, /settingsObject\.workflow = parseComfyWorkflowJson\(form\.value\.comfy_workflow_json\)/)
  assert.match(vueSource, /delete settingsObject\.workflow/)
})

test('AI config dialog confirms before discarding unsaved provider or model changes', () => {
  assert.match(vueSource, /:before-close="confirmConfigDialogClose"/)
  assert.match(vueSource, /@click="requestConfigDialogClose"/)
  assert.match(vueSource, /const configFormDirty = computed/)
  assert.match(vueSource, /configFormFingerprint\(\) !== configFormBaseline\.value/)
  assert.match(vueSource, /当前 AI 配置尚未保存/)
  assert.match(vueSource, /configDialogSaved\.value = true[\s\S]*dialogVisible\.value = false/)
})

test('AI config list preserves prior data on load failure and blocks auto-open while status is unresolved', () => {
  assert.match(vueSource, /configLoadError = ref\(''\)/)
  assert.match(vueSource, /class="config-load-state config-load-state--error"/)
  assert.match(vueSource, /configLoadState\.value = list\.value\.length \? 'refreshing' : 'loading'/)
  assert.match(vueSource, /configLoadError\.value = describeServiceLoadError\(/)
  assert.match(vueSource, /configLoadState\.value = 'error'/)
  assert.match(vueSource, /configLoadState\.value = 'ready'\n    return true/)
  assert.match(vueSource, /configLoadState\.value = 'error'\n    return false/)
  assert.match(vueSource, /const canAutoOpenMissingService = computed\(\(\) => \(\s*configLoadState\.value === 'ready' && vendorLockResolved\.value/s)
  assert.match(vueSource, /shouldAutoOpenRequestedService/)
  assert.doesNotMatch(vueSource, /async function loadList\(\)[\s\S]*catch \([^)]+\) \{\s*list\.value = \[\]/)

  const blocked = createCoverageHarness({
    canAutoOpenMissingService: refOf(false),
  })
  assert.equal(blocked.api.shouldAutoOpenRequestedService({ state: 'missing' }), false)
  blocked.canAutoOpenMissingService.value = true
  assert.equal(blocked.api.shouldAutoOpenRequestedService({ state: 'missing' }), true)
  assert.equal(blocked.api.shouldAutoOpenRequestedService({ state: 'configured' }), false)
})

test('AI config import keeps a successful server import unconfirmed until list refresh succeeds', async () => {
  assert.match(vueSource, /async function importConfigs\(event\)/)
  assert.match(vueSource, /const result = await runAiConfigCreateBatch\(configs, \(cfg\) => \{/)
  assert.match(
    vueSource,
    /const listConfirmed = await loadList\(\)\n    const createdIds = result\.created\.map\(\(item\) => Number\(item\?\.id\)\)\.filter\(Number\.isFinite\)/,
  )
  assert.match(vueSource, /createdIds\.every\(\(id\) => list\.value\.some\(\(item\) => Number\(item\.id\) === id\)\)/)
  assert.match(vueSource, /if \(listConfirmed && \(result\.success === 0 \|\| createdVisible\)\)/)
  assert.match(vueSource, /配置已导入但列表未确认，请勿重复导入。请点击“重试”刷新列表。/)
  assert.match(
    vueSource,
    /if \(result\.success > 0\) \{\s*invalidateConnectionTestResults\(\)\s*notifyConfigurationChanged\(\)\s*ElMessage\.success\(message\)/,
  )

  const result = await runAiConfigCreateBatch(
    [{ name: '导入甲' }, { name: '导入乙' }],
    async (item) => {
      if (item.name === '导入甲') {
        return { id: CONFIG_ID, drama_id: DRAMA_ID, episode_id: EPISODE_ID }
      }
      return { id: CONFIG_ID + 1, drama_id: DRAMA_ID, episode_id: EPISODE_ID }
    },
  )
  assert.equal(result.success, 2)
  const createdIds = result.created.map((item) => Number(item?.id)).filter(Number.isFinite)
  assert.deepEqual(createdIds, [CONFIG_ID, CONFIG_ID + 1])
  const confusedList = [
    { id: DRAMA_ID, drama_id: CONFIG_ID, episode_id: EPISODE_ID },
    { id: EPISODE_ID, drama_id: DRAMA_ID, episode_id: CONFIG_ID + 1, config_id: CONFIG_ID + 1 },
  ]
  assert.equal(
    createdIds.every((id) => confusedList.some((item) => Number(item.id) === id)),
    false,
  )
  assert.equal(
    createdIds.every((id) => confusedList.some((item) => (
      Number(item.drama_id) === id || Number(item.episode_id) === id || Number(item.config_id) === id
    ))),
    true,
  )
  assert.equal(
    createdIds.every((id) => [{ id: CONFIG_ID }, { id: CONFIG_ID + 1 }].some((item) => Number(item.id) === id)),
    true,
  )
})

test('coverage repair actions open and focus the concrete missing configuration field', async () => {
  assert.match(vueSource, /ref="apiKeyInputRef"[\s\S]*v-model="form\.api_key"/)
  assert.match(vueSource, /ref="modelListInputRef"[\s\S]*v-model="form\.modelText"/)
  assert.match(vueSource, /ref="workflowInputRef"[\s\S]*v-model="form\.comfy_workflow_json"/)
  assert.match(vueSource, /async function openEdit\(row, \{ repairIssue = '' \} = \{\}\)[\s\S]*applyAiConfigRepairTarget\(repairIssue/)
  assert.match(vueSource, /credentials: apiKeyInputRef/)
  assert.match(vueSource, /model: modelListInputRef/)
  assert.match(vueSource, /workflow: workflowInputRef/)

  const focused = []
  await applyAiConfigRepairTarget('missing_credentials', {
    fieldRefs: { credentials: { value: { focus: () => focused.push('credentials') } } },
    nextTickFn: async () => {},
  })
  await applyAiConfigRepairTarget('missing_model', {
    fieldRefs: { model: { value: { focus: () => focused.push('model') } } },
    nextTickFn: async () => {},
  })
  assert.deepEqual(focused, ['credentials', 'model'])

  const harness = createCoverageHarness()
  const textConfig = { id: DRAMA_ID, service_type: 'text' }
  const imageConfig = { id: CONFIG_ID, service_type: 'image' }
  await harness.api.onCoverageAction(
    { type: 'image', targetConfig: imageConfig, issue: 'missing_credentials' },
    { action: 'edit' },
  )
  await harness.api.onCoverageAction(
    { type: 'text', targetConfig: textConfig, issue: 'missing_model' },
    { action: 'edit' },
  )
  assert.deepEqual(harness.calls.openEdit, [
    { config: imageConfig, options: { repairIssue: 'missing_credentials' } },
    { config: textConfig, options: { repairIssue: 'missing_model' } },
  ])
})

test('AI configuration separates service status from provider management', () => {
  assert.match(vueSource, /role="tablist" aria-label="AI 配置工作区"/)
  assert.match(vueSource, /data-testid="ai-config-mode-coverage"/)
  assert.match(vueSource, /data-testid="ai-config-mode-configs"/)
  assert.match(vueSource, /:aria-selected="configWorkspaceView === 'coverage'"/)
  assert.match(vueSource, /:aria-selected="configWorkspaceView === 'configs'"/)
  assert.match(vueSource, /v-show="configWorkspaceView === 'coverage'"/)
  assert.match(vueSource, /v-show="configWorkspaceView === 'configs'"/)
  assert.match(
    vueSource,
    /const configWorkspaceView = ref\(\s*normalizeInitialServiceType\(props\.initialServiceType\) \? 'configs' : 'coverage',?\s*\)/,
  )
  assert.match(vueSource, /selectConfigWorkspaceView\('configs'/)
})

test('AI configuration workspace modes expose a visible keyboard focus state', async () => {
  assert.match(vueSource, /:tabindex="configWorkspaceView === 'coverage' \? 0 : -1"/)
  assert.match(vueSource, /:tabindex="configWorkspaceView === 'configs' \? 0 : -1"/)
  assert.match(vueSource, /@keydown="onConfigWorkspaceKeydown\('coverage', \$event\)"/)
  assert.match(vueSource, /@keydown="onConfigWorkspaceKeydown\('configs', \$event\)"/)
  assert.match(vueSource, /getConfigWorkspaceKeyTarget\(currentView, event\.key\)/)
  assert.match(vueSource, /shouldApplyConfigWorkspaceRequest\(/)
  assert.match(vueSource, /focusServiceConfigs,/)
  assert.match(vueSource, /onCoverageSelect\(item\)/)
  assert.match(
    vueSource,
    /\.config-workspace-mode:focus-visible\s*\{[\s\S]*?outline:\s*2px solid var\(--accent-text\);[\s\S]*?outline-offset:\s*2px;/,
  )

  assert.equal(getConfigWorkspaceKeyTarget('coverage', 'ArrowRight'), 'configs')
  assert.equal(getConfigWorkspaceKeyTarget('configs', 'Home'), 'coverage')
  assert.equal(shouldApplyConfigWorkspaceRequest({
    requestedServiceType: 'video',
    activeServiceType: 'image',
    workspaceView: 'configs',
  }), true)
  assert.equal(shouldApplyConfigWorkspaceRequest({
    requestedServiceType: 'video',
    activeServiceType: 'video',
    workspaceView: 'configs',
  }), false)

  const harness = createCoverageHarness()
  await harness.api.onCoverageSelect({ type: 'image', state: 'configured' })
  assert.deepEqual(harness.calls.selectConfigWorkspaceView, [{ view: 'configs', options: { focus: true } }])
  assert.equal(harness.activeServiceFilter.value, 'image')
  await harness.api.focusServiceConfigs('video', { focusMode: false })
  assert.equal(harness.activeServiceFilter.value, 'video')
})

test('AI 配置在 760px 和 520px 下重排且不会被固定双列撑宽', () => {
  assert.match(vueSource, /@media \(max-width: 760px\) \{[\s\S]*?\.ai-config-content,[\s\S]*?max-width: 100%;[\s\S]*?min-width: 0;/)
  assert.match(vueSource, /@media \(max-width: 760px\) \{[\s\S]*?\.coverage-grid,[\s\S]*?grid-template-columns: minmax\(0, 1fr\);/)
  assert.match(vueSource, /@media \(max-width: 760px\) \{[\s\S]*?\.content-actions,[\s\S]*?flex-direction: column;/)
  assert.match(vueSource, /@media \(max-width: 760px\) \{[\s\S]*?\.config-workspace-mode \{[\s\S]*?min-width: 0;/)
  assert.match(vueSource, /@media \(max-width: 520px\) \{[\s\S]*?\.config-workspace-switch \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);/)
  assert.match(vueSource, /@media \(max-width: 760px\) \{[\s\S]*?:deep\(\.el-form-item__content\),[\s\S]*?max-width: 100%;/)
  assert.match(pageSource, /@media \(max-width: 760px\) \{[\s\S]*?\.ai-config \{[\s\S]*?overflow-x: clip;/)
  assert.match(pageSource, /@media \(max-width: 760px\) \{[\s\S]*?\.main \{[\s\S]*?width: calc\(100% - 24px\);[\s\S]*?overflow-x: hidden;/)
  assert.match(pageSource, /@media \(max-width: 520px\) \{[\s\S]*?\.page-title \{[\s\S]*?position: absolute;[\s\S]*?clip: rect\(0, 0, 0, 0\);/)
})

test('zero saved configs hide prompt, scene-map and SD2 tabs and fall back to the config list', () => {
  assert.match(vueSource, /const hasSavedConfigs = computed\(\(\) => \(list\.value \|\| \[\]\)\.length > 0\)/)
  assert.match(vueSource, /<el-tab-pane v-if="hasSavedConfigs" label="高级设置（提示词）" name="prompts">/)
  assert.match(vueSource, /<el-tab-pane v-if="hasSavedConfigs" label="高级设置（业务场景）" name="sceneModelMap">/)
  assert.match(vueSource, /<el-tab-pane v-if="hasSavedConfigs" label="SD2 资产管理" name="sd2_assets">/)
  assert.match(vueSource, /if \(!hasConfigs && ADVANCED_CONFIG_TABS\.has\(activeTab\.value\)\)/)
  assert.match(vueSource, /activeTab\.value = 'configs'/)
  assert.match(vueSource, /<el-tab-pane label="生成设置" name="generation">/)
})
