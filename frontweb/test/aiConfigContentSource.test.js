import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../src/components/AIConfigContent.vue', import.meta.url), 'utf8')
const pageSource = readFileSync(new URL('../src/views/AiConfig.vue', import.meta.url), 'utf8')
const detailSource = readFileSync(new URL('../src/views/DramaDetail.vue', import.meta.url), 'utf8')

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

test('AI config mutations emit one reliable change notification only after real successes', () => {
  assert.match(source, /import \{ runAiConfigCreateBatch \} from '@\/utils\/aiConfigMutations\.js'/)
  assert.match(source, /const emit = defineEmits\(\['configuration-changed'\]\)/)
  assert.equal((source.match(/emit\('configuration-changed'\)/g) || []).length, 1)
  assert.match(source, /function notifyConfigurationChanged\(\) \{\s*emit\('configuration-changed'\)\s*\}/)

  const submit = source.slice(source.indexOf('async function submit()'), source.indexOf('function openBulkKey'))
  assert.equal((submit.match(/notifyConfigurationChanged\(\)/g) || []).length, 1)
  assert.match(submit, /await aiAPI\.update[\s\S]*await aiAPI\.create[\s\S]*notifyConfigurationChanged\(\)/)

  const bulkKey = source.slice(source.indexOf('async function submitBulkKey'), source.indexOf('function onJimeng2AssetsDialogClosed'))
  assert.equal((bulkKey.match(/notifyConfigurationChanged\(\)/g) || []).length, 1)
  assert.match(bulkKey, /if \(Number\(res\?\.updated\) > 0\) notifyConfigurationChanged\(\)/)

  const singleDelete = source.slice(source.indexOf('async function onDelete'), source.indexOf('function onSelectionChange'))
  assert.equal((singleDelete.match(/notifyConfigurationChanged\(\)/g) || []).length, 1)
  assert.match(singleDelete, /await aiAPI\.delete\(row\.id\)[\s\S]*notifyConfigurationChanged\(\)/)

  const batchDelete = source.slice(source.indexOf('async function onBatchDelete'), source.indexOf('function openOneKeyTongyi'))
  assert.equal((batchDelete.match(/notifyConfigurationChanged\(\)/g) || []).length, 1)
  assert.match(batchDelete, /if \(success > 0\) notifyConfigurationChanged\(\)/)

  const presets = source.slice(source.indexOf('async function submitPresetConfigs'), source.indexOf('async function exportConfigs'))
  assert.equal((presets.match(/notifyConfigurationChanged\(\)/g) || []).length, 1)
  assert.match(presets, /runAiConfigCreateBatch\(configs, createOne\)/)
  assert.match(presets, /if \(result\.success > 0\) notifyConfigurationChanged\(\)/)
  assert.match(presets, /预设配置完成：\$\{result\.success\} 条成功，\$\{result\.failed\} 条失败/)
  assert.match(presets, /await loadList\(\)/)
  for (const handler of ['submitOneKeyTongyi', 'submitOneKeyVolc', 'submitOneKeyAgnes']) {
    assert.match(presets, new RegExp(`async function ${handler}\\([\\s\\S]*submitPresetConfigs\\(`))
  }

  const importHandler = source.slice(source.indexOf('async function importConfigs'), source.indexOf('async function loadVendorLock'))
  assert.equal((importHandler.match(/notifyConfigurationChanged\(\)/g) || []).length, 1)
  assert.match(importHandler, /if \(result\.success > 0\) notifyConfigurationChanged\(\)/)

  const connectionTest = source.slice(source.indexOf('async function openTest'), source.indexOf('async function onDelete'))
  const exportHandler = source.slice(source.indexOf('async function exportConfigs'), source.indexOf('function triggerImport'))
  assert.doesNotMatch(connectionTest, /notifyConfigurationChanged|emit\(/)
  assert.doesNotMatch(exportHandler, /notifyConfigurationChanged|emit\(/)
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

test('coverage grid keeps five desktop columns, visible card details, and 32px controls', () => {
  assert.match(source, /\.coverage-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(5, minmax\(0, 1fr\)\);/)
  assert.match(source, /\.coverage-item\s*\{[\s\S]*?min-height:\s*132px;[\s\S]*?padding:\s*10px;/)
  assert.match(source, /\.coverage-select\s*\{[\s\S]*?min-height:\s*32px;/)
  assert.match(source, /\.coverage-action-link\s*\{[\s\S]*?min-height:\s*32px;/)
  assert.match(source, /\.coverage-config-detail\s*\{[\s\S]*?overflow-wrap:\s*anywhere;/)

  const mediumDesktop = source.slice(source.indexOf('@media (max-width: 1440px)'), source.indexOf('@media (max-width: 1120px)'))
  assert.doesNotMatch(mediumDesktop, /\.coverage-grid/)
  assert.match(source, /@media \(max-width: 1120px\) \{[\s\S]*?\.coverage-grid\s*\{[\s\S]*?repeat\(2, minmax\(0, 1fr\)\)/)
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
