import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

function readSource(url) {
  return readFileSync(url, 'utf8').replace(/\r\n?/g, '\n')
}

const vueSource = readSource(new URL('../src/components/AIConfigContent.vue', import.meta.url))
const formDialogSource = readSource(new URL('../src/components/aiConfig/AiConfigFormDialog.vue', import.meta.url))
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
  assert.match(vueSource, /async function submit\(\)/)
  assert.match(vueSource, /function formatJimeng2AssetCreatedAt\(value\)/)
  assert.doesNotMatch(formDialogSource, /async function loadList\(/)
  assert.doesNotMatch(formDialogSource, /async function openTest\(/)
  assert.doesNotMatch(formDialogSource, /async function submit\(/)
  assert.doesNotMatch(formDialogSource, /useAiConfigList/)
  assert.doesNotMatch(formDialogSource, /from '@\/composables\/useAiConfigList/)
  assert.doesNotMatch(formDialogSource, /function formatJimeng2AssetCreatedAt/)
  assert.doesNotMatch(formDialogSource, /aiAPI\.(create|update|getAll|testConnection)/)
  assert.match(formDialogSource, /defineModel\('dialogVisible'/)
  assert.match(formDialogSource, /defineModel\('form'/)
  assert.match(formDialogSource, /function bindFormRef\(el\) \{\s*formRef\.value = el/)
  assert.match(formDialogSource, /function bindApiKeyInputRef\(el\) \{\s*apiKeyInputRef\.value = el/)
  assert.match(formDialogSource, /:ref="bindFormRef"/)
  assert.match(formDialogSource, /:ref="bindApiKeyInputRef"/)
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
  assert.match(lockBlock, /data-ai-config-field="api_key"/)
  assert.match(lockBlock, /data-ai-config-field="default_model"/)
  assert.doesNotMatch(lockBlock, /data-ai-config-field="service_type"/)
  assert.doesNotMatch(lockBlock, /data-ai-config-field="provider"/)
  assert.match(normalBlock, /data-ai-config-field="service_type"/)
  assert.match(normalBlock, /data-ai-config-field="provider"/)
  assert.match(normalBlock, /<h4>基础信息<\/h4>/)
  assert.match(normalBlock, /<h4>厂商与认证<\/h4>/)
  assert.match(normalBlock, /<h4>模型<\/h4>/)
  assert.match(normalBlock, /<h4>调用策略<\/h4>/)
  assert.match(normalBlock, /<AiConfigModelListSection/)
})

test('未保存关闭确认仍由页面处理，保存按钮写锁优先', () => {
  assert.match(vueSource, /const configFormDirty = computed/)
  assert.match(vueSource, /当前 AI 配置尚未保存/)
  assert.match(formDialogSource, /:before-close="confirmConfigDialogClose"/)
  assert.match(formDialogSource, /@click="requestConfigDialogClose"/)
  assert.match(formDialogSource, /aria-label="保存配置"/)
  const saveButton = formDialogSource.match(/<el-button type="primary" aria-label="保存配置"[^>]*>/)?.[0]
  assert.ok(saveButton, '缺少保存按钮')
  assert.match(saveButton, /:disabled="configWriteLocked"/)
  assert.match(saveButton, /:title="configWriteLocked \? configWriteLockReason : undefined"/)
  assert.match(saveButton, /@click="submit"/)
  assert.match(oneKeyDialogSource, /aria-label="通义密钥"/)
  assert.match(oneKeyDialogSource, /aria-label="火山引擎密钥"/)
  assert.match(oneKeyDialogSource, /aria-label="Agnes 密钥"/)
  assert.doesNotMatch(formDialogSource, /aria-label="通义密钥"/)
  assert.doesNotMatch(formDialogSource, /aria-label="火山引擎密钥"/)
  assert.doesNotMatch(formDialogSource, /aria-label="Agnes 密钥"/)
})
