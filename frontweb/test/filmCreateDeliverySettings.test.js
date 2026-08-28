import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  FILM_CREATE_DELIVERY_SETTING_KEYS,
  applyFilmCreateDeliverySettingsSnapshot,
  snapshotFilmCreateDeliverySettings,
  useFilmCreateDeliverySettings,
} from '../src/composables/filmCreate/useFilmCreateDeliverySettings.js'

const DRAMA_ID = 11
const EPISODE_ID = 22
assert.notEqual(DRAMA_ID, EPISODE_ID)

const filmCreateSource = readFileSync(new URL('../src/views/FilmCreate.vue', import.meta.url), 'utf8')

test('成片设置默认值正确，且不保存 dramaId/episodeId', () => {
  const settings = useFilmCreateDeliverySettings()
  assert.deepEqual(FILM_CREATE_DELIVERY_SETTING_KEYS, [
    'generationStyle',
    'projectAspectRatio',
    'videoClipDuration',
    'videoMusic',
    'videoSfx',
    'videoQuality',
    'videoSubtitle',
    'videoBurnDialogue',
    'videoWatermark',
    'videoWatermarkText',
  ])
  assert.equal(settings.projectAspectRatio.value, '16:9')
  assert.equal(settings.videoClipDuration.value, 5)
  assert.equal(settings.videoQuality.value, 'high')
  assert.equal(settings.videoSubtitle.value, false)
  assert.equal(settings.videoBurnDialogue.value, false)
  const snapshot = snapshotFilmCreateDeliverySettings(settings)
  assert.equal(Object.prototype.hasOwnProperty.call(snapshot, 'dramaId'), false)
  assert.equal(Object.prototype.hasOwnProperty.call(snapshot, 'episodeId'), false)
  assert.equal(snapshot.videoClipDuration, 5)
})

test('成片设置能 round-trip，dramaId 与 episodeId 不相等也不会写进设置', () => {
  const settings = useFilmCreateDeliverySettings()
  settings.generationStyle.value = 'cinematic'
  settings.videoWatermark.value = true
  settings.videoWatermarkText.value = '本地短剧'
  settings.videoClipDuration.value = 8
  const snapshot = snapshotFilmCreateDeliverySettings(settings)
  settings.generationStyle.value = String(DRAMA_ID)
  settings.videoClipDuration.value = EPISODE_ID
  applyFilmCreateDeliverySettingsSnapshot(settings, snapshot)
  assert.equal(settings.generationStyle.value, 'cinematic')
  assert.equal(settings.videoWatermarkText.value, '本地短剧')
  assert.equal(settings.videoClipDuration.value, 8)
  assert.notEqual(settings.videoClipDuration.value, DRAMA_ID)
  assert.notEqual(settings.videoClipDuration.value, EPISODE_ID)
})

test('制作页把成片设置交给 composable，并继续传给风格和成片入口', () => {
  assert.match(filmCreateSource, /useFilmCreateDeliverySettings\(\)/)
  assert.doesNotMatch(filmCreateSource, /const generationStyle = ref\(''\)/)
  assert.doesNotMatch(filmCreateSource, /const videoWatermarkText = ref\(''\)/)
  assert.match(filmCreateSource, /useFilmCreateStylePrompts\(\{[\s\S]*generationStyle/)
  assert.match(filmCreateSource, /v-model:generation-style="generationStyle"/)
  assert.match(filmCreateSource, /v-model:watermark-text="videoWatermarkText"/)
})
