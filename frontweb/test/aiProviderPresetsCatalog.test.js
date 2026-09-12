import test from 'node:test'
import assert from 'node:assert/strict'

import {
  CUSTOM_PROVIDER_SENTINEL,
  getProviderProtocol,
  providerConfigs,
} from '../src/utils/aiProviderPresets.js'
import {
  buildAvailableModels,
  buildAvailableProviderOptions,
} from '../src/utils/aiConfigProviderOptions.js'

const CORE_SERVICE_TYPES = [
  'text',
  'image',
  'storyboard_image',
  'video',
  'tts',
  'ocr',
  'transcription',
]

const REQUIRED_COMPAT_IDS = [
  'openai_compatible',
  'deepseek',
  'moonshot',
  'anthropic',
  'xai',
  'ollama',
]

function providerIds(serviceType) {
  return (providerConfigs[serviceType] || []).map((item) => item.id)
}

function modelsFor(serviceType, providerId) {
  return (providerConfigs[serviceType] || []).find((item) => item.id === providerId)?.models || []
}

test('每个核心服务类型除自定义外都有厂商预设', () => {
  for (const serviceType of CORE_SERVICE_TYPES) {
    const options = buildAvailableProviderOptions(serviceType, '')
    const presetOptions = options.filter((item) => item.id !== CUSTOM_PROVIDER_SENTINEL)
    assert.ok(presetOptions.length >= 1, `${serviceType} 应有自定义以外的厂商`)
    assert.equal(options.at(-1)?.id, CUSTOM_PROVIDER_SENTINEL, serviceType)
    assert.match(options.at(-1)?.name || '', /自定义/)
    assert.equal(providerIds(serviceType).includes(CUSTOM_PROVIDER_SENTINEL), false, serviceType)
  }
})

test('切换厂商后仍能按 id 找回对应模型列表', () => {
  for (const serviceType of CORE_SERVICE_TYPES) {
    const ids = providerIds(serviceType)
    assert.ok(ids.length >= 2, serviceType)
    const snapshot = Object.fromEntries(ids.map((id) => [id, [...modelsFor(serviceType, id)]]))
    for (const id of ids) {
      assert.ok(snapshot[id].length > 0, `${serviceType}:${id} 模型列表为空`)
    }
    let lastId = ids[0]
    for (const id of ids) {
      const current = buildAvailableModels(serviceType, id)
      assert.deepEqual(current, snapshot[id], `${serviceType} 切到 ${id}`)
      lastId = id
    }
    const firstId = ids[0]
    assert.notEqual(lastId, firstId, serviceType)
    assert.deepEqual(buildAvailableModels(serviceType, firstId), snapshot[firstId], `${serviceType} 切回 ${firstId}`)
    assert.deepEqual(buildAvailableModels(serviceType, lastId), snapshot[lastId], `${serviceType} 再切 ${lastId}`)
    assert.equal((providerConfigs[serviceType] || []).find((item) => item.id === firstId)?.id, firstId)
  }
})

test('常见 OpenAI 兼容厂商覆盖各核心服务类型', () => {
  for (const serviceType of CORE_SERVICE_TYPES) {
    const ids = providerIds(serviceType)
    for (const id of REQUIRED_COMPAT_IDS) {
      assert.ok(ids.includes(id), `${serviceType} 缺少 ${id}`)
      assert.ok(modelsFor(serviceType, id).length > 0, `${serviceType}:${id}`)
    }
  }
  assert.ok(modelsFor('text', 'deepseek').includes('deepseek-v4-flash'))
  assert.ok(modelsFor('text', 'moonshot').includes('kimi-k2.5'))
  assert.ok(modelsFor('text', 'anthropic').includes('claude-sonnet-4-5'))
  assert.ok(modelsFor('text', 'xai').includes('grok-4'))
  assert.ok(modelsFor('text', 'ollama').includes('qwen3:8b'))
  assert.ok(modelsFor('text', 'openai_compatible').includes('kimi-k2.5'))
  assert.ok(modelsFor('text', 'openai_compatible').includes('grok-4'))
  assert.ok(modelsFor('image', 'xai').includes('grok-2-image'))
  assert.ok(modelsFor('storyboard_image', 'ollama').includes('flux'))
  assert.ok(modelsFor('video', 'openai_compatible').includes('sora-2'))
  assert.ok(modelsFor('ocr', 'anthropic').includes('claude-sonnet-4-5'))
  assert.ok(modelsFor('transcription', 'ollama').includes('whisper'))
})

test('通义火山可灵 Gemini 现有预设仍在', () => {
  assert.ok(providerIds('text').includes('qwen'))
  assert.ok(providerIds('text').includes('volcengine'))
  assert.ok(providerIds('text').includes('gemini'))
  for (const serviceType of ['image', 'storyboard_image']) {
    assert.ok(providerIds(serviceType).includes('dashscope'), serviceType)
    assert.ok(providerIds(serviceType).includes('volcengine'), serviceType)
    assert.ok(providerIds(serviceType).includes('kling'), serviceType)
    assert.ok(providerIds(serviceType).includes('gemini'), serviceType)
  }
  assert.ok(providerIds('video').includes('dashscope'))
  assert.ok(providerIds('video').includes('volces'))
  assert.ok(providerIds('video').includes('kling'))
  assert.ok(providerIds('video').includes('gemini'))
  assert.ok(providerIds('tts').includes('dashscope'))
  assert.ok(providerIds('tts').includes('volcengine'))
  assert.ok(providerIds('ocr').includes('qwen'))
  assert.ok(providerIds('ocr').includes('gemini'))
  assert.ok(providerIds('transcription').includes('qwen'))
})

test('xAI 图片走 OpenAI 兼容协议，视频仍走 xai', () => {
  assert.equal(getProviderProtocol('xai', 'text'), 'openai')
  assert.equal(getProviderProtocol('xai', 'image'), 'openai')
  assert.equal(getProviderProtocol('xai', 'storyboard_image'), 'openai')
  assert.equal(getProviderProtocol('xai', 'ocr'), 'openai')
  assert.equal(getProviderProtocol('xai', 'tts'), 'openai')
  assert.equal(getProviderProtocol('xai', 'video'), 'xai')
})
