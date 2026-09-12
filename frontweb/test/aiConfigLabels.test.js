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
  describeAiConfigSaveSuccess,
  describeAiConfigBulkKeySuccess,
  describeDisabledControlLabel,
} from '../src/utils/aiConfigLabels.js'
import { readAiConfigFormDialogTreeSource } from './helpers/aiConfigFormDialogSources.js'

const vueSource = readFileSync(new URL('../src/components/AIConfigContent.vue', import.meta.url), 'utf8')
const formDialogSource = readAiConfigFormDialogTreeSource()
const listTableSource = readFileSync(new URL('../src/components/aiConfig/AiConfigListTable.vue', import.meta.url), 'utf8')
const overlaySource = `${vueSource}\n${formDialogSource}\n${listTableSource}`

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
  assert.match(overlaySource, /configFieldDisplayLabel\(item\.label\)/)
  assert.match(overlaySource, /:aria-label="configActionLabel\('测试', row\)"/)
  assert.doesNotMatch(vueSource, /function serviceTypeLabel\(/)
  assert.doesNotMatch(vueSource, /function jimeng2AssetTypeLabel\(/)
})

test('保存成功给出中文下一步，批量换密钥不回传英文或密钥', () => {
  assert.equal(describeAiConfigSaveSuccess(true, 'text'), '已保存「文本」配置，可在列表中测试连接。')
  assert.equal(describeAiConfigSaveSuccess(false, 'text'), '已添加「文本」配置，可在列表中测试连接。')
  assert.equal(describeAiConfigSaveSuccess(false, 'ocr'), '已添加「图片识别 OCR」配置，可在列表中测试连接。')
  assert.match(describeAiConfigSaveSuccess(true, 'jimeng2_character_auth'), /角色面板验证认证资产/)
  assert.match(describeAiConfigSaveSuccess(false, 'model_ark_asset'), /认证资产管理标签页/)
  assert.equal(describeAiConfigSaveSuccess(true, 'unknown-vendor'), '已保存配置，可在列表中测试连接。')
  assert.equal(describeAiConfigBulkKeySuccess({ message: '已更新 3 条配置的密钥', updated: 3 }), '已更新 3 条配置的密钥')
  assert.equal(
    describeAiConfigBulkKeySuccess({ message: 'Updated API key sk-test-not-a-real-aaaaaa', updated: 2 }),
    '已更新 2 条配置的密钥',
  )
  assert.doesNotMatch(
    describeAiConfigBulkKeySuccess({ message: 'Bearer sess-fake-local-session-key', updated: 1 }),
    /sess-fake|Bearer/,
  )
})

test('禁用控件读屏名优先给出中文原因', () => {
  assert.equal(describeDisabledControlLabel('保存配置', {}), '保存配置')
  assert.equal(
    describeDisabledControlLabel('保存配置', {
      disabled: true,
      reason: '配置列表尚未就绪',
    }),
    '配置列表尚未就绪',
  )
  assert.equal(
    describeDisabledControlLabel('保存配置', {
      disabled: true,
      reason: '配置列表尚未就绪',
      loading: true,
      loadingLabel: '正在保存配置',
    }),
    '正在保存配置',
  )
})
