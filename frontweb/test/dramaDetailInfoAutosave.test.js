import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ref } from 'vue'

import { createDramaDetailInfoAutosave } from '../src/components/dramaDetail/dramaDetailInfoAutosave.js'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const pageSource = read('../src/views/DramaDetail.vue')
const helperSource = read('../src/components/dramaDetail/dramaDetailInfoAutosave.js')

test('\u5267\u96c6\u4fe1\u606f\u81ea\u52a8\u4fdd\u5b58\u5199\u56de\u9879\u76ee ID\uff0c\u4e0d\u628a\u5206\u96c6 ID \u5f53\u6210\u9879\u76ee ID', async () => {
  assert.match(pageSource, /createDramaDetailInfoAutosave\(/)
  assert.match(helperSource, /function scheduleInfoSave\(\{ immediate = false \} = \{\}\)/)
  assert.match(helperSource, /async function flushInfoSave\(/)
  assert.match(helperSource, /async function retryInfoSave\(/)
  const DRAMA_ID = 11
  const EPISODE_ID = 22
  assert.notEqual(DRAMA_ID, EPISODE_ID)
  const events = []
  const drama = ref({
    id: DRAMA_ID,
    title: '\u672c\u5730\u77ed\u5267',
    description: '',
    genre: '',
    style: '',
    metadata: { aspect_ratio: '16:9' },
  })
  const autosave = createDramaDetailInfoAutosave({
    dramaId: DRAMA_ID,
    drama,
    isDramaReady: ref(true),
    dramaAPI: {
      async update(id, payload) {
        events.push(['update', id, payload])
      },
      async saveOutline(id, payload) {
        events.push(['outline', id, payload])
      },
    },
    ElMessage: { warning() {}, success() {}, error() {} },
    ElMessageBox: { async confirm() { return true } },
    episodeBatchImportDialogRef: ref({
      isImporting: () => false,
      hasUnsavedWork: () => false,
    }),
    confirmResourceEditLeave: async () => true,
    hasUnsavedResourceEdits: () => false,
    dramaDetailUserError: (error, fallback) => error?.message || fallback,
  })
  autosave.syncInfoFormFromDrama(drama.value)
  autosave.infoForm.title = '\u6539\u540e\u7684\u6807\u9898'
  const saved = await autosave.flushInfoSave()
  assert.equal(saved, true)
  assert.equal(events[0][0], 'update')
  assert.equal(events[0][1], DRAMA_ID)
  assert.notEqual(events[0][1], EPISODE_ID)
  assert.equal(events[0][2].title, '\u6539\u540e\u7684\u6807\u9898')
  assert.equal(events[1][0], 'outline')
  assert.equal(events[1][1], DRAMA_ID)
  assert.equal(autosave.infoSaveState.value, 'saved')
  assert.equal(drama.value.title, '\u6539\u540e\u7684\u6807\u9898')
})
