import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const contentSource = readFileSync(
  new URL('../src/components/AIConfigContent.vue', import.meta.url),
  'utf8',
)
const pageSource = readFileSync(new URL('../src/views/AiConfig.vue', import.meta.url), 'utf8')
const filmListSource = readFileSync(new URL('../src/views/FilmList.vue', import.meta.url), 'utf8')
const filmCreateSource = readFileSync(new URL('../src/views/FilmCreate.vue', import.meta.url), 'utf8')
const aiConfigWorkspaceSource = readFileSync(new URL('../src/composables/filmCreate/useFilmCreateAiConfigWorkspace.js', import.meta.url), 'utf8')
const navigationGuardsSource = readFileSync(new URL('../src/composables/filmCreate/useFilmCreateNavigationGuards.js', import.meta.url), 'utf8')
const aiConfigDialogSource = readFileSync(new URL('../src/components/filmCreate/FilmCreateAiConfigDialog.vue', import.meta.url), 'utf8')
const promptEditorSource = readFileSync(new URL('../src/components/PromptEditor.vue', import.meta.url), 'utf8')
const sceneModelMapSource = readFileSync(new URL('../src/components/SceneModelMap.vue', import.meta.url), 'utf8')

test('AIConfigContent exposes one dirty-state and discard-confirmation contract', () => {
  assert.match(contentSource, /<PromptEditor ref="promptEditorRef" \/>/)
  assert.match(contentSource, /<SceneModelMap ref="sceneModelMapRef" \/>/)
  assert.match(
    contentSource,
    /function hasUnsavedChanges\(\) \{[\s\S]*hasUnsavedAiConfigChanges\(\[[\s\S]*promptEditorRef\.value,[\s\S]*sceneModelMapRef\.value,[\s\S]*\]\)[\s\S]*\}/,
  )
  assert.match(contentSource, /const generationSettingsDirty = computed/)
  assert.match(contentSource, /const credentialDraftDirty = computed/)
  assert.match(contentSource, /:before-close="confirmOneKeyTongyiClose"/)
  assert.match(contentSource, /:before-close="confirmBulkKeyClose"/)
  assert.match(contentSource, /async function requestClose\(\)/)
  assert.match(contentSource, /defineExpose\(\{[\s\S]*hasUnsavedChanges,[\s\S]*requestClose,[\s\S]*\}\)/)

  const requestCloseStart = contentSource.indexOf('async function requestClose()')
  const exposeStart = contentSource.indexOf('defineExpose({', requestCloseStart)
  assert.ok(requestCloseStart >= 0 && exposeStart > requestCloseStart)
  const requestCloseSource = contentSource.slice(requestCloseStart, exposeStart)
  assert.match(requestCloseSource, /if \(!hasUnsavedChanges\(\)\) return true/)
  assert.match(contentSource, /async function confirmDiscard\(\)[\s\S]*当前 AI 配置尚未保存/)
  assert.match(requestCloseSource, /await confirmDiscard\(\)/)
  assert.match(requestCloseSource, /return false/)
  assert.doesNotMatch(requestCloseSource, /markUnsavedChangesDiscarded/)
})

test('advanced AI editors expose their actual draft state', () => {
  assert.match(promptEditorSource, /function hasUnsavedChanges\(\)/)
  assert.match(promptEditorSource, /Object\.values\(isDirty\.value\)\.some\(Boolean\)/)
  assert.match(promptEditorSource, /defineExpose\(\{[\s\S]*hasUnsavedChanges[\s\S]*\}\)/)

  assert.match(sceneModelMapSource, /const formBaseline = ref\(''\)/)
  assert.match(sceneModelMapSource, /function hasUnsavedChanges\(\)/)
  assert.match(sceneModelMapSource, /defineExpose\(\{[\s\S]*hasUnsavedChanges[\s\S]*\}\)/)
  assert.match(sceneModelMapSource, /:before-close="confirmDialogClose"/)
  assert.match(sceneModelMapSource, /@click="requestDialogClose"/)
})

test('standalone AI config page protects route and browser exits', () => {
  assert.match(pageSource, /<AIConfigContent\s+ref="aiConfigContentRef"/)
  assert.match(pageSource, /import \{ onBeforeRouteLeave, useRoute, useRouter \} from 'vue-router'/)
  assert.match(pageSource, /const aiConfigContentRef = ref\(null\)/)
  assert.match(pageSource, /onBeforeRouteLeave\(\(\) => \{[\s\S]*if \(skipNextRouteGuard\) return true[\s\S]*return requestAiConfigPageClose\(\)[\s\S]*\}\)/)
  assert.match(pageSource, /aiConfigContentRef\.value\?\.requestClose\?\.\(\)/)
  assert.match(pageSource, /aiConfigContentRef\.value\?\.hasUnsavedChanges\?\.\(\)/)
  assert.match(pageSource, /window\.addEventListener\('beforeunload', handleBeforeUnload\)/)
  assert.match(pageSource, /window\.removeEventListener\('beforeunload', handleBeforeUnload\)/)
  assert.match(pageSource, /event\.preventDefault\(\)[\s\S]*event\.returnValue = ''/)
})

test('project list AI config dialog delegates every close request to the content guard', () => {
  assert.match(
    filmListSource,
    /<AccessibleDialog\s+v-model="showAiConfigDialog"[\s\S]*?:before-close="confirmAiConfigWorkspaceClose"/,
  )
  assert.match(filmListSource, /<AIConfigContent\s+ref="aiConfigContentRef"\s+v-if="showAiConfigDialog"/)
  assert.match(filmListSource, /const aiConfigContentRef = ref\(null\)/)
  assert.match(filmListSource, /async function confirmAiConfigWorkspaceClose\(done\)/)
  assert.match(filmListSource, /await aiConfigContentRef\.value\?\.requestClose\?\.\(\)/)
  assert.match(filmListSource, /onBeforeRouteLeave\(requestFilmListNavigation\)/)
  assert.match(filmListSource, /const hasUnsavedAiConfig = showAiConfigDialog\.value\s*&& aiConfigContentRef\.value\?\.hasUnsavedChanges\?\.\(\)/)
  assert.match(filmListSource, /window\.addEventListener\('beforeunload', handleBeforeUnload\)/)
  assert.match(filmListSource, /window\.removeEventListener\('beforeunload', handleBeforeUnload\)/)
})

test('production AI config dialog uses the same guard for chrome and custom back controls', () => {
  assert.match(
    aiConfigDialogSource,
    /<AccessibleDialog[\s\S]*?v-model="visible"[\s\S]*?:before-close="beforeClose"/,
  )
  assert.match(filmCreateSource, /:before-close="confirmAiConfigWorkspaceClose"/)
  assert.match(filmCreateSource, /@back="requestAiConfigWorkspaceClose"/)
  assert.match(aiConfigDialogSource, /<AIConfigContent\s+ref="contentRef"/)
  assert.match(filmCreateSource, /const aiConfigContentRef = ref\(null\)/)
  assert.match(aiConfigWorkspaceSource, /async function confirmAiConfigWorkspaceClose\(done\)/)
  assert.match(aiConfigWorkspaceSource, /async function requestAiConfigWorkspaceClose\(\)/)
  assert.match(aiConfigWorkspaceSource, /await aiConfigContentRef\.value\?\.requestClose\?\.\(\)/)
  assert.match(navigationGuardsSource, /const hasUnsavedAiConfig = showAiConfigDialog\.value\s*&& aiConfigContentRef\.value\?\.hasUnsavedChanges\?\.\(\)/)
  assert.match(navigationGuardsSource, /async function allowNavigationAfterDraftFlush\(\) \{[\s\S]*requestAiConfigWorkspaceNavigation\(\)/)
})
