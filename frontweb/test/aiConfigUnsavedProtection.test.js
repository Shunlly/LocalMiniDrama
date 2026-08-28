import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { useFilmCreateAiConfigWorkspace } from '../src/composables/filmCreate/useFilmCreateAiConfigWorkspace.js'
import { useFilmCreateNavigationGuards } from '../src/composables/filmCreate/useFilmCreateNavigationGuards.js'
import { ref } from 'vue'

const contentSource = readFileSync(new URL('../src/components/AIConfigContent.vue', import.meta.url), 'utf8')
const pageSource = readFileSync(new URL('../src/views/AiConfig.vue', import.meta.url), 'utf8')
const filmListSource = readFileSync(new URL('../src/views/FilmList.vue', import.meta.url), 'utf8')
const filmCreateSource = readFileSync(new URL('../src/views/FilmCreate.vue', import.meta.url), 'utf8')
const aiConfigDialogSource = readFileSync(new URL('../src/components/filmCreate/FilmCreateAiConfigDialog.vue', import.meta.url), 'utf8')
const promptEditorSource = readFileSync(new URL('../src/components/PromptEditor.vue', import.meta.url), 'utf8')
const sceneModelMapSource = readFileSync(new URL('../src/components/SceneModelMap.vue', import.meta.url), 'utf8')

function refOf(value) {
  return ref(value)
}

test('AIConfigContent exposes one dirty-state and discard-confirmation contract', () => {
  assert.match(contentSource, /from '@\/composables\/useAiConfigUnsaved\.js'/)
  assert.match(contentSource, /useAiConfigUnsaved\(\{/)
  assert.match(contentSource, /<PromptEditor ref="promptEditorRef" \/>/)
  assert.match(contentSource, /<SceneModelMap ref="sceneModelMapRef" \/>/)
  assert.match(contentSource, /defineExpose\(\{[\s\S]*hasUnsavedChanges,[\s\S]*requestClose,[\s\S]*\}\)/)
  assert.doesNotMatch(contentSource, /markUnsavedChangesDiscarded/)
})

test('advanced AI editors expose their actual draft state', () => {
  assert.match(promptEditorSource, /function hasUnsavedChanges\(\)/)
  assert.match(promptEditorSource, /defineExpose\(\{[\s\S]*hasUnsavedChanges[\s\S]*\}\)/)
  assert.match(sceneModelMapSource, /function hasUnsavedChanges\(\)/)
  assert.match(sceneModelMapSource, /:before-close="confirmDialogClose"/)
})

test('standalone AI config page protects route and browser exits', () => {
  assert.match(pageSource, /<AIConfigContent\s+ref="aiConfigContentRef"/)
  assert.match(pageSource, /onBeforeRouteLeave/)
  assert.match(pageSource, /window\.addEventListener\('beforeunload', handleBeforeUnload\)/)
  assert.match(pageSource, /event\.preventDefault\(\)[\s\S]*event\.returnValue = ''/)
})

test('project list AI config dialog delegates every close request to the content guard', () => {
  assert.match(filmListSource, /:before-close="confirmAiConfigWorkspaceClose"/)
  assert.match(filmListSource, /<AIConfigContent\s+ref="aiConfigContentRef"/)
  assert.match(filmListSource, /await aiConfigContentRef\.value\?\.requestClose\?\.\(\)/)
})

test('production AI config dialog uses the same guard for chrome and custom back controls', async () => {
  const showAiConfigDialog = refOf(true)
  const closed = []
  const aiConfigContentRef = refOf({
    hasUnsavedChanges: () => true,
    async requestClose() { return false },
  })
  const workspace = useFilmCreateAiConfigWorkspace({
    ElMessage: { info() {} },
    showAiConfigDialog,
    aiConfigContentRef,
    pipelinePanelRef: refOf(null),
    aiConfigInitialServiceType: refOf(''),
    aiConfigChanged: refOf(false),
    aiConfigOpenedFromPipelineAction: refOf(false),
    invalidateActiveVideoAiConfigCache() {},
    async refreshVideoGenerationCapability() {},
    async refreshProductionReadiness() {},
  })
  await workspace.confirmAiConfigWorkspaceClose(() => closed.push('done'))
  await workspace.requestAiConfigWorkspaceClose()
  assert.deepEqual(closed, [])
  assert.equal(showAiConfigDialog.value, true)

  aiConfigContentRef.value = { hasUnsavedChanges: () => true, async requestClose() { return true } }
  await workspace.confirmAiConfigWorkspaceClose(() => closed.push('done'))
  await workspace.requestAiConfigWorkspaceClose()
  assert.deepEqual(closed, ['done'])
  assert.equal(showAiConfigDialog.value, false)

  const guards = useFilmCreateNavigationGuards({
    pipelineStarting: refOf(false),
    pipelineRunning: refOf(false),
    pipelineStopping: refOf(false),
    activePipelineRunPromise: refOf(null),
    pipelineOwnedTaskIds: new Set(),
    showAiConfigDialog: refOf(true),
    aiConfigContentRef: refOf({
      hasUnsavedChanges: () => true,
      async requestClose() { return false },
    }),
    scriptDraftController: { hasPendingChanges: () => false, markSaved() {} },
    flushScriptDraft: async () => {},
    cancelPipelineRun: async () => true,
  })
  const event = { preventDefault() { event.prevented = true }, returnValue: 'preset' }
  guards.handleBeforeUnload(event)
  assert.equal(event.prevented, true)
  assert.equal(event.returnValue, '')
  assert.equal(await guards.allowNavigationAfterDraftFlush(), false)

  assert.match(filmCreateSource, /:before-close="confirmAiConfigWorkspaceClose"/)
  assert.match(filmCreateSource, /@back="requestAiConfigWorkspaceClose"/)
  assert.match(aiConfigDialogSource, /<AIConfigContent\s+ref="contentRef"/)
})
