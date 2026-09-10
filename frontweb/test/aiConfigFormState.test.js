import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { createBlankAiConfigForm, hydrateAiConfigForm } from '../src/utils/aiConfigFormState.js'

const vueSource = readFileSync(new URL('../src/components/AIConfigContent.vue', import.meta.url), 'utf8')

test('新增表单默认设为默认配置，并关闭 DeepSeek 思考', () => {
  const form = createBlankAiConfigForm()
  assert.equal(form.service_type, 'text')
  assert.equal(form.is_default, true)
  assert.equal(form.deepseek_thinking, 'disabled')
  assert.equal(form.comfy_workflow_json, '')
})

test('编辑回填 TTS、可灵 Omni 和 Comfy 工作流，坏 JSON 不会抛错', () => {
  const tts = hydrateAiConfigForm({
    service_type: 'tts',
    name: '旁白',
    provider: 'minimax',
    model: ['speech-2.6-hd'],
    default_model: 'speech-2.6-hd',
    settings: JSON.stringify({ voice_id: 'female-qn', group_id: 'g1' }),
  })
  assert.equal(tts.voice_id, 'female-qn')
  assert.equal(tts.group_id, 'g1')
  assert.equal(tts.modelText, 'speech-2.6-hd')

  const kling = hydrateAiConfigForm({
    service_type: 'video',
    api_protocol: 'kling_omni',
    settings: { kling_access_key: 'ak', kling_secret_key: 'sk', kling_secret_key_base64: true },
  })
  assert.equal(kling.kling_access_key, 'ak')
  assert.equal(kling.kling_secret_key_base64, true)

  const comfy = hydrateAiConfigForm({
    service_type: 'image',
    settings: { workflow: { 1: { class_type: 'KSampler' } } },
  })
  assert.match(comfy.comfy_workflow_json, /KSampler/)

  assert.doesNotThrow(() => hydrateAiConfigForm({ service_type: 'image', settings: '{' }))
})

test('页面新增/编辑仍走原函数，loadList/openTest 留在页面', () => {
  assert.match(vueSource, /function resetForm\(\)/)
  assert.match(vueSource, /createBlankAiConfigForm\(\)/)
  assert.match(vueSource, /hydrateAiConfigForm\(row\)/)
  assert.match(vueSource, /async function loadList\(\)/)
  assert.match(vueSource, /async function openTest\(row\)/)
})
