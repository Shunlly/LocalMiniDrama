import test, { describe } from 'node:test'
import assert from 'node:assert/strict'

import { ElMessage } from '../src/utils/elementPlusFeedback.js'
import { useFilmCreateStoryboardCrud } from '../src/composables/filmCreate/useFilmCreateStoryboardCrud.js'

const DRAMA_ID = 7
const EPISODE_ID = 21
const STORYBOARD_ID = 101
const NEXT_STORYBOARD_ID = 202
assert.notEqual(DRAMA_ID, EPISODE_ID)
assert.notEqual(STORYBOARD_ID, NEXT_STORYBOARD_ID)
assert.notEqual(DRAMA_ID, STORYBOARD_ID)
assert.notEqual(EPISODE_ID, NEXT_STORYBOARD_ID)

describe('filmCreateStoryboardInsertAfter', () => {
  let restoreMessages = () => {}

  function captureMessages() {
    const sink = { warning: [], error: [], success: [] }
    const original = {
      warning: ElMessage.warning,
      error: ElMessage.error,
      success: ElMessage.success,
    }
    ElMessage.warning = (message) => { sink.warning.push(message) }
    ElMessage.error = (message) => { sink.error.push(message) }
    ElMessage.success = (message) => { sink.success.push(message) }
    restoreMessages = () => {
      ElMessage.warning = original.warning
      ElMessage.error = original.error
      ElMessage.success = original.success
      restoreMessages = () => {}
    }
    return sink
  }

  test.afterEach(() => restoreMessages())

  test('missing episode warns in Chinese and does not call APIs', async () => {
    const messages = captureMessages()
    const inserts = []
    const creates = []
    const crud = useFilmCreateStoryboardCrud({
      currentEpisodeId: { value: null },
      dramaId: { value: DRAMA_ID },
      store: { storyboards: [{ id: STORYBOARD_ID, episode_id: EPISODE_ID, storyboard_number: 1 }] },
      storyboardsAPI: {
        insertBefore: async (id) => { inserts.push(id) },
        create: async (payload) => { creates.push(payload) },
      },
      loadDrama: async () => {},
    })
    await crud.onInsertStoryboardAfter({ id: STORYBOARD_ID, episode_id: EPISODE_ID })
    assert.equal(messages.warning.at(-1), '请先选择剧集')
    assert.deepEqual(inserts, [])
    assert.deepEqual(creates, [])
  })

  test('middle storyboard inserts before the next id, never using drama or current ids as the pivot', async () => {
    const messages = captureMessages()
    const inserts = []
    const creates = []
    const loads = []
    const crud = useFilmCreateStoryboardCrud({
      currentEpisodeId: { value: EPISODE_ID },
      dramaId: { value: DRAMA_ID },
      store: {
        storyboards: [
          { id: STORYBOARD_ID, episode_id: EPISODE_ID, storyboard_number: 1 },
          { id: NEXT_STORYBOARD_ID, episode_id: EPISODE_ID, storyboard_number: 2 },
        ],
      },
      storyboardsAPI: {
        insertBefore: async (id) => { inserts.push(id) },
        create: async (payload) => { creates.push(payload) },
      },
      loadDrama: async () => { loads.push('loaded') },
    })
    await crud.onInsertStoryboardAfter({ id: STORYBOARD_ID, episode_id: EPISODE_ID })
    assert.deepEqual(inserts, [NEXT_STORYBOARD_ID])
    assert.equal(inserts[0], NEXT_STORYBOARD_ID)
    assert.notEqual(inserts[0], STORYBOARD_ID)
    assert.notEqual(inserts[0], DRAMA_ID)
    assert.notEqual(inserts[0], EPISODE_ID)
    assert.deepEqual(creates, [])
    assert.deepEqual(loads, ['loaded'])
    assert.equal(messages.success.at(-1), '已在此位置后新增空白分镜')
  })

  test('last storyboard appends to the current episode, not the drama id', async () => {
    const messages = captureMessages()
    const inserts = []
    const creates = []
    const loads = []
    const crud = useFilmCreateStoryboardCrud({
      currentEpisodeId: { value: EPISODE_ID },
      dramaId: { value: DRAMA_ID },
      store: {
        storyboards: [
          { id: DRAMA_ID, episode_id: DRAMA_ID, storyboard_number: 99 },
          { id: STORYBOARD_ID, episode_id: EPISODE_ID, storyboard_number: 4 },
        ],
      },
      storyboardsAPI: {
        insertBefore: async (id) => { inserts.push(id) },
        create: async (payload) => { creates.push(payload) },
      },
      loadDrama: async () => { loads.push('loaded') },
    })
    await crud.onInsertStoryboardAfter({ id: STORYBOARD_ID, episode_id: EPISODE_ID })
    assert.deepEqual(inserts, [])
    assert.equal(creates.length, 1)
    assert.equal(creates[0].episode_id, EPISODE_ID)
    assert.notEqual(creates[0].episode_id, DRAMA_ID)
    assert.equal(creates[0].storyboard_number, 5)
    assert.equal(creates[0].title, '镜头 5')
    assert.deepEqual(loads, ['loaded'])
    assert.equal(messages.success.at(-1), '已在此位置后新增空白分镜')
  })
})
