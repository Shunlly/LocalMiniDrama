import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  CONNECTION_TEST_ENGLISH_RE,
  stripConnectionTestDecorations,
  pickConnectionTestTitle,
  describeConnectionTestError,
} from '../src/utils/aiConfigConnectionTest.js'

const vueSource = readFileSync(new URL('../src/components/AIConfigContent.vue', import.meta.url), 'utf8')

test('连接测试失败会去掉英文装饰并保留中文标题', () => {
  assert.equal(
    stripConnectionTestDecorations('连接测试失败：Provider 认证失败； response_bytes=2048'),
    '该厂商 认证失败',
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

test('openTest 仍留在页面并消费描述函数', () => {
  assert.match(vueSource, /async function openTest\(row\)/)
  assert.match(vueSource, /describeConnectionTestError\(e, controller\.signal, row\.service_type\)/)
  assert.doesNotMatch(vueSource, /function describeConnectionTestError\(/)
  assert.doesNotMatch(vueSource, /function stripConnectionTestDecorations\(/)
})
