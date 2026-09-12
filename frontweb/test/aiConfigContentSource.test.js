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
import { readAiConfigFormDialogTreeSource } from './helpers/aiConfigFormDialogSources.js'
import { formatJimeng2AssetCreatedAt } from '../src/components/aiConfig/aiConfigFormatters.js'

function readSource(url) {
  return readFileSync(url, 'utf8').replace(/\r\n?/g, '\n')
}

const vueSource = readSource(new URL('../src/components/AIConfigContent.vue', import.meta.url))
const formDialogSource = readAiConfigFormDialogTreeSource()
const oneKeyDialogSource = readSource(new URL('../src/components/aiConfig/AiConfigOneKeyDialogs.vue', import.meta.url))
const bulkKeyDialogSource = readSource(new URL('../src/components/aiConfig/AiConfigBulkKeyDialog.vue', import.meta.url))
const connectionDialogSource = readSource(new URL('../src/components/aiConfig/AiConfigConnectionTestDialog.vue', import.meta.url))
const jimeng2AssetsDialogSource = readSource(new URL('../src/components/aiConfig/AiConfigJimeng2AssetsDialog.vue', import.meta.url))
const dependencyErrorBarSource = readSource(new URL('../src/components/aiConfig/AiConfigDependencyErrorBar.vue', import.meta.url))
const listToolbarSource = readSource(new URL('../src/components/aiConfig/AiConfigListToolbar.vue', import.meta.url))
const listTableSource = readSource(new URL('../src/components/aiConfig/AiConfigListTable.vue', import.meta.url))
const workspaceSwitchSource = readSource(new URL('../src/components/aiConfig/AiConfigWorkspaceSwitch.vue', import.meta.url))
const coverageHeaderSource = readSource(new URL('../src/components/aiConfig/AiConfigCoverageHeader.vue', import.meta.url))
const coveragePanelSource = readSource(new URL('../src/components/aiConfig/AiConfigCoveragePanel.vue', import.meta.url))
const configsPanelSource = readSource(new URL('../src/components/aiConfig/AiConfigConfigsPanel.vue', import.meta.url))
const generationSettingsPaneSource = readSource(new URL('../src/components/aiConfig/AiConfigGenerationSettingsPane.vue', import.meta.url))
const formDerivedSource = readSource(new URL('../src/composables/useAiConfigFormDerived.js', import.meta.url))
const formRulesSource = readSource(new URL('../src/composables/useAiConfigFormRules.js', import.meta.url))
const writeLockSource = readSource(new URL('../src/composables/useAiConfigWriteLock.js', import.meta.url))
const emptyCopySource = readSource(new URL('../src/composables/useAiConfigEmptyCopy.js', import.meta.url))
const formActionsSource = readSource(new URL('../src/composables/useAiConfigFormActions.js', import.meta.url))
const sessionStatusSource = readSource(new URL('../src/composables/useAiConfigSessionStatus.js', import.meta.url))
const pageRequestsSource = readSource(new URL('../src/composables/useAiConfigPageRequests.js', import.meta.url))
const pageChromeSource = readSource(new URL('../src/composables/useAiConfigPageChrome.js', import.meta.url))
const requestOptionsSource = readSource(new URL('../src/utils/aiConfigRequestOptions.js', import.meta.url))
const overlaySource = [
  vueSource,
  formDialogSource,
  oneKeyDialogSource,
  bulkKeyDialogSource,
  connectionDialogSource,
  jimeng2AssetsDialogSource,
  dependencyErrorBarSource,
  listToolbarSource,
  listTableSource,
  workspaceSwitchSource,
  coverageHeaderSource,
  coveragePanelSource,
  configsPanelSource,
  generationSettingsPaneSource,
  formActionsSource,
  sessionStatusSource,
  pageRequestsSource,
  pageChromeSource,
  requestOptionsSource,
].join('\n')
const generationSettingsSource = readSource(new URL('../src/composables/useAiConfigGenerationSettings.js', import.meta.url))
const oneKeySource = readSource(new URL('../src/composables/useAiConfigOneKeyPresets.js', import.meta.url))
const importExportSource = readSource(new URL('../src/composables/useAiConfigImportExport.js', import.meta.url))
const listMutationsSource = readSource(new URL('../src/composables/useAiConfigRowMutations.js', import.meta.url))
const connectionTestSource = readSource(new URL('../src/utils/aiConfigConnectionTest.js', import.meta.url))
const formSettingsSource = readSource(new URL('../src/utils/aiConfigFormSettings.js', import.meta.url))
const providerOptionsSource = readSource(new URL('../src/utils/aiConfigProviderOptions.js', import.meta.url))
const submitPayloadSource = readSource(new URL('../src/utils/aiConfigSubmitPayload.js', import.meta.url))
const discoverModelsSource = readSource(new URL('../src/composables/useAiConfigDiscoverModels.js', import.meta.url))
const coverageCardsSource = readSource(new URL('../src/components/aiConfig/AiConfigCoverageCards.vue', import.meta.url))
const coverageCardSource = readSource(new URL('../src/components/aiConfig/AiConfigCoverageCard.vue', import.meta.url))
const workspaceViewSource = readSource(new URL('../src/composables/useAiConfigWorkspaceView.js', import.meta.url))
const modelListSource = readSource(new URL('../src/components/aiConfig/AiConfigModelListSection.vue', import.meta.url))
const presetHelpSource = readSource(new URL('../src/components/aiConfig/AiConfigPresetHelpCollapse.vue', import.meta.url))
const pageSource = readSource(new URL('../src/views/AiConfig.vue', import.meta.url))
const detailSource = readSource(new URL('../src/views/DramaDetail.vue', import.meta.url))
const detailNavSource = readSource(new URL('../src/components/dramaDetail/dramaDetailLoadAndNav.js', import.meta.url))
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

test('AIConfigContent wires coverage, model list and preset help components without extracting loadList', () => {
  assert.match(vueSource, /import AiConfigWorkspaceSwitch from '@\/components\/aiConfig\/AiConfigWorkspaceSwitch\.vue'/)
  assert.match(vueSource, /import AiConfigCoveragePanel from '@\/components\/aiConfig\/AiConfigCoveragePanel\.vue'/)
  assert.match(vueSource, /import AiConfigConfigsPanel from '@\/components\/aiConfig\/AiConfigConfigsPanel\.vue'/)
  assert.match(coveragePanelSource, /import AiConfigCoverageHeader from '@\/components\/aiConfig\/AiConfigCoverageHeader\.vue'/)
  assert.match(coveragePanelSource, /import AiConfigCoverageCards from '@\/components\/aiConfig\/AiConfigCoverageCards\.vue'/)
  assert.match(vueSource, /import AiConfigFormDialog from '@\/components\/aiConfig\/AiConfigFormDialog\.vue'/)
  assert.match(overlaySource, /import AiConfigModelListSection from '@\/components\/aiConfig\/AiConfigModelListSection\.vue'/)
  assert.match(overlaySource, /import AiConfigPresetHelpCollapse from '@\/components\/aiConfig\/AiConfigPresetHelpCollapse\.vue'/)
  assert.match(vueSource, /<AiConfigWorkspaceSwitch/)
  assert.match(vueSource, /<AiConfigCoveragePanel/)
  assert.match(coveragePanelSource, /<AiConfigCoverageHeader/)
  assert.match(coveragePanelSource, /<AiConfigCoverageCards/)
  assert.match(vueSource, /<AiConfigFormDialog/)
  assert.match(configsPanelSource, /import AiConfigListTable from '@\/components\/aiConfig\/AiConfigListTable\.vue'/)
  assert.match(vueSource, /<AiConfigConfigsPanel/)
  assert.match(configsPanelSource, /<AiConfigListTable/)
  assert.match(vueSource, /:open-test="openTest"/)
  assert.match(overlaySource, /<AiConfigModelListSection/)
  assert.match(overlaySource, /<AiConfigPresetHelpCollapse/)
  assert.match(vueSource, /async function loadList\(\)/)
  assert.match(vueSource, /async function openTest\(row\)/)
  assert.doesNotMatch(listTableSource, /async function loadList\(/)
  assert.doesNotMatch(listTableSource, /async function openTest\(/)
  assert.doesNotMatch(listTableSource, /useAiConfigList/)
  assert.doesNotMatch(workspaceSwitchSource, /async function loadList\(/)
  assert.doesNotMatch(workspaceSwitchSource, /async function openTest\(/)
  assert.doesNotMatch(workspaceSwitchSource, /useAiConfigList/)
  assert.doesNotMatch(coverageHeaderSource, /async function loadList\(/)
  assert.doesNotMatch(coverageHeaderSource, /async function openTest\(/)
  assert.doesNotMatch(coverageHeaderSource, /useAiConfigList/)
  assert.doesNotMatch(listTableSource, /function formatJimeng2AssetCreatedAt/)
  assert.match(vueSource, /useAiConfigGenerationSettings\(/)
  assert.match(vueSource, /<AiConfigGenerationSettingsPane/)
  assert.match(vueSource, /useAiConfigFormDerived\(/)
  assert.match(vueSource, /useAiConfigFormRules\(/)
  assert.match(vueSource, /useAiConfigWriteLock\(/)
  assert.match(vueSource, /useAiConfigEmptyCopy\(/)
  assert.match(vueSource, /useAiConfigFormActions\(/)
  assert.match(vueSource, /useAiConfigSessionStatus\(/)
  assert.match(vueSource, /useAiConfigPageRequests\(/)
  assert.match(vueSource, /useAiConfigPageChrome\(/)
  assert.doesNotMatch(vueSource, /function handleConfigDialogClosed\(/)
  assert.doesNotMatch(vueSource, /function clearServiceFilter\(/)
  assert.doesNotMatch(vueSource, /function isConfigRowSelectable\(/)
  assert.match(pageChromeSource, /function handleConfigDialogClosed\(/)
  assert.match(pageChromeSource, /function clearServiceFilter\(/)
  assert.match(pageChromeSource, /function isConfigRowSelectable\(/)
  assert.doesNotMatch(overlaySource, /async function loadGenerationSettings\(\)/)
  assert.doesNotMatch(vueSource, /async function saveGenerationSettings\(\)/)
  for (const extracted of [coveragePanelSource, configsPanelSource, generationSettingsPaneSource, formDerivedSource, formRulesSource, writeLockSource, emptyCopySource, formActionsSource, sessionStatusSource, pageRequestsSource, pageChromeSource, requestOptionsSource]) {
    assert.doesNotMatch(extracted, /async function loadList\(/)
    assert.doesNotMatch(extracted, /async function openTest\(/)
    assert.doesNotMatch(extracted, /useAiConfigList/)
  }
  assert.match(vueSource, /useAiConfigDiscoverModels\(/)
  assert.doesNotMatch(vueSource, /async function discoverModelsFromService\(\)/)
  assert.match(discoverModelsSource, /async function discoverModelsFromService\(\)/)
  assert.match(vueSource, /useAiConfigWorkspaceView\(/)
  assert.doesNotMatch(vueSource, /function selectConfigWorkspaceView\(/)
  assert.doesNotMatch(vueSource, /function onConfigWorkspaceKeydown\(/)
  assert.match(workspaceViewSource, /function selectConfigWorkspaceView\(/)
  assert.match(workspaceViewSource, /function onConfigWorkspaceKeydown\(/)
  assert.doesNotMatch(vueSource, /from '@\/composables\/useAiConfigList/)
  assert.doesNotMatch(vueSource, /from '@\/composables\/useAiConfigConnection/)
  assert.match(presetHelpSource, /class="protocol-help"/)
  assert.match(modelListSource, /@click="discoverModelsFromService"/)
})

test('AI config dialog keeps advanced API settings collapsed by default', () => {
  assert.match(vueSource, /const advancedFormSections = ref\(\[\]\)/)
  assert.match(overlaySource, /<el-collapse v-model="advancedFormSections" class="advanced-config-collapse">/)
  assert.match(overlaySource, /<strong>高级接口设置<\/strong>/)
})

test('AI config dialog stays grouped into basic, provider, model, and policy sections', () => {
  assert.match(overlaySource, /<h4>基础信息<\/h4>/)
  assert.match(overlaySource, /<h4>厂商与认证<\/h4>/)
  assert.match(overlaySource, /<h4>模型<\/h4>/)
  assert.match(overlaySource, /<h4>调用策略<\/h4>/)
})

test('service coverage panel exposes summary cards and per-service action links', () => {
  assert.match(vueSource, /coverageSummaryCards/)
  assert.match(vueSource, /const orderedCoverageServices = computed\(\(\) => sortAiServiceCoverage\(serviceCoverage\.value\.services\)\)/)
  assert.match(vueSource, /<AiConfigCoveragePanel/)
  assert.match(coveragePanelSource, /<AiConfigCoverageHeader/)
  assert.match(coveragePanelSource, /<AiConfigCoverageCards/)
  assert.match(coveragePanelSource, /v-if="!configListPendingEmpty && !configListFailedEmpty"/)
  assert.match(vueSource, /@select="onCoverageSelect"/)
  assert.match(vueSource, /@action="onCoverageAction"/)
  assert.match(coverageCardsSource, /v-for="item in orderedCoverageServices"/)
  assert.match(coverageCardSource, /coverageInventoryLabel\(item\)/)
  assert.match(coverageCardSource, /coverageActions\(item\)/)
  assert.match(coverageCardSource, /\$emit\('action', item, action\)/)
  assert.doesNotMatch(vueSource, /<article[\s\S]*class="coverage-item"/)
  assert.doesNotMatch(coverageCardSource, /<button[^>]*class="coverage-item"/)
  assert.match(coverageCardSource, /<article[\s\S]*class="coverage-item"/)
  assert.match(coverageCardSource, /class="coverage-select"/)
  assert.equal(coverageInventoryLabel({ state: 'missing' }), '未配置')
  assert.equal(coverageInventoryLabel({ configuredCount: 2, activeCount: 1 }), '已配置 2 条 · 启用 1')
})

test('coverage copy defines usable readiness and names missing credentials', () => {
  assert.match(coverageHeaderSource, /类可用/)
  assert.match(coverageHeaderSource, /默认配置还需凭据、模型或工作流完整/)
  assert.match(coverageCardSource, /\{\{ coverageStateLabel\(item\) \}\}/)
  assert.equal(coverageStateLabel({ ready: true }), '可用')
  assert.equal(coverageStateLabel({ issue: 'missing_credentials' }), '缺少凭据')
  assert.equal(coverageStateLabel({ issue: 'missing_model' }), '缺少模型')
  assert.equal(coverageStateLabel({ issue: 'missing_workflow' }), '缺少工作流')
})

test('AI config mutations emit one reliable change notification only after real successes', async () => {
  assert.match(vueSource, /import \{[\s\S]*runAiConfigCreateBatch,[\s\S]*\} from '@\/utils\/aiConfigMutations\.js'/)
  assert.match(vueSource, /const emit = defineEmits\(\['configuration-changed'\]\)/)
  assert.equal((vueSource.match(/emit\('configuration-changed'\)/g) || []).length, 0)
  assert.equal((formActionsSource.match(/emit\('configuration-changed'\)/g) || []).length, 1)
  assert.match(formActionsSource, /import \{ publishAiConfigChanged as defaultPublishAiConfigChanged \} from '@\/utils\/aiConfigChangeBus\.js'/)
  assert.match(formActionsSource, /function notifyConfigurationChanged\(\) \{\s*emit\('configuration-changed'\)\s*publishAiConfigChanged\(\{ action: 'changed' \}\)\s*\}/)
  assert.equal((vueSource.match(/^[ \t]*notifyConfigurationChanged\(\)$/gm) || []).length, 1)
  assert.equal((formActionsSource.match(/^[ \t]*notifyConfigurationChanged\(\)$/gm) || []).length, 1)
  assert.equal((oneKeySource.match(/^[ \t]*notifyConfigurationChanged\(\)$/gm) || []).length, 1)
  assert.equal((importExportSource.match(/^[ \t]*notifyConfigurationChanged\(\)$/gm) || []).length, 1)
  assert.equal((listMutationsSource.match(/^[ \t]*notifyConfigurationChanged\(\)$/gm) || []).length, 3)

  assert.match(formActionsSource, /await aiAPI\.update[\s\S]*await aiAPI\.create[\s\S]*notifyConfigurationChanged\(\)/)
  assert.match(
    formActionsSource,
    /confirmAiConfigMutationResult\(mutationResult, payload, previous \|\| \{\}\)[\s\S]*confirmAiConfigMutationInList\(serverConfirmation, list\.value\)/,
  )
  assert.match(formActionsSource, /服务端返回的配置快照与本次提交不一致/)
  assert.match(
    formActionsSource,
    /const listConfirmed = await loadList\(\)\s*const listMatches = listConfirmed && confirmAiConfigMutationInList\(serverConfirmation, list\.value\)/,
  )
  assert.match(
    formActionsSource,
    /notifyConfigurationChanged\(\)\s*configDialogSaved\.value = true[\s\S]*dialogVisible\.value = false/,
  )

  assert.match(listMutationsSource, /isAiConfigBulkKeyResult\(res\)/)
  assert.match(listMutationsSource, /confirmAiConfigBulkKeyResult\(res, list\.value\)/)
  assert.match(
    listMutationsSource,
    /if \(Number\(res\?\.updated\) > 0\) \{\s*invalidateConnectionTestResults\(\)\s*notifyConfigurationChanged\(\)\s*\}\s*bulkKeyVisible\.value = false/,
  )

  assert.match(listMutationsSource, /ElMessage\.success\('已删除'\)\s*invalidateConnectionTestResults\(\)\s*notifyConfigurationChanged\(\)\s*await loadList\(\)/)
  assert.match(
    listMutationsSource,
    /if \(success > 0\) \{\s*invalidateConnectionTestResults\(\)\s*notifyConfigurationChanged\(\)\s*\}/,
  )
  assert.match(vueSource, /useAiConfigRowMutations\(/)
  assert.doesNotMatch(vueSource, /function openBulkKey\(/)
  assert.doesNotMatch(vueSource, /async function onDelete\(row\)/)

  assert.match(oneKeySource, /runAiConfigCreateBatch\(configs, createOne\)/)
  assert.match(oneKeySource, /createdIds\.every\(\(id\) => list\.value\.some/)
  assert.match(oneKeySource, /预设配置已写入但列表尚未确认，请勿重复提交。请点击「重新读取配置列表」刷新列表。/)
  assert.match(
    oneKeySource,
    /if \(result\.success > 0\) \{\s*invalidateConnectionTestResults\(\)\s*notifyConfigurationChanged\(\)\s*revealSavedConfigs\?\.\(\)\s*closeDialog\(\)/,
  )
  assert.match(oneKeySource, /预设配置完成：\$\{result\.success\} 条成功，\$\{result\.failed\} 条失败/)
  assert.match(oneKeySource, /await submitPresetConfigs\(TONGYI_CONFIGS, apiKey/)
  assert.match(oneKeySource, /await submitPresetConfigs\(VOLCENGINE_CONFIGS, apiKey/)
  assert.match(oneKeySource, /await submitPresetConfigs\(AGNES_CONFIGS, apiKey/)
  assert.match(vueSource, /useAiConfigOneKeyPresets\(/)
  assert.doesNotMatch(vueSource, /function openOneKeyTongyi\(/)
  assert.doesNotMatch(vueSource, /async function submitPresetConfigs\(/)
  assert.match(vueSource, /async function loadList\(\)/)
  assert.match(vueSource, /async function openTest\(row\)/)

  assert.match(importExportSource, /if \(listConfirmed && \(result\.success === 0 \|\| createdVisible\)\)/)
  assert.match(importExportSource, /配置已导入但列表未确认，请勿重复导入。请点击「重新读取配置列表」刷新列表。/)
  assert.match(pageRequestsSource, /async function retryConfigDependencies\(\) \{\s*await Promise\.all\(\[loadVendorLock\(\), loadList\(\)\]\)\s*\}/)
  assert.match(vueSource, /useAiConfigPageRequests\(/)
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
  assert.match(sessionStatusSource, /async function initializeConnectionStatusStore\(\)[\s\S]*resolveAiConfigConnectionStatusScope/)
  assert.match(viteSource, /['"]\/health['"]:\s*\{[\s\S]*?target: backendProxyTarget/)
  assert.match(
    sessionStatusSource,
    /function invalidateConnectionTestResults\(\) \{\s*connectionStatusStore\.invalidateAll\(\)\s*sessionTestStatusById\.value = \{\}/,
  )
  assert.match(
    vueSource,
    /async function handleSd2AssetSaved\(\) \{\s*invalidateConnectionTestResults\(\)\s*notifyConfigurationChanged\(\)\s*await loadList\(\)/,
  )
  assert.match(
    formActionsSource,
    /const listMatches = listConfirmed && confirmAiConfigMutationInList\(serverConfirmation, list\.value\)\s*invalidateConnectionTestResults\(\)/,
  )
  assert.match(
    listMutationsSource,
    /const listMatches = listConfirmed && confirmAiConfigBulkKeyResult\(res, list\.value\)[\s\S]{0,80}invalidateConnectionTestResults\(\)/,
  )
  assert.match(
    listMutationsSource,
    /await aiAPI\.delete\(row\.id\)[\s\S]{0,120}invalidateConnectionTestResults\(\)/,
  )
  assert.match(
    listMutationsSource,
    /if \(success > 0\) \{\s*invalidateConnectionTestResults\(\)\s*notifyConfigurationChanged\(\)/,
  )
  assert.match(
    oneKeySource,
    /if \(result\.success > 0\) \{\s*invalidateConnectionTestResults\(\)\s*notifyConfigurationChanged\(\)\s*revealSavedConfigs\?\.\(\)\s*closeDialog\(\)/,
  )
  assert.match(
    importExportSource,
    /if \(result\.success > 0\) \{\s*invalidateConnectionTestResults\(\)\s*notifyConfigurationChanged\(\)\s*revealSavedConfigs\?\.\(\)\s*ElMessage\.success\(message\)/,
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
  assert.match(vueSource, /:set-coverage-card-ref="setCoverageCardRef"/)
  assert.match(coverageCardSource, /:ref="\(element\) => setCoverageCardRef\(item\.type, element\)"/)
  assert.match(coverageCardSource, /tabindex="-1"/)
  assert.match(coverageCardSource, /:aria-label="`\$\{item\.label\}，\$\{coverageStateLabel\(item\)\}，\$\{coverageTestLabel\(item\.test\)\}`"/)
  assert.match(connectionDialogSource, /<AccessibleDialog v-model="testVisible"[\s\S]*@closed="restoreTestedCoverageCardFocus"/)
  assert.match(vueSource, /<AiConfigConnectionTestDialog/)
  assert.match(connectionDialogSource, /role="status" aria-live="polite"[\s\S]*\{\{ testResultAnnouncement \}\}/)
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
  assert.match(coverageCardsSource, /\.coverage-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(auto-fit, minmax\(220px, 1fr\)\);/)
  assert.match(coverageCardSource, /\.coverage-item\s*\{[\s\S]*?min-height:\s*132px;[\s\S]*?padding:\s*10px;/)
  assert.match(coverageCardSource, /\.coverage-select\s*\{[\s\S]*?min-height:\s*32px;/)
  assert.match(coverageCardSource, /\.coverage-action-link\s*\{[\s\S]*?min-height:\s*32px;/)
  assert.match(coverageCardSource, /\.coverage-config-detail\s*\{[\s\S]*?overflow-wrap:\s*anywhere;/)
  assert.match(coverageCardsSource, /@media \(max-width: 1120px\) \{[\s\S]*?\.coverage-grid\s*\{[\s\S]*?repeat\(2, minmax\(0, 1fr\)\)/)
  assert.match(listTableSource, /<el-table-column prop="name"[^>]*min-width="220"[^>]*show-overflow-tooltip/)
  assert.match(listTableSource, /<el-table-column prop="provider"[^>]*min-width="180"[^>]*show-overflow-tooltip/)
})

test('project readiness service links are consumed as an AI configuration filter', async () => {
  assert.match(detailNavSource, /service_type:\s*action\.serviceType\s*\|\|\s*''/)
  assert.match(detailNavSource, /returnTo:\s*route\.fullPath/)
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
  assert.match(overlaySource, /v-if="isComfyUiForm" prop="comfy_workflow_json" label="工作流 JSON"/)
  assert.match(formSettingsSource, /function parseComfyWorkflowJson\(value\)/)
  assert.match(submitPayloadSource, /settingsObject\.workflow = parseComfyWorkflowJson\(form\.comfy_workflow_json\)/)
  assert.match(submitPayloadSource, /delete settingsObject\.workflow/)
})

test('AI config dialog confirms before discarding unsaved provider or model changes', () => {
  assert.match(overlaySource, /:before-close="confirmConfigDialogClose"/)
  assert.match(overlaySource, /@click="requestConfigDialogClose"/)
  assert.match(vueSource, /const configFormDirty = computed/)
  assert.match(vueSource, /configFormFingerprint\(\) !== configFormBaseline\.value/)
  assert.match(vueSource, /当前 AI 配置尚未保存/)
  assert.match(formActionsSource, /configDialogSaved\.value = true[\s\S]*dialogVisible\.value = false/)
})

test('AI config list preserves prior data on load failure and blocks auto-open while status is unresolved', () => {
  assert.match(vueSource, /configLoadError = ref\(''\)/)
  assert.match(overlaySource, /class="config-load-state config-load-state--error"/)
  assert.match(vueSource, /configLoadState\.value = list\.value\.length \? 'refreshing' : 'loading'/)
  assert.match(vueSource, /configLoadError\.value = describeServiceLoadError\(/)
  assert.match(vueSource, /configLoadState\.value = 'error'/)
  assert.match(vueSource, /configLoadState\.value = 'ready'\n    return true/)
  assert.match(vueSource, /configLoadState\.value = 'error'\n    return false/)
  assert.match(vueSource, /canAutoOpenMissingService,/)
  assert.match(writeLockSource, /const canAutoOpenMissingService = computed\(\(\) => \(\s*configLoadState\.value === 'ready' && vendorLockResolved\.value/)
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
  assert.match(importExportSource, /async function importConfigs\(event\)/)
  assert.match(importExportSource, /const result = await runAiConfigCreateBatch\(configs, \(cfg\) => \{/)
  assert.match(
    importExportSource,
    /const listConfirmed = await loadList\(\)\s*const createdIds = result\.created\.map\(\(item\) => Number\(item\?\.id\)\)\.filter\(Number\.isFinite\)/,
  )
  assert.match(importExportSource, /createdIds\.every\(\(id\) => list\.value\.some\(\(item\) => Number\(item\.id\) === id\)\)/)
  assert.match(importExportSource, /if \(listConfirmed && \(result\.success === 0 \|\| createdVisible\)\)/)
  assert.match(importExportSource, /配置已导入但列表未确认，请勿重复导入。请点击「重新读取配置列表」刷新列表。/)
  assert.match(vueSource, /useAiConfigImportExport\(/)
  assert.doesNotMatch(vueSource, /async function importConfigs\(event\)/)
  assert.doesNotMatch(vueSource, /async function exportConfigs\(\)/)
  assert.match(vueSource, /async function loadList\(\)/)
  assert.match(vueSource, /async function openTest\(row\)/)
  assert.match(
    importExportSource,
    /if \(result\.success > 0\) \{\s*invalidateConnectionTestResults\(\)\s*notifyConfigurationChanged\(\)\s*revealSavedConfigs\?\.\(\)\s*ElMessage\.success\(message\)/,
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
  assert.match(overlaySource, /:ref="bindApiKeyInputRef"[\s\S]*v-model="form\.api_key"/)
  assert.match(vueSource, /function setModelListInputRef\(element\)/)
  assert.match(formActionsSource, /model: modelListInputRef/)
  assert.match(modelListSource, /:ref="setModelListInputRef"[\s\S]*v-model="form\.modelText"/)
  assert.match(overlaySource, /:ref="bindWorkflowInputRef"[\s\S]*v-model="form\.comfy_workflow_json"/)
  assert.match(formActionsSource, /async function openEdit\(row, \{ repairIssue = '' \} = \{\}\)[\s\S]*applyAiConfigRepairTarget\(repairIssue/)
  assert.match(formActionsSource, /credentials: apiKeyInputRef/)
  assert.match(formActionsSource, /model: modelListInputRef/)
  assert.match(formActionsSource, /workflow: workflowInputRef/)

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
  assert.match(workspaceSwitchSource, /role="tablist" aria-label="AI 配置工作区"/)
  assert.match(workspaceSwitchSource, /data-testid="ai-config-mode-coverage"/)
  assert.match(workspaceSwitchSource, /data-testid="ai-config-mode-configs"/)
  assert.match(workspaceSwitchSource, /:aria-selected="configWorkspaceView === 'coverage'"/)
  assert.match(workspaceSwitchSource, /:aria-selected="configWorkspaceView === 'configs'"/)
  assert.match(vueSource, /<AiConfigWorkspaceSwitch/)
  assert.match(coveragePanelSource, /v-show="configWorkspaceView === 'coverage'"/)
  assert.match(configsPanelSource, /v-show="configWorkspaceView === 'configs'"/)
  assert.match(coveragePanelSource, /tabindex="-1"/)
  assert.match(configsPanelSource, /tabindex="-1"/)
  assert.match(
    vueSource,
    /const configWorkspaceView = ref\(\s*normalizeInitialServiceType\(props\.initialServiceType\) \? 'configs' : 'coverage',?\s*\)/,
  )
  assert.match(workspaceSwitchSource, /selectConfigWorkspaceView\('configs'/)
  assert.match(vueSource, /:select-config-workspace-view="selectConfigWorkspaceView"/)
})

test('AI configuration workspace modes expose a visible keyboard focus state', async () => {
  assert.match(workspaceSwitchSource, /:tabindex="configWorkspaceView === 'coverage' \? 0 : -1"/)
  assert.match(workspaceSwitchSource, /:tabindex="configWorkspaceView === 'configs' \? 0 : -1"/)
  assert.match(workspaceSwitchSource, /@keydown="onConfigWorkspaceKeydown\('coverage', \$event\)"/)
  assert.match(workspaceSwitchSource, /@keydown="onConfigWorkspaceKeydown\('configs', \$event\)"/)
  assert.match(vueSource, /useAiConfigWorkspaceView\(/)
  assert.match(vueSource, /const coverageWorkspaceModeRef = ref\(null\)/)
  assert.match(vueSource, /const configsWorkspaceModeRef = ref\(null\)/)
  assert.match(vueSource, /v-model:coverage-workspace-mode-ref="coverageWorkspaceModeRef"/)
  assert.match(vueSource, /v-model:configs-workspace-mode-ref="configsWorkspaceModeRef"/)
  assert.match(workspaceViewSource, /getConfigWorkspaceKeyTarget\(currentView, event\.key\)/)
  assert.match(vueSource, /shouldApplyConfigWorkspaceRequest\(/)
  assert.match(vueSource, /focusServiceConfigs,/)
  assert.match(vueSource, /@select="onCoverageSelect"/)
  assert.match(coverageCardSource, /\$emit\('select', item\)/)
  assert.match(
    workspaceSwitchSource,
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
  assert.match(coverageCardsSource, /@media \(max-width: 760px\) \{[\s\S]*?\.coverage-grid,[\s\S]*?grid-template-columns: minmax\(0, 1fr\);/)
  assert.match(overlaySource, /@media \(max-width: 760px\) \{[\s\S]*?\.content-actions,[\s\S]*?flex-direction: column;/)
  assert.match(workspaceSwitchSource, /@media \(max-width: 760px\) \{[\s\S]*?\.config-workspace-mode \{[\s\S]*?min-width: 0;/)
  assert.match(workspaceSwitchSource, /@media \(max-width: 520px\) \{[\s\S]*?\.config-workspace-switch \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);/)
  assert.match(overlaySource, /@media \(max-width: 760px\) \{[\s\S]*?:deep\(\.el-form-item__content\),[\s\S]*?max-width: 100%;/)
  assert.match(pageSource, /@media \(max-width: 760px\) \{[\s\S]*?\.ai-config \{[\s\S]*?overflow-x: clip;/)
  assert.match(pageSource, /@media \(max-width: 760px\) \{[\s\S]*?\.main \{[\s\S]*?width: calc\(100% - 24px\);[\s\S]*?overflow-x: hidden;/)
  assert.match(pageSource, /@media \(max-width: 520px\) \{[\s\S]*?\.page-title \{[\s\S]*?position: absolute;[\s\S]*?clip: rect\(0, 0, 0, 0\);/)
})

test('zero saved configs hide prompt, scene-map and SD2 tabs and fall back to the config list', () => {
  assert.match(vueSource, /const hasSavedConfigs = computed\(\(\) => \(list\.value \|\| \[\]\)\.length > 0\)/)
  assert.match(vueSource, /<el-tab-pane v-if="hasSavedConfigs" label="高级设置（提示词）" name="prompts">/)
  assert.match(vueSource, /<el-tab-pane v-if="hasSavedConfigs" label="高级设置（业务场景）" name="sceneModelMap">/)
  assert.match(vueSource, /<el-tab-pane v-if="hasSavedConfigs" label="认证资产管理" name="sd2_assets">/)
  assert.match(vueSource, /if \(!hasConfigs && ADVANCED_CONFIG_TABS\.has\(activeTab\.value\)\)/)
  assert.match(vueSource, /activeTab\.value = 'configs'/)
  assert.match(vueSource, /<el-tab-pane label="生成设置" name="generation">/)
})

test('AI 配置保存、导入和连接测试失败不再直出 e.message', () => {
  assert.match(vueSource, /import \{ toUserFacingError, isUserFacingAbort \} from '@\/utils\/userFacingError'/)
  assert.match(generationSettingsSource, /if \(isUserFacingAbort\(e\)\) return\s*ElMessage\.error\(toUserFacingError\(e, '保存失败'\)\)/)
  assert.match(importExportSource, /if \(isUserFacingAbort\(e\)\) return\s*ElMessage\.error\(toUserFacingError\(e, '导入失败'\)\)/)
  assert.match(listMutationsSource, /toUserFacingError\(error, '删除失败'/)
  assert.match(overlaySource, /configFieldDisplayLabel\(item\.label\)/)
  assert.match(connectionTestSource, /toUserFacingError\(error, '暂时无法完成连接测试，请稍后重试。'/)
  assert.match(vueSource, /isUserFacingAbort\(e, controller\.signal\)/)
  assert.match(generationSettingsSource, /runWithOwnedRequestErrorToast\(\(\) => generationSettingsAPI\.update/)
  assert.match(formActionsSource, /runWithOwnedRequestErrorToast\(async \(\) => \([\s\S]*await aiAPI\.update[\s\S]*await aiAPI\.create/)
  assert.doesNotMatch(vueSource, /ElMessage\.error\('保存失败：'/)
  assert.doesNotMatch(vueSource, /ElMessage\.error\('导入失败：' \+ \(e\.message/)
  assert.doesNotMatch(vueSource, /ElMessage\.error\(e\??\.message/)
})


test('AI 配置厂商和模型选择保留中文空状态、无障碍名称，以及删除/保存确认', () => {
  const providerTag = overlaySource.match(/<el-select[^>]*data-ai-config-field="provider"[^>]*>/)?.[0]
  const modelPickTag = modelListSource.match(/<el-select[^>]*aria-label="追加预设模型"[^>]*>/)?.[0]
  const defaultModelTags = [...overlaySource.matchAll(/<el-select[^>]*data-ai-config-field="default_model"[^>]*>/g)].map((item) => item[0])
  assert.ok(providerTag, 'missing provider select')
  assert.ok(modelPickTag, 'missing preset model select')
  assert.equal(defaultModelTags.length, 2)
  assert.match(providerTag, /aria-label="厂商"/)
  assert.match(providerTag, /no-data-text="没有匹配的厂商，可直接输入自定义名称"/)
  assert.match(modelPickTag, /no-data-text="暂无预设模型，可直接输入"/)
  for (const tag of defaultModelTags) {
    assert.match(tag, /aria-label="默认模型"/)
    assert.match(tag, /no-data-text="/)
  }
  assert.ok(defaultModelTags.some((tag) => tag.includes('allow-create') && tag.includes('暂无模型，可直接输入或先填写模型列表')))
  assert.ok(defaultModelTags.some((tag) => !tag.includes('allow-create') && tag.includes('暂无可用模型')))
  assert.match(providerOptionsSource, /下一步：先选择厂商自动填入，或直接输入模型名。/)
  assert.match(formDerivedSource, /describeProviderModelEmptyHint\(/)
  assert.match(providerOptionsSource, /下一步：直接输入模型名；填好接口地址和密钥后也可点「从服务读取模型」。/)
  assert.match(overlaySource, /:aria-label="configActionLabel\('测试', row\)"/)
  assert.match(overlaySource, /:aria-label="configActionLabel\('删除', row\)"/)
  assert.match(overlaySource, /:aria-label="saveAriaLabel"/)
  assert.match(overlaySource, /describeDisabledControlLabel\('保存配置'/)
  assert.match(overlaySource, /@click="submit">保存<\/el-button>/)
  assert.match(submitPayloadSource, /title: '保存确认'/)
  assert.match(submitPayloadSource, /confirmButtonText: '确认保存'/)
  assert.match(formActionsSource, /copy.title/)
  assert.match(formActionsSource, /if \(!await confirmReplaceDefaultConfig\(\)\) return\s*if \(configWriteLocked\.value\) return/)
  assert.match(listMutationsSource, /确定删除配置「\$\{name\}」？此操作不可恢复。/)
  assert.match(listMutationsSource, /catch \(error\) \{\s*if \(isUserFacingAbort\(error\)\) return\s*ElMessage\.error\(toUserFacingError\(error, '删除失败'\)/)
  assert.match(listMutationsSource, /if \(!success && failed\) ElMessage\.error\(`删除失败，\$\{failed\} 条未能删除`\)/)
  assert.doesNotMatch(listMutationsSource, /ElMessage\.success\(`已删除 \$\{success\} 条\$\{failed \? `，\$\{failed\} 条失败` : ''\}`\)/)
})


test('即梦素材库弹窗去掉接口路径，列名和时间改为中文', () => {
  assert.match(vueSource, /<AiConfigFormDialog/)
  assert.match(vueSource, /<AiConfigJimeng2AssetsDialog/)
  assert.match(vueSource, /v-model:jimeng2-assets-dialog-visible="jimeng2AssetsDialogVisible"/)
  assert.match(jimeng2AssetsDialogSource, /v-model="jimeng2AssetsDialogVisible"\s+title="素材库列表"/)
  assert.doesNotMatch(jimeng2AssetsDialogSource, /素材库列表（GET \/api\/business\/v1\/assets）/)
  assert.doesNotMatch(jimeng2AssetsDialogSource, /<code>status=active<\/code>/)
  assert.match(jimeng2AssetsDialogSource, /仅启用中的素材可用于 Seedance 2\.0 视频引用/)
  assert.match(jimeng2AssetsDialogSource, /label="原始地址"/)
  assert.doesNotMatch(jimeng2AssetsDialogSource, /label="原始 URL"/)
  assert.match(jimeng2AssetsDialogSource, /formatJimeng2AssetCreatedAt\(row\.created_at\) \|\| '未知时间'/)
  assert.doesNotMatch(jimeng2AssetsDialogSource, /<el-table-column prop="created_at" label="创建时间"[^/]*\/>/)

  assert.match(vueSource, /import \{ formatJimeng2AssetCreatedAt \} from '@\/components\/aiConfig\/aiConfigFormatters\.js'/)
  assert.match(vueSource, /:format-jimeng2-asset-created-at="formatJimeng2AssetCreatedAt"/)
  const formatted = formatJimeng2AssetCreatedAt('2026-08-29T00:00:00Z')
  assert.match(formatted, /2026/)
  assert.doesNotMatch(formatted, /T00:00:00Z/)
  assert.equal(formatJimeng2AssetCreatedAt('not-a-date'), '')
  assert.equal(formatJimeng2AssetCreatedAt(''), '')
  assert.equal(formatJimeng2AssetCreatedAt(null), '')
})

test('AI 配置页 GET 帮助、429 说明和一键配置空密钥禁用改为中文，写锁优先', () => {
  assert.doesNotMatch(overlaySource, /GET \/api/)
  assert.doesNotMatch(overlaySource, /POST \/api\/business/)
  assert.doesNotMatch(overlaySource, /storage\.base_url/)
  assert.match(overlaySource, /调用网关的素材列表接口/)
  assert.match(overlaySource, /网关地址与令牌/)
  assert.match(overlaySource, /素材登记接口/)
  assert.match(overlaySource, /对外访问地址/)
  assert.doesNotMatch(vueSource, /429 错误/)
  assert.doesNotMatch(generationSettingsPaneSource, /429 错误/)
  assert.match(generationSettingsPaneSource, /接口限流（请求过于频繁）/)
  assert.match(vueSource, /async function loadList\(\)/)
  assert.match(vueSource, /async function openTest\(row\)/)
  assert.match(vueSource, /<AiConfigFormDialog/)
  assert.match(vueSource, /<AiConfigOneKeyDialogs/)
  assert.match(vueSource, /<AiConfigBulkKeyDialog/)
  assert.match(vueSource, /<AiConfigConnectionTestDialog/)
  assert.match(vueSource, /<AiConfigJimeng2AssetsDialog/)
  assert.match(vueSource, /<AiConfigConfigsPanel/)
  assert.match(configsPanelSource, /<AiConfigListTable/)
  assert.doesNotMatch(vueSource, /useAiConfigList/)
  assert.doesNotMatch(vueSource, /from '@\/composables\/useAiConfigList/)
  for (const overlay of [formDialogSource, oneKeyDialogSource, bulkKeyDialogSource, connectionDialogSource, jimeng2AssetsDialogSource, listToolbarSource, listTableSource, dependencyErrorBarSource, workspaceSwitchSource, coverageHeaderSource, coveragePanelSource, configsPanelSource, generationSettingsPaneSource, formDerivedSource, formRulesSource, writeLockSource, emptyCopySource, formActionsSource, sessionStatusSource, pageRequestsSource, pageChromeSource, requestOptionsSource]) {
    assert.doesNotMatch(overlay, /async function loadList\(/)
    assert.doesNotMatch(overlay, /async function openTest\(/)
    assert.doesNotMatch(overlay, /useAiConfigList/)
  }

  const oneKeySubmitKeys = ['oneKeyTongyiKey', 'oneKeyVolcKey', 'oneKeyAgnesKey', 'bulkKeyInput']
  for (const key of oneKeySubmitKeys) {
    assert.match(
      overlaySource,
      new RegExp(`:disabled="configWriteLocked \\|\\| !${key}\\.trim\\(\\)"`),
      `${key} 空密钥时必须禁用一键配置`,
    )
    const titleRe = new RegExp(`:title="(configWriteLocked \\? configWriteLockReason : \\(!${key}\\.trim\\(\\) \\? '请先填写密钥' : undefined\\))"`)
    const matched = overlaySource.match(titleRe)
    assert.ok(matched, `${key} 必须给出空密钥中文原因，且写锁优先`)
    const expr = matched[1]
    const evalTitle = (env) => Function(
      'configWriteLocked',
      'configWriteLockReason',
      key,
      `"use strict"; return (${expr})`,
    )(env.configWriteLocked, env.configWriteLockReason, env[key])

    assert.equal(
      evalTitle({ configWriteLocked: true, configWriteLockReason: '配置列表尚未就绪', [key]: '' }),
      '配置列表尚未就绪',
    )
    assert.equal(
      evalTitle({ configWriteLocked: true, configWriteLockReason: '正在一键配置，请稍候', [key]: 'sk-test' }),
      '正在一键配置，请稍候',
    )
    assert.equal(
      evalTitle({ configWriteLocked: false, configWriteLockReason: '配置列表尚未就绪', [key]: '' }),
      '请先填写密钥',
    )
    assert.equal(
      evalTitle({ configWriteLocked: false, configWriteLockReason: '配置列表尚未就绪', [key]: '   ' }),
      '请先填写密钥',
    )
    assert.equal(
      evalTitle({ configWriteLocked: false, configWriteLockReason: '配置列表尚未就绪', [key]: 'sk-test' }),
      undefined,
    )
  }
})
