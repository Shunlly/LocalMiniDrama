import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  getBaseUrlForProvider,
  getProviderEndpointDefaults,
  getProviderProtocol,
  providerConfigs,
} from '../src/utils/aiProviderPresets.js'
import {
  AI_EXTRACTION_COVERAGE_DEFINITIONS,
  AI_SERVICE_COVERAGE_DEFINITIONS,
  buildAiServiceCoverage,
} from '../src/utils/aiConfigCoverage.js'

function readSource(url) {
  return readFileSync(url, 'utf8').replace(/\r\n?/g, '\n')
}

const vueSource = readSource(new URL('../src/components/AIConfigContent.vue', import.meta.url))
const pageSource = readSource(new URL('../src/views/AiConfig.vue', import.meta.url))
const coverageSource = readSource(new URL('../src/utils/aiConfigCoverage.js', import.meta.url))

function providerIds(serviceType) {
  return providerConfigs[serviceType].map((item) => item.id)
}

function modelsFor(serviceType, providerId) {
  return providerConfigs[serviceType].find((item) => item.id === providerId)?.models || []
}

function readyCoreConfigs() {
  return [
    { id: 1, service_type: 'text', provider: 'ollama', default_model: 'qwen3', is_active: true, is_default: true },
    { id: 2, service_type: 'image', provider: 'ollama', default_model: 'img', is_active: true, is_default: true },
    { id: 3, service_type: 'storyboard_image', provider: 'ollama', default_model: 'sb', is_active: true, is_default: true },
    { id: 4, service_type: 'video', provider: 'ollama', default_model: 'vid', is_active: true, is_default: true },
    { id: 5, service_type: 'tts', provider: 'ollama', default_model: 'voice', is_active: true, is_default: true },
  ]
}

test('ocr presets cover OpenAI-compatible vision, Qwen, Gemini and Ollama', () => {
  for (const id of ['openai', 'openai_compatible', 'gemini', 'qwen', 'ollama', 'openrouter', 'siliconflow']) {
    assert.ok(providerIds('ocr').includes(id), id)
  }
  assert.ok(modelsFor('ocr', 'openai').includes('gpt-4o-mini'))
  assert.ok(modelsFor('ocr', 'qwen').includes('qwen-vl-max'))
  assert.ok(modelsFor('ocr', 'gemini').includes('gemini-2.5-flash'))
  assert.ok(modelsFor('ocr', 'ollama').includes('qwen2.5vl'))
})

test('transcription presets cover OpenAI, Groq and Qwen', () => {
  for (const id of ['openai', 'openai_compatible', 'groq', 'qwen']) {
    assert.ok(providerIds('transcription').includes(id), id)
  }
  assert.ok(modelsFor('transcription', 'openai').includes('whisper-1'))
  assert.ok(modelsFor('transcription', 'openai').includes('gpt-4o-mini-transcribe'))
  assert.ok(modelsFor('transcription', 'groq').includes('whisper-large-v3'))
  assert.ok(modelsFor('transcription', 'qwen').includes('qwen3-asr-flash'))
})

test('ocr and transcription use OpenAI-compatible protocol, base URL and endpoints', () => {
  assert.equal(getProviderProtocol('gemini', 'ocr'), 'openai')
  assert.equal(getProviderProtocol('qwen', 'ocr'), 'openai')
  assert.equal(getProviderProtocol('ollama', 'ocr'), 'openai')
  assert.equal(getProviderProtocol('groq', 'transcription'), 'openai')
  assert.equal(getProviderProtocol('openai', 'transcription'), 'openai')
  assert.equal(getBaseUrlForProvider('gemini', 'ocr'), 'https://generativelanguage.googleapis.com/v1beta/openai')
  assert.equal(getBaseUrlForProvider('qwen', 'ocr'), 'https://dashscope.aliyuncs.com/compatible-mode/v1')
  assert.equal(getBaseUrlForProvider('qwen', 'transcription'), 'https://dashscope.aliyuncs.com/compatible-mode/v1')
  assert.equal(getBaseUrlForProvider('groq', 'transcription'), 'https://api.groq.com/openai/v1')
  assert.equal(getBaseUrlForProvider('ollama', 'ocr'), 'http://127.0.0.1:11434/v1')
  assert.deepEqual(getProviderEndpointDefaults('openai', 'ocr'), {
    endpoint: '/chat/completions',
    query_endpoint: '',
  })
  assert.deepEqual(getProviderEndpointDefaults('groq', 'transcription'), {
    endpoint: '/audio/transcriptions',
    query_endpoint: '',
  })
})

test('core production coverage stays five types and ignores missing extraction services', () => {
  assert.deepEqual(AI_SERVICE_COVERAGE_DEFINITIONS.map((item) => item.type), [
    'text',
    'image',
    'storyboard_image',
    'video',
    'tts',
  ])
  assert.deepEqual(AI_EXTRACTION_COVERAGE_DEFINITIONS.map((item) => item.type), [
    'ocr',
    'transcription',
  ])

  const coverage = buildAiServiceCoverage(readyCoreConfigs())
  assert.equal(coverage.totalCount, 5)
  assert.equal(coverage.readyCount, 5)
  assert.equal(coverage.ready, true)
  assert.equal(coverage.missingCount, 0)
  assert.equal(coverage.attentionCount, 0)
  assert.deepEqual(coverage.services.map((item) => item.type), AI_SERVICE_COVERAGE_DEFINITIONS.map((item) => item.type))
  assert.ok(!coverage.services.some((item) => item.type === 'ocr' || item.type === 'transcription'))
  assert.deepEqual(coverage.extractionServices.map((item) => item.type), ['ocr', 'transcription'])
  assert.ok(coverage.extractionServices.every((item) => item.state === 'missing'))
  assert.ok(coverage.extractionServices.every((item) => item.needsAttention))
})

test('configured extraction services do not change core production readiness', () => {
  const coverage = buildAiServiceCoverage([
    ...readyCoreConfigs(),
    { id: 8, service_type: 'ocr', provider: 'openai', default_model: 'gpt-4o-mini', is_active: true, is_default: true },
    { id: 9, service_type: 'transcription', is_active: false, is_default: false },
  ])
  assert.equal(coverage.ready, true)
  assert.equal(coverage.totalCount, 5)
  const byType = Object.fromEntries(coverage.extractionServices.map((item) => [item.type, item]))
  assert.equal(byType.ocr.state, 'default')
  assert.equal(byType.transcription.state, 'configured')
  assert.equal(byType.transcription.issue, 'inactive')
})

test('AI config form exposes OCR and transcription in Chinese without raw service type tokens', () => {
  assert.match(vueSource, /<el-option label="图片识别 OCR" value="ocr" \/>/)
  assert.match(vueSource, /<el-option label="语音转写" value="transcription" \/>/)
  assert.match(vueSource, /<b>图片识别 OCR<\/b>：用于 PDF、扫描件和图片抽文字。本机也可安装 Tesseract/)
  assert.match(vueSource, /<b>语音转写<\/b>：用于音频、视频对白转成文字/)
  assert.match(vueSource, /预设只用于填表，不代表已跑通该厂商/)
  assert.match(vueSource, /ocr: '图片识别 OCR'/)
  assert.match(vueSource, /transcription: '语音转写'/)
  assert.doesNotMatch(vueSource, /service_type=ocr/)
  assert.doesNotMatch(vueSource, /service_type=transcription/)
  assert.doesNotMatch(pageSource, /service_type=ocr/)
})

test('coverage panel keeps five production cards and adds an optional extraction section', () => {
  assert.match(vueSource, /const orderedCoverageServices = computed\(\(\) => sortAiServiceCoverage\(serviceCoverage\.value\.services\)\)/)
  assert.match(vueSource, /orderedExtractionCoverageServices/)
  assert.match(vueSource, /<h3 id="ai-extraction-coverage-title">素材抽取<\/h3>/)
  assert.match(vueSource, /缺省不会把正式制作标成未就绪/)
  assert.match(vueSource, /上方统计只看五类正式制作服务/)
  assert.match(vueSource, /图片识别和语音转写属于扩展能力，不计入上方五类基础生成服务/)
  assert.match(coverageSource, /extractionServices/)
  const coreBlock = coverageSource.slice(
    coverageSource.indexOf('AI_SERVICE_COVERAGE_DEFINITIONS'),
    coverageSource.indexOf('AI_EXTRACTION_COVERAGE_DEFINITIONS'),
  )
  assert.match(coreBlock, /type: 'tts'/)
  assert.doesNotMatch(coreBlock, /type: 'ocr'/)
  assert.doesNotMatch(coreBlock, /type: 'transcription'/)
})

test('connection tests stay in the page and remain available for OCR and transcription', () => {
  assert.match(vueSource, /async function loadList\(\)/)
  assert.match(vueSource, /async function openTest\(row\)/)
  assert.match(vueSource, /await aiAPI\.testConnection\(\{/)
  assert.doesNotMatch(vueSource, /from '@\/composables\/useAiConfigList/)
  assert.doesNotMatch(vueSource, /from '@\/composables\/useAiConfigConnection/)
  assert.match(
    vueSource,
    /async function openTest\(row\) \{\s*if \(row\.service_type === 'jimeng2_character_auth'\)/,
  )
  assert.doesNotMatch(
    vueSource,
    /async function openTest\(row\) \{[\s\S]{0,400}if \(row\.service_type === 'ocr'\)/,
  )
  assert.doesNotMatch(
    vueSource,
    /async function openTest\(row\) \{[\s\S]{0,400}if \(row\.service_type === 'transcription'\)/,
  )
  assert.match(vueSource, /图片识别接口已正常响应/)
  assert.match(vueSource, /语音转写接口已正常响应/)
  assert.match(vueSource, /图片识别用于 PDF\/图片抽文字/)
  assert.match(vueSource, /语音转写用于音频\/视频/)
  assert.match(vueSource, /hidesApiProtocolField\(form\.service_type\)/)
  assert.match(pageSource, /'ocr', 'transcription'/)
  assert.match(
    vueSource,
    /\['text', 'image', 'storyboard_image', 'video', 'tts'\]\.includes\(form\.service_type\)/,
  )
  assert.doesNotMatch(
    vueSource,
    /filterableServiceTypes\.has\(form\.service_type\)/,
  )
})
