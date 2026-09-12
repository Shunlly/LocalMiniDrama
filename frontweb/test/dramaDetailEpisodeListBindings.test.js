import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { effectScope, ref } from 'vue'

import { createDramaDetailEpisodeListBindings } from '../src/components/dramaDetail/dramaDetailEpisodeListBindings.js'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const pageSource = read('../src/views/DramaDetail.vue')
const helperSource = read('../src/components/dramaDetail/dramaDetailEpisodeListBindings.js')
const pageBindingsSource = read('../src/components/dramaDetail/dramaDetailPageBindings.js')

test('剧集列表绑定只装配已有状态，不把剧集 ID 当成项目 ID', () => {
  assert.match(pageSource, /createDramaDetailPageBindings\(/)
  assert.match(pageSource, /<DramaDetailEpisodeList ref="episodeBatchImportDialogRef" v-bind="episodeListBindings" \/>/)
  assert.match(pageBindingsSource, /createDramaDetailEpisodeListBindings\(/)
  assert.match(helperSource, /export function createDramaDetailEpisodeListBindings\(/)
  const DRAMA_ID = 11
  const EPISODE_ID = 22
  assert.notEqual(DRAMA_ID, EPISODE_ID)
  const scope = effectScope()
  try {
    const bag = scope.run(() => createDramaDetailEpisodeListBindings({
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
    }))
    assert.equal(bag.value.dramaId, DRAMA_ID)
    assert.equal(bag.value.episodes[0].id, EPISODE_ID)
    assert.notEqual(bag.value.dramaId, bag.value.episodes[0].id)
    assert.equal(bag.value.nextEpisodeNumber, 2)
  } finally {
    scope.stop()
  }
})
