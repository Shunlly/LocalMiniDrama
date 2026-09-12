import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const vueSource = readFileSync(new URL('../src/components/AIConfigContent.vue', import.meta.url), 'utf8').replace(/\r\n?/g, '\n')
const paneSource = readFileSync(new URL('../src/components/aiConfig/AiConfigGenerationSettingsPane.vue', import.meta.url), 'utf8').replace(/\r\n?/g, '\n')

test('生成设置面板是纯展示组件，loadList/openTest 仍留在页面', () => {
  assert.match(vueSource, /<el-tab-pane label="生成设置" name="generation">/)
  assert.match(vueSource, /<AiConfigGenerationSettingsPane/)
  assert.match(vueSource, /async function loadList\(\)/)
  assert.match(vueSource, /async function openTest\(row\)/)
  assert.doesNotMatch(paneSource, /async function loadList\(/)
  assert.doesNotMatch(paneSource, /async function openTest\(/)
  assert.doesNotMatch(paneSource, /useAiConfigList/)
  assert.doesNotMatch(paneSource, /aiAPI\./)
  assert.match(paneSource, /接口限流（请求过于频繁）/)
  assert.match(paneSource, /:disabled="generationSettingsWriteLocked"/)
  assert.match(paneSource, /:title="generationSettingsWriteLocked \? generationSettingsWriteLockReason : undefined"/)
  assert.match(paneSource, /:aria-label="genSettingSaving \? '正在保存生成设置' : \(generationSettingsWriteLocked \? \(generationSettingsWriteLockReason \|\| '当前不能保存生成设置'\) : '保存生成设置'\)"/)
  assert.match(paneSource, /aria-label="重试加载生成设置"[^>]*>重试加载生成设置<\/el-button>/)
})

test('生成设置保存成功展示中文反馈', () => {
  assert.match(paneSource, /title="保存成功"/)
  assert.match(paneSource, /生成并发设置已写入本地服务/)
  assert.doesNotMatch(paneSource, /title="已保存"/)
})

