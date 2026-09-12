import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { compileScript, parse } from '@vue/compiler-sfc'
import { effectScope, ref } from 'vue'

import { createResourcePanelBindings } from '../src/components/filmCreate/filmCreateProductionBindings.js'

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8')
const filmCreateSource = read('../src/views/FilmCreate.vue')
const resourcePanelFile = read('../src/components/filmCreate/FilmCreateResourcePanel.vue')
const sceneBlockSource = read('../src/components/filmCreate/FilmCreateSceneBlock.vue')
const resourcePanelCopy = read('../src/components/filmCreate/filmCreateResourcePanelCopy.js')
const resourcePanelSource = [resourcePanelFile, sceneBlockSource, resourcePanelCopy].join('\n')
const productionBindingsSource = read('../src/components/filmCreate/filmCreateProductionBindings.js')
const workspaceBindingsSource = read('../src/components/filmCreate/filmCreateWorkspaceBindings.js')
const bootstrapSource = read('../src/composables/filmCreate/useFilmCreateWorkspaceBootstrap.js')

function resourcePanelStub(extra = {}) {
  return {
    resourcePanelCollapsed: ref(false),
    charactersBlockCollapsed: ref(false),
    propsBlockCollapsed: ref(false),
    scenesBlockCollapsed: ref(false),
    propUseQuadGrid: ref(false),
    sceneUseQuadGrid: ref(false),
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
    ...extra,
  }
}

test('制作页资源袋把全景图生成函数透成 Vue 事件监听', () => {
  assert.match(filmCreateSource, /v-bind="resourcePanelBindings"/)
  assert.match(workspaceBindingsSource, /resourcePanel: \{[\s\S]*generatingPanoramaIds[\s\S]*onGenerateScenePanorama/)
  assert.match(bootstrapSource, /createResourcePanelBindings\(resourcePanel\)/)
  assert.match(productionBindingsSource, /export function createResourcePanelBindings/)
  assert.match(resourcePanelSource, /'generate-scene-panorama'/)
  assert.match(resourcePanelSource, /emit\('generate-scene-panorama', scene\)/)
  assert.match(resourcePanelSource, /请先为该场景生成或上传主图/)
  assert.match(resourcePanelSource, /missingScenePanoramaReason/)
  assert.match(resourcePanelSource, /class="scene-panorama-row"/)
  assert.match(resourcePanelSource, /class="scene-panorama-preview-btn"/)
  assert.doesNotMatch(resourcePanelSource, /class="thumb-preview-btn"[^>]*>\s*预览全景/)

  function onGenerateScenePanorama() {}
  const generatingPanoramaIds = new Set()
  const scope = effectScope()
  try {
    const bindings = scope.run(() => createResourcePanelBindings(resourcePanelStub({
      generatingPanoramaIds,
      onGenerateScenePanorama,
    })))
    assert.equal(bindings.value.onGenerateScenePanorama, onGenerateScenePanorama)
    assert.equal(bindings.value.generatingPanoramaIds, generatingPanoramaIds)
    assert.equal(Object.prototype.hasOwnProperty.call(bindings.value, 'onUpdate:onGenerateScenePanorama'), false)
  } finally {
    scope.stop()
  }
})

test('资源面板全景图入口改动后仍可编译', () => {
  const parsed = parse(resourcePanelFile, { filename: 'FilmCreateResourcePanel.vue' })
  assert.deepEqual(parsed.errors, [])
  assert.doesNotThrow(() => compileScript(parsed.descriptor, { id: 'resource-panorama-panel' }))
  const sceneParsed = parse(sceneBlockSource, { filename: 'FilmCreateSceneBlock.vue' })
  assert.deepEqual(sceneParsed.errors, [])
  assert.doesNotThrow(() => compileScript(sceneParsed.descriptor, { id: 'resource-panorama-scene-block' }))
})
