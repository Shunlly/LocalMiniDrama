import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { effectScope, ref } from 'vue'

import { createDramaDetailPageBindings } from '../src/components/dramaDetail/dramaDetailPageBindings.js'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const pageSource = read('../src/views/DramaDetail.vue')
const helperSource = read('../src/components/dramaDetail/dramaDetailPageBindings.js')

test('详情页绑定袋透出项目 ID 和分集 ID，且不把两者混用', () => {
  assert.match(pageSource, /createDramaDetailPageBindings\(/)
  assert.match(pageSource, /v-bind="episodeListBindings"/)
  assert.match(pageSource, /v-bind="resourceLibraryBindings"/)
  assert.match(pageSource, /v-bind="resourceDialogsBindings"/)
  assert.match(helperSource, /export function createDramaDetailPageBindings\(/)
  const DRAMA_ID = 11
  const EPISODE_ID = 22
  assert.notEqual(DRAMA_ID, EPISODE_ID)
  const scope = effectScope()
  try {
    const bags = scope.run(() => createDramaDetailPageBindings({
      addingEpisode: ref(false),
      deletingEpisodeId: ref(null),
      dramaId: DRAMA_ID,
      episodeEmptyState: ref({ title: '还没有剧集' }),
      episodes: ref([{ id: EPISODE_ID, title: '第一集' }]),
      epStatusLabel: (status) => status,
      handleReadinessAction: () => {},
      nextEpisodeNumber: ref(2),
      onAddEpisode: () => {},
      onBatchImportEpisodes: () => {},
      onDeleteEpisode: () => {},
      openEpisodeBatchImport: () => {},
      withProjectListReturnTo: (query) => query,
      activeResTab: ref('lib-char'),
      currentEpisodeId: ref(EPISODE_ID),
      drama: ref({ id: DRAMA_ID, title: '雨巷' }),
      charList: ref([]),
      charKw: ref(''),
      charPage: ref(1),
      charPageSize: ref(20),
      sceneKw: ref(''),
      scenePage: ref(1),
      scenePageSize: ref(20),
      propKw: ref(''),
      propPage: ref(1),
      propPageSize: ref(20),
      editCharVisible: ref(false),
      editCharForm: ref(null),
      editDramaCharVisible: ref(false),
      editDramaCharForm: ref(null),
      editDramaSceneVisible: ref(false),
      editDramaSceneForm: ref(null),
      editDramaPropVisible: ref(false),
      editDramaPropForm: ref(null),
      editSceneVisible: ref(false),
      editSceneForm: ref(null),
      editPropVisible: ref(false),
      editPropForm: ref(null),
      importVisible: ref(false),
      importKw: ref(''),
      importPage: ref(1),
      importPageSize: ref(20),
      previewUrl: ref(null),
    }))
    assert.equal(bags.episodeListBindings.value.dramaId, DRAMA_ID)
    assert.equal(bags.episodeListBindings.value.episodes[0].id, EPISODE_ID)
    assert.notEqual(bags.episodeListBindings.value.dramaId, bags.resourceLibraryBindings.value.currentEpisodeId)
    assert.equal(bags.resourceLibraryBindings.value.currentEpisodeId, EPISODE_ID)
    assert.equal(bags.resourceDialogsBindings.value.currentEpisodeId, EPISODE_ID)
  } finally {
    scope.stop()
  }
})
