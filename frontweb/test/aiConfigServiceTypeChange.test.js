import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  applyServiceTypeChange,
  appendModelToList,
  applyPresetModelSelect,
} from '../src/utils/aiConfigServiceTypeChange.js'

const vueSource = readFileSync(new URL('../src/components/AIConfigContent.vue', import.meta.url), 'utf8')

test('切到即梦2角色认证会填中文名称和素材网关，不会沿用文本厂商', () => {
  const form = {
    service_type: 'jimeng2_character_auth',
    provider: '',
    name: '',
    base_url: '',
    modelText: 'gpt-4o',
    default_model: 'gpt-4o',
    endpoint: '/chat/completions',
    query_endpoint: '/old',
    api_protocol: 'openai',
  }
  applyServiceTypeChange(form)
  assert.equal(form.provider, 'jimeng_material_api')
  assert.equal(form.name, '即梦2角色认证')
  assert.equal(form.modelText, '-')
  assert.equal(form.default_model, '-')
  assert.equal(form.endpoint, '')
  assert.equal(form.api_protocol, '')
  assert.match(form.base_url, /silvamux\.tingyutech\.com/)
})

test('切换到当前厂商不支持的类型会清掉旧地址和模型', () => {
  const form = {
    service_type: 'ocr',
    provider: 'minimax',
    api_protocol: 'minimax',
    base_url: 'https://api.minimaxi.com/v1',
    endpoint: '/video_generation',
    query_endpoint: '/query',
    modelText: 'video-01',
    default_model: 'video-01',
  }
  applyServiceTypeChange(form)
  assert.equal(form.provider, '')
  assert.equal(form.base_url, '')
  assert.equal(form.modelText, '')
  assert.equal(form.default_model, '')
})

test('追加模型去重，空默认模型会用预设值', () => {
  const form = { modelText: 'gpt-4o', default_model: '' }
  appendModelToList(form, 'gpt-4o')
  assert.equal(form.modelText, 'gpt-4o')
  applyPresetModelSelect(form, 'qwen-plus')
  assert.match(form.modelText, /qwen-plus/)
  assert.equal(form.default_model, 'qwen-plus')
})

test('页面仍走原事件，loadList/openTest 留在页面', () => {
  assert.match(vueSource, /function onServiceTypeChange\(\)/)
  assert.match(vueSource, /applyServiceTypeChange\(form\.value/)
  assert.match(vueSource, /async function loadList\(\)/)
  assert.match(vueSource, /async function openTest\(row\)/)
})
