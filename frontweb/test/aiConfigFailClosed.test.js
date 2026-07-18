import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../src/components/AIConfigContent.vue', import.meta.url), 'utf8')
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
  'openBulkKey',
  'submitBulkKey',
  'onDelete',
  'onBatchDelete',
  'openOneKeyTongyi',
  'submitOneKeyTongyi',
  'openOneKeyVolc',
  'submitOneKeyVolc',
  'openOneKeyAgnes',
  'submitOneKeyAgnes',
  'triggerImport',
  'importConfigs',
]

test('AI config writes fail closed until the list and vendor lock dependencies are ready', () => {
  assert.match(
    source,
    /const configWriteLocked = computed\(\(\) => \(\s*configLoadState\.value !== 'ready'\s*\|\| !vendorLockResolved\.value\s*\)\)/,
  )
  assert.match(source, /v-if="configDependencyError"[\s\S]*@click="retryConfigDependencies"/)
  assert.match(source, /function isCoverageActionDisabled\(item, action\)/)
  assert.match(source, /:disabled="isCoverageActionDisabled\(item, action\)"/)

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
    assert.match(
      openingButtonFor(clickHandler),
      /:disabled="[^"]*configWriteLocked/,
      `${clickHandler} must be visibly disabled while configuration writes are locked`,
    )
  }

  for (const handler of mutationHandlers) {
    assert.match(
      source,
      new RegExp(`(?:async )?function ${handler}\\([^)]*\\) \\{\\s*if \\(configWriteLocked\\.value\\)`),
      `${handler} must guard against programmatic writes while configuration dependencies are unavailable`,
    )
  }
})

test('retry, viewing, connection tests, and sanitized export remain available while writes are locked', () => {
  assert.match(source, /@click="retryConfigDependencies"/)
  assert.match(source, /@click="onCoverageSelect\(item\)"/)
  assert.match(source, /@click="openTest\(row\)"/)
  assert.match(source, /@click="exportConfigs"/)
  assert.match(source, /<div v-else class="vendor-lock-bar">[\s\S]*?@click="exportConfigs"/)
  assert.match(source, /const exportData = configs\.map\(sanitizeConfigForExport\)/)
  assert.doesNotMatch(source, /async function openTest\(row\) \{\s*if \(configWriteLocked\.value\)/)
  assert.doesNotMatch(source, /async function exportConfigs\(\) \{\s*if \(configWriteLocked\.value\)/)
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
