import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { readSd2AssetSources } from './helpers/sd2AssetSources.js'
import { readAiConfigFormDialogTreeSource } from './helpers/aiConfigFormDialogSources.js'

const source = readFileSync(new URL('../src/components/AIConfigContent.vue', import.meta.url), 'utf8')
const coverageComposableSource = readFileSync(new URL('../src/composables/useAiConfigCoverage.js', import.meta.url), 'utf8')
const oneKeySource = readFileSync(new URL('../src/composables/useAiConfigOneKeyPresets.js', import.meta.url), 'utf8')
const importExportSource = readFileSync(new URL('../src/composables/useAiConfigImportExport.js', import.meta.url), 'utf8')
const listMutationsSource = readFileSync(new URL('../src/composables/useAiConfigRowMutations.js', import.meta.url), 'utf8')
const coverageCardSource = readFileSync(new URL('../src/components/aiConfig/AiConfigCoverageCard.vue', import.meta.url), 'utf8')
const sd2Source = readSd2AssetSources().combined
const oneKeyDialogsSource = readFileSync(new URL('../src/components/aiConfig/AiConfigOneKeyDialogs.vue', import.meta.url), 'utf8')
const bulkKeyDialogSource = readFileSync(new URL('../src/components/aiConfig/AiConfigBulkKeyDialog.vue', import.meta.url), 'utf8')
const connectionTestDialogSource = readFileSync(new URL('../src/components/aiConfig/AiConfigConnectionTestDialog.vue', import.meta.url), 'utf8')
const jimeng2AssetsDialogSource = readFileSync(new URL('../src/components/aiConfig/AiConfigJimeng2AssetsDialog.vue', import.meta.url), 'utf8')
const formDialogSource = readAiConfigFormDialogTreeSource()
const dependencyErrorBarSource = readFileSync(new URL('../src/components/aiConfig/AiConfigDependencyErrorBar.vue', import.meta.url), 'utf8')
const listToolbarSource = readFileSync(new URL('../src/components/aiConfig/AiConfigListToolbar.vue', import.meta.url), 'utf8')
const listTableSource = readFileSync(new URL('../src/components/aiConfig/AiConfigListTable.vue', import.meta.url), 'utf8')
const workspaceSwitchSource = readFileSync(new URL('../src/components/aiConfig/AiConfigWorkspaceSwitch.vue', import.meta.url), 'utf8')
const coverageHeaderSource = readFileSync(new URL('../src/components/aiConfig/AiConfigCoverageHeader.vue', import.meta.url), 'utf8')
const coveragePanelSource = readFileSync(new URL('../src/components/aiConfig/AiConfigCoveragePanel.vue', import.meta.url), 'utf8')
const configsPanelSource = readFileSync(new URL('../src/components/aiConfig/AiConfigConfigsPanel.vue', import.meta.url), 'utf8')
const writeLockSource = readFileSync(new URL('../src/composables/useAiConfigWriteLock.js', import.meta.url), 'utf8')
const formActionsSource = readFileSync(new URL('../src/composables/useAiConfigFormActions.js', import.meta.url), 'utf8')
const writeSurfaceSources = [
  source,
  formDialogSource,
  oneKeyDialogsSource,
  bulkKeyDialogSource,
  connectionTestDialogSource,
  jimeng2AssetsDialogSource,
  dependencyErrorBarSource,
  listToolbarSource,
  listTableSource,
  workspaceSwitchSource,
  coverageHeaderSource,
  coveragePanelSource,
  configsPanelSource,
]
const writeSurfaceSource = writeSurfaceSources.join('\n')

function openingButtonFor(clickHandler) {
  const marker = `@click="${clickHandler}"`
  for (const haystack of writeSurfaceSources) {
    const clickIndex = haystack.indexOf(marker)
    if (clickIndex === -1) continue
    const start = haystack.lastIndexOf('<el-button', clickIndex)
    assert.notEqual(start, -1, `${clickHandler} must be attached to an el-button`)
    return haystack.slice(start, haystack.indexOf('>', clickIndex) + 1)
  }
  assert.fail(`${clickHandler} button must exist`)
}

// 所有 configWriteLocked 按钮 title 形态：写锁原因优先，一键配置空密钥才回落「请先填写密钥」
const CONFIG_WRITE_LOCKED_TITLE_MORPHOLOGY = /:title="configWriteLocked \? configWriteLockReason : (?:undefined|\(!\w+\.trim\(\) \? '请先填写密钥' : undefined\))"/

const pageMutationHandlers = [
  'onRowEdit',
]
const formActionMutationHandlers = [
  'openAdd',
  'openAddForService',
  'openEdit',
  'submit',
]
const listMutationHandlers = [
  'openBulkKey',
  'submitBulkKey',
  'onDelete',
  'onBatchDelete',
]
const importExportMutationHandlers = [
  'triggerImport',
  'importConfigs',
]
const oneKeyMutationHandlers = [
  'openOneKeyTongyi',
  'submitOneKeyTongyi',
  'openOneKeyVolc',
  'submitOneKeyVolc',
  'openOneKeyAgnes',
  'submitOneKeyAgnes',
]

test('AI config writes fail closed until the list and vendor lock dependencies are ready', () => {
  assert.match(source, /useAiConfigWriteLock\(/)
  assert.match(
    writeLockSource,
    /const configWriteLocked = computed\(\(\) => \(\s*configLoadState\.value !== 'ready'\s*\|\| !vendorLockResolved\.value[\s\S]*saving\.value[\s\S]*bulkKeySaving\.value[\s\S]*\)\)/,
  )
  assert.match(writeSurfaceSource, /v-if="configDependencyError"[\s\S]*@click="retryConfigDependencies"/)
  assert.match(source, /isCoverageActionDisabled,/)
  assert.match(coverageComposableSource, /function isCoverageActionDisabled\(item, action\)/)
  assert.match(source, /:is-coverage-action-disabled="isCoverageActionDisabled"/)
  assert.match(coverageCardSource, /:disabled="isCoverageActionDisabled\(item, action\)"/)

  const disabledMutationBindings = [
    'openAdd',
    'triggerImport',
    'openOneKeyVolc',
    'openOneKeyAgnes',
    'openOneKeyTongyi',
    'onBatchDelete',
    'openBulkKey',
    'onRowEdit(row)',
    'onDelete(row)',
    "openAddForService(activeServiceFilter || 'text')",
    'submit',
    'submitOneKeyTongyi',
    'submitOneKeyVolc',
    'submitOneKeyAgnes',
    'submitBulkKey',
  ]
  for (const clickHandler of disabledMutationBindings) {
    const opening = openingButtonFor(clickHandler)
    assert.match(
      opening,
      /:disabled="[^"]*configWriteLocked/,
      `${clickHandler} must be visibly disabled while configuration writes are locked`,
    )
    assert.match(
      opening,
      CONFIG_WRITE_LOCKED_TITLE_MORPHOLOGY,
      `${clickHandler} 必须保持写锁优先的 title 形态`,
    )
  }

  for (const handler of pageMutationHandlers) {
    assert.match(
      source,
      new RegExp(`(?:async )?function ${handler}\\([^)]*\\) \\{\\s*if \\(configWriteLocked\\.value\\)`),
      `${handler} must guard against programmatic writes while configuration dependencies are unavailable`,
    )
  }
  for (const handler of formActionMutationHandlers) {
    assert.match(
      formActionsSource,
      new RegExp(`(?:async )?function ${handler}\\([^)]*\\) \\{\\s*if \\(configWriteLocked\\.value\\)`),
      `${handler} must guard against programmatic writes while configuration dependencies are unavailable`,
    )
  }
  for (const handler of oneKeyMutationHandlers) {
    assert.match(
      oneKeySource,
      new RegExp(`(?:async )?function ${handler}\\([^)]*\\) \\{\\s*if \\(configWriteLocked\\.value\\)`),
      `${handler} must guard against programmatic writes while configuration dependencies are unavailable`,
    )
  }
  for (const handler of importExportMutationHandlers) {
    assert.match(
      importExportSource,
      new RegExp(`(?:async )?function ${handler}\\([^)]*\\) \\{\\s*if \\(configWriteLocked\\.value\\)`),
      `${handler} must guard against programmatic writes while configuration dependencies are unavailable`,
    )
  }
  for (const handler of listMutationHandlers) {
    assert.match(
      listMutationsSource,
      new RegExp(`(?:async )?function ${handler}\\([^)]*\\) \\{\\s*if \\(configWriteLocked\\.value\\)`),
      `${handler} must guard against programmatic writes while configuration dependencies are unavailable`,
    )
  }
})

test('retry, viewing, connection tests, and sanitized export remain available while writes are locked', () => {
  assert.match(writeSurfaceSource, /@click="retryConfigDependencies"/)
  assert.match(coverageHeaderSource, /@click="retryConfigDependencies"/)
  assert.doesNotMatch(coverageHeaderSource, /configWriteLocked/)
  assert.doesNotMatch(workspaceSwitchSource, /configWriteLocked/)
  assert.match(source, /@select="onCoverageSelect"/)
  assert.match(coverageCardSource, /\$emit\('select', item\)/)
  assert.match(writeSurfaceSource, /@click="openTest\(row\)"/)
  assert.match(writeSurfaceSource, /@click="exportConfigs"/)
  assert.match(writeSurfaceSource, /<div v-else class="vendor-lock-bar">[\s\S]*?@click="exportConfigs"/)
  assert.match(importExportSource, /const exportData = configs\.map\(sanitizeConfigForExport\)/)
  assert.doesNotMatch(source, /async function openTest\(row\) \{\s*if \(configWriteLocked\.value\)/)
  assert.doesNotMatch(importExportSource, /async function exportConfigs\(\) \{\s*if \(configWriteLocked\.value\)/)
})

test('SD2 asset management receives the parent write lock and guards every mutation path', () => {
  assert.match(source, /<Sd2AssetManagement\s+:configs="list"\s+:write-locked="configWriteLocked \|\| vendorLock\.enabled"/)
  assert.match(sd2Source, /writeLocked:\s*\{\s*type:\s*Boolean/)
  assert.match(sd2Source, /const mutationLocked = computed\(\(\) => props\.writeLocked\)/)
  assert.match(sd2Source, /:disabled="mutationLocked"/)
  assert.match(sd2Source, /:disabled="Boolean\(saveLockReason\)"[\s\S]*保存到 AI 配置/)
  assert.match(sd2Source, /if \(mutationLocked\.value\) return/)
  assert.match(sd2Source, /function openCreateGroup\([\s\S]*mutationLocked\.value/)
  assert.match(sd2Source, /function openCreateAsset\([\s\S]*mutationLocked\.value/)
  assert.match(sd2Source, /async function deleteGroup\([\s\S]*mutationLocked\.value/)
  assert.match(sd2Source, /async function deleteAsset\([\s\S]*mutationLocked\.value/)
})

test('AI 配置写入锁定时可见按钮给出中文原因，隐藏文件选择器不显示 title', () => {
  assert.match(source, /useAiConfigWriteLock\(/)
  assert.match(writeLockSource, /const configWriteLockReason = computed\(\(\) => \{/)
  assert.match(writeLockSource, /配置列表尚未就绪/)
  assert.match(writeLockSource, /厂商锁定状态尚未解析/)
  assert.match(writeLockSource, /正在保存配置，请稍候/)
  assert.match(writeLockSource, /正在批量删除配置，请稍候/)
  assert.match(writeLockSource, /正在一键配置，请稍候/)
  assert.match(writeLockSource, /正在批量替换密钥，请稍候/)
  assert.doesNotMatch(source, /useAiConfigList/)
  assert.doesNotMatch(writeSurfaceSource, /useAiConfigList/)
  assert.doesNotMatch(workspaceSwitchSource, /async function loadList\(/)
  assert.doesNotMatch(coverageHeaderSource, /async function openTest\(/)
  assert.match(jimeng2AssetsDialogSource, /title="素材库列表"/)
  assert.doesNotMatch(writeSurfaceSource, /status=active/)
  assert.match(writeSurfaceSource, /formatJimeng2AssetCreatedAt/)
  assert.match(jimeng2AssetsDialogSource, /label="原始地址"/)
  assert.match(source, /async function loadList\(\)/)
  assert.match(source, /async function openTest\(row\)/)
  assert.match(source, /<AiConfigOneKeyDialogs/)
  assert.match(source, /<AiConfigBulkKeyDialog/)
  assert.match(source, /<AiConfigConnectionTestDialog/)
  assert.match(source, /<AiConfigJimeng2AssetsDialog/)
  assert.match(source, /<AiConfigConfigsPanel/)
  assert.match(configsPanelSource, /<AiConfigListTable/)

  const lockedButtons = []
  let searchFrom = 0
  while (searchFrom < writeSurfaceSource.length) {
    const start = writeSurfaceSource.indexOf('<el-button', searchFrom)
    if (start === -1) break
    let quote = ''
    let end = -1
    for (let i = start; i < writeSurfaceSource.length; i += 1) {
      const ch = writeSurfaceSource[i]
      if (quote) {
        if (ch === quote) quote = ''
        continue
      }
      if (ch === '"' || ch === "'") {
        quote = ch
        continue
      }
      if (ch === '>') {
        end = i
        break
      }
    }
    if (end === -1) break
    const tag = writeSurfaceSource.slice(start, end + 1)
    if (/:disabled="[^"]*configWriteLocked/.test(tag)) lockedButtons.push(tag)
    searchFrom = end + 1
  }
  assert.ok(lockedButtons.length >= 15, `expected locked visible buttons, got ${lockedButtons.length}`)
  // 所有 configWriteLocked 按钮 title 形态
  for (const tag of lockedButtons) {
    assert.match(tag, CONFIG_WRITE_LOCKED_TITLE_MORPHOLOGY)
  }
  for (const key of ['oneKeyTongyiKey', 'oneKeyVolcKey', 'oneKeyAgnesKey', 'bulkKeyInput']) {
    assert.match(
      writeSurfaceSource,
      new RegExp(`:title="configWriteLocked \\? configWriteLockReason : \\(!${key}\\.trim\\(\\) \\? '请先填写密钥' : undefined\\)"`),
    )
  }

  const hiddenInput = writeSurfaceSource.match(/<input[^>]*type="file"[^>]*>/)?.[0] || ''
  assert.match(hiddenInput, /:disabled="configWriteLocked"/)
  assert.doesNotMatch(hiddenInput, /:title=/)
})

