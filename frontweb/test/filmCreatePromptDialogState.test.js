import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { useFilmCreatePromptDialogState } from '../src/composables/filmCreate/useFilmCreatePromptDialogState.js'

const DRAMA_ID = 11
const EPISODE_ID = 22
const STORYBOARD_ID = 77
assert.notEqual(DRAMA_ID, EPISODE_ID)
assert.notEqual(STORYBOARD_ID, DRAMA_ID)
assert.notEqual(STORYBOARD_ID, EPISODE_ID)

const filmCreateSource = readFileSync(new URL('../src/views/FilmCreate.vue', import.meta.url), 'utf8')

test('提示词弹窗初始关闭，当前目标不是项目或剧集 id', () => {
  const state = useFilmCreatePromptDialogState()
  assert.equal(state.showSbPromptDialog.value, false)
  assert.equal(state.showFramePromptEditor.value, false)
  assert.equal(state.editingFramePromptSlot.value, 'first')
  assert.equal(state.sbPromptTarget.value, null)
  assert.equal(state.editingSbVideoPromptId.value, null)
})

test('打开提示词弹窗只绑定分镜 id，不会写成 dramaId 或 episodeId', () => {
  const state = useFilmCreatePromptDialogState()
  state.showSbPromptDialog.value = true
  state.sbPromptTarget.value = { id: STORYBOARD_ID, storyboard_number: 3 }
  state.editingSbVideoPromptId.value = STORYBOARD_ID
  state.editingFramePromptSb.value = { id: STORYBOARD_ID }
  assert.equal(state.sbPromptTarget.value.id, STORYBOARD_ID)
  assert.notEqual(state.sbPromptTarget.value.id, DRAMA_ID)
  assert.notEqual(state.sbPromptTarget.value.id, EPISODE_ID)
  assert.equal(state.editingSbVideoPromptId.value, STORYBOARD_ID)
  assert.notEqual(state.editingSbVideoPromptId.value, EPISODE_ID)
})

test('制作页把提示词弹窗状态交给 composable，并继续传给分镜弹窗', () => {
  assert.match(filmCreateSource, /useFilmCreatePromptDialogState\(\)/)
  assert.doesNotMatch(filmCreateSource, /const showSbPromptDialog = ref\(false\)/)
  assert.doesNotMatch(filmCreateSource, /const editingFramePromptSb = ref\(null\)/)
  assert.match(filmCreateSource, /v-model:show-sb-prompt-dialog="showSbPromptDialog"/)
  assert.match(
    filmCreateSource,
    /useFilmCreateStoryboardPrompts\(\{[\s\S]*sbPromptTarget,[\s\S]*showSbPromptDialog/,
  )
})
