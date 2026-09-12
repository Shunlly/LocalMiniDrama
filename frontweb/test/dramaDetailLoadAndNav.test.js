import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ref } from 'vue'

import { createDramaDetailLoadAndNav } from '../src/components/dramaDetail/dramaDetailLoadAndNav.js'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const pageSource = read('../src/views/DramaDetail.vue')
const helperSource = read('../src/components/dramaDetail/dramaDetailLoadAndNav.js')

if (typeof globalThis.document === 'undefined') {
  globalThis.document = {
    getElementById() { return null },
    querySelector() { return null },
  }
}
if (typeof globalThis.window === 'undefined') {
  globalThis.window = {
    scrollY: 0,
    scrollTo() {},
    setTimeout,
  }
}

function createNav(overrides = {}) {
  const DRAMA_ID = 11
  const EPISODE_ID = 22
  const events = []
  const drama = ref(overrides.drama ?? { id: DRAMA_ID, title: '\u672c\u5730\u77ed\u5267', episodes: [] })
  const episodes = ref(overrides.episodes ?? [])
  const loading = ref(false)
  const dramaLoadState = ref('ready')
  const dramaLoadError = ref('')
  const dramaLoadNotFound = ref(false)
  const isDramaReady = ref(true)
  const nav = createDramaDetailLoadAndNav({
    dramaId: DRAMA_ID,
    drama,
    episodes,
    loading,
    dramaLoadState,
    dramaLoadError,
    dramaLoadNotFound,
    dramaLoadFailureRef: ref({ focus() { events.push('focus') } }),
    isDramaReady,
    readinessDependencyState: ref('idle'),
    readinessDependencyError: ref(''),
    hasReadinessSnapshot: ref(false),
    aiConfigs: ref([]),
    sourceCount: ref(0),
    projectLifecycle: {
      guardApi() {
        return {
          async get() {
            const error = new Error('missing')
            error.status = 404
            throw error
          },
          async saveOutline() {},
        }
      },
    },
    aiAPI: { async list() { return [] } },
    sourceIntakeAPI: { async listForDrama() { return [] } },
    ElMessage: {
      warning(message) { events.push(['warning', message]) },
      error(message) { events.push(['error', message]) },
    },
    router: { push(target) { events.push(['push', target]) } },
    route: { fullPath: '/drama/11', query: {} },
    projectListReturnTo: ref('/?q=rain'),
    currentEpisodeId: ref(overrides.currentEpisodeId ?? null),
    syncInfoFormFromDrama() { events.push('sync') },
    clearInfoSaveTimer() { events.push('clear-timer') },
    infoSaveScheduled: ref(false),
    infoSaveError: ref(''),
    infoSaveState: ref('saved'),
    loadCharList: async () => { events.push('load-char') },
  })
  return { DRAMA_ID, EPISODE_ID, events, drama, episodes, loading, dramaLoadState, dramaLoadError, dramaLoadNotFound, nav }
}

test('\u52a0\u8f7d\u5931\u8d25\u548c\u5bfc\u822a\u90fd\u8d70\u9879\u76ee ID\uff0c\u7f3a\u5c11\u5206\u96c6\u65f6\u4e0d\u76f4\u63a5\u8fdb\u5165\u5236\u4f5c', async () => {
  assert.match(pageSource, /createDramaDetailLoadAndNav\(/)
  assert.match(helperSource, /async function loadDrama\(/)
  assert.match(helperSource, /function handleReadinessAction\(/)
  assert.match(helperSource, /focusSectionField\(id, '\[aria-label="网页 URL"\]'/)
  assert.match(helperSource, /function goList\(/)
  const missing = createNav()
  const loaded = await missing.nav.loadDrama({ blocking: true })
  assert.equal(loaded, false)
  assert.equal(missing.dramaLoadState.value, 'error')
  assert.equal(missing.dramaLoadNotFound.value, true)
  assert.equal(missing.drama.value, null)
  assert.equal(missing.events.includes('focus'), true)
  assert.equal(missing.events.includes('clear-timer'), true)

  const noEpisode = createNav({ currentEpisodeId: null })
  noEpisode.nav.goCreate()
  assert.deepEqual(noEpisode.events[0], ['warning', '\u8bf7\u5148\u65b0\u589e\u4e00\u96c6\uff0c\u518d\u8fdb\u5165\u5236\u4f5c'])
  assert.equal(noEpisode.events.some((item) => item[0] === 'push'), false)

  const ready = createNav({ currentEpisodeId: 22 })
  ready.nav.goCreate()
  ready.nav.goCanvasMode()
  ready.nav.goList()
  const pushes = ready.events.filter((item) => item[0] === 'push').map((item) => item[1])
  assert.equal(pushes[0].path, '/film/11')
  assert.equal(pushes[0].query.episode, '22')
  assert.equal(pushes[0].query.returnTo, '/?q=rain')
  assert.equal(pushes[1].path, '/film/11/canvas')
  assert.equal(pushes[1].query.episode, '22')
  assert.equal(pushes[2], '/?q=rain')
  assert.notEqual(ready.DRAMA_ID, ready.EPISODE_ID)
})
