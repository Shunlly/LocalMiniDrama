import test from 'node:test'
import assert from 'node:assert/strict'

import {
  getServiceConfigReadiness,
  isModelOptionalServiceConfig,
} from '../src/utils/aiServiceReadiness.js'

test('ordinary configured services need a model', () => {
  const result = getServiceConfigReadiness({
    service_type: 'video',
    provider: 'openai',
    model: [],
    default_model: '',
  })
  assert.equal(result.ready, false)
  assert.equal(result.issue, 'missing_model')
})

test('ComfyUI image protocol is the explicit model-less exception only with a workflow', () => {
  const config = {
    service_type: 'storyboard_image',
    api_protocol: 'comfyui',
    model: [],
    default_model: '',
    settings: JSON.stringify({ workflow: { '1': { class_type: 'KSampler' } } }),
  }
  assert.equal(isModelOptionalServiceConfig(config), true)
  assert.equal(getServiceConfigReadiness(config).ready, true)
  const missingWorkflow = getServiceConfigReadiness({
    ...config,
    model: ['custom-workflow'],
    settings: '{}',
  })
  assert.equal(missingWorkflow.ready, false)
  assert.equal(missingWorkflow.issue, 'missing_workflow')
})

test('remote providers require configured credentials for production readiness', () => {
  const missing = getServiceConfigReadiness({
    service_type: 'video',
    provider: 'openai',
    model: ['sora-2'],
  })
  assert.equal(missing.ready, false)
  assert.equal(missing.issue, 'missing_credentials')

  const configured = getServiceConfigReadiness({
    service_type: 'video',
    provider: 'openai',
    model: ['sora-2'],
    credential_set: true,
  })
  assert.equal(configured.ready, true)
})

test('Ollama is an explicit no-key provider and masked values cannot spoof credentials', () => {
  assert.equal(getServiceConfigReadiness({
    service_type: 'text',
    provider: 'ollama',
    model: ['qwen3:8b'],
  }).ready, true)

  const spoofed = getServiceConfigReadiness({
    service_type: 'video',
    provider: 'klingai',
    api_protocol: 'kling_omni',
    model: ['kling-video-o1'],
    settings: JSON.stringify({ kling_access_key: '********', kling_secret_key: '********' }),
  })
  assert.equal(spoofed.ready, false)
  assert.equal(spoofed.issue, 'missing_credentials')
})
