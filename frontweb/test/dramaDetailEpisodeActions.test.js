import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { effectScope, ref } from 'vue'

import { createDramaDetailEpisodeActions, dramaDetailEpisodeDeletedMessage, toDramaDetailEpisodeSavePayload } from '../src/components/dramaDetail/dramaDetailEpisodeActions.js'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const pageSource = read('../src/views/DramaDetail.vue')
const helperSource = read('../src/components/dramaDetail/dramaDetailEpisodeActions.js')

test('剧集删除和批量导入写回项目 ID，不把分集 ID 当成项目 ID', async () => {
  assert.match(pageSource, /createDramaDetailEpisodeActions\(/)
  assert.match(pageSource, /async function onAddEpisode\(/)
  assert.match(helperSource, /export function createDramaDetailEpisodeActions\(/)
  const DRAMA_ID = 11
  const EPISODE_ID = 22
  const OTHER_EPISODE_ID = 33
  assert.notEqual(DRAMA_ID, EPISODE_ID)
  const events = []
  const episodes = ref([
    { id: EPISODE_ID, episode_number: 1, title: '第一集', script_content: 'a', description: null, duration: 0 },
    { id: OTHER_EPISODE_ID, episode_number: 2, title: '第二集', script_content: 'b', description: null, duration: 0 },
  ])
  const scope = effectScope()
  try {
    const actions = scope.run(() => createDramaDetailEpisodeActions({
      dramaId: DRAMA_ID,
      episodes,
      dramaAPI: {
        async saveEpisodes(id, payload) {
          events.push(['save', id, payload])
        },
      },
      ElMessage: {
        success(message) { events.push(['success', message]) },
        error(message) { events.push(['error', message]) },
      },
      ElMessageBox: { async confirm() { return true } },
      loadDrama: async () => { events.push('load') },
      episodeBatchImportDialogRef: ref({ openDialog() { events.push('open-import') } }),
      dramaDetailUserError: (error, fallback) => error?.message || fallback,
      scrollToSection(id) { events.push(['scroll', id]) },
    }))
    await actions.onDeleteEpisode(episodes.value[0])
    assert.equal(events[0][0], 'save')
    assert.equal(events[0][1], DRAMA_ID)
    assert.notEqual(events[0][1], EPISODE_ID)
    assert.equal(events[0][2].length, 1)
    assert.equal(events[0][2][0].title, '第二集')
    const success = events.find((item) => item[0] === 'success')
    assert.match(success[1], /已删除/)
    assert.match(success[1], /继续制作剩余剧集/)
    assert.equal(events.some((item) => item[0] === 'scroll'), false)
    events.length = 0
    await actions.onBatchImportEpisodes([{ episode_number: 3, title: '第三集', script_content: '', description: null, duration: 0 }])
    assert.equal(events[0][1], DRAMA_ID)
    assert.equal(events[0][2].length, 3)
    assert.equal(toDramaDetailEpisodeSavePayload(episodes.value)[0].episode_number, 1)
  } finally {
    scope.stop()
  }
})

test('删光剧集后提示新增或批量导入，并定位到分集列表', async () => {
  assert.match(
    dramaDetailEpisodeDeletedMessage('第 1 集「开篇」', 0),
    /请新增一集或批量导入剧本/,
  )
  const DRAMA_ID = 11
  const EPISODE_ID = 22
  const events = []
  const episodes = ref([
    { id: EPISODE_ID, episode_number: 1, title: '开篇', script_content: 'a', description: null, duration: 0 },
  ])
  const scope = effectScope()
  try {
    const actions = scope.run(() => createDramaDetailEpisodeActions({
      dramaId: DRAMA_ID,
      episodes,
      dramaAPI: {
        async saveEpisodes(id, payload) {
          events.push(['save', id, payload])
        },
      },
      ElMessage: {
        success(message) { events.push(['success', message]) },
        error(message) { events.push(['error', message]) },
      },
      ElMessageBox: { async confirm() { return true } },
      loadDrama: async () => { events.push('load') },
      episodeBatchImportDialogRef: ref({ openDialog() { events.push('open-import') } }),
      dramaDetailUserError: (error, fallback) => error?.message || fallback,
      scrollToSection(id) { events.push(['scroll', id]) },
    }))
    await actions.onDeleteEpisode(episodes.value[0])
    assert.equal(events[0][2].length, 0)
    assert.match(events.find((item) => item[0] === 'success')[1], /请新增一集或批量导入剧本/)
    assert.deepEqual(events.find((item) => item[0] === 'scroll'), ['scroll', 'episode-list'])
  } finally {
    scope.stop()
  }
})
