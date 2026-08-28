import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { useFilmCreateProductionCapabilityState } from '../src/composables/filmCreate/useFilmCreateProductionCapabilityState.js'
import { useFilmCreateOmniPolishState } from '../src/composables/filmCreate/useFilmCreateOmniPolishState.js'
import { useFilmCreateInFlightMediaSets } from '../src/composables/filmCreate/useFilmCreateInFlightMediaSets.js'

const DRAMA_ID = 11
const EPISODE_ID = 22
const STORYBOARD_ID = 77
assert.notEqual(DRAMA_ID, EPISODE_ID)
assert.notEqual(STORYBOARD_ID, DRAMA_ID)

const filmCreateSource = readFileSync(new URL('../src/views/FilmCreate.vue', import.meta.url), 'utf8')

test('视频能力和就绪检查默认在加载中', () => {
  const state = useFilmCreateProductionCapabilityState()
  assert.equal(state.videoCapabilityLoading.value, true)
  assert.equal(state.productionReadinessLoading.value, true)
  assert.equal(state.videoCapabilityFailed.value, false)
  assert.equal(state.authoritativeProductionReadiness.value, null)
})

test('全能润色默认未运行', () => {
  const state = useFilmCreateOmniPolishState()
  assert.equal(state.universalOmniPolishRunning.value, false)
  assert.equal(state.universalOmniPolishAbort.value, false)
  assert.deepEqual(state.universalOmniPolishProgress.value, { current: 0, total: 0, label: '' })
  assert.equal(state.videoErrorMsg.value, '')
})

test('进行中集合按分镜 id 记录，不会写入 dramaId 或 episodeId', () => {
  const state = useFilmCreateInFlightMediaSets()
  state.generatingSbImageIds.add(STORYBOARD_ID)
  state.ttsSbIds.add(STORYBOARD_ID)
  state.sbDialogueAudioPaths.value[STORYBOARD_ID] = '/static/a.wav'
  assert.equal(state.generatingSbImageIds.has(STORYBOARD_ID), true)
  assert.equal(state.generatingSbImageIds.has(DRAMA_ID), false)
  assert.equal(state.generatingSbImageIds.has(EPISODE_ID), false)
  assert.equal(state.sbDialogueAudioPaths.value[DRAMA_ID], undefined)
  assert.equal(state.sbNarrationAudioPaths.value[EPISODE_ID], undefined)
})

test('制作页把能力检查、润色进度和进行中集合交给 composable', () => {
  assert.match(filmCreateSource, /useFilmCreateProductionCapabilityState\(\)/)
  assert.match(filmCreateSource, /useFilmCreateOmniPolishState\(\)/)
  assert.match(filmCreateSource, /useFilmCreateInFlightMediaSets\(\)/)
  assert.doesNotMatch(filmCreateSource, /const videoCapabilityLoading = ref\(true\)/)
  assert.doesNotMatch(filmCreateSource, /const universalOmniPolishRunning = ref\(false\)/)
  assert.doesNotMatch(filmCreateSource, /const generatingSbImageIds = reactive\(new Set\(\)\)/)
  assert.match(filmCreateSource, /useFilmCreateTaskRecovery\(\{[\s\S]*generatingSbImageIds/)
  assert.match(filmCreateSource, /useFilmCreateTtsDisableReason\(\{[\s\S]*ttsSbIds/)
  assert.match(filmCreateSource, /useFilmCreateActiveTasks\(\{[\s\S]*universalOmniPolishRunning/)
})
