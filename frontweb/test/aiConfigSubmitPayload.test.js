import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  findExistingDefaultConfig,
  buildReplaceDefaultConfirmCopy,
  buildAiConfigSubmitPayload,
} from '../src/utils/aiConfigSubmitPayload.js'

const vueSource = readFileSync(new URL('../src/components/AIConfigContent.vue', import.meta.url), 'utf8')
const formActionsSource = readFileSync(new URL('../src/composables/useAiConfigFormActions.js', import.meta.url), 'utf8')

test('替换默认配置确认文案使用中文类型和未命名回退', () => {
  const existing = findExistingDefaultConfig([
    { id: 1, service_type: 'video', is_default: true, name: '旧视频' },
    { id: 2, service_type: 'video', is_default: false, name: '备选' },
  ], 'video', 3)
  assert.equal(existing.name, '旧视频')
  const copy = buildReplaceDefaultConfirmCopy({ name: '', service_type: 'video' }, existing)
  assert.equal(copy.title, '保存确认')
  assert.equal(copy.confirmButtonText, '确认保存')
  assert.match(copy.message, /未命名配置/)
  assert.match(copy.message, /视频/)
  assert.match(copy.message, /旧视频/)
  assert.equal(findExistingDefaultConfig([existing], 'video', 1), null)
})

test('保存载荷会补即梦占位模型，并打包 TTS/可灵/DeepSeek settings', () => {
  const jimeng = buildAiConfigSubmitPayload({
    service_type: 'jimeng2_character_auth',
    name: '认证',
    provider: 'jimeng_material_api',
    base_url: 'https://example',
    modelText: '',
    is_default: true,
  })
  assert.deepEqual(jimeng.model, ['-'])

  const tts = buildAiConfigSubmitPayload({
    service_type: 'tts',
    name: '旁白',
    provider: 'minimax',
    modelText: 'speech-2.6-hd',
    voice_id: 'female-qn',
    group_id: 'g1',
  })
  assert.match(tts.settings, /female-qn/)

  const deepseek = buildAiConfigSubmitPayload({
    service_type: 'text',
    name: '思考',
    provider: 'deepseek',
    modelText: 'deepseek-reasoner',
    deepseek_thinking: 'enabled',
    deepseek_reasoning_effort: 'max',
  }, { isDeepSeekOfficial: true })
  const parsed = JSON.parse(deepseek.settings)
  assert.equal(parsed.deepseek_thinking, 'enabled')
  assert.equal(parsed.deepseek_reasoning_effort, 'max')
})

test('页面保存仍先确认再提交，loadList/openTest 留在页面', () => {
  assert.match(formActionsSource, /if \(!await confirmReplaceDefaultConfig\(\)\) return/)
  assert.match(formActionsSource, /buildAiConfigSubmitPayload\(form\.value/)
  assert.match(vueSource, /useAiConfigFormActions\(/)
  assert.match(vueSource, /async function loadList\(\)/)
  assert.match(vueSource, /async function openTest\(row\)/)
})
