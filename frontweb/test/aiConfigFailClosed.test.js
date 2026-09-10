import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../src/components/AIConfigContent.vue', import.meta.url), 'utf8')
const oneKeySource = readFileSync(new URL('../src/composables/useAiConfigOneKeyPresets.js', import.meta.url), 'utf8')
const importExportSource = readFileSync(new URL('../src/composables/useAiConfigImportExport.js', import.meta.url), 'utf8')
const listMutationsSource = readFileSync(new URL('../src/composables/useAiConfigRowMutations.js', import.meta.url), 'utf8')
const coverageCardSource = readFileSync(new URL('../src/components/aiConfig/AiConfigCoverageCard.vue', import.meta.url), 'utf8')
const sd2Source = readFileSync(new URL('../src/components/Sd2AssetManagement.vue', import.meta.url), 'utf8')

function openingButtonFor(clickHandler) {
  const marker = `@click="${clickHandler}"`
  const clickIndex = source.indexOf(marker)
  assert.notEqual(clickIndex, -1, `${clickHandler} button must exist`)
  const start = source.lastIndexOf('<el-button', clickIndex)
  assert.notEqual(start, -1, `${clickHandler} must be attached to an el-button`)
  return source.slice(start, source.indexOf('>', clickIndex) + 1)
}

const mutationHandlers = [
  'openAdd',
  'openAddForService',
  'onRowEdit',
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
  assert.match(
    source,
    /const configWriteLocked = computed\(\(\) => \(\s*configLoadState\.value !== 'ready'\s*\|\| !vendorLockResolved\.value[\s\S]*saving\.value[\s\S]*bulkKeySaving\.value[\s\S]*\)\)/,
  )
  assert.match(source, /v-if="configDependencyError"[\s\S]*@click="retryConfigDependencies"/)
  assert.match(source, /function isCoverageActionDisabled\(item, action\)/)
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
      /:title="configWriteLocked \? configWriteLockReason : undefined"/,
      `${clickHandler} must show a Chinese lock reason while configuration writes are locked`,
    )
  }

  for (const handler of mutationHandlers) {
    assert.match(
      source,
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
  assert.match(source, /@click="retryConfigDependencies"/)
  assert.match(source, /@select="onCoverageSelect"/)
  assert.match(coverageCardSource, /\$emit\('select', item\)/)
  assert.match(source, /@click="openTest\(row\)"/)
  assert.match(source, /@click="exportConfigs"/)
  assert.match(source, /<div v-else class="vendor-lock-bar">[\s\S]*?@click="exportConfigs"/)
  assert.match(importExportSource, /const exportData = configs\.map\(sanitizeConfigForExport\)/)
  assert.doesNotMatch(source, /async function openTest\(row\) \{\s*if \(configWriteLocked\.value\)/)
  assert.doesNotMatch(importExportSource, /async function exportConfigs\(\) \{\s*if \(configWriteLocked\.value\)/)
})

test('SD2 asset management receives the parent write lock and guards every mutation path', () => {
  assert.match(source, /<Sd2AssetManagement\s+:configs="list"\s+:write-locked="configWriteLocked \|\| vendorLock\.enabled"/)
  assert.match(sd2Source, /writeLocked:\s*\{\s*type:\s*Boolean/)
  assert.match(sd2Source, /const mutationLocked = computed\(\(\) => props\.writeLocked\)/)
  assert.match(sd2Source, /:disabled="mutationLocked"[\s\S]*保存到 AI 配置/)
  assert.match(sd2Source, /if \(mutationLocked\.value\) return/)
  assert.match(sd2Source, /function openCreateGroup\([\s\S]*mutationLocked\.value/)
  assert.match(sd2Source, /function openCreateAsset\([\s\S]*mutationLocked\.value/)
  assert.match(sd2Source, /async function deleteGroup\([\s\S]*mutationLocked\.value/)
  assert.match(sd2Source, /async function deleteAsset\([\s\S]*mutationLocked\.value/)
})

test('AI 配置写入锁定时可见按钮给出中文原因，隐藏文件选择器不显示 title', () => {
  assert.match(source, /const configWriteLockReason = computed\(\(\) => \{/)
  assert.match(source, /配置列表尚未就绪/)
  assert.match(source, /厂商锁定状态尚未解析/)
  assert.match(source, /正在保存配置，请稍候/)
  assert.match(source, /正在批量删除配置，请稍候/)
  assert.match(source, /正在一键配置，请稍候/)
  assert.match(source, /正在批量替换密钥，请稍候/)
  assert.doesNotMatch(source, /useAiConfigList/)
  assert.match(source, /title="素材库列表"/)
  assert.doesNotMatch(source, /status=active/)
  assert.match(source, /formatJimeng2AssetCreatedAt/)
  assert.match(source, /label="原始地址"/)
  assert.match(source, /async function loadList\(\)/)
  assert.match(source, /async function openTest\(row\)/)

  const lockedButtons = []
  const buttonTag = /<el-button\b[\s\S]*?>/g
  let match
  while ((match = buttonTag.exec(source))) {
    const tag = match[0]
    if (/:disabled="[^"]*configWriteLocked/.test(tag)) lockedButtons.push(tag)
  }
  assert.ok(lockedButtons.length >= 14, `expected locked visible buttons, got ${lockedButtons.length}`)
  for (const tag of lockedButtons) {
    assert.match(tag, /:title="configWriteLocked \? configWriteLockReason : undefined"/)
  }

  const hiddenInput = source.match(/<input ref="importFileRef"[^>]*>/)?.[0] || ''
  assert.match(hiddenInput, /:disabled="configWriteLocked"/)
  assert.doesNotMatch(hiddenInput, /:title=/)
})

