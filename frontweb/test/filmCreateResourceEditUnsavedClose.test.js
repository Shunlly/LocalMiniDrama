import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  PROP_EDIT_UNSAVED_CLOSE_MESSAGE,
  RESOURCE_EDIT_UNSAVED_CLOSE_CANCEL_TEXT,
  RESOURCE_EDIT_UNSAVED_CLOSE_CONFIRM_TEXT,
  RESOURCE_EDIT_UNSAVED_CLOSE_TITLE,
  SCENE_EDIT_UNSAVED_CLOSE_MESSAGE,
  captureResourceEditDraft,
  createResourceEditUnsavedCloser,
  isVisibleEditorDraftDirty,
} from '../src/components/filmCreate/filmCreateResourceEditUnsavedClose.js'

function read(rel) {
  return readFileSync(new URL(rel, import.meta.url), 'utf8')
}

test('草稿比对会区分表单和参考图', () => {
  const form = { name: '茶杯' }
  const image = { dataUrl: 'data:image/png;base64,aaa', filename: 'cup.png' }
  const baseline = captureResourceEditDraft(form, image)
  assert.notEqual(captureResourceEditDraft({ name: '茶碗' }, image), baseline)
  assert.notEqual(captureResourceEditDraft(form, { ...image, filename: 'cup2.png' }), baseline)
  assert.equal(captureResourceEditDraft(form, image), baseline)
})

test('无未保存修改时不弹确认并直接关闭', async () => {
  const calls = []
  const closer = createResourceEditUnsavedCloser({
    message: SCENE_EDIT_UNSAVED_CLOSE_MESSAGE,
    confirmBox: async (...args) => {
      calls.push(args)
      throw new Error('should not confirm')
    },
  })
  let closed = false
  await closer.requestClose(() => false, () => { closed = true })
  assert.equal(closed, true)
  assert.deepEqual(calls, [])
})

test('有未保存修改时取消保持打开，确认才关闭', async () => {
  const calls = []
  let allow = false
  const closer = createResourceEditUnsavedCloser({
    message: PROP_EDIT_UNSAVED_CLOSE_MESSAGE,
    confirmBox: async (message, title, options) => {
      calls.push({ message, title, options })
      if (!allow) throw new Error('cancel')
    },
  })
  let closed = false
  await closer.requestClose(() => true, () => { closed = true })
  assert.equal(closed, false)
  allow = true
  await closer.requestClose(() => true, () => { closed = true })
  assert.equal(closed, true)
  assert.equal(calls.length, 2)
  assert.equal(calls[0].message, PROP_EDIT_UNSAVED_CLOSE_MESSAGE)
  assert.equal(calls[0].title, RESOURCE_EDIT_UNSAVED_CLOSE_TITLE)
  assert.equal(calls[0].options.confirmButtonText, RESOURCE_EDIT_UNSAVED_CLOSE_CONFIRM_TEXT)
  assert.equal(calls[0].options.cancelButtonText, RESOURCE_EDIT_UNSAVED_CLOSE_CANCEL_TEXT)
})

test('并发关闭复用同一次确认，取消不会关掉弹窗', async () => {
  let resolveConfirm
  const closer = createResourceEditUnsavedCloser({
    message: SCENE_EDIT_UNSAVED_CLOSE_MESSAGE,
    confirmBox: () => new Promise((_, reject) => {
      resolveConfirm = () => reject(new Error('cancel'))
    }),
  })
  let closed = 0
  const first = closer.requestClose(() => true, () => { closed += 1 })
  const second = closer.requestClose(() => true, () => { closed += 1 })
  resolveConfirm()
  assert.deepEqual(await Promise.all([first, second]), [undefined, undefined])
  assert.equal(closed, 0)
})

test('场景和道具弹窗把取消接到未保存确认', () => {
  const sceneSource = read('../src/components/filmCreate/FilmCreateSceneEditDialog.vue')
  const propSource = read('../src/components/filmCreate/FilmCreatePropEditDialog.vue')
  assert.match(sceneSource, /:before-close="handleSceneDialogBeforeClose"/)
  assert.match(sceneSource, /@click="requestCloseSceneDialog"/)
  assert.match(sceneSource, /SCENE_EDIT_UNSAVED_CLOSE_MESSAGE/)
  assert.doesNotMatch(sceneSource, /window\.confirm/)
  assert.match(propSource, /:before-close="handlePropDialogBeforeClose"/)
  assert.match(propSource, /@click="requestClosePropDialog"/)
  assert.match(propSource, /PROP_EDIT_UNSAVED_CLOSE_MESSAGE/)
  assert.doesNotMatch(propSource, /window\.confirm/)
  assert.match(SCENE_EDIT_UNSAVED_CLOSE_MESSAGE, /场景编辑还没有保存/)
  assert.match(PROP_EDIT_UNSAVED_CLOSE_MESSAGE, /道具编辑还没有保存/)
})

test('未打开的编辑弹窗不算未保存，打开后才比较草稿', () => {
  const draft = captureResourceEditDraft({ name: '茶杯' }, null)
  assert.equal(isVisibleEditorDraftDirty(false, draft, ''), false)
  assert.equal(isVisibleEditorDraftDirty(false, draft, draft), false)
  assert.equal(isVisibleEditorDraftDirty(true, draft, ''), true)
  assert.equal(isVisibleEditorDraftDirty(true, draft, draft), false)
})

test('角色场景道具未保存判定都先看弹窗是否打开', () => {
  const characterSource = read('../src/components/filmCreate/FilmCreateCharacterEditDialog.vue')
  const sceneSource = read('../src/components/filmCreate/FilmCreateSceneEditDialog.vue')
  const propSource = read('../src/components/filmCreate/FilmCreatePropEditDialog.vue')
  assert.match(characterSource, /function hasUnsavedCharacterDraft\(\) \{\s*if \(!showEditCharacter\.value\) return false/)
  assert.match(sceneSource, /isVisibleEditorDraftDirty\(\s*showEditScene\.value,/)
  assert.match(propSource, /isVisibleEditorDraftDirty\(\s*showAddProp\.value,/)
  assert.match(propSource, /isVisibleEditorDraftDirty\(\s*showEditProp\.value,/)
})
