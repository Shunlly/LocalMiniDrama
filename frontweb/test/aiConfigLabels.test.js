import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  hidesApiProtocolField,
  serviceTypeLabel,
  configFieldDisplayLabel,
  jimeng2AssetTypeLabel,
  jimeng2AssetStatusLabel,
  configActionLabel,
} from '../src/utils/aiConfigLabels.js'

const vueSource = readFileSync(new URL('../src/components/AIConfigContent.vue', import.meta.url), 'utf8')

test('AI 配置把英文技术字段和资产状态收成中文', () => {
  assert.equal(serviceTypeLabel('ocr'), '图片识别 OCR')
  assert.equal(serviceTypeLabel('transcription'), '语音转写')
  assert.equal(serviceTypeLabel('model_ark_asset'), '认证资产库')
  assert.equal(configFieldDisplayLabel('API Key'), 'API 密钥')
  assert.equal(configFieldDisplayLabel('Base URL'), '接口地址（Base URL）')
  assert.equal(jimeng2AssetTypeLabel('Image'), '图片')
  assert.equal(jimeng2AssetTypeLabel('video'), '视频')
  assert.equal(jimeng2AssetTypeLabel(''), '—')
  assert.equal(jimeng2AssetStatusLabel('active'), '可用')
  assert.equal(jimeng2AssetStatusLabel('pending'), '处理中')
  assert.equal(configActionLabel('测试', { name: '火山视频' }), '测试「火山视频」')
  assert.equal(configActionLabel('删除', {}), '删除「未命名配置」')
  assert.equal(hidesApiProtocolField('ocr'), true)
  assert.equal(hidesApiProtocolField('image'), false)
})

test('页面仍消费标签函数，不把 loadList/openTest 抽走', () => {
  assert.match(vueSource, /async function loadList\(\)/)
  assert.match(vueSource, /async function openTest\(row\)/)
  assert.match(vueSource, /configFieldDisplayLabel\(item\.label\)/)
  assert.match(vueSource, /:aria-label="configActionLabel\('测试', row\)"/)
  assert.doesNotMatch(vueSource, /function serviceTypeLabel\(/)
  assert.doesNotMatch(vueSource, /function jimeng2AssetTypeLabel\(/)
})
