import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { effectScope } from 'vue'

import { createDramaDetailResourceImport } from '../src/components/dramaDetail/dramaDetailResourceImport.js'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const pageSource = read('../src/views/DramaDetail.vue')
const helperSource = read('../src/components/dramaDetail/dramaDetailResourceImport.js')

test('全局素材导入列表不带 drama_id，写入才用项目 ID', async () => {
  assert.match(pageSource, /createDramaDetailResourceImport\(/)
  assert.match(helperSource, /export function createDramaDetailResourceImport\(/)
  const DRAMA_ID = 11
  const EPISODE_ID = 22
  const ITEM_ID = 41
  assert.notEqual(DRAMA_ID, EPISODE_ID)
  assert.notEqual(ITEM_ID, DRAMA_ID)
  const events = []
  const scope = effectScope()
  try {
    const importer = scope.run(() => createDramaDetailResourceImport({
      dramaId: DRAMA_ID,
      characterLibraryAPI: {
        async list(query) {
          events.push(['list', query])
          return { items: [{ id: ITEM_ID, name: '阿宁' }], pagination: { total: 1 } }
        },
        async create(payload) {
          events.push(['create', payload])
        },
      },
      sceneLibraryAPI: {},
      propLibraryAPI: {},
      loadCharList() { events.push('load-char') },
      loadSceneList() { events.push('load-scene') },
      loadPropList() { events.push('load-prop') },
      ElMessage: {
        success(message) { events.push(['success', message]) },
        error(message) { events.push(['error', message]) },
      },
      dramaDetailUserError: (error, fallback) => error?.message || fallback,
    }))
    importer.openImport('char')
    await importer.loadImportList()
    assert.equal(events[0][0], 'list')
    assert.equal(events[0][1].global, 1)
    assert.equal('drama_id' in events[0][1], false)
    await importer.doImport({ id: ITEM_ID, name: '阿宁', image_url: '/static/a.png' })
    const created = events.find((item) => item[0] === 'create')
    assert.equal(created[1].drama_id, DRAMA_ID)
    assert.notEqual(created[1].drama_id, EPISODE_ID)
    assert.equal(created[1].source_type, 'imported')
    assert.equal(events.includes('load-char'), true)
  } finally {
    scope.stop()
  }
})
