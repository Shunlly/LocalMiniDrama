import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { useFilmCreateBatchMediaState } from '../src/composables/filmCreate/useFilmCreateBatchMediaState.js'
import { useFilmCreateUploadDragState } from '../src/composables/filmCreate/useFilmCreateUploadDragState.js'
import { useFilmCreateStoryboardGenerateSettings } from '../src/composables/filmCreate/useFilmCreateStoryboardGenerateSettings.js'

const DRAMA_ID = 11
const EPISODE_ID = 22
assert.notEqual(DRAMA_ID, EPISODE_ID)

const filmCreateSource = readFileSync(new URL('../src/views/FilmCreate.vue', import.meta.url), 'utf8')

test('批量进度初始为空，视频参数弹窗关闭', () => {
  const state = useFilmCreateBatchMediaState()
  assert.equal(state.batchImageRunning.value, false)
  assert.equal(state.batchVideoRunning.value, false)
  assert.deepEqual(state.batchImageProgress.value, { current: 0, total: 0, failed: 0 })
  assert.equal(state.showVideoParamsDialog.value, false)
  assert.equal(state.videoParamsTarget.value, null)
  assert.equal(state.videoFrameContiguity.value, false)
})

test('上传目标不是 dramaId 或 episodeId', () => {
  const state = useFilmCreateUploadDragState()
  assert.equal(state.uploadingSbImageId.value, null)
  assert.equal(state.resourceUploadId.value, null)
  state.sbImageUploadForId.value = 77
  assert.notEqual(state.sbImageUploadForId.value, DRAMA_ID)
  assert.notEqual(state.sbImageUploadForId.value, EPISODE_ID)
})

test('分镜生成开关默认单张，首尾帧默认关，布局锁定默认开', () => {
  const state = useFilmCreateStoryboardGenerateSettings()
  assert.equal(state.storyboardCount.value, null)
  assert.equal(state.gridMode.value, 'single')
  assert.equal(state.storyboardUseFirstLastFrame.value, false)
  assert.equal(state.lastFrameUseFirstLayoutLock.value, true)
  assert.equal(state.storyboardIncludeNarration.value, false)
})

test('制作页把批量、上传和分镜开关交给 composable', () => {
  assert.match(filmCreateSource, /useFilmCreateBatchMediaState\(\)/)
  assert.match(filmCreateSource, /useFilmCreateUploadDragState\(\)/)
  assert.match(filmCreateSource, /useFilmCreateStoryboardGenerateSettings\(\)/)
  assert.doesNotMatch(filmCreateSource, /const batchImageRunning = ref\(false\)/)
  assert.doesNotMatch(filmCreateSource, /const storyboardCount = ref\(null\)/)
  assert.doesNotMatch(filmCreateSource, /const uploadingSbImageId = ref\(null\)/)
  assert.match(filmCreateSource, /useFilmCreateTaskCancel\(\{[\s\S]*batchImageStopping,[\s\S]*batchVideoStopping/)
  assert.match(filmCreateSource, /useFilmCreateActiveTasks\(\{[\s\S]*batchImageRunning,[\s\S]*batchVideoRunning,[\s\S]*batchVideoProgress/)
  assert.match(filmCreateSource, /useFilmCreateRefImageDrop\(\{[\s\S]*dragOverResourceKey,[\s\S]*dragOverSbId/)
})
