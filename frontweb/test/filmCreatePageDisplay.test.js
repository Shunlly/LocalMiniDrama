import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { effectScope, reactive, ref } from 'vue'

import {
  useFilmCreateGeneratingDisplay,
  useFilmCreateReadinessDisplay,
  useFilmCreateRootClass,
  useFilmCreateRouteDisplay,
  useFilmCreateStoreDisplay,
} from '../src/composables/filmCreate/useFilmCreatePageDisplay.js'
import { GEN_RESOURCE } from '../src/stores/generationTaskStore.js'

const DRAMA_ID = 11
const EPISODE_ID = 22
assert.notEqual(DRAMA_ID, EPISODE_ID)

const filmCreateSource = readFileSync(new URL('../src/views/FilmCreate.vue', import.meta.url), 'utf8')
const pageDisplaySource = readFileSync(new URL('../src/composables/filmCreate/useFilmCreatePageDisplay.js', import.meta.url), 'utf8')
const closeoutSource = readFileSync(new URL('../src/components/filmCreate/filmCreateCloseoutBindings.js', import.meta.url), 'utf8')

function withScope(run) {
  const scope = effectScope()
  try {
    return scope.run(run)
  } finally {
    scope.stop()
  }
}

test('制作页把 store 展示绑定和根 class 交给独立模块，closeout 调用名不变', () => {
  assert.match(filmCreateSource, /useFilmCreateStoreDisplay\(/)
  assert.match(filmCreateSource, /useFilmCreateRouteDisplay\(/)
  assert.match(filmCreateSource, /useFilmCreateRootClass\(/)
  assert.match(filmCreateSource, /useFilmCreateReadinessDisplay\(/)
  assert.match(filmCreateSource, /useFilmCreateGeneratingDisplay\(/)
  assert.match(filmCreateSource, /:class="filmCreateRootClass"/)
  assert.match(filmCreateSource, /createFilmCreateCloseoutBindings\(/)
  assert.doesNotMatch(filmCreateSource, /const hasAnyEpisode = computed/)
  assert.doesNotMatch(filmCreateSource, /const storyboardGenerating = computed/)
  assert.doesNotMatch(filmCreateSource, /const productionReadinessServiceType = computed/)
  assert.doesNotMatch(pageDisplaySource, /loadList|openTest/)
  assert.match(closeoutSource, /export function createFilmCreateCloseoutBindings/)
  assert.doesNotMatch(closeoutSource, /allowNavigationAfterDraftFlush/)
})

test('store 展示绑定保持 dramaId 与 episodeId 不相等，空剧集不看项目 id', () => {
  const store = reactive({
    dramaId: DRAMA_ID,
    scriptContent: '旧剧本',
    characters: [{ id: 1 }],
    scenes: [],
    props: [{ id: 3 }],
    storyboards: [],
    currentEpisode: { id: EPISODE_ID, episode_number: 2 },
    videoProgress: 0,
    videoStatus: 'idle',
    drama: { episodes: [{ id: EPISODE_ID }] },
    setScriptContent(value) { this.scriptContent = value },
  })
  const storeVideoResolution = ref('720p')
  withScope(() => {
    const bag = useFilmCreateStoreDisplay({ store, storeVideoResolution })
    assert.equal(bag.dramaId.value, DRAMA_ID)
    assert.equal(bag.currentEpisodeId.value, EPISODE_ID)
    assert.notEqual(bag.dramaId.value, bag.currentEpisodeId.value)
    assert.equal(bag.hasAnyEpisode.value, true)
    assert.equal(bag.props.value[0].id, 3)
    assert.notEqual(bag.props.value[0].id, bag.currentEpisodeId.value)
    bag.scriptContent.value = '新剧本'
    assert.equal(store.scriptContent, '新剧本')
    store.drama = { episodes: [] }
    store.dramaId = DRAMA_ID
    assert.equal(bag.hasAnyEpisode.value, false)
    assert.equal(bag.dramaId.value, DRAMA_ID)
  })
})

test('根 class、缺失服务类型和分镜生成中状态只做展示映射', () => {
  const navCollapsed = ref(true)
  const projectLoadState = ref('error')
  const productionCapabilityGaps = ref([
    { service_type: 'video', label: '视频', detail: '未配置' },
  ])
  const calls = []
  const genStore = {
    isRunning(query) {
      calls.push(query)
      assert.equal(query.dramaId, DRAMA_ID)
      assert.equal(query.episodeId, EPISODE_ID)
      assert.notEqual(query.dramaId, query.episodeId)
      return true
    },
  }
  withScope(() => {
    const { filmCreateRootClass } = useFilmCreateRootClass({ navCollapsed, projectLoadState })
    const { productionReadinessServiceType } = useFilmCreateReadinessDisplay({ productionCapabilityGaps })
    const { storyboardGenerating } = useFilmCreateGeneratingDisplay({
      genStore,
      dramaId: ref(DRAMA_ID),
      currentEpisodeId: ref(EPISODE_ID),
    })
    const { projectListReturnTo } = useFilmCreateRouteDisplay({
      route: { query: { returnTo: '/?q=rain' } },
    })
    assert.equal(filmCreateRootClass.value['sidebar-collapsed'], true)
    assert.equal(filmCreateRootClass.value['project-state-active'], true)
    assert.equal(productionReadinessServiceType.value, 'video')
    assert.notEqual(productionReadinessServiceType.value, DRAMA_ID)
    assert.notEqual(productionReadinessServiceType.value, EPISODE_ID)
    assert.equal(storyboardGenerating.value, true)
    assert.equal(calls[0].resourceType, GEN_RESOURCE.GENERATE_STORYBOARD)
    assert.equal(projectListReturnTo.value, '/?q=rain')
  })
})
