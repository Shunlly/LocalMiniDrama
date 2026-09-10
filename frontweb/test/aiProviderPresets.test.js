import test from 'node:test'
import assert from 'node:assert/strict'

import {
  CUSTOM_PROVIDER_SENTINEL,
  getBaseUrlForProvider,
  getProviderEndpointDefaults,
  getProviderProtocol,
  isApiKeyOptionalProvider,
  providerConfigs,
} from '../src/utils/aiProviderPresets.js'

function providerIds(serviceType) {
  return providerConfigs[serviceType].map((item) => item.id)
}

function modelsFor(serviceType, providerId) {
  return providerConfigs[serviceType].find((item) => item.id === providerId)?.models || []
}

test('text presets include broader OpenAI-compatible providers and models', () => {
  for (const id of ['openrouter', 'siliconflow', 'moonshot', 'deepseek', 'zhipu', 'minimax', 'perplexity', 'ollama', 'anthropic', 'vllm']) {
    assert.ok(providerIds('text').includes(id), id)
  }

  assert.ok(modelsFor('text', 'openai').includes('gpt-5.5'))
  assert.ok(modelsFor('text', 'xai').includes('grok-4'))
  assert.ok(modelsFor('text', 'perplexity').includes('sonar-pro'))
  assert.ok(modelsFor('text', 'minimax').includes('MiniMax-M1'))
  assert.ok(modelsFor('text', 'zhipu').includes('glm-4.6'))
})

test('media presets include newer image, video and tts models', () => {
  assert.ok(modelsFor('image', 'openai').includes('gpt-image-1'))
  assert.ok(modelsFor('storyboard_image', 'siliconflow').includes('black-forest-labs/FLUX.1-dev'))
  assert.ok(modelsFor('video', 'openai').includes('sora'))
  assert.ok(modelsFor('tts', 'openai').includes('gpt-4o-mini-tts'))
  assert.ok(providerIds('image').includes('comfyui'))
  assert.ok(providerIds('storyboard_image').includes('comfyui'))
  assert.ok(providerIds('image').includes('openrouter'))
  assert.ok(providerIds('video').includes('runway'))
  assert.ok(providerIds('video').includes('luma'))
  assert.ok(providerIds('video').includes('minimax'))
  assert.ok(providerIds('tts').includes('siliconflow'))
  assert.ok(modelsFor('video', 'runway').includes('gen4_turbo'))
  assert.ok(modelsFor('video', 'luma').includes('ray-2'))
  assert.ok(modelsFor('tts', 'minimax').includes('speech-02-hd'))
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
  assert.equal(getBaseUrlForProvider('custom-provider', 'text'), '')

  assert.equal(getProviderProtocol('ollama', 'text'), 'openai')
  assert.equal(getBaseUrlForProvider('ollama', 'text'), 'http://127.0.0.1:11434/v1')
  assert.equal(getProviderProtocol('comfyui', 'image'), 'comfyui')
  assert.equal(getBaseUrlForProvider('comfyui', 'image'), 'http://127.0.0.1:8188')
  assert.equal(getProviderProtocol('openai', 'video'), 'sora')
  assert.equal(getProviderProtocol('minimax', 'video'), 'minimax')
  assert.deepEqual(getProviderEndpointDefaults('minimax', 'video'), {
    endpoint: '/video_generation',
    query_endpoint: '/query/video_generation/{taskId}',
  })
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
  assert.deepEqual(getProviderEndpointDefaults('ollama', 'text'), {
    endpoint: '/chat/completions',
    query_endpoint: '',
  })
  assert.deepEqual(getProviderEndpointDefaults('comfyui', 'storyboard_image'), {
    endpoint: '/prompt',
    query_endpoint: '/history/{promptId}',
  })
})

test('local presets allow keyless use while provider and model fields remain customizable', () => {
  assert.equal(isApiKeyOptionalProvider('ollama', 'openai'), true)
  assert.equal(isApiKeyOptionalProvider('lmstudio', 'openai'), true)
  assert.equal(isApiKeyOptionalProvider('vllm', 'openai'), true)
  assert.equal(isApiKeyOptionalProvider('comfyui', 'comfyui'), true)
  assert.equal(isApiKeyOptionalProvider('openai', 'openai'), false)
  assert.equal(CUSTOM_PROVIDER_SENTINEL, '__custom__')
  assert.equal(getBaseUrlForProvider('my-private-provider', 'text'), '')
  assert.deepEqual(modelsFor('image', 'comfyui'), ['custom-workflow'])
})

test('preset provider ids are unique within each service type', () => {
  for (const [serviceType, list] of Object.entries(providerConfigs)) {
    const ids = list.map((item) => item.id)
    assert.deepEqual(new Set(ids).size, ids.length, serviceType)
  }
})

test('every catalog preset has a Chinese label, models and a known Base URL', () => {
  const cjk = /[\u4e00-\u9fff]/
  for (const [serviceType, list] of Object.entries(providerConfigs)) {
    for (const item of list) {
      assert.match(item.name, cjk, `${serviceType}:${item.id}`)
      assert.ok(item.models.length > 0, `${serviceType}:${item.id}`)
      assert.notEqual(getBaseUrlForProvider(item.id, serviceType), '', `${serviceType}:${item.id}`)
    }
  }
  assert.equal(getBaseUrlForProvider('openrouter', 'text'), 'https://openrouter.ai/api/v1')
  assert.equal(getBaseUrlForProvider('siliconflow', 'image'), 'https://api.siliconflow.cn/v1')
  assert.equal(getBaseUrlForProvider('moonshot', 'text'), 'https://api.moonshot.cn/v1')
  assert.equal(getBaseUrlForProvider('deepseek', 'text'), 'https://api.deepseek.com')
  assert.equal(getBaseUrlForProvider('zhipu', 'text'), 'https://open.bigmodel.cn/api/paas/v4')
  assert.equal(getBaseUrlForProvider('minimax', 'video'), 'https://api.minimaxi.com/v1')
  assert.equal(getBaseUrlForProvider('kling', 'image'), 'https://api.klingai.com')
  assert.equal(getBaseUrlForProvider('runway', 'video'), 'https://api.dev.runwayml.com/v1')
  assert.equal(getBaseUrlForProvider('luma', 'video'), 'https://api.lumalabs.ai/dream-machine/v1')
  assert.equal(getProviderProtocol('runway', 'video'), 'openai')
  assert.equal(getProviderProtocol('luma', 'video'), 'openai')
  assert.equal(getProviderProtocol('minimax', 'text'), 'openai')
  assert.equal(getProviderProtocol('minimax', 'tts'), 'minimax')
})

test('new text vendors resolve public Base URL and openai protocol', () => {
  const textOnlyIds = [
    'azure_openai',
    'bedrock',
    'vertex',
    'cohere',
    'cerebras',
    'deepinfra',
    'github_models',
    'qianfan',
    'sensenova',
    'tiangong',
  ]
  for (const id of textOnlyIds) {
    assert.ok(providerIds('text').includes(id), id)
    assert.notEqual(getBaseUrlForProvider(id, 'text'), '', id)
    assert.equal(getProviderProtocol(id, 'text'), 'openai', id)
    assert.equal(providerIds('image').includes(id), false, `text id leaked into image: ${id}`)
    assert.equal(providerIds('video').includes(id), false, `text id leaked into video: ${id}`)
    assert.equal(providerIds('tts').includes(id), false, `text id leaked into tts: ${id}`)
  }

  assert.equal(getBaseUrlForProvider('azure_openai', 'text'), 'https://YOUR-RESOURCE-NAME.openai.azure.com/openai/v1')
  assert.equal(getBaseUrlForProvider('bedrock', 'text'), 'https://bedrock-runtime.us-east-1.amazonaws.com/openai/v1')
  assert.equal(getBaseUrlForProvider('vertex', 'text'), 'https://aiplatform.googleapis.com/v1/projects/YOUR-PROJECT/locations/global/endpoints/openapi')
  assert.equal(getBaseUrlForProvider('cohere', 'text'), 'https://api.cohere.ai/compatibility/v1')
  assert.equal(getBaseUrlForProvider('cerebras', 'text'), 'https://api.cerebras.ai/v1')
  assert.equal(getBaseUrlForProvider('deepinfra', 'text'), 'https://api.deepinfra.com/v1/openai')
  assert.equal(getBaseUrlForProvider('github_models', 'text'), 'https://models.github.ai/inference')
  assert.equal(getBaseUrlForProvider('qianfan', 'text'), 'https://qianfan.baidubce.com/v2')
  assert.equal(getBaseUrlForProvider('sensenova', 'text'), 'https://token.sensenova.cn/v1')
  assert.equal(getBaseUrlForProvider('tiangong', 'text'), 'https://api-maas.singularity-ai.com/sky-work/api/v1')
  assert.equal(providerIds('text').includes('bailian'), false)
  assert.equal(providerIds('text').includes('dashscope'), false)
})

test('image-only vendors keep native protocol and do not leak into text/video/tts', () => {
  for (const id of ['replicate', 'fal']) {
    assert.ok(providerIds('image').includes(id), id)
    assert.ok(providerIds('storyboard_image').includes(id), id)
    assert.notEqual(getBaseUrlForProvider(id, 'image'), '', id)
    assert.notEqual(getProviderProtocol(id, 'image'), 'openai', id)
    assert.equal(providerIds('text').includes(id), false, id)
    assert.equal(providerIds('video').includes(id), false, id)
    assert.equal(providerIds('tts').includes(id), false, id)
  }
  assert.equal(getBaseUrlForProvider('replicate', 'image'), 'https://api.replicate.com/v1')
  assert.equal(getBaseUrlForProvider('fal', 'image'), 'https://queue.fal.run')
  assert.equal(getProviderProtocol('replicate', 'image'), 'replicate')
  assert.equal(getProviderProtocol('fal', 'image'), 'fal')
  assert.ok(modelsFor('image', 'recraft').includes('recraftv4'))
  assert.ok(modelsFor('image', 'recraft').includes('recraftv3'))
  assert.ok(modelsFor('image', 'ideogram').includes('V_3_1'))
  assert.ok(modelsFor('image', 'ideogram').includes('V_3'))
  assert.ok(modelsFor('image', 'stability').includes('sd3.5-large-turbo'))
  assert.ok(modelsFor('image', 'stability').includes('stable-image-ultra'))
})

test('video and tts aliases update existing vendors without duplicating ids or marking native video as openai', () => {
  assert.deepEqual(providerIds('video').filter((id) => id === 'runway').length, 1)
  assert.deepEqual(providerIds('video').filter((id) => id === 'luma').length, 1)
  assert.deepEqual(providerIds('video').filter((id) => id === 'kling').length, 1)
  assert.deepEqual(providerIds('video').filter((id) => id === 'vidu').length, 1)
  assert.ok(modelsFor('video', 'runway').includes('gen4.5'))
  assert.ok(modelsFor('video', 'runway').includes('gen4_turbo'))
  assert.ok(modelsFor('video', 'luma').includes('ray-3.2'))
  assert.ok(modelsFor('video', 'luma').includes('ray-2'))
  assert.ok(modelsFor('video', 'kling').includes('kling-v3-omni'))
  assert.ok(modelsFor('video', 'kling').includes('kling-video'))
  assert.ok(modelsFor('video', 'vidu').includes('viduq3-pro'))
  assert.ok(modelsFor('video', 'vidu').includes('viduq2'))
  assert.equal(getProviderProtocol('kling', 'video'), 'kling')
  assert.equal(getProviderProtocol('vidu', 'video'), 'vidu')
  assert.equal(getProviderProtocol('runway', 'video'), 'openai')
  assert.equal(getProviderProtocol('luma', 'video'), 'openai')
  assert.ok(modelsFor('tts', 'elevenlabs').includes('eleven_v3'))
  assert.ok(modelsFor('tts', 'elevenlabs').includes('eleven_multilingual_v2'))
  assert.ok(modelsFor('text', 'zhipu').includes('glm-5.3'))
  assert.ok(modelsFor('text', 'zhipu').includes('glm-4.6'))
  assert.ok(modelsFor('text', 'qwen').includes('qwen3.8-max'))
  assert.ok(modelsFor('text', 'qwen').includes('qwen3-max'))
  assert.ok(modelsFor('text', 'deepseek').includes('deepseek-v4-flash'))
  assert.ok(modelsFor('text', 'gemini').includes('gemini-3.8-flash'))
  assert.ok(modelsFor('text', 'anthropic').includes('claude-sonnet-4-5'))
})

test('custom sentinel stays out of catalog so UI can append it last', () => {
  for (const [serviceType, list] of Object.entries(providerConfigs)) {
    assert.equal(list.some((item) => item.id === CUSTOM_PROVIDER_SENTINEL), false, serviceType)
    assert.notEqual(list.at(-1)?.id, CUSTOM_PROVIDER_SENTINEL, serviceType)
  }
  assert.equal(CUSTOM_PROVIDER_SENTINEL, '__custom__')
})


test('ocr and transcription presets stay OpenAI-compatible and do not leak into core media catalogs', () => {
  assert.ok(providerIds('ocr').includes('openai'))
  assert.ok(providerIds('ocr').includes('gemini'))
  assert.ok(providerIds('ocr').includes('qwen'))
  assert.ok(providerIds('ocr').includes('ollama'))
  assert.ok(providerIds('transcription').includes('openai'))
  assert.ok(providerIds('transcription').includes('groq'))
  assert.ok(providerIds('transcription').includes('qwen'))
  assert.ok(modelsFor('ocr', 'openai').includes('gpt-4o-mini'))
  assert.ok(modelsFor('transcription', 'openai').includes('whisper-1'))
  assert.ok(modelsFor('transcription', 'openai').includes('gpt-4o-mini-transcribe'))
  assert.ok(modelsFor('transcription', 'groq').includes('whisper-large-v3'))
  assert.equal(getProviderProtocol('gemini', 'ocr'), 'openai')
  assert.equal(getProviderProtocol('groq', 'transcription'), 'openai')
  assert.equal(getBaseUrlForProvider('gemini', 'ocr'), 'https://generativelanguage.googleapis.com/v1beta/openai')
  assert.deepEqual(getProviderEndpointDefaults('qwen', 'ocr'), {
    endpoint: '/chat/completions',
    query_endpoint: '',
  })
  assert.deepEqual(getProviderEndpointDefaults('openai', 'transcription'), {
    endpoint: '/audio/transcriptions',
    query_endpoint: '',
  })
  assert.equal(providerIds('ocr').includes('comfyui'), false)
  assert.equal(providerIds('transcription').includes('comfyui'), false)
})
