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
  assert.match(source, /coverageInventoryLabel/)
  assert.match(source, /coverageActions\(item\)/)
  assert.match(source, /onCoverageAction\(item, action\)/)
  assert.doesNotMatch(source, /<button[^>]*class="coverage-item"/)
  assert.match(source, /<article[\s\S]*class="coverage-item"/)
  assert.match(source, /class="coverage-select"/)
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
