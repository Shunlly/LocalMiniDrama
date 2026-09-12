import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { compileScript, parse } from '@vue/compiler-sfc'

import {
  FILM_CREATE_RESOURCE_DIALOG_FILES,
  readFilmCreateComponent,
  readFilmCreateResourceDialogTree,
} from './helpers/filmCreateResourceDialogSources.js'

const parentSource = readFilmCreateComponent('FilmCreateResourceDialogs.vue')
const propEditSource = readFilmCreateComponent('FilmCreatePropEditDialog.vue')
const sceneEditSource = readFilmCreateComponent('FilmCreateSceneEditDialog.vue')
const charLibrarySource = readFilmCreateComponent('FilmCreateCharacterLibraryDialogs.vue')
const propLibrarySource = readFilmCreateComponent('FilmCreatePropLibraryDialogs.vue')
const sceneLibrarySource = readFilmCreateComponent('FilmCreateSceneLibraryDialogs.vue')
const refImageSource = readFilmCreateComponent('FilmCreateResourceRefImageField.vue')
const treeSource = readFilmCreateResourceDialogTree()
const filmCreateSource = readFileSync(new URL('../src/views/FilmCreate.vue', import.meta.url), 'utf8')
const workspaceDialogsSource = readFileSync(new URL('../src/components/filmCreate/FilmCreateWorkspaceDialogs.vue', import.meta.url), 'utf8')

function assertCompiles(name, source) {
  const parsed = parse(source, { filename: name })
  assert.deepEqual(parsed.errors, [])
  assert.doesNotThrow(() => compileScript(parsed.descriptor, { id: name }))
}

test('资源弹窗集合把角色库、道具和场景弹窗交给子组件，制作页入口不变', () => {
  assertCompiles('FilmCreateResourceDialogs.vue', parentSource)
  for (const file of FILM_CREATE_RESOURCE_DIALOG_FILES) {
    const name = file.split('/').pop()
    assertCompiles(name, readFileSync(new URL(file, import.meta.url), 'utf8'))
  }

  assert.match(parentSource, /import FilmCreateCharacterEditDialog from '\.\/FilmCreateCharacterEditDialog\.vue'/)
  assert.match(parentSource, /import FilmCreateCharacterLibraryDialogs from '\.\/FilmCreateCharacterLibraryDialogs\.vue'/)
  assert.match(parentSource, /import FilmCreatePropEditDialog from '\.\/FilmCreatePropEditDialog\.vue'/)
  assert.match(parentSource, /import FilmCreateSceneEditDialog from '\.\/FilmCreateSceneEditDialog\.vue'/)
  assert.match(parentSource, /import FilmCreatePropLibraryDialogs from '\.\/FilmCreatePropLibraryDialogs\.vue'/)
  assert.match(parentSource, /import FilmCreateSceneLibraryDialogs from '\.\/FilmCreateSceneLibraryDialogs\.vue'/)
  assert.match(parentSource, /<FilmCreatePropEditDialog/)
  assert.match(parentSource, /<FilmCreateSceneEditDialog/)
  assert.match(parentSource, /v-model:show-add-prop="showAddProp"/)
  assert.match(parentSource, /v-model:show-edit-scene="showEditScene"/)
  assert.doesNotMatch(parentSource, /aria-label="道具名称"/)
  assert.doesNotMatch(parentSource, /aria-label="场景地点"/)
  assert.doesNotMatch(parentSource, /aria-label="搜索角色素材"/)
  assert.doesNotMatch(parentSource, /<AccessibleDialog/)

  assert.match(workspaceDialogsSource, /<FilmCreateResourceDialogs/)
  assert.match(filmCreateSource, /<FilmCreateWorkspaceDialogs/)
  assert.doesNotMatch(filmCreateSource, /<FilmCreatePropEditDialog/)
  assert.doesNotMatch(filmCreateSource, /<FilmCreateSceneEditDialog/)
})

test('抽出的参考图上传区保留提取互斥提示', () => {
  assert.match(refImageSource, /class="ref-image-box"/)
  assert.match(refImageSource, /:aria-label="selectAriaLabel"/)
  assert.match(refImageSource, /点击或拖入参考图/)
  assert.match(refImageSource, /pendingExtractTitle: \{ type: String, default: '正在提取特征描述，请稍候' \}/)
  assert.match(refImageSource, /savedExtractTitle: \{ type: String, default: '正在提取描述，请稍候' \}/)
  assert.match(refImageSource, /extracting \? pendingExtractTitle : undefined/)
  assert.match(propEditSource, /<FilmCreateResourceRefImageField/)
  assert.match(sceneEditSource, /<FilmCreateResourceRefImageField/)
  assert.equal((propEditSource.match(/<FilmCreateResourceRefImageField/g) || []).length, 2)
  assert.equal((sceneEditSource.match(/<FilmCreateResourceRefImageField/g) || []).length, 1)
})

test('道具和场景弹窗保留保存中文原因，资源库保留删除按钮', () => {
  assert.match(propEditSource, /addPropSaving \? '正在保存道具，请稍候'/)
  assert.match(propEditSource, /editPropSaving \? '正在保存道具，请稍候'/)
  assert.match(propEditSource, /请先填写名称/)
  assert.match(sceneEditSource, /editSceneSaving \? '正在保存场景，请稍候'/)
  assert.match(sceneEditSource, /请先填写地点/)
  assert.match(charLibrarySource, /title="认证资产详情"/)
  assert.match(charLibrarySource, /正在保存公共角色，请稍候/)
  assert.match(propLibrarySource, /正在保存公共道具，请稍候/)
  assert.match(sceneLibrarySource, /正在保存公共场景，请稍候/)
  assert.match(charLibrarySource, />删除<\/el-button>/)
  assert.match(propLibrarySource, />删除<\/el-button>/)
  assert.match(sceneLibrarySource, />删除<\/el-button>/)
  assert.doesNotMatch(treeSource, /正在生成图片，请稍候/)
  assert.doesNotMatch(treeSource, /正在上传图片，请稍候/)
  assert.doesNotMatch(treeSource, /title="删除确认"/)
  assert.equal(
    [...treeSource.matchAll(/:disabled="Boolean\(addToEpisodeDisabledReason\)" :title="addToEpisodeDisabledReason \|\| undefined"/g)].length,
    6,
  )
})
