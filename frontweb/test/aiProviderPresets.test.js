import test from 'node:test'
import assert from 'node:assert/strict'

import {
  getBaseUrlForProvider,
  getProviderEndpointDefaults,
  getProviderProtocol,
  providerConfigs,
} from '../src/utils/aiProviderPresets.js'

function providerIds(serviceType) {
  return providerConfigs[serviceType].map((item) => item.id)
}

function modelsFor(serviceType, providerId) {
  return providerConfigs[serviceType].find((item) => item.id === providerId)?.models || []
}

test('text presets include broader OpenAI-compatible providers and models', () => {
  assert.ok(providerIds('text').includes('openrouter'))
  assert.ok(providerIds('text').includes('siliconflow'))
  assert.ok(providerIds('text').includes('moonshot'))
  assert.ok(providerIds('text').includes('perplexity'))
  assert.ok(providerIds('text').includes('ollama'))

  assert.ok(modelsFor('text', 'openai').includes('gpt-5.5'))
  assert.ok(modelsFor('text', 'xai').includes('grok-4'))
  assert.ok(modelsFor('text', 'perplexity').includes('sonar-pro'))
})

test('media presets include newer image, video and tts models', () => {
  assert.ok(modelsFor('image', 'openai').includes('gpt-image-1'))
  assert.ok(modelsFor('storyboard_image', 'siliconflow').includes('black-forest-labs/FLUX.1-dev'))
  assert.ok(modelsFor('video', 'openai').includes('sora'))
  assert.ok(modelsFor('tts', 'openai').includes('gpt-4o-mini-tts'))
})

test('provider defaults are service-type aware', () => {
  assert.equal(getProviderProtocol('gemini', 'text'), 'openai')
  assert.equal(getProviderProtocol('gemini', 'image'), 'gemini')
  assert.equal(getBaseUrlForProvider('gemini', 'text'), 'https://generativelanguage.googleapis.com/v1beta/openai')
  assert.equal(getBaseUrlForProvider('gemini', 'image'), 'https://generativelanguage.googleapis.com')

  assert.equal(getProviderProtocol('xai', 'text'), 'openai')
  assert.equal(getProviderProtocol('xai', 'video'), 'xai')
  assert.equal(getBaseUrlForProvider('xai', 'text'), 'https://api.x.ai/v1')
  assert.equal(getBaseUrlForProvider('xai', 'video'), 'https://api.x.ai')
})

test('endpoint defaults prevent provider switching residue', () => {
  assert.deepEqual(getProviderEndpointDefaults('gemini', 'text'), {
    endpoint: '/chat/completions',
    query_endpoint: '',
  })
  assert.deepEqual(getProviderEndpointDefaults('ffir', 'video'), {
    endpoint: '/kling/v1/videos/omni-video',
    query_endpoint: '/kling/v1/images/omni-image/{taskId}',
  })
  assert.deepEqual(getProviderEndpointDefaults('siliconflow', 'image'), {
    endpoint: '',
    query_endpoint: '',
  })
})

test('preset provider ids are unique within each service type', () => {
  for (const [serviceType, list] of Object.entries(providerConfigs)) {
    const ids = list.map((item) => item.id)
    assert.deepEqual(new Set(ids).size, ids.length, serviceType)
  }
})
