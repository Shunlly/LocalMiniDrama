import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const filmCreateSource = readFileSync(new URL('../src/views/FilmCreate.vue', import.meta.url), 'utf8')
const filmListSource = readFileSync(new URL('../src/views/FilmList.vue', import.meta.url), 'utf8')
const aiConfigSource = readFileSync(new URL('../src/components/AIConfigContent.vue', import.meta.url), 'utf8')
const themeSource = readFileSync(new URL('../src/styles/theme.css', import.meta.url), 'utf8')
const mainSource = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8')
const aiDialogHostSelector = ':is(.el-dialog.ai-config-workspace-dialog, .el-dialog:has(> .el-dialog__body > .ai-config-content))'

function sourceBetween(source, start, end) {
  const startIndex = source.indexOf(start)
  const endIndex = source.indexOf(end, startIndex + start.length)
  assert.ok(startIndex >= 0, `missing source boundary: ${start}`)
  assert.ok(endIndex > startIndex, `missing source boundary: ${end}`)
  return source.slice(startIndex, endIndex)
}

function cssRule(source, selector) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = source.match(new RegExp(`${escapedSelector}\\s*\\{([\\s\\S]*?)\\}`))
  assert.ok(match, `missing CSS rule: ${selector}`)
  return match[1]
}

test('FilmCreate keeps AI readiness in the pipeline instead of the page-level dependency warning', () => {
  assert.match(filmCreateSource, /:production-readiness-reason="productionReadinessReason"/)
  assert.match(filmCreateSource, /:production-readiness-state="productionReadinessState"/)
  assert.match(filmCreateSource, /@retry-readiness="refreshProductionReadiness"/)
  assert.match(filmCreateSource, /const productionReadinessState = computed\(\(\) => \{/)

  const dependencyRefresh = sourceBetween(
    filmCreateSource,
    'async function refreshProjectDependencies',
    'async function retryProjectDependencies',
  )
  assert.doesNotMatch(dependencyRefresh, /videoCapabilityResult/)
  assert.doesNotMatch(dependencyRefresh, /readinessResult/)
})

test('FilmCreate AI config dialog fixes its header and tabs around one content scroller', () => {
  assert.match(
    filmCreateSource,
    /<el-dialog\s+v-model="showAiConfigDialog"[^>]*top="5vh"[^>]*class="ai-config-workspace-dialog ai-config-overlay"/,
  )
  assert.doesNotMatch(aiConfigSource, /max-height:\s*calc\(100vh\s*-\s*320px\)/)
  assert.match(mainSource, /import ['"]\.\/styles\/theme\.css['"]/)

  const homeAiDialog = sourceBetween(
    filmListSource,
    '<el-dialog v-model="showAiConfigDialog"',
    '</el-dialog>',
  )
  assert.match(homeAiDialog, /<AIConfigContent v-if="showAiConfigDialog"\s*\/>/)
  assert.doesNotMatch(homeAiDialog, /ai-config-workspace-dialog/)

  const dialog = cssRule(themeSource, aiDialogHostSelector)
  assert.match(dialog, /margin-top:\s*5vh/)
  assert.match(dialog, /max-height:\s*90vh/)
  assert.match(dialog, /display:\s*flex/)
  assert.match(dialog, /flex-direction:\s*column/)
  assert.match(dialog, /overflow:\s*hidden/)

  const header = cssRule(themeSource, `${aiDialogHostSelector} > .el-dialog__header`)
  assert.match(header, /flex:\s*0 0 auto/)

  const body = cssRule(themeSource, `${aiDialogHostSelector} > .el-dialog__body`)
  assert.match(body, /flex:\s*1 1 auto/)
  assert.match(body, /display:\s*flex/)
  assert.match(body, /flex-direction:\s*column/)
  assert.match(body, /min-height:\s*0/)
  assert.match(body, /overflow:\s*hidden/)

  const tabsHeader = cssRule(themeSource, `${aiDialogHostSelector} .config-tabs > .el-tabs__header`)
  assert.match(tabsHeader, /flex:\s*0 0 auto/)

  const tabsContent = cssRule(themeSource, `${aiDialogHostSelector} .config-tabs > .el-tabs__content`)
  assert.match(tabsContent, /min-height:\s*0/)
  assert.match(tabsContent, /overflow:\s*hidden/)

  const tabContent = cssRule(themeSource, `${aiDialogHostSelector} .tab-content`)
  assert.match(tabContent, /height:\s*100%/)
  assert.match(tabContent, /max-height:\s*100%/)
  assert.match(tabContent, /overflow-y:\s*auto/)

  const workspaceScrollRules = [...themeSource.matchAll(
    /:is\(\.el-dialog\.ai-config-workspace-dialog,[^\{]*\{([\s\S]*?)\}/g,
  )].filter((match) => /overflow-y:\s*auto/.test(match[1]))
  assert.equal(workspaceScrollRules.length, 1)
})

test('AI coverage test actions are accessible secondary buttons with pending state', () => {
  const coverageAction = aiConfigSource.match(
    /<el-button\s+v-for="action in coverageActions\(item\)"[\s\S]*?<\/el-button>/,
  )?.[0]
  assert.ok(coverageAction, 'missing service coverage action button')
  assert.match(coverageAction, /:link="action\.action !== 'test'"/)
  assert.match(coverageAction, /:plain="action\.action === 'test'"/)
  assert.match(coverageAction, /:aria-label="action\.label"/)
  assert.match(coverageAction, /:loading="isCoverageActionTesting\(item, action\)"/)
  assert.match(coverageAction, /:disabled="isCoverageActionDisabled\(item, action\)"/)
  assert.match(coverageAction, /:aria-busy="isCoverageActionTesting\(item, action\)"/)

  assert.match(aiConfigSource, /const testingConfigId = ref\(null\)/)
  assert.match(aiConfigSource, /function isCoverageActionTesting\(item, action\)/)
  const actionDisabled = sourceBetween(
    aiConfigSource,
    'function isCoverageActionDisabled',
    'function isConfigRowSelectable',
  )
  assert.match(actionDisabled, /testingConfigId\.value !== null/)

  const openTest = sourceBetween(aiConfigSource, 'async function openTest', 'async function onDelete')
  assert.match(openTest, /if \(testingConfigId\.value !== null\) return/)
  assert.match(openTest, /testingConfigId\.value = row\.id/)
  assert.match(openTest, /finally\s*\{\s*testingConfigId\.value = null\s*\}/)
})
