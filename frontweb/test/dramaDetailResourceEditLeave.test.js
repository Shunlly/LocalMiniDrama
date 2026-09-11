import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { parse } from '@vue/compiler-sfc'

import { DRAMA_DETAIL_RESOURCE_DIALOG_FILES, readDramaDetailResourceDialogSources } from './helpers/dramaDetailResourceDialogSources.js'
import { isResourceEditDirty, snapshotResourceEdit } from '../src/components/dramaDetail/dramaDetailResourceEditorLeave.js'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const dramaDetailPageSource = read('../src/views/DramaDetail.vue')
const leaveSource = read('../src/components/dramaDetail/dramaDetailResourceEditorLeave.js')
const editorsSource = read('../src/components/dramaDetail/dramaDetailProductionEditors.js')
const imagesSource = read('../src/components/dramaDetail/dramaDetailResourceImages.js')
const autosaveSource = read('../src/components/dramaDetail/dramaDetailInfoAutosave.js')
const listsSource = read('../src/components/dramaDetail/dramaDetailResourceLists.js')
const dramaDetailSource = [dramaDetailPageSource, leaveSource, editorsSource, imagesSource, autosaveSource, listsSource].join('\n')
const dramaDetailHeaderSource = read('../src/components/dramaDetail/DramaDetailHeader.vue')
const dramaDetailDialogsSource = readDramaDetailResourceDialogSources(read)
const imageEditorSource = read('../src/components/dramaDetail/DramaDetailResourceImageEditor.vue')

test('角色场景道具编辑弹窗未保存关闭和离开都要中文确认', () => {
  const editors = [
    ['editDramaCharVisible', 'dramaChar'],
    ['editDramaSceneVisible', 'dramaScene'],
    ['editDramaPropVisible', 'dramaProp'],
    ['editCharVisible', 'char'],
    ['editSceneVisible', 'scene'],
    ['editPropVisible', 'prop'],
  ]
  for (const [visible, kind] of editors) {
    assert.match(
      dramaDetailDialogsSource,
      new RegExp(`<AccessibleDialog v-model="${visible}"[^>]*:before-close="\\(done\\) => requestResourceEditorClose\\('${kind}', done\\)"`),
    )
    assert.match(
      dramaDetailDialogsSource,
      new RegExp(`@click="requestResourceEditorClose\\('${kind}'\\)">取消`),
    )
    assert.match(
      dramaDetailSource,
      new RegExp(`captureResourceEditorBaseline\\('${kind}'\\)`),
    )
  }
  assert.match(
    dramaDetailSource,
    /async function confirmInfoLeave\(\) \{\s*if \(\(await confirmBatchImportLeave\(\)\) === false\) return false\s*if \(\(await confirmResourceEditLeave\(\)\) === false\) return false/,
  )
  assert.match(
    dramaDetailSource,
    /function handleInfoBeforeUnload\(event\) \{\s*if \(!shouldProtectInfoLeave\.value && !episodeBatchImportDialogRef\.value\?\.hasUnsavedWork\?\.\(\) && !hasUnsavedResourceEdits\(\)\) return/,
  )
  assert.match(dramaDetailSource, /当前角色、场景或道具尚未保存，关闭后本次修改会丢失。/)
  assert.match(dramaDetailSource, /放弃未保存修改？/)
  assert.match(dramaDetailSource, /confirmButtonText: '放弃修改'/)
  assert.match(dramaDetailSource, /cancelButtonText: '继续编辑'/)
  const untitledForms = [
    'editDramaCharForm',
    'editDramaSceneForm',
    'editDramaPropForm',
    'editCharForm',
    'editSceneForm',
    'editPropForm',
  ]
  assert.match(imageEditorSource, /const previewTitle = computed\(\(\) => \(imageUrl\.value \? undefined : '暂无图片'\)\)/)
  for (const form of untitledForms) {
    assert.match(
      dramaDetailDialogsSource,
      new RegExp(`<DramaDetailResourceImageEditor\\s+:form="${form}"`),
    )
  }
  assert.match(dramaDetailHeaderSource, /<header class="header">/)
  assert.match(dramaDetailPageSource, /@go-list="goList"/)
  for (const visible of [
    'editDramaCharVisible',
    'editDramaSceneVisible',
    'editDramaPropVisible',
    'editCharVisible',
    'editSceneVisible',
    'editPropVisible',
  ]) {
    assert.equal(dramaDetailSource.includes(`@click="${visible} = false"`), false)
    assert.equal(dramaDetailDialogsSource.includes(`@click="${visible} = false"`), false)
  }
  assert.match(dramaDetailSource, /await characterAPI\.update\(editDramaCharForm\.value\.id/)
  assert.match(dramaDetailSource, /await sceneAPI\.update\(editDramaSceneForm\.value\.id/)
  assert.match(dramaDetailSource, /await propAPI\.update\(editDramaPropForm\.value\.id/)
  assert.match(dramaDetailSource, /await characterLibraryAPI\.update\(editCharForm\.value\.id/)
  assert.match(dramaDetailSource, /editDramaCharVisible\.value = false/)
  assert.match(dramaDetailSource, /editCharVisible\.value = false/)
  assert.match(dramaDetailPageSource, /<DramaDetailResourceDialogs v-bind="resourceDialogsBindings"/)
  assert.match(dramaDetailPageSource, /from '@\/utils\/elementPlusFeedback\.js'/)
  assert.doesNotMatch(dramaDetailPageSource, /from 'element-plus'/)
  assert.match(leaveSource, /当前角色、场景或道具尚未保存，关闭后本次修改会丢失。/)
  assert.match(editorsSource, /await characterAPI\.update\(editDramaCharForm\.value\.id/)
  assert.match(imagesSource, /export function assetImageUrl\(/)
})

test('资源编辑脏检查只看未保存字段，图片单独变更不算脏', () => {
  const keys = ['name', 'description']
  const baseline = snapshotResourceEdit({ name: '阿宁', description: '主角' }, keys)

  assert.equal(
    isResourceEditDirty(true, { name: '阿宁', description: '主角' }, baseline, keys),
    false,
  )
  assert.equal(
    isResourceEditDirty(true, { name: '阿宁改', description: '主角' }, baseline, keys),
    true,
  )
  assert.equal(
    isResourceEditDirty(true, { name: '阿宁', description: '主角', image_url: 'https://cdn.example/new.png' }, baseline, keys),
    false,
  )
  assert.equal(
    isResourceEditDirty(true, { name: '阿宁', description: '主角', imgGenerating: true }, baseline, keys),
    true,
  )
  assert.equal(
    isResourceEditDirty(false, { name: '阿宁改', description: '主角' }, baseline, keys),
    false,
  )
})

test('剧集详情资源弹窗互斥上传生成并给出中文禁用原因', () => {
  for (const file of DRAMA_DETAIL_RESOURCE_DIALOG_FILES) {
    const parsed = parse(read(file), { filename: file.split('/').pop() })
    assert.deepEqual(parsed.errors, [])
  }
  const forms = [
    'editDramaCharForm',
    'editDramaSceneForm',
    'editDramaPropForm',
    'editCharForm',
    'editSceneForm',
    'editPropForm',
  ]
  assert.match(imageEditorSource, /form\?\.imgGenerating \? '正在生成图片，请稍候' : ''/)
  assert.match(imageEditorSource, /form\?\.imgUploading \? '正在上传图片，请稍候' : ''/)
  assert.match(imageEditorSource, /:disabled="Boolean\(uploadDisabledReason\)"/)
  assert.match(imageEditorSource, /:disabled="Boolean\(generateDisabledReason\)"/)
  for (const form of forms) {
    assert.match(
      dramaDetailDialogsSource,
      new RegExp(`<DramaDetailResourceImageEditor\\s+:form="${form}"`),
    )
  }
  for (const saving of [
    'editDramaCharSaving',
    'editDramaSceneSaving',
    'editDramaPropSaving',
    'editCharSaving',
    'editSceneSaving',
    'editPropSaving',
  ]) {
    assert.match(
      dramaDetailDialogsSource,
      new RegExp(`:loading="${saving}" :disabled="${saving}" :title="${saving} \\? '正在保存，请稍候' : undefined"`),
    )
  }
})
