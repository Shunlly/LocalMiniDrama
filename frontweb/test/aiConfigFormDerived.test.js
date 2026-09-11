import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ref } from 'vue'

import { useAiConfigFormDerived } from '../src/composables/useAiConfigFormDerived.js'

const vueSource = readFileSync(new URL('../src/components/AIConfigContent.vue', import.meta.url), 'utf8')
const formDerivedSource = readFileSync(new URL('../src/composables/useAiConfigFormDerived.js', import.meta.url), 'utf8')

const CONFIG_ID = 41
const DRAMA_ID = 11
assert.notEqual(CONFIG_ID, DRAMA_ID)

function createDerived(formValue, { editingId = null } = {}) {
  const form = ref(formValue)
  const presetModelPick = ref('')
  const api = useAiConfigFormDerived({
    form,
    editingId: ref(editingId),
    presetModelPick,
  })
  return { form, presetModelPick, api }
}

test('表单派生状态抽到 composable 后，loadList/openTest 仍留在页面', () => {
  assert.match(vueSource, /useAiConfigFormDerived\(/)
  assert.match(vueSource, /async function loadList\(\)/)
  assert.match(vueSource, /async function openTest\(row\)/)
  assert.doesNotMatch(formDerivedSource, /async function loadList\(/)
  assert.doesNotMatch(formDerivedSource, /async function openTest\(/)
  assert.doesNotMatch(formDerivedSource, /useAiConfigList/)
})

test('读取模型禁用原因和 Comfy 判定只看当前表单，不把编辑 id 当成服务类型', () => {
  const missingUrl = createDerived({
    service_type: 'text',
    provider: 'openai',
    api_protocol: 'openai',
    base_url: '',
    api_key: 'sk-test',
    modelText: 'gpt-4o-mini',
    default_model: 'gpt-4o-mini',
  })
  assert.equal(missingUrl.api.discoverModelsDisabledReason.value, '请先填写接口地址')
  assert.equal(missingUrl.api.discoverModelsDisabled.value, true)

  const missingKey = createDerived({
    service_type: 'text',
    provider: 'openai',
    api_protocol: 'openai',
    base_url: 'https://api.openai.com/v1',
    api_key: '',
    modelText: 'gpt-4o-mini',
    default_model: 'gpt-4o-mini',
  })
  assert.equal(missingKey.api.discoverModelsDisabledReason.value, '请先填写 API 密钥后再读取模型')

  const comfy = createDerived({
    service_type: 'image',
    provider: 'comfyui',
    api_protocol: 'comfyui',
    base_url: 'http://127.0.0.1:8188',
    api_key: '',
    modelText: '',
    default_model: '',
  }, { editingId: CONFIG_ID })
  assert.equal(comfy.api.isComfyUiForm.value, true)
  assert.equal(comfy.api.isDeepSeekOfficialForm.value, false)

  const textComfyName = createDerived({
    service_type: 'text',
    provider: 'comfyui',
    api_protocol: 'openai',
    base_url: 'https://api.deepseek.com',
    api_key: 'sk-test',
    modelText: 'deepseek-chat',
    default_model: 'deepseek-chat',
  }, { editingId: DRAMA_ID })
  assert.equal(textComfyName.api.isComfyUiForm.value, false)
  assert.equal(textComfyName.api.isDeepSeekOfficialForm.value, true)
})

test('切换服务类型后厂商和模型下拉仍有可选项', () => {
  const created = createDerived({
    service_type: 'text',
    provider: '',
    api_protocol: '',
    base_url: '',
    api_key: '',
    modelText: '',
    default_model: '',
  })
  assert.ok(created.api.availableProviderOptions.value.length > 1)
  created.api.onServiceTypeChange()
  created.form.value.service_type = 'video'
  created.api.onServiceTypeChange()
  assert.equal(created.form.value.service_type, 'video')
  assert.ok(created.api.availableProviderOptions.value.length > 1)
  assert.equal(created.api.availableProviderOptions.value.at(-1).id, '__custom__')
  created.form.value.provider = 'minimax'
  assert.ok(created.api.availableModels.value.length > 0)
  assert.match(created.api.providerModelEmptyHint.value || 'ok', /ok|可直接输入/)
})

test('新增时手填默认模型会进列表，编辑时保留已失效默认模型', () => {
  const created = createDerived({
    service_type: 'text',
    provider: 'openai',
    api_protocol: 'openai',
    base_url: 'https://api.openai.com/v1',
    api_key: 'sk-test',
    modelText: 'current-model-a\ncurrent-model-b',
    default_model: 'retired-model',
  })
  assert.match(created.form.value.modelText, /retired-model/)
  assert.equal(created.form.value.default_model, 'retired-model')

  const editing = createDerived({
    service_type: 'text',
    provider: 'openai',
    api_protocol: 'openai',
    base_url: 'https://api.openai.com/v1',
    api_key: 'sk-test',
    modelText: 'current-model-a\ncurrent-model-b',
    default_model: 'retired-model',
  }, { editingId: CONFIG_ID })
  assert.equal(editing.form.value.modelText, 'current-model-a\ncurrent-model-b')
  assert.equal(editing.form.value.default_model, 'retired-model')
  assert.equal(editing.api.isDefaultModelUnavailable.value, true)
  assert.equal(editing.api.isDefaultModelSelectionValid('retired-model'), false)
  assert.equal(editing.api.isDefaultModelSelectionValid('current-model-b'), true)
})