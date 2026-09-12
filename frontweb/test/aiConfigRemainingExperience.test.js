import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { describeAiConfigSaveSuccess } from '../src/utils/aiConfigLabels.js'
import { readAiConfigFormDialogTreeSource } from './helpers/aiConfigFormDialogSources.js'

function readSource(url) {
  return readFileSync(url, 'utf8').replace(/\r\n?/g, '\n')
}

const vueSource = readSource(new URL('../src/components/AIConfigContent.vue', import.meta.url))
const pageSource = readSource(new URL('../src/views/AiConfig.vue', import.meta.url))
const coverageHeaderSource = readSource(new URL('../src/components/aiConfig/AiConfigCoverageHeader.vue', import.meta.url))
const coverageCardsSource = readSource(new URL('../src/components/aiConfig/AiConfigCoverageCards.vue', import.meta.url))
const coverageCardSource = readSource(new URL('../src/components/aiConfig/AiConfigCoverageCard.vue', import.meta.url))
const coveragePanelSource = readSource(new URL('../src/components/aiConfig/AiConfigCoveragePanel.vue', import.meta.url))
const listToolbarSource = readSource(new URL('../src/components/aiConfig/AiConfigListToolbar.vue', import.meta.url))
const listTableSource = readSource(new URL('../src/components/aiConfig/AiConfigListTable.vue', import.meta.url))
const configsPanelSource = readSource(new URL('../src/components/aiConfig/AiConfigConfigsPanel.vue', import.meta.url))
const oneKeyDialogSource = readSource(new URL('../src/components/aiConfig/AiConfigOneKeyDialogs.vue', import.meta.url))
const connectionDialogSource = readSource(new URL('../src/components/aiConfig/AiConfigConnectionTestDialog.vue', import.meta.url))
const formDialogSource = readAiConfigFormDialogTreeSource()
const accessibleDialogSource = readSource(new URL('../src/components/AccessibleDialog.vue', import.meta.url))
const themeSource = readSource(new URL('../src/styles/theme.css', import.meta.url))
const labelsSource = readSource(new URL('../src/utils/aiConfigLabels.js', import.meta.url))

function sourceBetween(source, startToken, endToken) {
  const start = source.indexOf(startToken)
  const end = source.indexOf(endToken, start + startToken.length)
  assert.ok(start >= 0 && end > start, `缺少片段 ${startToken}`)
  return source.slice(start, end)
}

test('覆盖矩阵、列表、一键配置和连接测试在 1024/769 不横向撑开', () => {
  assert.match(coverageHeaderSource, /@media \(max-width: 1024px\) \{[\s\S]*?\.coverage-header \{[\s\S]*?flex-direction: column;/)
  assert.match(coverageHeaderSource, /@media \(max-width: 769px\) \{[\s\S]*?\.coverage-summary-strip \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);/)
  assert.match(coverageHeaderSource, /\.coverage-header p \{[\s\S]*?overflow-wrap: anywhere;/)
  assert.match(coverageCardsSource, /@media \(max-width: 1024px\) \{[\s\S]*?\.coverage-grid,[\s\S]*?min-width: 0;/)
  assert.match(coverageCardsSource, /@media \(max-width: 769px\) \{[\s\S]*?\.coverage-grid,[\s\S]*?grid-template-columns: minmax\(0, 1fr\);/)
  assert.match(coverageCardSource, /\.coverage-actions \{[\s\S]*?flex-wrap: wrap;[\s\S]*?min-width: 0;/)
  assert.match(coveragePanelSource, /@media \(max-width: 1024px\) \{[\s\S]*?\.config-workspace-panel,[\s\S]*?\.coverage-panel \{[\s\S]*?min-width: 0;/)
  assert.match(coveragePanelSource, /@media \(max-width: 769px\) \{[\s\S]*?\.config-workspace-panel \{[\s\S]*?min-width: 0;/)

  assert.match(listToolbarSource, /@media \(max-width: 1024px\) \{[\s\S]*?\.content-actions,[\s\S]*?flex-wrap: wrap;/)
  assert.match(listToolbarSource, /@media \(max-width: 769px\) \{[\s\S]*?\.content-actions,[\s\S]*?flex-direction: column;/)
  assert.match(listTableSource, /\.config-row-actions \{[\s\S]*?flex-wrap: wrap;/)
  assert.match(listTableSource, /@media \(max-width: 1024px\) \{[\s\S]*?\.config-row-actions,[\s\S]*?max-width: 100%;/)
  assert.match(configsPanelSource, /\.config-list-section \{[\s\S]*?overflow-x: auto;/)
  assert.match(configsPanelSource, /@media \(max-width: 1024px\) \{[\s\S]*?\.config-list-section,[\s\S]*?min-width: 0;/)
  assert.match(configsPanelSource, /@media \(max-width: 769px\) \{[\s\S]*?\.config-workspace-panel \{[\s\S]*?min-width: 0;/)

  assert.match(oneKeyDialogSource, /\.one-key-list \{[\s\S]*?overflow-wrap: anywhere;/)
  assert.match(oneKeyDialogSource, /\.one-key-footer \{[\s\S]*?flex-wrap: wrap;/)
  assert.match(oneKeyDialogSource, /@media \(max-width: 1024px\) \{[\s\S]*?\.one-key-help,[\s\S]*?max-width: 100%;/)
  assert.match(oneKeyDialogSource, /@media \(max-width: 769px\) \{[\s\S]*?\.one-key-help,[\s\S]*?overflow-wrap: anywhere;/)
  assert.match(connectionDialogSource, /\.test-dialog-footer \{[\s\S]*?flex-wrap: wrap;/)
  assert.match(connectionDialogSource, /@media \(max-width: 1024px\) \{[\s\S]*?\.test-dialog-footer,[\s\S]*?max-width: 100%;/)
  assert.match(connectionDialogSource, /@media \(max-width: 769px\) \{[\s\S]*?\.test-dialog-footer,[\s\S]*?overflow-wrap: anywhere;/)
  assert.match(accessibleDialogSource, /@media \(max-width: 769px\) \{[\s\S]*?\.accessible-dialog\.el-dialog\.ai-config-overlay > \.el-dialog__body \{[\s\S]*?overflow-wrap: anywhere;/)
  assert.match(accessibleDialogSource, /@media \(max-width: 769px\) \{[\s\S]*?\.accessible-dialog\.el-dialog\.ai-config-overlay > \.el-dialog__footer \{[\s\S]*?flex-wrap: wrap;/)
  assert.match(pageSource, /@media \(max-width: 769px\) \{[\s\S]*?\.ai-config \{[\s\S]*?overflow-x: clip;/)
  assert.match(vueSource, /@media \(max-width: 1024px\) \{[\s\S]*?\.ai-config-content,[\s\S]*?min-width: 0;/)
  assert.match(themeSource, /\.tab-content \{[\s\S]*?overflow-x:\s*hidden;[\s\S]*?overflow-y:\s*auto;/)
})

test('剩余操作的读屏名包含可见文案，连接测试关闭名保持关闭连接测试', () => {
  assert.match(connectionDialogSource, /aria-label="关闭连接测试"/)
  assert.match(connectionDialogSource, />关闭<\/el-button>/)
  assert.doesNotMatch(connectionDialogSource, /aria-label="关闭"/)
  assert.match(connectionDialogSource, /:aria-label="testingConfigId !== null \? '正在重试连接' : '重试连接测试'"/)
  assert.match(connectionDialogSource, />重试<\/el-button>/)

  assert.match(listToolbarSource, /一键配置通义<span class="one-key-not-recommended">（不推荐）<\/span>/)
  assert.match(listToolbarSource, /:aria-label="configWriteLocked \? configWriteLockReason : '一键配置通义（不推荐）'"/)
  assert.match(listToolbarSource, /删除选中 \{\{ selectedRows.length \}\} 项配置/)
  assert.match(listToolbarSource, /删除选中 \$\{selectedRows.length\} 项配置/)
  assert.match(listTableSource, />查看全部配置<\/el-button>/)
  assert.match(listTableSource, /aria-label="清除当前服务筛选，查看全部配置"/)
  assert.match(listToolbarSource, />查看全部配置<\/el-button>/)

  assert.match(oneKeyDialogSource, /'确定，一键创建配置（通义）'/)
  assert.match(oneKeyDialogSource, /'确定，一键创建配置（火山）'/)
  assert.match(oneKeyDialogSource, /'确定，一键创建配置（Agnes）'/)
  assert.equal((oneKeyDialogSource.match(/>\s*确定，一键创建配置\s*<\/el-button>/g) || []).length, 3)
  assert.doesNotMatch(oneKeyDialogSource, /'确定，一键创建通义配置'/)
  assert.doesNotMatch(oneKeyDialogSource, /'确定，一键创建火山配置'/)
  assert.doesNotMatch(oneKeyDialogSource, /'确定，一键创建 Agnes 配置'/)
})

test('focused 表单仍用 API 密钥，添加文本配置成功提示保持不变', () => {
  assert.match(formDialogSource, /<span class="form-label-tip">API 密钥<\/span>/)
  assert.match(formDialogSource, /const apiKeyLabel = configFieldDisplayLabel\('API Key'\)/)
  assert.doesNotMatch(formDialogSource, />API Key</)
  assert.equal(describeAiConfigSaveSuccess(false, 'text'), '已添加「文本」配置，可在列表中测试连接。')
  assert.match(labelsSource, /return verb \+ '「' \+ label \+ '」配置，可在列表中测试连接。'/)
})

test('不抽取或改写 AIConfigContent 的 loadList / openTest', () => {
  const loadList = sourceBetween(vueSource, 'async function loadList() {', 'async function openTest(row) {')
  const openTest = sourceBetween(vueSource, 'async function openTest(row) {', 'onMounted(async () => {')
  assert.match(loadList, /aiAPI\.list\(/)
  assert.match(openTest, /aiAPI\.testConnection\(/)
  assert.match(vueSource, /async function loadList\(\)/)
  assert.match(vueSource, /async function openTest\(row\)/)
  assert.doesNotMatch(coveragePanelSource, /async function loadList\(/)
  assert.doesNotMatch(coveragePanelSource, /async function openTest\(/)
  assert.doesNotMatch(configsPanelSource, /async function loadList\(/)
  assert.doesNotMatch(configsPanelSource, /async function openTest\(/)
  assert.doesNotMatch(listTableSource, /async function openTest\(/)
  assert.doesNotMatch(oneKeyDialogSource, /async function loadList\(/)
  assert.doesNotMatch(connectionDialogSource, /async function openTest\(/)
})
