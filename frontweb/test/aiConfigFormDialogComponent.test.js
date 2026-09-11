import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  readAiConfigFormDialogTreeSource,
  readAiConfigFormSectionSource,
} from './helpers/aiConfigFormDialogSources.js'

function readSource(url) {
  return readFileSync(url, 'utf8').replace(/\r\n?/g, '\n')
}

const vueSource = readSource(new URL('../src/components/AIConfigContent.vue', import.meta.url))
const formActionsSource = readSource(new URL('../src/composables/useAiConfigFormActions.js', import.meta.url))
const formDialogSource = readAiConfigFormSectionSource('AiConfigFormDialog.vue')
const lockSectionSource = readAiConfigFormSectionSource('AiConfigFormLockSection.vue')
const basicSectionSource = readAiConfigFormSectionSource('AiConfigFormBasicSection.vue')
const vendorSectionSource = readAiConfigFormSectionSource('AiConfigFormVendorSection.vue')
const endpointSectionSource = readAiConfigFormSectionSource('AiConfigFormEndpointSection.vue')
const modelSectionSource = readAiConfigFormSectionSource('AiConfigFormModelSection.vue')
const policySectionSource = readAiConfigFormSectionSource('AiConfigFormPolicySection.vue')
const formTreeSource = readAiConfigFormDialogTreeSource()
const oneKeyDialogSource = readSource(new URL('../src/components/aiConfig/AiConfigOneKeyDialogs.vue', import.meta.url))

test('添加/编辑对话框是纯展示组件，提交和列表刷新仍留在页面', () => {
  assert.match(vueSource, /<AiConfigFormDialog/)
  assert.match(vueSource, /v-model:dialog-visible="dialogVisible"/)
  assert.match(vueSource, /v-model:form="form"/)
  assert.match(vueSource, /v-model:form-ref="formRef"/)
  assert.match(vueSource, /v-model:api-key-input-ref="apiKeyInputRef"/)
  assert.match(vueSource, /:submit="submit"/)
  assert.match(vueSource, /:confirm-config-dialog-close="confirmConfigDialogClose"/)
  assert.match(vueSource, /async function loadList\(\)/)
  assert.match(vueSource, /async function openTest\(row\)/)
  assert.match(formActionsSource, /async function submit\(\)/)
  assert.match(vueSource, /useAiConfigFormActions\(/)
  assert.match(vueSource, /import \{ formatJimeng2AssetCreatedAt \} from '@\/components\/aiConfig\/aiConfigFormatters\.js'/)
  for (const source of [formDialogSource, lockSectionSource, basicSectionSource, vendorSectionSource, endpointSectionSource, modelSectionSource, policySectionSource]) {
    assert.doesNotMatch(source, /async function loadList\(/)
    assert.doesNotMatch(source, /async function openTest\(/)
    assert.doesNotMatch(source, /async function submit\(/)
    assert.doesNotMatch(source, /useAiConfigList/)
    assert.doesNotMatch(source, /from '@\/composables\/useAiConfigList/)
    assert.doesNotMatch(source, /function formatJimeng2AssetCreatedAt/)
    assert.doesNotMatch(source, /aiAPI\.(create|update|getAll|testConnection)/)
  }
  assert.match(formDialogSource, /defineModel\('dialogVisible'/)
  assert.match(formDialogSource, /defineModel\('form'/)
  assert.match(formDialogSource, /function bindFormRef\(el\) \{\s*formRef\.value = el/)
  assert.match(formDialogSource, /function bindApiKeyInputRef\(el\) \{\s*apiKeyInputRef\.value = el/)
  assert.match(formDialogSource, /:ref="bindFormRef"/)
  assert.match(formDialogSource, /:bind-api-key-input-ref="bindApiKeyInputRef"/)
  assert.match(lockSectionSource, /:ref="bindApiKeyInputRef"/)
  assert.match(vendorSectionSource, /:ref="bindApiKeyInputRef"/)
  assert.match(formDialogSource, /submit: \{ type: Function, required: true \}/)
})

test('锁定模式只展示密钥和默认模型，普通模式保留完整表单', () => {
  assert.match(formDialogSource, /<!-- 锁定模式：只展示 api_key 和 default_model -->/)
  assert.match(formDialogSource, /v-if="vendorLock.enabled"/)
  assert.match(
    formDialogSource,
    /:title="vendorLock.enabled \? '修改 API 密钥 \/ 默认模型' : \(editingId \? '编辑配置' : '添加配置'\)"/,
  )
  const lockStart = formDialogSource.indexOf('v-if="vendorLock.enabled"')
  const normalStart = formDialogSource.indexOf('<el-form v-else')
  assert.ok(lockStart >= 0 && normalStart > lockStart)
  const lockBlock = formDialogSource.slice(lockStart, normalStart)
  const normalBlock = formDialogSource.slice(normalStart)
  assert.match(lockBlock, /<AiConfigFormLockSection/)
  assert.doesNotMatch(lockBlock, /data-ai-config-field="service_type"/)
  assert.doesNotMatch(lockBlock, /data-ai-config-field="provider"/)
  assert.match(lockSectionSource, /data-ai-config-field="api_key"/)
  assert.match(lockSectionSource, /data-ai-config-field="default_model"/)
  assert.doesNotMatch(lockSectionSource, /data-ai-config-field="service_type"/)
  assert.doesNotMatch(lockSectionSource, /data-ai-config-field="provider"/)
  assert.match(normalBlock, /<AiConfigFormBasicSection/)
  assert.match(normalBlock, /<AiConfigFormVendorSection/)
  assert.match(normalBlock, /<AiConfigFormEndpointSection/)
  assert.match(normalBlock, /<AiConfigFormModelSection/)
  assert.match(normalBlock, /<AiConfigFormPolicySection/)
  assert.match(basicSectionSource, /data-ai-config-field="service_type"/)
  assert.match(vendorSectionSource, /data-ai-config-field="provider"/)
  assert.match(basicSectionSource, /<h4>基础信息<\/h4>/)
  assert.match(vendorSectionSource, /<h4>厂商与认证<\/h4>/)
  assert.match(modelSectionSource, /<h4>模型<\/h4>/)
  assert.match(policySectionSource, /<h4>调用策略<\/h4>/)
  assert.match(modelSectionSource, /<AiConfigModelListSection/)
})

test('未保存关闭确认仍由页面处理，保存按钮写锁优先', () => {
  assert.match(vueSource, /const configFormDirty = computed/)
  assert.match(vueSource, /当前 AI 配置尚未保存/)
  assert.match(formDialogSource, /:before-close="confirmConfigDialogClose"/)
  assert.match(formDialogSource, /@click="requestConfigDialogClose"/)
  assert.match(formDialogSource, /:aria-label="editingId \? '取消编辑配置' : '取消添加配置'"/)
  assert.match(formDialogSource, /aria-label="保存配置"/)
  const saveButton = formDialogSource.match(/<el-button type="primary" aria-label="保存配置"[^>]*>/)?.[0]
  assert.ok(saveButton, '缺少保存按钮')
  assert.match(saveButton, /:disabled="configWriteLocked"/)
  assert.match(saveButton, /:title="configWriteLocked \? configWriteLockReason : undefined"/)
  assert.match(saveButton, /@click="submit"/)
  assert.match(oneKeyDialogSource, /aria-label="通义密钥"/)
  assert.match(oneKeyDialogSource, /aria-label="火山引擎密钥"/)
  assert.match(oneKeyDialogSource, /aria-label="Agnes 密钥"/)
  assert.doesNotMatch(formTreeSource, /aria-label="通义密钥"/)
  assert.doesNotMatch(formTreeSource, /aria-label="火山引擎密钥"/)
  assert.doesNotMatch(formTreeSource, /aria-label="Agnes 密钥"/)
})
