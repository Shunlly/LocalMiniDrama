import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const filmCreateSource = readFileSync(new URL('../src/views/FilmCreate.vue', import.meta.url), 'utf8')
const filmListSource = readFileSync(new URL('../src/views/FilmList.vue', import.meta.url), 'utf8')
const aiConfigSource = readFileSync(new URL('../src/components/AIConfigContent.vue', import.meta.url), 'utf8')
const pipelinePanelSource = readFileSync(new URL('../src/components/filmCreate/FilmCreatePipelinePanel.vue', import.meta.url), 'utf8')
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

test('FilmCreate readiness refreshes use independent latest-request generation guards', () => {
  assert.match(filmCreateSource, /import \{ createLatestRequestGuard \} from '@\/utils\/latestRequest\.js'/)
  assert.match(filmCreateSource, /const productionReadinessRequestGuard = createLatestRequestGuard\(\)/)
  assert.match(filmCreateSource, /const videoCapabilityRequestGuard = createLatestRequestGuard\(\)/)

  const productionRefresh = sourceBetween(
    filmCreateSource,
    'async function refreshProductionReadiness',
    'async function refreshVideoGenerationCapability',
  )
  assert.equal((productionRefresh.match(/productionReadinessRequestGuard\.begin\(\)/g) || []).length, 1)
  assert.equal((productionRefresh.match(/productionReadinessRequestGuard\.commit\(/g) || []).length, 4)
  assert.match(productionRefresh, /productionReadinessRequestGuard\.commit\(requestGeneration, \(\) => \{\s*productionReadinessLoading\.value = true\s*productionReadinessFailed\.value = false\s*authoritativeProductionReadiness\.value = null\s*\}\)/)
  assert.match(productionRefresh, /productionReadinessRequestGuard\.commit\(requestGeneration, \(\) => \{\s*authoritativeProductionReadiness\.value = normalizeProductionReadiness\(readiness\)\s*\}\)/)
  assert.match(productionRefresh, /catch \(_\) \{\s*productionReadinessRequestGuard\.commit\(requestGeneration, \(\) => \{\s*productionReadinessFailed\.value = true/)
  assert.match(productionRefresh, /finally \{\s*productionReadinessRequestGuard\.commit\(requestGeneration, \(\) => \{\s*productionReadinessLoading\.value = false/)

  const videoRefresh = sourceBetween(
    filmCreateSource,
    'async function refreshVideoGenerationCapability',
    'async function getActiveVideoAiConfig',
  )
  assert.equal((videoRefresh.match(/videoCapabilityRequestGuard\.begin\(\)/g) || []).length, 1)
  assert.equal((videoRefresh.match(/videoCapabilityRequestGuard\.commit\(/g) || []).length, 4)
  assert.match(videoRefresh, /videoCapabilityRequestGuard\.commit\(requestGeneration, \(\) => \{\s*videoCapabilityLoading\.value = true\s*videoCapabilityFailed\.value = false/)
  assert.match(videoRefresh, /videoCapabilityRequestGuard\.commit\(requestGeneration, \(\) => \{\s*videoCapabilityConfigs\.value = normalizedRows\s*activeVideoAiConfigCache = capability\.config/)
  assert.match(videoRefresh, /catch \(_\) \{\s*capability = getVideoGenerationCapability\(\[\], \{ failed: true \}\)\s*videoCapabilityRequestGuard\.commit\(requestGeneration, \(\) => \{\s*videoCapabilityConfigs\.value = \[\]\s*videoCapabilityFailed\.value = true\s*activeVideoAiConfigCache = null/)
  assert.match(videoRefresh, /finally \{\s*videoCapabilityRequestGuard\.commit\(requestGeneration, \(\) => \{\s*activeVideoAiConfigCacheAt = Date\.now\(\)\s*videoCapabilityLoading\.value = false/)
  assert.match(videoRefresh, /return videoCapabilityRequestGuard\.isLatest\(requestGeneration\)\s*\? capability\s*: videoGenerationCapability\.value/)
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

test('FilmCreate generic AI config entry resets a prior service-specific filter', () => {
  assert.doesNotMatch(filmCreateSource, /@click="showAiConfigDialog = true"/)
  assert.match(filmCreateSource, /<el-link[^>]*@click="openAiConfig\(\)"[^>]*>AI 配置<\/el-link>/)
  assert.match(filmCreateSource, /function openAiConfig\(serviceType = ''\)/)
  assert.match(filmCreateSource, /aiConfigInitialServiceType\.value = \['text', 'image', 'storyboard_image', 'video', 'tts'\]\.includes\(serviceType\)/)
})

test('FilmCreate AI config returns to production and refreshes changed readiness through the close watcher', () => {
  const dialogModelIndex = filmCreateSource.indexOf('v-model="showAiConfigDialog"')
  assert.ok(dialogModelIndex >= 0, 'missing AI config dialog')
  const dialogStart = filmCreateSource.lastIndexOf('<el-dialog', dialogModelIndex)
  const dialogEnd = filmCreateSource.indexOf('</el-dialog>', dialogModelIndex)
  const dialog = filmCreateSource.slice(dialogStart, dialogEnd)
  assert.match(dialog, /:show-close="true"/)
  assert.match(dialog, /<template #header="\{ titleId, titleClass \}">[\s\S]*<ArrowLeft \/>[\s\S]*返回制作[\s\S]*<\/template>/)
  assert.match(dialog, /<strong :id="titleId" :class="\[titleClass, 'ai-config-dialog-title'\]">AI 配置<\/strong>/)
  assert.match(dialog, /@click="returnToProductionFromAiConfig"/)
  assert.match(dialog, /@configuration-changed="onAiConfigurationChanged"/)

  assert.match(filmCreateSource, /const aiConfigChanged = ref\(false\)/)
  assert.match(filmCreateSource, /function onAiConfigurationChanged\(\) \{\s*aiConfigChanged\.value = true\s*\}/)
  assert.match(filmCreateSource, /function returnToProductionFromAiConfig\(\) \{\s*showAiConfigDialog\.value = false\s*\}/)

  const closeWatcher = sourceBetween(
    filmCreateSource,
    'watch(showAiConfigDialog',
    'const storyInput',
  )
  assert.match(closeWatcher, /if \(open\) \{[\s\S]*aiConfigChanged\.value = false[\s\S]*return/)
  assert.match(closeWatcher, /invalidateActiveVideoAiConfigCache\(\)/)
  assert.match(closeWatcher, /const refreshPromise = Promise\.allSettled\(\[[\s\S]*refreshVideoGenerationCapability\(\)[\s\S]*refreshProductionReadiness\(\)/)
  const feedbackIndex = closeWatcher.indexOf("ElMessage.info('配置已更新，正在重新检查')")
  const refreshIndex = closeWatcher.indexOf('const refreshPromise = Promise.allSettled')
  assert.ok(feedbackIndex >= 0 && feedbackIndex < refreshIndex)
  const nextTickIndex = closeWatcher.indexOf('await nextTick()')
  const focusIndex = closeWatcher.indexOf('pipelinePanelRef.value?.focusSummary()')
  const awaitRefreshIndex = closeWatcher.indexOf('await refreshPromise')
  assert.ok(refreshIndex < nextTickIndex && nextTickIndex < focusIndex && focusIndex < awaitRefreshIndex)
  assert.match(closeWatcher, /if \(restorePipelineSummaryFocus\)/)
})

test('pipeline-owned AI recovery restores focus to a stable exposed summary', () => {
  assert.match(
    pipelinePanelSource,
    /<div\s+ref="summaryRef"[\s\S]*data-testid="film-pipeline-summary"[\s\S]*tabindex="-1"/,
  )
  assert.match(pipelinePanelSource, /import \{ computed, ref \} from 'vue'/)
  assert.match(pipelinePanelSource, /const summaryRef = ref\(null\)/)
  assert.match(pipelinePanelSource, /function focusSummary\(\) \{\s*summaryRef\.value\?\.focus\(\{ preventScroll: true \}\)\s*\}/)
  assert.match(pipelinePanelSource, /defineExpose\(\{\s*focusSummary,?\s*\}\)/)
  assert.match(
    pipelinePanelSource,
    /\.pipeline-compact-copy:focus-visible\s*\{[\s\S]*outline:\s*2px solid var\(--el-color-primary\)[\s\S]*outline-offset:\s*2px/,
  )
  assert.match(pipelinePanelSource, /emit\(action\.event, action\.payload, \{ source: 'compact-action' \}\)/)

  assert.match(filmCreateSource, /<FilmCreatePipelinePanel\s+ref="pipelinePanelRef"/)
  assert.match(filmCreateSource, /@open-ai-config="openAiConfigFromPipeline"/)
  assert.match(filmCreateSource, /const pipelinePanelRef = ref\(null\)/)
  assert.match(filmCreateSource, /const aiConfigOpenedFromPipelineAction = ref\(false\)/)
  assert.match(filmCreateSource, /function openAiConfigFromPipeline\(serviceType = '', context = \{\}\)/)
  assert.match(filmCreateSource, /aiConfigOpenedFromPipelineAction\.value = context\.source === 'compact-action'/)
  assert.match(filmCreateSource, /const restorePipelineSummaryFocus = aiConfigOpenedFromPipelineAction\.value/)
  assert.match(filmCreateSource, /aiConfigOpenedFromPipelineAction\.value = false/)
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
