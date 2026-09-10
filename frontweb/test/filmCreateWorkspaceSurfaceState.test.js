import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { effectScope, ref } from 'vue'

import { createResourcePanelBindings } from '../src/components/filmCreate/filmCreateProductionBindings.js'
import { useFilmCreateProjectLoadSurface } from '../src/composables/filmCreate/useFilmCreateProjectLoadSurface.js'
import { useFilmCreateAiConfigDialogState } from '../src/composables/filmCreate/useFilmCreateAiConfigDialogState.js'
import { useFilmCreateResourcePanelState } from '../src/composables/filmCreate/useFilmCreateResourcePanelState.js'
import { useFilmCreateMediaPickerState } from '../src/composables/filmCreate/useFilmCreateMediaPickerState.js'
import { FILM_CREATE_RESOURCE_PANEL_MODEL_KEYS } from '../src/utils/filmCreateTemplateBindings.js'

const DRAMA_ID = 11
const EPISODE_ID = 22
assert.notEqual(DRAMA_ID, EPISODE_ID)

const filmCreateSource = readFileSync(new URL('../src/views/FilmCreate.vue', import.meta.url), 'utf8')
const productionBindingsSource = readFileSync(new URL('../src/components/filmCreate/filmCreateProductionBindings.js', import.meta.url), 'utf8')
const bootstrapSource = readFileSync(new URL('../src/composables/filmCreate/useFilmCreateWorkspaceBootstrap.js', import.meta.url), 'utf8')

test('项目加载失败面标题不把 episodeId 当成项目 id', () => {
  const store = { dramaId: DRAMA_ID, drama: { title: '月光基地', episodes: [{ id: EPISODE_ID }] } }
  const loading = useFilmCreateProjectLoadSurface({ initialRouteProjectId: DRAMA_ID, store })
  assert.equal(loading.projectLoadState.value, 'loading')
  assert.equal(loading.projectPageTitle.value, '正在加载项目')
  loading.projectLoadState.value = 'error'
  assert.equal(loading.projectPageTitle.value, '项目加载失败')
  loading.projectLoadState.value = 'ready'
  assert.equal(loading.projectPageTitle.value, '月光基地')
  assert.notEqual(loading.projectPageTitle.value, String(EPISODE_ID))
})

test('AI 配置弹窗默认关闭，且不把连接测试抽到 composable', () => {
  const state = useFilmCreateAiConfigDialogState()
  assert.equal(state.showAiConfigDialog.value, false)
  assert.equal(state.aiConfigChanged.value, false)
  assert.equal(state.aiConfigInitialServiceType.value, '')
  assert.doesNotMatch(filmCreateSource, /useFilmCreateAiConfigDialogState\(\)[\s\S]{0,80}loadList/)
  assert.doesNotMatch(bootstrapSource, /loadList\(/)
  assert.match(filmCreateSource, /useFilmCreateAiConfigWorkspace\(\{[\s\S]*showAiConfigDialog/)
})

test('资源面板折叠默认展开，四视图默认关闭', () => {
  const state = useFilmCreateResourcePanelState()
  assert.equal(state.resourcePanelCollapsed.value, false)
  assert.equal(state.sceneUseQuadGrid.value, false)
  assert.equal(state.propUseQuadGrid.value, false)
})

test('素材选择器目标不是 dramaId 或 episodeId', () => {
  const state = useFilmCreateMediaPickerState()
  assert.equal(state.showGlobalMediaPicker.value, false)
  assert.equal(state.globalMediaPickerMode.value, 'reference')
  assert.equal(state.globalMediaPickerTarget.value, null)
  state.globalMediaPickerTarget.value = { storyboardId: 77 }
  assert.notEqual(state.globalMediaPickerTarget.value.storyboardId, DRAMA_ID)
  assert.notEqual(state.globalMediaPickerTarget.value.storyboardId, EPISODE_ID)
})

test('制作页把加载失败面、AI 弹窗、资源折叠和选择器交给 composable', () => {
  assert.match(filmCreateSource, /useFilmCreateProjectLoadSurface\(\{ initialRouteProjectId, store \}\)/)
  assert.match(filmCreateSource, /useFilmCreateAiConfigDialogState\(\)/)
  assert.match(filmCreateSource, /useFilmCreateResourcePanelState\(\)/)
  assert.match(filmCreateSource, /useFilmCreateMediaPickerState\(\)/)
  assert.match(filmCreateSource, /useFilmCreateWorkspaceBootstrap\(/)
  assert.doesNotMatch(filmCreateSource, /const showAiConfigDialog = ref\(false\)/)
  assert.doesNotMatch(filmCreateSource, /const resourcePanelCollapsed = ref\(false\)/)
  assert.doesNotMatch(filmCreateSource, /const showGlobalMediaPicker = ref\(false\)/)
  assert.match(filmCreateSource, /v-bind="resourcePanelBindings"/)
  assert.match(filmCreateSource, /resourcePanel: \{[\s\S]*resourcePanelCollapsed/)
  assert.doesNotMatch(filmCreateSource, /v-model:resource-panel-collapsed="resourcePanelCollapsed"/)
  assert.match(filmCreateSource, /v-model="showAiConfigDialog"/)
  assert.match(filmCreateSource, /v-model:show-global-media-picker="showGlobalMediaPicker"/)
  assert.match(filmCreateSource, /onMounted\(mountWorkspace\)/)
  assert.match(filmCreateSource, /onBeforeUnmount\(unmountWorkspace\)/)
  assert.doesNotMatch(filmCreateSource, /projectLifecycle\.dispose\(\)/)
  assert.match(bootstrapSource, /function unmountWorkspace/)
})

test('资源面板折叠仍走属性袋 v-model，不会改到 episodeId', () => {
  assert.ok(FILM_CREATE_RESOURCE_PANEL_MODEL_KEYS.includes('resourcePanelCollapsed'))
  assert.equal(FILM_CREATE_RESOURCE_PANEL_MODEL_KEYS.includes('currentEpisodeId'), false)
  assert.equal(FILM_CREATE_RESOURCE_PANEL_MODEL_KEYS.includes('dramaId'), false)
  assert.match(productionBindingsSource, /FILM_CREATE_RESOURCE_PANEL_MODEL_KEYS/)
  assert.match(productionBindingsSource, /export function createResourcePanelBindings/)
  assert.match(bootstrapSource, /createResourcePanelBindings\(resourcePanel\)/)

  const resourcePanelCollapsed = ref(false)
  const currentEpisodeId = ref(EPISODE_ID)
  const dramaId = ref(DRAMA_ID)
  const showCharLibrary = ref(false)
  const scope = effectScope()
  try {
    const bindings = scope.run(() => createResourcePanelBindings({
      resourcePanelCollapsed,
      currentEpisodeId,
      dramaId,
      charactersBlockCollapsed: ref(false),
      propsBlockCollapsed: ref(false),
      scenesBlockCollapsed: ref(false),
      propUseQuadGrid: ref(false),
      sceneUseQuadGrid: ref(false),
      openAddCharacter() {},
      showCharLibrary,
      showAddProp: ref(false),
      showPropLibrary: ref(false),
      openAddScene() {},
      showSceneLibrary: ref(false),
      editCharacter() {},
      editProp() {},
      editScene() {},
      onAddCharacterToMaterialLibrary() {},
      onAddPropToMaterialLibrary() {},
      onAddSceneToMaterialLibrary() {},
      doUploadResourceImage() {},
      openImagePreview() {},
      scrollToStoryboard() {},
      playSd2Voice() {},
    }))
    assert.equal(bindings.value.resourcePanelCollapsed, false)
    assert.equal(typeof bindings.value['onUpdate:resourcePanelCollapsed'], 'function')
    assert.equal('currentEpisodeId' in bindings.value, false)
    assert.equal('dramaId' in bindings.value, false)
    assert.equal(Object.prototype.hasOwnProperty.call(bindings.value, 'onUpdate:currentEpisodeId'), false)

    bindings.value['onUpdate:resourcePanelCollapsed'](true)
    assert.equal(resourcePanelCollapsed.value, true)
    assert.equal(currentEpisodeId.value, EPISODE_ID)
    assert.equal(dramaId.value, DRAMA_ID)
    assert.equal(showCharLibrary.value, false)
  } finally {
    scope.stop()
  }
})
