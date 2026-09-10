import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { CUSTOM_PROVIDER_SENTINEL } from '../src/utils/aiProviderPresets.js'
import {
  buildAvailableProviderOptions,
  buildAvailableModels,
  providerModelEmptyHint,
  describeConfigEditTarget,
} from '../src/utils/aiConfigProviderOptions.js'

const vueSource = readFileSync(new URL('../src/components/AIConfigContent.vue', import.meta.url), 'utf8')

test('编辑未知厂商时保留当前项，并始终提供自定义入口', () => {
  const options = buildAvailableProviderOptions('text', 'my-private-llm', { editingId: 9 })
  assert.equal(options[0].id, 'my-private-llm')
  assert.match(options[0].name, /当前/)
  assert.equal(options[options.length - 1].id, CUSTOM_PROVIDER_SENTINEL)
  assert.match(options[options.length - 1].name, /自定义/)
})

test('没有厂商或没有预设模型时给出可输入的中文提示', () => {
  assert.equal(providerModelEmptyHint('text', ''), '请先选择厂商，或直接输入模型名。')
  assert.equal(providerModelEmptyHint('text', 'unknown-vendor', []), '当前厂商没有预设模型，可直接输入模型名。')
  assert.equal(providerModelEmptyHint('jimeng2_character_auth', ''), '')
  assert.ok(buildAvailableModels('video', 'agnes').includes('agnes-video-v2.0'))
})

test('认证资产库编辑会跳到资产管理标签，而不是普通配置表单', () => {
  assert.deepEqual(describeConfigEditTarget({ service_type: 'model_ark_asset' }), {
    tab: 'sd2_assets',
    message: '请在「认证资产管理」标签页编辑此配置',
  })
  assert.deepEqual(describeConfigEditTarget({ service_type: 'video' }), { openEdit: true })
  assert.match(vueSource, /function onRowEdit\(row\)/)
  assert.match(vueSource, /describeConfigEditTarget\(row\)/)
  assert.match(vueSource, /async function loadList\(\)/)
  assert.match(vueSource, /async function openTest\(row\)/)
})
