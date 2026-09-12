import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ref } from 'vue'

import { createDramaDetailResourceLists, dramaDetailResourceDeletedMessage } from '../src/components/dramaDetail/dramaDetailResourceLists.js'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const pageSource = read('../src/views/DramaDetail.vue')
const helperSource = read('../src/components/dramaDetail/dramaDetailResourceLists.js')

test('\u672c\u5267\u89d2\u8272\u5e93\u5217\u8868\u8bf7\u6c42\u5e26 drama_id\uff0c\u4fdd\u5b58\u8d70\u89d2\u8272 ID', async () => {
  assert.match(pageSource, /createDramaDetailResourceLists\(/)
  assert.match(helperSource, /async function loadCharList\(/)
  assert.match(helperSource, /async function saveChar\(/)
  const DRAMA_ID = 11
  const EPISODE_ID = 22
  const CHAR_ID = 41
  assert.notEqual(DRAMA_ID, EPISODE_ID)
  assert.notEqual(CHAR_ID, DRAMA_ID)
  const events = []
  const editCharForm = ref(null)
  const editCharVisible = ref(false)
  const editCharSaving = ref(false)
  const lists = createDramaDetailResourceLists({
    dramaId: DRAMA_ID,
    characterLibraryAPI: {
      async list(query) {
        events.push(['list', query])
        return { items: [{ id: CHAR_ID, name: '\u963f\u5b81' }], pagination: { total: 1 } }
      },
      async update(id, payload) {
        events.push(['update', id, payload])
      },
    },
    sceneLibraryAPI: {},
    propLibraryAPI: {},
    ElMessage: {
      success(message) { events.push(['success', message]) },
      error(message) { events.push(['error', message]) },
    },
    ElMessageBox: { async confirm() { return true } },
    captureResourceEditorBaseline(kind) { events.push(['baseline', kind]) },
    editCharForm,
    editCharVisible,
    editCharSaving,
    editSceneForm: ref(null),
    editSceneVisible: ref(false),
    editSceneSaving: ref(false),
    editPropForm: ref(null),
    editPropVisible: ref(false),
    editPropSaving: ref(false),
    dramaDetailUserError: (error, fallback) => error?.message || fallback,
  })
  await lists.loadCharList()
  assert.equal(events[0][0], 'list')
  assert.equal(events[0][1].drama_id, DRAMA_ID)
  assert.notEqual(events[0][1].drama_id, EPISODE_ID)
  assert.equal(lists.charList.value[0].id, CHAR_ID)
  lists.openEditChar({ id: CHAR_ID, name: '\u963f\u5b81', category: '', description: '', tags: '', image_url: '', local_path: null })
  assert.equal(editCharVisible.value, true)
  assert.equal(editCharForm.value.id, CHAR_ID)
  await lists.saveChar()
  const updated = events.find((item) => item[0] === 'update')
  assert.equal(updated[0], 'update')
  assert.equal(updated[1], CHAR_ID)
  assert.notEqual(updated[1], DRAMA_ID)
  assert.equal(editCharVisible.value, false)
})

test('资源删除确认与成功提示都是可操作的中文下一步', async () => {
  assert.match(dramaDetailResourceDeletedMessage('阿宁'), /可以从素材库重新导入/)
  assert.match(dramaDetailResourceDeletedMessage('阿宁'), /在制作页提取后再入库/)
  assert.doesNotMatch(dramaDetailResourceDeletedMessage('阿宁'), /前往制作页新增并入库/)
  const events = []
  const lists = createDramaDetailResourceLists({
    dramaId: 11,
    characterLibraryAPI: {
      async list() { events.push('reload'); return { items: [], pagination: { total: 0 } } },
      async delete(id) { events.push(['delete', id]) },
    },
    sceneLibraryAPI: {},
    propLibraryAPI: {},
    ElMessage: {
      success(message) { events.push(['success', message]) },
      error(message) { events.push(['error', message]) },
    },
    ElMessageBox: {
      async confirm(_message, _title, options) {
        events.push(['confirm', options.confirmButtonText, options.cancelButtonText])
        return true
      },
    },
    captureResourceEditorBaseline() {},
    editCharForm: ref(null),
    editCharVisible: ref(false),
    editCharSaving: ref(false),
    editSceneForm: ref(null),
    editSceneVisible: ref(false),
    editSceneSaving: ref(false),
    editPropForm: ref(null),
    editPropVisible: ref(false),
    editPropSaving: ref(false),
    dramaDetailUserError: (error, fallback) => error?.message || fallback,
  })
  await lists.deleteChar({ id: 41, name: '阿宁' })
  assert.deepEqual(events[0], ['confirm', '删除该角色', '取消删除'])
  assert.deepEqual(events[1], ['delete', 41])
  assert.match(events[2][1], /已删除「阿宁」/)
  assert.equal(events[3], 'reload')
})
