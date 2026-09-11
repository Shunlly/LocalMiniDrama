import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { compileScript, parse } from '@vue/compiler-sfc'
import { effectScope, isRef, ref } from 'vue'

import {
  FILM_CREATE_RESOURCE_DIALOG_MODEL_KEYS,
  FILM_CREATE_RESOURCE_PANEL_MODEL_KEYS,
  FILM_CREATE_STORYBOARD_DIALOG_MODEL_KEYS,
  FILM_CREATE_STORYBOARD_PANEL_MODEL_KEYS,
  createTemplateModelBindings,
} from '../src/utils/filmCreateTemplateBindings.js'
import { createResourcePanelBindings, createStoryboardPanelBindings } from '../src/components/filmCreate/filmCreateProductionBindings.js'

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8')
const filmCreateSource = read('../src/views/FilmCreate.vue')
const productionBindingsSource = read('../src/components/filmCreate/filmCreateProductionBindings.js')
const workspaceBindingsSource = read('../src/components/filmCreate/filmCreateWorkspaceBindings.js')
const surfaceBindingsSource = read('../src/components/filmCreate/filmCreateSurfaceBindings.js')
const warningSource = read('../src/components/filmCreate/FilmCreateProjectDependencyWarning.vue')
const outputSource = read('../src/components/filmCreate/FilmCreateOutputSection.vue')
const workspaceSource = read('../src/components/filmCreate/FilmCreateWorkspaceDialogs.vue')

const DRAMA_ID = 'drama-11'
const EPISODE_ID = 'episode-22'

function compileVue(rel, id) {
  const source = read(rel)
  const parsed = parse(source, { filename: rel.split('/').at(-1) })
  assert.deepEqual(parsed.errors, [])
  assert.doesNotThrow(() => compileScript(parsed.descriptor, { id, inlineTemplate: true }))
  return source
}

function withBindings(values, modelKeys, assertFn) {
  const scope = effectScope()
  try {
    const bindings = scope.run(() => createTemplateModelBindings(values, modelKeys))
    assertFn(bindings)
  } finally {
    scope.stop()
  }
}

test('制作页把素材警告、交付区和弹窗层交给独立组件', () => {
  assert.match(filmCreateSource, /<FilmCreateProjectDependencyWarning/)
  assert.match(filmCreateSource, /:media-error="storyboardMediaLoadError"/)
  assert.match(filmCreateSource, /@retry="retryProjectDependencies"/)
  assert.match(filmCreateSource, /<FilmCreateOutputSection/)
  assert.match(filmCreateSource, /v-bind="outputSectionBindings"/)
  assert.match(surfaceBindingsSource, /watermarkText: videoWatermarkText/)
  assert.match(surfaceBindingsSource, /onDownloadVideo: downloadCurrentEpisodeVideo/)
  assert.match(filmCreateSource, /<FilmCreateWorkspaceDialogs/)
  assert.match(filmCreateSource, /v-if="projectLoadState === 'ready'"/)
  assert.match(filmCreateSource, /ref="aiConfigContentRef"/)
  assert.match(filmCreateSource, /:resource-dialogs="resourceDialogsBindings"/)
  assert.match(filmCreateSource, /:storyboard-dialogs="storyboardDialogsBindings"/)
  assert.match(filmCreateSource, /v-model:max-chapters="novelMaxChapters"/)
  assert.match(filmCreateSource, /v-model="showAiConfigDialog"/)
  assert.match(filmCreateSource, /@select="onGlobalMediaAssetSelected"/)
  assert.doesNotMatch(filmCreateSource, /class="project-dependency-warning"/)
  assert.doesNotMatch(filmCreateSource, /<FilmCreateVideoSettingsPanel/)
  assert.doesNotMatch(filmCreateSource, /<FilmCreateDeliveryPanel/)
  assert.doesNotMatch(filmCreateSource, /<FilmCreateResourceDialogs/)
  assert.doesNotMatch(filmCreateSource, /<ImagePreviewDialog/)
  assert.doesNotMatch(filmCreateSource, /<GlobalMediaPickerDialog/)
})

test('抽出的警告条、交付区和弹窗层可以独立编译', () => {
  compileVue('../src/components/filmCreate/FilmCreateProjectDependencyWarning.vue', 'film-create-warning')
  compileVue('../src/components/filmCreate/FilmCreateOutputSection.vue', 'film-create-output')
  compileVue('../src/components/filmCreate/FilmCreateWorkspaceDialogs.vue', 'film-create-workspace-dialogs')
  assert.match(warningSource, /重试加载素材/)
  assert.match(outputSource, /<FilmCreateVideoSettingsPanel/)
  assert.match(outputSource, /<FilmCreateDeliveryPanel/)
  assert.match(workspaceSource, /<FilmCreateResourceDialogs v-bind="resourceDialogs"/)
  assert.match(workspaceSource, /<FilmCreateStoryboardDialogs v-bind="storyboardDialogs"/)
  assert.match(workspaceSource, /<FilmCreateNovelImportDialog/)
  assert.match(workspaceSource, /<FilmCreateAiConfigDialog/)
  assert.match(workspaceSource, /requestClose: \(\.\.\.args\) => aiConfigDialogRef\.value\?\.requestClose\?\.\(\.\.\.args\)/)
  assert.match(workspaceSource, /title="制作资源图片预览"/)
})

test('只装配已有 ref，不创建新状态', () => {
  const visible = ref(false)
  const values = { visible }
  const originalKeys = Object.keys(values)
  withBindings(values, ['visible', 'missingDialog'], (bindings) => {
    assert.equal(values.visible, visible)
    assert.deepEqual(Object.keys(values), originalKeys)
    assert.equal('missingDialog' in values, false)
    assert.equal(isRef(values.visible), true)
    assert.equal(isRef(bindings.value.visible), false)
    assert.equal(bindings.value.visible, false)
    assert.equal('missingDialog' in bindings.value, false)
    assert.equal(typeof bindings.value['onUpdate:missingDialog'], 'function')

    visible.value = true
    assert.equal(bindings.value.visible, true)
    assert.equal(values.visible, visible)
    bindings.value['onUpdate:missingDialog'](true)
    assert.equal('missingDialog' in values, false)
    assert.equal('missingDialog' in bindings.value, false)
  })
  assert.match(productionBindingsSource, /createTemplateModelBindings\(/)
  assert.match(filmCreateSource, /useFilmCreateWorkspaceBootstrap\(/)
  assert.match(workspaceBindingsSource, /FILM_CREATE_RESOURCE_DIALOG_MODEL_KEYS/)
  assert.match(workspaceBindingsSource, /FILM_CREATE_STORYBOARD_DIALOG_MODEL_KEYS/)
  assert.doesNotMatch(filmCreateSource, /const showAddProp = ref\(false\)/)
  assert.ok(FILM_CREATE_RESOURCE_DIALOG_MODEL_KEYS.includes('showAddProp'))
  assert.ok(FILM_CREATE_STORYBOARD_DIALOG_MODEL_KEYS.includes('showSbPromptDialog'))
})

test('modelKeys 会生成 onUpdate:key，写入对应 ref.value', () => {
  const showAddProp = ref(false)
  const charLibraryPage = ref(1)
  withBindings({ showAddProp, charLibraryPage }, ['showAddProp', 'charLibraryPage'], (bindings) => {
    const firstUpdater = bindings.value['onUpdate:showAddProp']
    assert.equal(typeof firstUpdater, 'function')
    assert.equal(typeof bindings.value['onUpdate:charLibraryPage'], 'function')

    bindings.value['onUpdate:showAddProp'](true)
    bindings.value['onUpdate:charLibraryPage'](3)

    assert.equal(showAddProp.value, true)
    assert.equal(charLibraryPage.value, 3)
    assert.equal(bindings.value.showAddProp, true)
    assert.equal(bindings.value.charLibraryPage, 3)
    assert.equal(bindings.value['onUpdate:showAddProp'], firstUpdater)
  })
})

test('非 ref 字段原样透出', () => {
  const save = () => 'saved'
  const form = { name: '李华' }
  const label = '道具'
  withBindings({
    save,
    form,
    label,
    visible: ref(false),
  }, ['visible'], (bindings) => {
    assert.equal(bindings.value.save, save)
    assert.equal(bindings.value.save(), 'saved')
    assert.equal(bindings.value.form, form)
    assert.equal(bindings.value.label, '道具')
    assert.equal(Object.prototype.hasOwnProperty.call(bindings.value, 'onUpdate:save'), false)
    assert.equal(Object.prototype.hasOwnProperty.call(bindings.value, 'onUpdate:form'), false)
    assert.equal(Object.prototype.hasOwnProperty.call(bindings.value, 'onUpdate:label'), false)
    assert.equal(typeof bindings.value['onUpdate:visible'], 'function')
  })

  withBindings({ save, form, visible: ref(false) }, ['save', 'form', 'visible'], (bindings) => {
    assert.equal(bindings.value.save, save)
    assert.equal(bindings.value.form, form)
    bindings.value['onUpdate:save'](() => 'other')
    bindings.value['onUpdate:form']({ name: '王安' })
    assert.equal(bindings.value.save, save)
    assert.equal(bindings.value.save(), 'saved')
    assert.equal(bindings.value.form, form)
    assert.equal(form.name, '李华')
  })
})

test('两个 ID 不相等时不能互相覆盖，modelKeys 与 values key 不一致也不串写', () => {
  assert.notEqual(DRAMA_ID, EPISODE_ID)
  const dramaId = ref(DRAMA_ID)
  const episodeId = ref(EPISODE_ID)
  const charLibraryPage = ref(1)
  const dramaAllCharPage = ref(9)
  assert.notEqual(charLibraryPage.value, dramaAllCharPage.value)

  withBindings({ dramaId }, ['episodeId'], (bindings) => {
    assert.equal(typeof bindings.value['onUpdate:episodeId'], 'function')
    bindings.value['onUpdate:episodeId']('hijack-episode')
    assert.equal(dramaId.value, DRAMA_ID)
    assert.equal(episodeId.value, EPISODE_ID)
    assert.equal(bindings.value.dramaId, DRAMA_ID)
    assert.equal('episodeId' in bindings.value, false)
  })

  withBindings({
    dramaId,
    episodeId,
    charLibraryPage,
    dramaAllCharPage,
  }, ['dramaId', 'charLibraryPage'], (bindings) => {
    bindings.value['onUpdate:dramaId']('drama-99')
    bindings.value['onUpdate:charLibraryPage'](3)
    assert.equal(dramaId.value, 'drama-99')
    assert.equal(episodeId.value, EPISODE_ID)
    assert.equal(charLibraryPage.value, 3)
    assert.equal(dramaAllCharPage.value, 9)
    assert.equal(Object.prototype.hasOwnProperty.call(bindings.value, 'onUpdate:episodeId'), false)
    assert.equal(Object.prototype.hasOwnProperty.call(bindings.value, 'onUpdate:dramaAllCharPage'), false)
  })

  assert.equal(FILM_CREATE_RESOURCE_DIALOG_MODEL_KEYS.includes('currentEpisodeId'), false)
  assert.ok(FILM_CREATE_RESOURCE_DIALOG_MODEL_KEYS.includes('charLibraryPage'))
  assert.ok(FILM_CREATE_RESOURCE_DIALOG_MODEL_KEYS.includes('dramaAllCharPage'))
  const currentEpisodeId = ref(EPISODE_ID)
  const currentDramaId = ref(DRAMA_ID)
  const pageA = ref(1)
  const pageB = ref(9)
  assert.notEqual(currentDramaId.value, currentEpisodeId.value)
  assert.notEqual(pageA.value, pageB.value)
  withBindings({
    charLibraryPage: pageA,
    dramaAllCharPage: pageB,
    currentEpisodeId,
    currentDramaId,
  }, FILM_CREATE_RESOURCE_DIALOG_MODEL_KEYS, (bindings) => {
    bindings.value['onUpdate:charLibraryPage'](3)
    assert.equal(pageA.value, 3)
    assert.equal(pageB.value, 9)
    assert.equal(currentEpisodeId.value, EPISODE_ID)
    assert.equal(currentDramaId.value, DRAMA_ID)
    assert.equal(Object.prototype.hasOwnProperty.call(bindings.value, 'onUpdate:currentEpisodeId'), false)
    assert.equal(Object.prototype.hasOwnProperty.call(bindings.value, 'onUpdate:currentDramaId'), false)
    bindings.value['onUpdate:dramaAllCharPage'](4)
    assert.equal(pageA.value, 3)
    assert.equal(pageB.value, 4)
    assert.equal(currentEpisodeId.value, EPISODE_ID)
    assert.equal(currentDramaId.value, DRAMA_ID)
  })
})

test('computed 返回的是当前 unref 快照', () => {
  const keyword = ref('旧词')
  const form = ref({ name: '李华' })
  withBindings({ keyword, form }, ['keyword'], (bindings) => {
    assert.equal(isRef(bindings), true)
    const first = bindings.value
    const cached = bindings.value
    assert.equal(first, cached)
    assert.equal(first.keyword, '旧词')
    assert.equal(first.form, form.value)

    keyword.value = '新词'
    form.value = { name: '王安' }
    const second = bindings.value
    assert.notEqual(first, second)
    assert.equal(first.keyword, '旧词')
    assert.equal(second.keyword, '新词')
    assert.equal(second.form, form.value)
    assert.notEqual(first.form, second.form)

    second.keyword = '被改'
    assert.equal(keyword.value, '新词')
    assert.equal(bindings.value, second)
    assert.equal(bindings.value.keyword, '被改')

    keyword.value = '再更新'
    const third = bindings.value
    assert.notEqual(third, second)
    assert.equal(keyword.value, '再更新')
    assert.equal(third.keyword, '再更新')
    assert.equal(second.keyword, '被改')
  })
})
test('资源面板折叠键会生成 onUpdate，写入原 ref', () => {
  assert.ok(FILM_CREATE_RESOURCE_PANEL_MODEL_KEYS.includes('resourcePanelCollapsed'))
  assert.equal(FILM_CREATE_RESOURCE_PANEL_MODEL_KEYS.includes('currentEpisodeId'), false)
  assert.match(productionBindingsSource, /createResourcePanelBindings\([\s\S]*FILM_CREATE_RESOURCE_PANEL_MODEL_KEYS/)
  const resourcePanelCollapsed = ref(false)
  const currentEpisodeId = ref(EPISODE_ID)
  withBindings({
    resourcePanelCollapsed,
    currentEpisodeId,
  }, FILM_CREATE_RESOURCE_PANEL_MODEL_KEYS, (bindings) => {
    assert.equal(bindings.value.resourcePanelCollapsed, false)
    assert.equal(typeof bindings.value['onUpdate:resourcePanelCollapsed'], 'function')
    assert.equal(Object.prototype.hasOwnProperty.call(bindings.value, 'onUpdate:currentEpisodeId'), false)
    bindings.value['onUpdate:resourcePanelCollapsed'](true)
    assert.equal(resourcePanelCollapsed.value, true)
    assert.equal(currentEpisodeId.value, EPISODE_ID)
  })

  const panelCollapsed = ref(false)
  const scopeCollapsed = ref(false)
  const episodeId = ref(EPISODE_ID)
  const scope = effectScope()
  try {
    const bindings = scope.run(() => createResourcePanelBindings({
      resourcePanelCollapsed: panelCollapsed,
      currentEpisodeId: episodeId,
      openAddCharacter() {},
      showCharLibrary: ref(false),
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
    bindings.value['onUpdate:resourcePanelCollapsed'](true)
    assert.equal(panelCollapsed.value, true)
    assert.equal(scopeCollapsed.value, false)
    assert.equal(episodeId.value, EPISODE_ID)
    assert.equal('currentEpisodeId' in bindings.value, false)
  } finally {
    scope.stop()
  }
})
test('资源面板绑定袋透出 onAddEpisode / onSelectEpisode，不把它们当成 v-model，也不改 episodeId', () => {
  assert.equal(FILM_CREATE_RESOURCE_PANEL_MODEL_KEYS.includes('onAddEpisode'), false)
  assert.equal(FILM_CREATE_RESOURCE_PANEL_MODEL_KEYS.includes('onSelectEpisode'), false)
  assert.equal(FILM_CREATE_RESOURCE_PANEL_MODEL_KEYS.includes('currentEpisodeId'), false)
  assert.match(productionBindingsSource, /createResourcePanelBindings\([\s\S]*onAddEpisode,[\s\S]*onSelectEpisode,[\s\S]*FILM_CREATE_RESOURCE_PANEL_MODEL_KEYS/)
  assert.match(workspaceBindingsSource, /resourcePanel: \{[\s\S]*onAddEpisode, onSelectEpisode, onGenerateCharacters/)

  const currentEpisodeId = ref(EPISODE_ID)
  let added = 0
  let selected = 0
  function onAddEpisode() { added += 1 }
  function onSelectEpisode() { selected += 1 }
  const scope = effectScope()
  try {
    const bindings = scope.run(() => createResourcePanelBindings({
      currentEpisodeId,
      onAddEpisode,
      onSelectEpisode,
      openAddCharacter() {},
      showCharLibrary: ref(false),
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
    assert.equal(bindings.value.onAddEpisode, onAddEpisode)
    assert.equal(bindings.value.onSelectEpisode, onSelectEpisode)
    assert.equal(Object.prototype.hasOwnProperty.call(bindings.value, 'onUpdate:onAddEpisode'), false)
    assert.equal(Object.prototype.hasOwnProperty.call(bindings.value, 'onUpdate:onSelectEpisode'), false)
    assert.equal(Object.prototype.hasOwnProperty.call(bindings.value, 'onUpdate:currentEpisodeId'), false)
    bindings.value.onAddEpisode()
    bindings.value.onSelectEpisode()
    assert.equal(added, 1)
    assert.equal(selected, 1)
    assert.equal(currentEpisodeId.value, EPISODE_ID)
  } finally {
    scope.stop()
  }
})
test('分镜面板绑定袋透出 onAddEpisode，不把它当成 v-model，也不改 episodeId', () => {
  assert.equal(FILM_CREATE_STORYBOARD_PANEL_MODEL_KEYS.includes('onAddEpisode'), false)
  assert.equal(FILM_CREATE_STORYBOARD_PANEL_MODEL_KEYS.includes('currentEpisodeId'), false)
  assert.match(productionBindingsSource, /onAddEpisode,/)
  assert.match(workspaceBindingsSource, /storyboardPanel: \{[\s\S]*onAddEpisode, onAddSingleStoryboard/)

  const currentEpisodeId = ref(EPISODE_ID)
  let added = 0
  function onAddEpisode() { added += 1 }
  const scope = effectScope()
  try {
    const bindings = scope.run(() => createStoryboardPanelBindings({
      currentEpisodeId,
      onAddEpisode,
      saveProjectSettings() {},
      doUploadSbImage() {},
    }))
    assert.equal(bindings.value.onAddEpisode, onAddEpisode)
    assert.equal(Object.prototype.hasOwnProperty.call(bindings.value, 'onUpdate:onAddEpisode'), false)
    assert.equal(Object.prototype.hasOwnProperty.call(bindings.value, 'onUpdate:currentEpisodeId'), false)
    bindings.value.onAddEpisode()
    assert.equal(added, 1)
    assert.equal(currentEpisodeId.value, EPISODE_ID)
  } finally {
    scope.stop()
  }
})

