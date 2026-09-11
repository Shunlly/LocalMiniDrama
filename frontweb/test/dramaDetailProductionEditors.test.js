import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ref } from 'vue'

import { createDramaDetailProductionEditors } from '../src/components/dramaDetail/dramaDetailProductionEditors.js'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const pageSource = read('../src/views/DramaDetail.vue')
const helperSource = read('../src/components/dramaDetail/dramaDetailProductionEditors.js')

test('制作资源 open/save 写回角色字段且不把剧集 ID 当成项目 ID', async () => {
  assert.match(pageSource, /createDramaDetailProductionEditors\(/)
  assert.match(helperSource, /function openEditDramaChar\(/)
  assert.match(helperSource, /await characterAPI\.update\(editDramaCharForm\.value\.id/)
  const DRAMA_ID = 11
  const CHARACTER_ID = 41
  const EPISODE_ID = 22
  assert.notEqual(DRAMA_ID, CHARACTER_ID)
  assert.notEqual(CHARACTER_ID, EPISODE_ID)
  const events = []
  const editDramaCharVisible = ref(false)
  const editDramaCharForm = ref(null)
  const editDramaCharSaving = ref(false)
  const editors = createDramaDetailProductionEditors({
    dramaId: DRAMA_ID,
    loadDrama: () => events.push(['loadDrama', DRAMA_ID]),
    captureResourceEditorBaseline: (kind) => events.push(['baseline', kind]),
    editDramaCharVisible,
    editDramaCharForm,
    editDramaCharSaving,
    editDramaSceneVisible: ref(false),
    editDramaSceneForm: ref(null),
    editDramaSceneSaving: ref(false),
    editDramaPropVisible: ref(false),
    editDramaPropForm: ref(null),
    editDramaPropSaving: ref(false),
    characterAPI: {
      async update(id, payload) {
        events.push(['update', id, payload])
      },
    },
    sceneAPI: {},
    propAPI: {},
    uploadAPI: {},
    taskAPI: {},
    ElMessage: {
      success(message) { events.push(['success', message]) },
      error(message) { events.push(['error', message]) },
    },
    toUserError: (error, fallback) => error?.message || fallback,
  })
  editors.openEditDramaChar({
    id: CHARACTER_ID,
    name: '阿宁',
    role: 'main',
    description: '雨巷主角',
    personality: '',
    appearance: '',
    image_url: '',
    local_path: null,
  })
  assert.equal(editDramaCharVisible.value, true)
  assert.equal(editDramaCharForm.value.id, CHARACTER_ID)
  assert.notEqual(editDramaCharForm.value.id, DRAMA_ID)
  assert.deepEqual(events, [['baseline', 'dramaChar']])
  await editors.saveDramaChar()
  assert.equal(editDramaCharVisible.value, false)
  assert.equal(events.at(-3)[0], 'update')
  assert.equal(events.at(-3)[1], CHARACTER_ID)
  assert.equal(events.at(-2)[0], 'success')
  assert.equal(events.at(-1)[0], 'loadDrama')
  assert.equal(events.at(-1)[1], DRAMA_ID)
})
