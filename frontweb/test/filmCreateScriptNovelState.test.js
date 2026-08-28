import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { effectScope, reactive } from 'vue'

import { GEN_RESOURCE } from '../src/stores/generationTaskStore.js'
import {
  applyFilmCreateScriptNovelStateSnapshot,
  snapshotFilmCreateScriptNovelState,
  useFilmCreateScriptNovelState,
} from '../src/composables/filmCreate/useFilmCreateScriptNovelState.js'

const DRAMA_ID = 11
const EPISODE_ID = 22
const OTHER_EPISODE_ID = 33
const OTHER_DRAMA_ID = 22

assert.notEqual(DRAMA_ID, EPISODE_ID)
assert.equal(OTHER_DRAMA_ID, EPISODE_ID)

const filmCreateSource = readFileSync(new URL('../src/views/FilmCreate.vue', import.meta.url), 'utf8')

function createState(overrides = {}) {
  const store = reactive({
    dramaId: DRAMA_ID,
    drama: {
      episodes: [
        { id: EPISODE_ID, episode_number: 1, title: '第一集' },
        { id: OTHER_EPISODE_ID, episode_number: 2, title: '第二集' },
      ],
    },
    ...overrides.store,
  })
  const genStore = {
    getAllRunningTasks: () => overrides.runningTasks || [],
  }
  const scope = effectScope()
  const state = scope.run(() => useFilmCreateScriptNovelState({ store, genStore }))
  return { store, genStore, state, scope }
}

test('剧本/小说/剧集本地状态初始值正确', () => {
  const { state, scope } = createState()
  try {
    assert.equal(state.storyInput.value, '')
    assert.equal(state.storyStyle.value, '')
    assert.equal(state.storyType.value, '')
    assert.equal(state.storyEpisodeCount.value, 1)
    assert.equal(state.storyGenerating.value, false)
    assert.equal(state.scriptWorkbenchMode.value, 'create')
    assert.equal(state.showSelectScriptDialog.value, false)
    assert.equal(state.selectScriptLoading.value, false)
    assert.equal(state.selectScriptImporting.value, false)
    assert.deepEqual(state.selectScriptDramas.value, [])
    assert.equal(state.selectPreviewEpisodeId.value, '')
    assert.equal(state.showNovelImport.value, false)
    assert.equal(state.novelImportMode.value, 'text')
    assert.equal(state.novelText.value, '')
    assert.equal(state.novelFileName.value, '')
    assert.equal(state.novelFileContent.value, '')
    assert.equal(state.novelMaxChapters.value, 10)
    assert.equal(state.novelAiSummarize.value, false)
    assert.equal(state.novelImporting.value, false)
    assert.equal(state.scriptTitle.value, '')
    assert.equal(state.selectedEpisodeId.value, null)
    assert.equal(state.episodeSwitching.value, false)
    assert.equal(state.selectedEpisodeContextLabel.value, '未选择剧集')
    assert.equal(state.savedCurrentEpisodeNumber.value, 1)
    assert.equal(state.scriptLanguage.value, 'zh')
    assert.equal(state.scriptStoryboardStyle.value, '')
    assert.equal(state.scriptGenerating.value, false)
    assert.equal(state.scriptDraftStatus.value, 'saved')
    assert.equal(state.scriptDraftStatusLabel.value, '已保存')
    assert.equal(state.isStoryGenRunning.value, false)
  } finally {
    scope.stop()
  }
})

test('dramaId 与 episodeId 不相等时不会串写剧本和剧集状态', () => {
  const runningTasks = [
    { dramaId: EPISODE_ID, resourceType: GEN_RESOURCE.GENERATE_STORY },
  ]
  const { state, store, scope } = createState({ runningTasks })
  try {
    store.dramaId = DRAMA_ID
    state.selectedEpisodeId.value = EPISODE_ID
    state.storyInput.value = '独立草稿'
    state.novelText.value = '小说正文'
    state.scriptTitle.value = '第一集'
    state.selectScriptDramas.value = [
      { id: DRAMA_ID, title: '当前项目' },
      { id: EPISODE_ID, title: '同号其它项目' },
      { id: 99, title: '其它剧本' },
    ]

    assert.equal(store.dramaId, DRAMA_ID)
    assert.equal(state.selectedEpisodeId.value, EPISODE_ID)
    assert.notEqual(state.selectedEpisodeId.value, store.dramaId)
    assert.deepEqual(
      state.selectableScriptDramas.value.map((item) => item.id),
      [EPISODE_ID, 99],
    )
    assert.equal(state.selectedEpisodeContextLabel.value, '第 1 集 · 第一集')
    assert.equal(state.isStoryGenRunning.value, false)

    state.storyGenerating.value = true
    assert.equal(state.isStoryGenRunning.value, true)
    state.storyGenerating.value = false
    assert.equal(state.isStoryGenRunning.value, false)

    runningTasks.splice(0, 1, { dramaId: DRAMA_ID, resourceType: GEN_RESOURCE.GENERATE_STORY })
    state.scriptGenerating.value = true
    assert.equal(state.isStoryGenRunning.value, true)
    state.scriptGenerating.value = false
    assert.equal(state.isStoryGenRunning.value, true)

    state.selectedEpisodeId.value = OTHER_EPISODE_ID
    assert.equal(state.selectedEpisodeContextLabel.value, '第 2 集 · 第二集')
    assert.equal(store.dramaId, DRAMA_ID)
    assert.notEqual(state.selectedEpisodeId.value, store.dramaId)
  } finally {
    scope.stop()
  }
})

test('剧本/小说/剧集字段能 round-trip', () => {
  const { state, store, scope } = createState()
  try {
    state.storyInput.value = '独立草稿'
    state.storyStyle.value = '爽文'
    state.storyType.value = '都市'
    state.storyEpisodeCount.value = 8
    state.scriptWorkbenchMode.value = 'select'
    state.novelImportMode.value = 'file'
    state.novelText.value = '小说正文'
    state.novelFileName.value = 'book.txt'
    state.novelFileContent.value = 'file-body'
    state.novelMaxChapters.value = 4
    state.novelAiSummarize.value = true
    state.scriptTitle.value = '第一集'
    state.selectedEpisodeId.value = EPISODE_ID
    state.savedCurrentEpisodeNumber.value = 2
    state.scriptLanguage.value = 'en'
    state.scriptStoryboardStyle.value = 'cinematic'
    state.scriptDraftStatus.value = 'dirty'
    state.selectScriptDramas.value = [{ id: 99, title: '其它剧本' }]

    const snapshot = snapshotFilmCreateScriptNovelState(state)
    state.storyInput.value = '被覆盖'
    state.novelText.value = ''
    state.selectedEpisodeId.value = DRAMA_ID
    state.scriptDraftStatus.value = 'error'
    state.selectScriptDramas.value = [{ id: DRAMA_ID, title: '当前项目' }]
    applyFilmCreateScriptNovelStateSnapshot(state, snapshot)

    assert.equal(state.storyInput.value, '独立草稿')
    assert.equal(state.storyStyle.value, '爽文')
    assert.equal(state.novelText.value, '小说正文')
    assert.equal(state.novelFileName.value, 'book.txt')
    assert.equal(state.selectedEpisodeId.value, EPISODE_ID)
    assert.notEqual(state.selectedEpisodeId.value, store.dramaId)
    assert.equal(state.scriptDraftStatus.value, 'dirty')
    assert.equal(state.scriptDraftStatusLabel.value, '未保存')
    assert.deepEqual(state.selectScriptDramas.value.map((item) => item.id), [99])
    assert.equal(state.selectedEpisodeContextLabel.value, '第 1 集 · 第一集')
  } finally {
    scope.stop()
  }
})

test('制作页把剧本状态交给 composable，并继续传给既有工作台入口', () => {
  assert.match(filmCreateSource, /useFilmCreateScriptNovelState\(\{ store, genStore \}\)/)
  assert.doesNotMatch(filmCreateSource, /const storyInput = ref\(''\)/)
  assert.doesNotMatch(filmCreateSource, /const selectedEpisodeId = ref\(null\)/)
  assert.doesNotMatch(filmCreateSource, /const novelText = ref\(''\)/)
  assert.match(filmCreateSource, /v-model:story-input="storyInput"/)
  assert.match(
    filmCreateSource,
    /useFilmCreateScriptWorkspace\(\{[\s\S]*scriptTitle,[\s\S]*selectedEpisodeId,[\s\S]*novelText,[\s\S]*showNovelImport/,
  )
  assert.match(
    filmCreateSource,
    /useFilmCreateProjectLoad\(\{[\s\S]*scriptTitle,[\s\S]*selectedEpisodeId,[\s\S]*savedCurrentEpisodeNumber,[\s\S]*storyInput/,
  )
  assert.match(
    filmCreateSource,
    /useFilmCreateScriptPersistence\(\{[\s\S]*scriptTitle,[\s\S]*storyInput,[\s\S]*storyEpisodeCount/,
  )
})
