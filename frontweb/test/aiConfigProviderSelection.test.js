import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { CUSTOM_PROVIDER_SENTINEL } from '../src/utils/aiProviderPresets.js'
import { applyProviderSelection } from '../src/utils/aiConfigProviderSelection.js'

const vueSource = readFileSync(new URL('../src/components/AIConfigContent.vue', import.meta.url), 'utf8')
const formDerivedSource = readFileSync(new URL('../src/composables/useAiConfigFormDerived.js', import.meta.url), 'utf8')

function blankForm(serviceType = 'text') {
  return {
    service_type: serviceType,
    name: '',
    provider: '',
    api_protocol: 'openai',
    base_url: 'https://old.example/v1',
    endpoint: '/old',
    query_endpoint: '/old-query',
    modelText: 'old-model',
    default_model: 'old-model',
    deepseek_thinking: 'enabled',
    deepseek_reasoning_effort: 'max',
  }
}

test('选择自定义厂商会清掉旧地址和模型，避免沿用上一家配置', () => {
  const form = blankForm('video')
  applyProviderSelection(form, CUSTOM_PROVIDER_SENTINEL)
  assert.equal(form.provider, '')
  assert.equal(form.api_protocol, '')
  assert.equal(form.base_url, '')
  assert.equal(form.endpoint, '')
  assert.equal(form.query_endpoint, '')
  assert.equal(form.modelText, '')
  assert.equal(form.default_model, '')
})

test('选择 Agnes 视频会填官方协议、端点和中文名称', () => {
  const form = blankForm('video')
  applyProviderSelection(form, 'agnes')
  assert.equal(form.api_protocol, 'agnes')
  assert.equal(form.endpoint, '/videos')
  assert.equal(form.query_endpoint, '/videos/{taskId}')
  assert.match(form.name, /Agnes/)
  assert.match(form.name, /视频/)
  assert.equal(form.default_model, 'agnes-video-v2.0')
})

test('选择即梦视频会清掉误填端点；DeepSeek 默认关闭思考', () => {
  const jimeng = applyProviderSelection(blankForm('video'), 'jimeng_ai_api')
  assert.equal(jimeng.endpoint, '')
  assert.equal(jimeng.query_endpoint, '')
  const deepseek = applyProviderSelection(blankForm('text'), 'deepseek')
  assert.equal(deepseek.deepseek_thinking, 'disabled')
  assert.equal(deepseek.deepseek_reasoning_effort, 'high')
  assert.match(deepseek.base_url, /api\.deepseek\.com/)
})

test('编辑已有配置时不改名称；页面仍走 onProviderChange', () => {
  const form = { ...blankForm('video'), name: '我的视频配置' }
  applyProviderSelection(form, 'agnes', { editingId: 12 })
  assert.equal(form.name, '我的视频配置')
  assert.match(vueSource, /onProviderChange,/)
  assert.match(formDerivedSource, /function onProviderChange\(providerId\)/)
  assert.match(formDerivedSource, /applyProviderSelection\(form\.value, providerId/)
  assert.match(vueSource, /async function loadList\(\)/)
  assert.match(vueSource, /async function openTest\(row\)/)
})

test('切换预设厂商会换成新厂商的模型列表，不会沿用上一份', () => {
  const form = blankForm('text')
  applyProviderSelection(form, 'openai')
  assert.equal(form.provider, 'openai')
  assert.match(form.modelText, /gpt-4o/)
  const oldDefault = form.default_model
  applyProviderSelection(form, 'deepseek')
  assert.equal(form.provider, 'deepseek')
  assert.match(form.modelText, /deepseek-v4-flash/)
  assert.doesNotMatch(form.modelText, /gpt-4o/)
  assert.match(form.default_model, /deepseek/)
  assert.notEqual(form.default_model, oldDefault)
})
