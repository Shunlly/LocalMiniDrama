import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  CONNECTION_TEST_ENGLISH_RE,
  stripConnectionTestDecorations,
  pickConnectionTestTitle,
  describeConnectionTestError,
  connectionTestTextLeaksSecret,
} from '../src/utils/aiConfigConnectionTest.js'

const vueSource = readFileSync(new URL('../src/components/AIConfigContent.vue', import.meta.url), 'utf8')

test('连接测试失败会去掉英文装饰并保留中文标题', () => {
  assert.equal(
    stripConnectionTestDecorations('连接测试失败：Provider 认证失败； response_bytes=2048'),
    '该厂商认证失败',
  )
  assert.equal(
    pickConnectionTestTitle('AI 配置服务：认证失败'),
    '认证失败',
  )
  assert.equal(CONNECTION_TEST_ENGLISH_RE.test('Network Error'), true)
  assert.equal(CONNECTION_TEST_ENGLISH_RE.test('认证失败'), false)
  assert.equal(
    pickConnectionTestTitle('AI 配置服务：Network Error'),
    'AI 配置服务：Network Error',
  )
})

test('超时、取消和模型目录失败给出可执行中文说明', () => {
  const timeout = describeConnectionTestError(Object.assign(new Error('timeout of 30000ms exceeded'), {
    code: 'ECONNABORTED',
  }), undefined, 'text')
  assert.equal(timeout.title, '连接测试超时')
  assert.match(timeout.detail, /手工填写模型名/)

  const abortSignal = { aborted: true }
  const cancelled = describeConnectionTestError(Object.assign(new Error('canceled'), {
    name: 'CanceledError',
    code: 'ERR_CANCELED',
  }), abortSignal, 'text')
  assert.equal(cancelled.title, '连接测试已取消')

  const probe = describeConnectionTestError(new Error('ollama 模型列表不可用 /v1/models'), undefined, 'text')
  assert.equal(probe.title, '无法读取模型列表')

  const ocr = describeConnectionTestError(new Error('暂时无法完成连接测试，请稍后重试。'), undefined, 'ocr')
  assert.match(ocr.detail, /图片识别用于 PDF\/图片抽文字/)

  const transcription = describeConnectionTestError(new Error('暂时无法完成连接测试，请稍后重试。'), undefined, 'transcription')
  assert.match(transcription.detail, /语音转写用于音频\/视频/)
})

test('英文网络原文不会进入连接测试标题', () => {
  const cases = [
    Object.assign(new Error('fetch failed'), { code: 'ECONNREFUSED' }),
    Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:443'), { code: 'ECONNREFUSED' }),
    new Error('socket hang up'),
    new Error('AI 配置服务：socket hang up'),
    Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' }),
  ]
  for (const error of cases) {
    const described = describeConnectionTestError(error, undefined, 'text')
    assert.match(described.title, /[\u4e00-\u9fff]/)
    assert.doesNotMatch(described.title, /fetch failed|ECONNREFUSED|socket hang up|aborted|127\.0\.0\.1/i)
    assert.doesNotMatch(described.detail, /fetch failed|ECONNREFUSED|socket hang up|aborted|127\.0\.0\.1/i)
  }
})

test('openTest 仍留在页面并消费描述函数', () => {
  assert.match(vueSource, /async function openTest\(row\)/)
  assert.match(vueSource, /describeConnectionTestError\(e, controller\.signal, row\.service_type\)/)
  assert.doesNotMatch(vueSource, /function describeConnectionTestError\(/)
  assert.doesNotMatch(vueSource, /function stripConnectionTestDecorations\(/)
})

test('假密钥和英文原文不会进入连接测试标题或详情', () => {
  const fakeKey = 'sk-test-not-a-real-aaaaaa'
  const session = 'sess-fake-local-session-key'
  const cases = [
    new Error('认证失败 ' + fakeKey),
    new Error('认证失败 Authorization: Bearer ' + session),
    new Error('Incorrect API key provided: ' + fakeKey),
    { response: { data: { error: { message: '认证失败，API Key: ' + fakeKey } } } },
  ]
  for (const error of cases) {
    const described = describeConnectionTestError(error, undefined, 'text')
    assert.match(described.title, /[\u4e00-\u9fff]/)
    assert.match(described.detail, /[\u4e00-\u9fff]/)
    assert.equal(connectionTestTextLeaksSecret(described.title), false)
    assert.equal(connectionTestTextLeaksSecret(described.detail), false)
    assert.doesNotMatch(described.title, /sk-test-not-a-real|sess-fake|Bearer /)
    assert.doesNotMatch(described.detail, /sk-test-not-a-real|sess-fake|Bearer /)
  }
})

test('HTTP 状态给出中文连接失败原因', () => {
  const unauthorized = describeConnectionTestError(Object.assign(new Error('Request failed with status code 401'), {
    response: { status: 401 },
    status: 401,
  }), undefined, 'text')
  assert.equal(unauthorized.title, '认证失败')
  assert.match(unauthorized.detail, /API 密钥/)

  const missing = describeConnectionTestError(Object.assign(new Error('Request failed with status code 404'), {
    response: { status: 404 },
    status: 404,
  }), undefined, 'text')
  assert.equal(missing.title, '找不到该服务地址')

  const busy = describeConnectionTestError(Object.assign(new Error('Request failed with status code 429'), {
    response: { status: 429 },
    status: 429,
  }), undefined, 'text')
  assert.equal(busy.title, '请求过于频繁')

  const down = describeConnectionTestError(Object.assign(new Error('Request failed with status code 502'), {
    response: { status: 502 },
    status: 502,
  }), undefined, 'text')
  assert.equal(down.title, '服务暂时不可用')

  const gateway = describeConnectionTestError(Object.assign(new Error('Request failed with status code 502'), {
    response: { status: 502, data: { error: { message: '网关拒绝连接' } } },
    status: 502,
  }), undefined, 'text')
  assert.equal(gateway.title, '网关拒绝连接')
})
