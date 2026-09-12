import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ref } from 'vue'

import { DEFAULT_MODEL_VALIDATION_MESSAGE } from '../src/composables/useAiConfigUnsaved.js'
import { useAiConfigFormRules } from '../src/composables/useAiConfigFormRules.js'

const vueSource = readFileSync(new URL('../src/components/AIConfigContent.vue', import.meta.url), 'utf8')
const formActionsSource = readFileSync(new URL('../src/composables/useAiConfigFormActions.js', import.meta.url), 'utf8')
const formRulesSource = readFileSync(new URL('../src/composables/useAiConfigFormRules.js', import.meta.url), 'utf8')

function validate(rule, value) {
  return new Promise((resolve) => {
    rule.validator({}, value, (error) => resolve(error ? error.message : ''))
  })
}

function createRules(formValue, { isComfyUi = false, modelValid = true } = {}) {
  const form = ref(formValue)
  const isComfyUiForm = ref(isComfyUi)
  const { rules } = useAiConfigFormRules({
    form,
    isComfyUiForm,
    isDefaultModelSelectionValid: () => modelValid,
  })
  return { form, rules }
}

test('表单校验留在独立模块，页面仍保留 loadList/openTest/submit', () => {
  assert.match(vueSource, /useAiConfigFormRules\(/)
  assert.match(vueSource, /async function loadList\(\)/)
  assert.match(vueSource, /async function openTest\(row\)/)
  assert.match(formActionsSource, /async function submit\(\)/)
  assert.match(vueSource, /useAiConfigFormActions\(/)
  assert.doesNotMatch(formRulesSource, /async function loadList\(/)
  assert.doesNotMatch(formRulesSource, /async function openTest\(/)
  assert.doesNotMatch(formRulesSource, /useAiConfigList/)
})

test('密钥、令牌和自定义视频端点按服务类型 fail-closed', async () => {
  const jimeng = createRules({
    service_type: 'jimeng2_character_auth',
    provider: 'jimeng_material_api',
    api_protocol: '',
    kling_access_key: '',
    kling_secret_key: '',
  })
  assert.equal(await validate(jimeng.rules.value.api_key[0], ''), '请填写令牌（Token）')
  assert.equal(await validate(jimeng.rules.value.api_key[0], 'token-1'), '')

  const kling = createRules({
    service_type: 'video',
    provider: 'kling',
    api_protocol: 'kling_omni',
    kling_access_key: 'ak',
    kling_secret_key: 'sk',
  })
  assert.equal(await validate(kling.rules.value.api_key[0], ''), '')

  const customVideo = createRules({
    service_type: 'video',
    provider: 'my-custom',
    api_protocol: 'openai',
    kling_access_key: '',
    kling_secret_key: '',
  })
  assert.equal(await validate(customVideo.rules.value.endpoint[0], ''), '自定义视频厂商请输入提交端点')
  assert.equal(await validate(customVideo.rules.value.endpoint[0], '/video_generation'), '')
})

test('Comfy 工作流和默认模型校验不会被其他服务类型放过', async () => {
  const comfy = createRules({
    service_type: 'image',
    provider: 'comfyui',
    api_protocol: 'comfyui',
  }, { isComfyUi: true, modelValid: false })
  assert.equal(await validate(comfy.rules.value.modelText[0], ''), '')
  assert.equal(await validate(comfy.rules.value.comfy_workflow_json[0], '{}'), '工作流 JSON 必须是非空对象')
  assert.equal(await validate(comfy.rules.value.default_model[0], ''), DEFAULT_MODEL_VALIDATION_MESSAGE)

  const text = createRules({
    service_type: 'text',
    provider: 'openai',
    api_protocol: 'openai',
  }, { isComfyUi: false, modelValid: true })
  assert.equal(await validate(text.rules.value.modelText[0], ''), '请填写至少一个模型')
  assert.equal(await validate(text.rules.value.comfy_workflow_json[0], ''), '')
})