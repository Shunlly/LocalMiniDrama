import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { buildEndpointPreviewInfo } from '../src/utils/aiConfigEndpointPreview.js'

const vueSource = readFileSync(new URL('../src/components/AIConfigContent.vue', import.meta.url), 'utf8')

test('空表单不预览；即梦2认证会提示填写网关 URL', () => {
  assert.equal(buildEndpointPreviewInfo({}), null)
  const preview = buildEndpointPreviewInfo({ service_type: 'jimeng2_character_auth' })
  assert.equal(preview.isJimeng2Auth, true)
  assert.match(preview.submit, /请填写网关 URL/)
  assert.equal(preview.query, null)
  const filled = buildEndpointPreviewInfo({
    service_type: 'jimeng2_character_auth',
    base_url: 'https://gateway.example',
  })
  assert.equal(filled.submit, 'https://gateway.example/api/business/v1/assets')
  assert.equal(filled.query, 'https://gateway.example/api/business/v1/assets/{assetId}')
})

test('OCR 和语音转写会预览真实调用地址，未填接口时给出中文占位', () => {
  const ocr = buildEndpointPreviewInfo({
    service_type: 'ocr',
    provider: 'openai',
    api_protocol: 'openai',
  })
  assert.match(ocr.submit, /未填接口地址/)
  assert.match(ocr.submit, /\/chat\/completions/)
  const transcription = buildEndpointPreviewInfo({
    service_type: 'transcription',
    provider: 'openai',
    api_protocol: 'openai',
    base_url: 'https://api.openai.com/v1',
  })
  assert.equal(transcription.submit, 'https://api.openai.com/v1/audio/transcriptions')
  const agnes = buildEndpointPreviewInfo({
    service_type: 'video',
    provider: 'agnes',
    api_protocol: 'agnes',
    base_url: 'https://apihub.agnes-ai.com/v1',
  })
  assert.equal(agnes.submit, 'https://apihub.agnes-ai.com/v1/videos')
  assert.equal(agnes.query, 'https://apihub.agnes-ai.com/v1/videos/{taskId}')
})

test('页面仍展示预览框，loadList/openTest 留在页面', () => {
  assert.match(vueSource, /buildEndpointPreviewInfo\(form\.value\)/)
  assert.match(vueSource, /class="endpoint-preview-box"/)
  assert.match(vueSource, /async function loadList\(\)/)
  assert.match(vueSource, /async function openTest\(row\)/)
})
