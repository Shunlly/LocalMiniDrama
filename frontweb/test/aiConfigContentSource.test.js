import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../src/components/AIConfigContent.vue', import.meta.url), 'utf8')
const pageSource = readFileSync(new URL('../src/views/AiConfig.vue', import.meta.url), 'utf8')
const detailSource = readFileSync(new URL('../src/views/DramaDetail.vue', import.meta.url), 'utf8')
const viteSource = readFileSync(new URL('../vite.config.js', import.meta.url), 'utf8')

function sourceBetween(sourceText, start, end) {
  const startIndex = sourceText.indexOf(start)
  const endIndex = sourceText.indexOf(end, startIndex + start.length)
  assert.ok(startIndex >= 0, `missing source boundary: ${start}`)
  assert.ok(endIndex > startIndex, `missing source boundary: ${end}`)
  return sourceText.slice(startIndex, endIndex)
}

function sourceTag(sourceText, start) {
  const startIndex = sourceText.indexOf(start)
  const endIndex = sourceText.indexOf('/>', startIndex + start.length)
  assert.ok(startIndex >= 0, `missing tag boundary: ${start}`)
  assert.ok(endIndex > startIndex, `missing tag end: ${start}`)
  return sourceText.slice(startIndex, endIndex + 2)
}

test('AI config dialog keeps advanced API settings collapsed by default', () => {
  assert.match(source, /const advancedFormSections = ref\(\[\]\)/)
  assert.match(source, /<el-collapse v-model="advancedFormSections" class="advanced-config-collapse">/)
  assert.match(source, /<strong>高级接口设置<\/strong>/)
})

test('AI config dialog stays grouped into basic, provider, model, and policy sections', () => {
  assert.match(source, /<h4>基础信息<\/h4>/)
  assert.match(source, /<h4>厂商与认证<\/h4>/)
  assert.match(source, /<h4>模型<\/h4>/)
  assert.match(source, /<h4>调用策略<\/h4>/)
})

test('service coverage panel exposes summary cards and per-service action links', () => {
  assert.match(source, /coverageSummaryCards/)
  assert.match(source, /const orderedCoverageServices = computed\(\(\) => sortAiServiceCoverage\(serviceCoverage\.value\.services\)\)/)
  assert.match(source, /v-for="item in orderedCoverageServices"/)
  assert.match(source, /coverageInventoryLabel/)
  assert.match(source, /coverageActions\(item\)/)
  assert.match(source, /onCoverageAction\(item, action\)/)
  assert.doesNotMatch(source, /<button[^>]*class="coverage-item"/)
  assert.match(source, /<article[\s\S]*class="coverage-item"/)
  assert.match(source, /class="coverage-select"/)
})

test('coverage copy defines usable readiness and names missing credentials', () => {
  assert.match(source, /类可用/)
  assert.match(source, /默认配置还需凭据、模型或工作流完整/)
  assert.match(source, /item\.issue === 'missing_credentials'.*'缺少凭据'/)
})

test('AI config mutations emit one reliable change notification only after real successes', () => {
  assert.match(source, /import \{ runAiConfigCreateBatch \} from '@\/utils\/aiConfigMutations\.js'/)
  assert.match(source, /const emit = defineEmits\(\['configuration-changed'\]\)/)
  assert.equal((source.match(/emit\('configuration-changed'\)/g) || []).length, 1)
  assert.match(source, /function notifyConfigurationChanged\(\) \{\s*emit\('configuration-changed'\)\s*\}/)

  const submit = sourceBetween(source, 'async function submit()', 'function openBulkKey')
  assert.equal((submit.match(/notifyConfigurationChanged\(\)/g) || []).length, 1)
  assert.match(submit, /await aiAPI\.update[\s\S]*await aiAPI\.create[\s\S]*notifyConfigurationChanged\(\)/)

  const bulkKey = sourceBetween(source, 'async function submitBulkKey', 'function onJimeng2AssetsDialogClosed')
  assert.equal((bulkKey.match(/notifyConfigurationChanged\(\)/g) || []).length, 1)
  assert.match(bulkKey, /if \(Number\(res\?\.updated\) > 0\) \{[\s\S]*notifyConfigurationChanged\(\)[\s\S]*\}/)

  const singleDelete = sourceBetween(source, 'async function onDelete', 'function onSelectionChange')
  assert.equal((singleDelete.match(/notifyConfigurationChanged\(\)/g) || []).length, 1)
  assert.match(singleDelete, /await aiAPI\.delete\(row\.id\)[\s\S]*notifyConfigurationChanged\(\)/)

  const batchDelete = sourceBetween(source, 'async function onBatchDelete', 'function openOneKeyTongyi')
  assert.equal((batchDelete.match(/notifyConfigurationChanged\(\)/g) || []).length, 1)
  assert.match(batchDelete, /if \(success > 0\) \{[\s\S]*notifyConfigurationChanged\(\)[\s\S]*\}/)

  const presetHandler = sourceBetween(source, 'async function submitPresetConfigs', 'async function submitOneKeyTongyi')
  assert.equal((presetHandler.match(/notifyConfigurationChanged\(\)/g) || []).length, 1)
  assert.match(presetHandler, /runAiConfigCreateBatch\(configs, createOne\)/)
  assert.match(presetHandler, /if \(result\.success > 0\) \{[\s\S]*notifyConfigurationChanged\(\)[\s\S]*\}/)
  assert.match(presetHandler, /预设配置完成：\$\{result\.success\} 条成功，\$\{result\.failed\} 条失败/)
  assert.match(presetHandler, /if \(result\.success > 0\) \{[\s\S]*?\n  \} else \{[\s\S]*?\n  \}\n  await loadList\(\)/)

  const presetBoundaries = [
    ['submitOneKeyTongyi', 'function openOneKeyVolc'],
    ['submitOneKeyVolc', 'function openOneKeyAgnes'],
    ['submitOneKeyAgnes', 'async function exportConfigs'],
  ]
  for (const [handler, nextBoundary] of presetBoundaries) {
    const handlerSource = sourceBetween(source, `async function ${handler}`, nextBoundary)
    assert.match(handlerSource, /await submitPresetConfigs\(/)
  }

  const importHandler = sourceBetween(source, 'async function importConfigs', 'async function loadVendorLock')
  assert.equal((importHandler.match(/notifyConfigurationChanged\(\)/g) || []).length, 1)
  assert.match(importHandler, /if \(result\.success > 0\) \{[\s\S]*notifyConfigurationChanged\(\)[\s\S]*\}/)
  assert.match(importHandler, /if \(result\.success > 0\) ElMessage\.success\(message\)\n    else ElMessage\.error\(message\)\n    await loadList\(\)/)

  const connectionTest = sourceBetween(source, 'async function openTest', 'async function onDelete')
  const exportHandler = sourceBetween(source, 'async function exportConfigs', 'function triggerImport')
  assert.doesNotMatch(connectionTest, /notifyConfigurationChanged|emit\(/)
  assert.doesNotMatch(exportHandler, /notifyConfigurationChanged|emit\(/)
})

test('every successful configuration mutation invalidates persisted connection semantics', () => {
  assert.match(source, /async function initializeConnectionStatusStore\(\)[\s\S]*resolveAiConfigConnectionStatusScope/)
  assert.match(viteSource, /['"]\/health['"]:\s*\{[\s\S]*?target: backendProxyTarget/)
  assert.match(source, /function invalidateConnectionTestResults\(\) \{[\s\S]*connectionStatusStore\.invalidateAll\(\)[\s\S]*sessionTestStatusById\.value = \{\}/)

  const mutationSections = [
    sourceBetween(source, 'async function handleSd2AssetSaved', 'async function loadList'),
    sourceBetween(source, 'async function submit()', 'function openBulkKey'),
    sourceBetween(source, 'async function submitBulkKey', 'function onJimeng2AssetsDialogClosed'),
    sourceBetween(source, 'async function onDelete', 'function onSelectionChange'),
    sourceBetween(source, 'async function onBatchDelete', 'function openOneKeyTongyi'),
    sourceBetween(source, 'async function submitPresetConfigs', 'async function submitOneKeyTongyi'),
    sourceBetween(source, 'async function importConfigs', 'async function loadVendorLock'),
  ]
  for (const section of mutationSections) {
    assert.match(section, /invalidateConnectionTestResults\(\)/)
  }
})

test('SD2 saved notifies once and refreshes through a bounded parent handler', () => {
  const sd2Tag = sourceTag(source, '<Sd2AssetManagement')
  assert.match(sd2Tag, /@saved="handleSd2AssetSaved"/)
  assert.doesNotMatch(sd2Tag, /@saved="loadList"/)

  const handler = sourceBetween(source, 'async function handleSd2AssetSaved', 'async function loadList')
  assert.equal((handler.match(/notifyConfigurationChanged\(\)/g) || []).length, 1)
  assert.equal((handler.match(/await loadList\(\)/g) || []).length, 1)
  assert.ok(handler.indexOf('notifyConfigurationChanged()') < handler.indexOf('await loadList()'))
})

test('coverage actions receive both vendor and dependency write locks', () => {
  const handler = sourceBetween(source, 'function coverageActions', 'function setCoverageCardRef')
  assert.match(handler, /vendorLocked: vendorLock\.value\.enabled/)
  assert.match(handler, /writesLocked: configWriteLocked\.value/)
})

test('coverage testing restores the keyed service card and keeps results perceivable after sorting', () => {
  assert.match(source, /:ref="\(element\) => setCoverageCardRef\(item\.type, element\)"/)
  assert.match(source, /tabindex="-1"/)
  assert.match(source, /:aria-label="`\$\{item\.label\}，\$\{coverageStateLabel\(item\)\}，\$\{coverageTestLabel\(item\.test\)\}`"/)
  assert.match(source, /<el-dialog v-model="testVisible"[\s\S]*@closed="restoreTestedCoverageCardFocus"/)
  assert.match(source, /role="status" aria-live="polite"[\s\S]*\{\{ testResultAnnouncement \}\}/)
  assert.match(source, /testResultAnnouncement\.value = '连接测试通过'/)
  assert.match(source, /testResultAnnouncement\.value = `连接测试失败：\$\{testError\.value\}`/)
  assert.match(source, /async function restoreTestedCoverageCardFocus\(\)[\s\S]*await nextTick\(\)[\s\S]*const target = coverageCardRefs\.get\(serviceType\)/)
  assert.match(source, /const target = coverageCardRefs\.get\(serviceType\)[\s\S]*if \(target\) target\.focus\(\)[\s\S]*else coverageWorkspaceModeRef\.value\?\.focus\?\.\(\)/)
})

test('coverage grid stays readable on desktop and identity columns retain tooltips', () => {
  assert.match(source, /\.coverage-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(auto-fit, minmax\(220px, 1fr\)\);/)
  assert.match(source, /\.coverage-item\s*\{[\s\S]*?min-height:\s*132px;[\s\S]*?padding:\s*10px;/)
  assert.match(source, /\.coverage-select\s*\{[\s\S]*?min-height:\s*32px;/)
  assert.match(source, /\.coverage-action-link\s*\{[\s\S]*?min-height:\s*32px;/)
  assert.match(source, /\.coverage-config-detail\s*\{[\s\S]*?overflow-wrap:\s*anywhere;/)

  assert.match(source, /@media \(max-width: 1120px\) \{[\s\S]*?\.coverage-grid\s*\{[\s\S]*?repeat\(2, minmax\(0, 1fr\)\)/)
  assert.match(source, /<el-table-column prop="name"[^>]*min-width="220"[^>]*show-overflow-tooltip/)
  assert.match(source, /<el-table-column prop="provider"[^>]*min-width="180"[^>]*show-overflow-tooltip/)
})

test('project readiness service links are consumed as an AI configuration filter', () => {
  assert.match(detailSource, /service_type:\s*action\.serviceType\s*\|\|\s*''/)
  assert.match(detailSource, /returnTo:\s*route\.fullPath/)
  assert.match(pageSource, /<AIConfigContent\s+:initial-service-type="initialServiceType"\s*\/>/)
  assert.match(pageSource, /route\.query\.service_type/)
  assert.match(source, /activeServiceFilter\s*=\s*ref\(normalizeInitialServiceType\(props\.initialServiceType\)\)/)
  assert.match(source, /if \(activeServiceFilter\.value\) await applyRequestedService\(activeServiceFilter\.value\)/)
  assert.match(source, /openAddForService\(normalized\)/)
})

test('ComfyUI configuration exposes a validated workflow editor and persists the parsed object', () => {
  assert.match(source, /v-if="isComfyUiForm" prop="comfy_workflow_json" label="Workflow JSON"/)
  assert.match(source, /function parseComfyWorkflowJson\(value\)/)
  assert.match(source, /settingsObject\.workflow = parseComfyWorkflowJson\(form\.value\.comfy_workflow_json\)/)
  assert.match(source, /delete settingsObject\.workflow/)
})

test('AI config dialog confirms before discarding unsaved provider or model changes', () => {
  assert.match(source, /:before-close="confirmConfigDialogClose"/)
  assert.match(source, /@click="requestConfigDialogClose"/)
  assert.match(source, /const configFormDirty = computed/)
  assert.match(source, /configFormFingerprint\(\) !== configFormBaseline\.value/)
  assert.match(source, /当前 AI 配置尚未保存/)
  assert.match(source, /configDialogSaved\.value = true[\s\S]*dialogVisible\.value = false/)
})

test('AI config list preserves prior data on load failure and blocks auto-open while status is unresolved', () => {
  assert.match(source, /configLoadError = ref\(''\)/)
  assert.match(source, /class="config-load-state config-load-state--error"/)
  assert.match(source, /configLoadState\.value = list\.value\.length \? 'refreshing' : 'loading'/)
  assert.match(source, /configLoadError\.value = error\?\.message \|\| '暂时无法读取 AI 配置，请稍后重试。'/)
  assert.match(source, /configLoadState\.value = 'error'/)
  assert.match(source, /const canAutoOpenMissingService = computed\(\(\) => \(\s*configLoadState\.value === 'ready' && vendorLockResolved\.value/s)
  assert.match(source, /function shouldAutoOpenRequestedService\(coverageItem\)/)
  assert.match(source, /if \(shouldAutoOpenRequestedService\(coverageItem\)\)/)
  assert.match(source, /if \(shouldAutoOpenRequestedService\(item\)\)/)
  assert.doesNotMatch(source, /async function loadList\(\)[\s\S]*catch \([^)]+\) \{\s*list\.value = \[\]/)
})

test('coverage repair actions open and focus the concrete missing configuration field', () => {
  assert.match(source, /ref="apiKeyInputRef"[\s\S]*v-model="form\.api_key"/)
  assert.match(source, /ref="modelListInputRef"[\s\S]*v-model="form\.modelText"/)
  assert.match(source, /ref="workflowInputRef"[\s\S]*v-model="form\.comfy_workflow_json"/)
  assert.match(source, /await openEdit\(item\.targetConfig, \{ repairIssue: item\.issue \}\)/)
  assert.match(source, /async function openEdit\(row, \{ repairIssue = '' \} = \{\}\)[\s\S]*applyAiConfigRepairTarget\(repairIssue/)
})

test('AI configuration separates service status from provider management', () => {
  assert.match(source, /role="tablist" aria-label="AI 配置工作区"/)
  assert.match(source, /data-testid="ai-config-mode-coverage"/)
  assert.match(source, /data-testid="ai-config-mode-configs"/)
  assert.match(source, /:aria-selected="configWorkspaceView === 'coverage'"/)
  assert.match(source, /:aria-selected="configWorkspaceView === 'configs'"/)
  assert.match(source, /v-show="configWorkspaceView === 'coverage'"/)
  assert.match(source, /v-show="configWorkspaceView === 'configs'"/)
  assert.match(
    source,
    /const configWorkspaceView = ref\(\s*normalizeInitialServiceType\(props\.initialServiceType\) \? 'configs' : 'coverage',?\s*\)/,
  )
  assert.match(source, /selectConfigWorkspaceView\('configs', \{ focus: focusMode \}\)[\s\S]*activeServiceFilter\.value = serviceType/)
})

test('AI configuration workspace modes expose a visible keyboard focus state', () => {
  assert.match(source, /:tabindex="configWorkspaceView === 'coverage' \? 0 : -1"/)
  assert.match(source, /:tabindex="configWorkspaceView === 'configs' \? 0 : -1"/)
  assert.match(source, /@keydown="onConfigWorkspaceKeydown\('coverage', \$event\)"/)
  assert.match(source, /@keydown="onConfigWorkspaceKeydown\('configs', \$event\)"/)
  assert.match(source, /getConfigWorkspaceKeyTarget/)
  assert.match(source, /shouldApplyConfigWorkspaceRequest/)
  assert.match(source, /async function focusServiceConfigs\(serviceType, \{ focusMode = false \} = \{\}\)/)
  assert.match(source, /selectConfigWorkspaceView\('configs', \{ focus: focusMode \}\)/)
  assert.match(source, /focusServiceConfigs\(item\.type, \{ focusMode: true \}\)/)
  assert.match(
    source,
    /\.config-workspace-mode:focus-visible\s*\{[\s\S]*?outline:\s*2px solid var\(--accent-text\);[\s\S]*?outline-offset:\s*2px;/,
  )
})
