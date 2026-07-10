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
  assert.match(detailSource, /query:\s*\{\s*service_type:\s*action\.serviceType\s*\|\|\s*''\s*\}/)
  assert.match(pageSource, /<AIConfigContent\s+:initial-service-type="initialServiceType"\s*\/>/)
  assert.match(pageSource, /route\.query\.service_type/)
  assert.match(source, /activeServiceFilter\s*=\s*ref\(normalizeInitialServiceType\(props\.initialServiceType\)\)/)
  assert.match(source, /if \(activeServiceFilter\.value\) await focusServiceConfigs\(activeServiceFilter\.value\)/)
})
