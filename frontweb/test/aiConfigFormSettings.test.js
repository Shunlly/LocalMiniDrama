import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  parseSettings,
  parseComfyWorkflowJson,
  isDeepSeekOfficial,
  resolveDeepSeekFormSettings,
} from '../src/utils/aiConfigFormSettings.js'

const vueSource = readFileSync(new URL('../src/components/AIConfigContent.vue', import.meta.url), 'utf8')

test('settings 和 Comfy 工作流解析失败给出中文错误，不抛英文 JSON 堆栈', () => {
  assert.deepEqual(parseSettings(''), {})
  assert.deepEqual(parseSettings('{'), {})
  assert.deepEqual(parseSettings({ thinking: 'enabled' }), { thinking: 'enabled' })
  assert.throws(() => parseComfyWorkflowJson('{'), /工作流 JSON 格式无效/)
  assert.throws(() => parseComfyWorkflowJson('[]'), /工作流 JSON 必须是非空对象/)
  assert.throws(() => parseComfyWorkflowJson('{}'), /工作流 JSON 必须是非空对象/)
  assert.deepEqual(parseComfyWorkflowJson('{"1":{"class_type":"KSampler"}}'), { 1: { class_type: 'KSampler' } })
})

test('DeepSeek 官方配置按模型和 settings 解析思考开关', () => {
  assert.equal(isDeepSeekOfficial('deepseek', ''), true)
  assert.equal(isDeepSeekOfficial('openai', 'https://api.deepseek.com/v1'), true)
  assert.equal(isDeepSeekOfficial('openai', 'https://api.openai.com/v1'), false)
  assert.deepEqual(resolveDeepSeekFormSettings({ default_model: 'deepseek-chat' }), {
    thinking: 'disabled',
    effort: 'high',
  })
  assert.deepEqual(resolveDeepSeekFormSettings({ default_model: 'deepseek-reasoner' }), {
    thinking: 'enabled',
    effort: 'high',
  })
  assert.deepEqual(resolveDeepSeekFormSettings({
    default_model: 'deepseek-reasoner',
    settings: { deepseek_thinking: 'enabled', deepseek_reasoning_effort: 'max' },
  }), { thinking: 'enabled', effort: 'max' })
})

test('页面提交仍调用工作流解析，loadList/openTest 留在页面', () => {
  assert.match(vueSource, /buildAiConfigSubmitPayload\(form\.value/)
  assert.match(vueSource, /async function loadList\(\)/)
  assert.match(vueSource, /async function openTest\(row\)/)
  assert.doesNotMatch(vueSource, /function parseComfyWorkflowJson\(value\)/)
  assert.doesNotMatch(vueSource, /function isDeepSeekOfficial\(/)
})
