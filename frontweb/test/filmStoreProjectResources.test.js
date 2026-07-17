import test from 'node:test'
import assert from 'node:assert/strict'

import { createPinia, setActivePinia } from 'pinia'

import { useFilmStore } from '../src/stores/film.js'
import { buildProjectReadiness } from '../src/utils/projectReadiness.js'
import { collectStoryboardReferenceSlots } from '../src/utils/storyboardVideoRequest.js'

function createStoreWithProjectResources() {
  setActivePinia(createPinia())
  const store = useFilmStore()
  const firstEpisode = {
    id: 101,
    characters: [{ id: 1, name: 'Episode-only character view' }],
    scenes: [{ id: 11, location: 'Episode-only scene view' }],
    props: [{ id: 21, name: 'Episode-only prop view' }],
    storyboards: [{ id: 1001 }],
  }
  const secondEpisode = {
    id: 102,
    characters: [{ id: 2, name: 'Second episode character view' }],
    scenes: [{ id: 12, location: 'Second episode scene view' }],
    props: [{ id: 22, name: 'Second episode prop view' }],
    storyboards: [{ id: 1002 }],
  }
  const drama = {
    id: 7,
    characters: [
      { id: 1, name: 'Lead', image_url: '/lead.png' },
      { id: 2, name: 'Partner', local_path: 'characters/partner.png' },
    ],
    scenes: [
      { id: 11, location: 'Office', image_url: '/office.png' },
      { id: 12, location: 'Rooftop', local_path: 'scenes/rooftop.png' },
    ],
    props: [
      { id: 21, name: 'Key', image_url: '/key.png' },
      { id: 22, name: 'Letter', local_path: 'props/letter.png' },
    ],
    episodes: [firstEpisode, secondEpisode],
  }

  store.setDrama(drama)
  store.setCurrentEpisode(firstEpisode)
  return { store, secondEpisode }
}

test('film store exposes project resources instead of the selected episode association views', () => {
  const { store, secondEpisode } = createStoreWithProjectResources()
  const readiness = buildProjectReadiness({ drama: store.drama })
  const projectCounts = [
    store.drama.characters.length,
    store.drama.scenes.length,
    store.drama.props.length,
  ]

  assert.deepEqual(
    [store.characters.length, store.scenes.length, store.props.length],
    projectCounts,
  )
  assert.deepEqual(
    [readiness.counts.characters, readiness.counts.scenes, readiness.counts.props],
    projectCounts,
  )

  store.setCurrentEpisode(secondEpisode)

  assert.deepEqual(store.characters.map((item) => item.id), [1, 2])
  assert.deepEqual(store.scenes.map((item) => item.id), [11, 12])
  assert.deepEqual(store.props.map((item) => item.id), [21, 22])
  assert.deepEqual(store.storyboards.map((item) => item.id), [1002])
})

test('project resources outside the selected episode remain bindable as storyboard references', () => {
  const { store } = createStoreWithProjectResources()

  const slots = collectStoryboardReferenceSlots({
    characters: store.characters,
    scenes: store.scenes,
    props: store.props,
  }, {
    scene_id: 12,
    characters: [2],
    prop_ids: [22],
  })

  assert.deepEqual(slots, [
    { index: 1, kind: 'scene', name: 'Rooftop', url: '/static/scenes/rooftop.png' },
    { index: 2, kind: 'character', name: 'Partner', url: '/static/characters/partner.png' },
    { index: 3, kind: 'prop', name: 'Letter', url: '/static/props/letter.png' },
  ])
})
