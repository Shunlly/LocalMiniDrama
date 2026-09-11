import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { h, nextTick, ref } from 'vue'
import { defineComponent } from 'vue'

import {
  STORYBOARD_LIST_DEFAULT_ROW_HEIGHT,
  STORYBOARD_LIST_MIN_RENDERED,
  buildStoryboardOffsets,
  computeStoryboardListWindow,
  estimateStoryboardBlockHeight,
  findStoryboardIndexByOffset,
  hasStoryboardSegmentHeader,
  pinStoryboardIndexes,
  resetStoryboardListRevealListeners,
  revealStoryboardListTarget,
  subscribeStoryboardListReveal,
  visibleStoryboardItems,
  windowAroundIndex,
} from '../src/utils/storyboardListWindow.js'
import { useFilmCreateStoryboardListWindow } from '../src/composables/filmCreate/useFilmCreateStoryboardListWindow.js'
import { useFilmCreateStoryboardBindings } from '../src/composables/filmCreate/useFilmCreateStoryboardBindings.js'
import {
  buttonByText,
  click,
  compileIconStub,
  compileSfc,
  createHostRenderer,
  dataModule,
  findByClass,
  findByTestId,
  loadCompiledSfc,
  mountHarness,
  vueUrl,
} from './helpers/vueComponentHarness.js'

const listSource = readFileSync(new URL('../src/components/filmCreate/FilmCreateStoryboardList.vue', import.meta.url), 'utf8')
const filmCreateSource = readFileSync(new URL('../src/views/FilmCreate.vue', import.meta.url), 'utf8')
const listUrl = new URL('../src/components/filmCreate/FilmCreateStoryboardList.vue', import.meta.url)
const toolbarUrl = new URL('../src/components/filmCreate/FilmCreateStoryboardToolbar.vue', import.meta.url)

test.afterEach(() => {
  resetStoryboardListRevealListeners()
})

function offsetsFor(count, height = STORYBOARD_LIST_DEFAULT_ROW_HEIGHT) {
  return buildStoryboardOffsets(Array.from({ length: count }, () => height))
}

function boards(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: 1000 + index,
    title: `镜头 ${index + 1}`,
    storyboard_number: index + 1,
    episode_id: 21,
  }))
}

test('制作页自身没有改动分镜列表窗口逻辑', () => {
  assert.doesNotMatch(filmCreateSource, /visibleItems/)
  assert.doesNotMatch(filmCreateSource, /storyboard-list-window/)
  assert.doesNotMatch(listSource, /v-for="\(sb, i\) in storyboards"/)
  assert.match(listSource, /v-for="\{ sb, i \} in visibleItems"/)
  assert.match(listSource, /class="storyboard-list-window"/)
  assert.match(listSource, /onInsertStoryboardBefore/)
  assert.match(listSource, /onReorderDragStart/)
})

test('大列表窗口只覆盖视口附近行，并保留插入邻行', () => {
  const total = 80
  const prefix = offsetsFor(total)
  const window = computeStoryboardListWindow({
    total,
    scrollTop: 0,
    viewportHeight: 960,
    offsets: prefix,
  })
  assert.equal(window.start, 0)
  assert.ok(window.size <= 16)
  assert.ok(window.size >= STORYBOARD_LIST_MIN_RENDERED)
  assert.ok(window.size < total)
  assert.equal(window.topSpacer, 0)
  assert.ok(window.bottomSpacer > 0)

  const mid = computeStoryboardListWindow({
    total,
    scrollTop: 40 * STORYBOARD_LIST_DEFAULT_ROW_HEIGHT,
    viewportHeight: 960,
    offsets: prefix,
  })
  assert.ok(mid.start >= 30)
  assert.ok(mid.end <= 55)
  assert.ok(mid.size < 20)
  assert.ok(!visibleStoryboardItems(boards(total), mid).some((item) => item.i === 0))
  assert.equal(visibleStoryboardItems(boards(total), mid)[0].i, mid.start)

  assert.deepEqual(pinStoryboardIndexes(total, [null, undefined, '']), [])
  const pinned = pinStoryboardIndexes(total, [41])
  assert.deepEqual(pinned, [40, 41, 42])
  const withInsert = computeStoryboardListWindow({
    total,
    scrollTop: 40 * STORYBOARD_LIST_DEFAULT_ROW_HEIGHT,
    viewportHeight: 960,
    offsets: prefix,
    pinnedIndexes: pinned,
  })
  assert.ok(withInsert.start <= 40)
  assert.ok(withInsert.end > 42)
})

test('forceIndex 会把窗口挪到目标行，小列表仍整表渲染', () => {
  const total = 80
  const around = windowAroundIndex(total, 70, 10)
  assert.ok(around.start <= 70)
  assert.ok(around.end > 70)
  const forced = computeStoryboardListWindow({
    total,
    scrollTop: 0,
    viewportHeight: 960,
    offsets: offsetsFor(total),
    forceIndex: 70,
  })
  assert.ok(forced.start <= 70 && forced.end > 70)
  assert.ok(forced.size < 20)

  const small = computeStoryboardListWindow({
    total: 3,
    scrollTop: 0,
    viewportHeight: 960,
    offsets: offsetsFor(3),
  })
  assert.deepEqual(small, { start: 0, end: 3, topSpacer: 0, bottomSpacer: 0, size: 3 })
})

test('幕标题只在该幕第一镜出现，高度估算会计入幕头', () => {
  const list = [
    { id: 1, segment_title: '开场', segment_index: 0 },
    { id: 2, segment_title: '开场', segment_index: 0 },
    { id: 3, segment_title: '对峙', segment_index: 1 },
  ]
  assert.equal(hasStoryboardSegmentHeader(list, 0), true)
  assert.equal(hasStoryboardSegmentHeader(list, 1), false)
  assert.equal(hasStoryboardSegmentHeader(list, 2), true)
  assert.ok(estimateStoryboardBlockHeight({ hasSegmentHeader: true }) > estimateStoryboardBlockHeight({ hasSegmentHeader: false }))
  assert.equal(findStoryboardIndexByOffset(offsetsFor(10, 100), 250), 2)
})

test('露出目标分镜会通知已挂载的列表窗口', async () => {
  const seen = []
  const stop = subscribeStoryboardListReveal(async (id) => {
    seen.push(id)
    return true
  })
  assert.equal(await revealStoryboardListTarget('sb-404'), true)
  assert.deepEqual(seen, ['404'])
  stop()
  assert.equal(await revealStoryboardListTarget('sb-405'), false)
})

test('列表窗口 composable 滚动后只暴露附近行，钉住插入位置', async () => {
  const metrics = ref({ scrollTop: 0, viewportHeight: 960 })
  const list = ref(boards(80))
  let api
  const renderer = createHostRenderer()
  const harness = mountHarness(renderer, () => {
    const Host = defineComponent({
      setup() {
        api = useFilmCreateStoryboardListWindow({
          getList: () => list.value,
          listRef: ref(null),
          metrics,
        })
        return () => null
      },
    })
    return h(Host)
  })
  try {
    await nextTick()
    assert.ok(api.visibleItems.value.length < 80)
    assert.equal(api.visibleItems.value[0].i, 0)
    metrics.value = { scrollTop: 45 * STORYBOARD_LIST_DEFAULT_ROW_HEIGHT, viewportHeight: 960 }
    await nextTick()
    assert.ok(api.visibleItems.value[0].i >= 35)
    assert.ok(api.visibleItems.value.every((item) => item.i === list.value.indexOf(item.sb)))
    api.pinAround(46)
    await nextTick()
    const indexes = api.visibleItems.value.map((item) => item.i)
    assert.ok(indexes.includes(45))
    assert.ok(indexes.includes(46))
    assert.ok(indexes.includes(47))
    const revealed = await api.revealById(1000 + 72)
    assert.equal(revealed, true)
    await nextTick()
    assert.ok(api.visibleItems.value.some((item) => item.i === 72))
  } finally {
    harness.app.unmount()
  }
})

const iconStubUrl = compileIconStub(['ArrowDown', 'ArrowUp', 'Delete', 'Plus', 'Rank'])
const columnStubUrl = dataModule(`
  import { defineComponent, h } from ${JSON.stringify(vueUrl)}
  export default defineComponent({
    name: 'FilmCreateStoryboardColumnStub',
    setup() { return () => h('div', { 'data-testid': 'storyboard-column-stub' }) },
  })
`)
const compiledToolbarUrl = compileSfc(
  toolbarUrl,
  'storyboard-list-window-toolbar',
  new Map([
    ['vue', vueUrl],
    ['@element-plus/icons-vue', iconStubUrl],
  ]),
)
const FilmCreateStoryboardList = await loadCompiledSfc(
  listUrl,
  'storyboard-list-window-list',
  new Map([
    ['vue', vueUrl],
    ['@/components/filmCreate/FilmCreateStoryboardToolbar.vue', compiledToolbarUrl],
    ['@/components/filmCreate/FilmCreateStoryboardImageColumn.vue', columnStubUrl],
    ['@/components/filmCreate/FilmCreateStoryboardScriptColumn.vue', columnStubUrl],
    ['@/components/filmCreate/FilmCreateStoryboardVideoColumn.vue', columnStubUrl],
  ]),
)

const renderer = createHostRenderer()
const REQUIRED_FNS = [
  'uploadingSbImageSlot',
  'assetImageUrl',
  'assetVideoUrl',
  'canUsePrevTailAsFirst',
  'charactersAvailableToAddToSb',
  'getMovementLabel',
  'getNextStoryboard',
  'getSbCharacterIds',
  'getSbFirstImage',
  'getSbImage',
  'getSbLastImage',
  'getSbLocalImage',
  'getSbPropIds',
  'getSbSelectedCharacters',
  'getSbSelectedProps',
  'getSbSelectedScene',
  'getSbUniversalOmniRefSlots',
  'getSbVideo',
  'getSbVideoError',
  'getStripItems',
  'getVideoStripItems',
  'hasAssetImage',
  'hasSbDraftImagePlaceholder',
  'hasSbFirstLastPair',
  'hasSbImage',
  'historyImageLabel',
  'isSbUniversalMode',
  'isSbVideoGenerating',
  'onAddSingleStoryboard',
  'onDeleteSingleStoryboard',
  'onExportNarrationSrt',
  'onExportStoryboardSheet',
  'onGenerateSbFrameImage',
  'onGenerateSbFramePair',
  'onGenerateSbImage',
  'onGenerateSbVideo',
  'onGenerateStoryboard',
  'onInsertStoryboardBefore',
  'onInsertStoryboardAfter',
  'onLastFrameLayoutLockChange',
  'onLinkTailFrameToNext',
  'onOpenSbPromptDialog',
  'onOpenVideoParamsDialog',
  'onRemoveSbHistoryImage',
  'onSaveSbNarrationField',
  'onSaveUniversalSegmentField',
  'onSbAddCharacterCommand',
  'onSbImageDragLeave',
  'onSbImageDragOver',
  'onSbImageDrop',
  'onSelectSbMainVideo',
  'onSelectStripItem',
  'onStoryboardSceneChange',
  'onStoryboardUseFirstLastFrameChange',
  'onStripItemClick',
  'onToggleSbUniversalMode',
  'onTtsSbDialogue',
  'onTtsSbNarration',
  'onUniversalSegmentPromptMenu',
  'prepareSbImageUpload',
  'onUpscaleSbImage',
  'onUsePrevTailAsFirst',
  'openAiConfig',
  'openImagePreview',
  'playSbDialogueTts',
  'playSbNarrationTts',
  'sbCanSubmitVideo',
  'sbDialogueAudioRelPath',
  'sbMainVideoPlayerKey',
  'sbNarrationAudioRelPath',
  'sbUniversalSegmentTrimmed',
  'sbVideoGenerationDisabledReason',
  'setSbCharacterIds',
  'setSbPropIds',
  'showSbFramePromptPreview',
  'startBatchImageGeneration',
  'startBatchVideoGeneration',
  'storyboardImageUrl',
  'stripItemTitle',
  'ttsGenerationDisabledReason',
  'onUploadSbImageClick',
  'onMoveStoryboardUp',
  'onMoveStoryboardDown',
  'onReorderDragStart',
  'onReorderDragOver',
  'onReorderDragEnd',
  'onReorderDrop',
  'reorderHandleReason',
]

function defaultFnProps(events) {
  const props = {}
  for (const name of REQUIRED_FNS) {
    if (name.startsWith('has') || name.startsWith('is') || name.startsWith('can') || name.startsWith('sbCan')) {
      props[name] = () => false
    } else if (name.startsWith('get') || name.endsWith('Items')) {
      props[name] = () => []
    } else if (
      name.endsWith('Reason')
      || name.endsWith('Url')
      || name.endsWith('Label')
      || name.endsWith('Path')
      || name.endsWith('Key')
      || name.endsWith('Trimmed')
    ) {
      props[name] = () => ''
    } else {
      props[name] = () => {}
    }
  }
  props.getMovementLabel = () => ''
  props.isSbUniversalMode = () => false
  props.reorderHandleReason = () => ''
  props.onInsertStoryboardBefore = (sb) => events.push(['insert-before', sb.id])
  props.onInsertStoryboardAfter = (sb) => events.push(['insert-after', sb.id])
  props.onMoveStoryboardUp = (sb, index) => events.push(['move-up', sb.id, index])
  props.onMoveStoryboardDown = (sb, index) => events.push(['move-down', sb.id, index])
  props.onReorderDragStart = (_event, index) => events.push(['drag-start', index])
  props.onReorderDragOver = (_event, index) => events.push(['drag-over', index])
  props.onReorderDragEnd = () => events.push(['drag-end'])
  props.onReorderDrop = (_event, index) => events.push(['drop', index])
  return props
}

function mountList(storyboards) {
  const events = []
  const props = {
    storyboards,
    storyboardMoveCopies: storyboards.map((_, index) => ({
      up: { disabled: index === 0, title: '上移', ariaLabel: `上移分镜${index + 1}` },
      down: { disabled: index === storyboards.length - 1, title: '下移', ariaLabel: `下移分镜${index + 1}` },
    })),
    ...defaultFnProps(events),
  }
  const mounted = mountHarness(renderer, () => h(FilmCreateStoryboardList, props))
  return { ...mounted, events }
}

test('80 条分镜只挂载窗口内的三列，插入前后和拖拽仍接到当前行', async () => {
  const storyboards = boards(80)
  const harness = mountList(storyboards)
  try {
    await nextTick()
    const items = findByClass(harness.root, 'storyboard-list-item')
    const stubs = findByTestId(harness.root, 'storyboard-column-stub')
    const windowRoot = findByClass(harness.root, 'storyboard-list-window')[0]
    assert.ok(windowRoot)
    assert.ok(items.length < 80)
    assert.ok(items.length >= 1)
    assert.ok(items.length <= 16)
    assert.equal(stubs.length, items.length * 3)
    assert.ok(Number(windowRoot.props['data-sb-window-count']) === items.length)
    assert.equal(buttonByText(harness.root, '后插') != null, true)
    click(buttonByText(harness.root, '插入分镜'))
    click(buttonByText(harness.root, '后插'))
    assert.deepEqual(harness.events.filter((item) => item[0].startsWith('insert')), [
      ['insert-before', 1000],
      ['insert-after', 1000],
    ])
    const handle = findByClass(harness.root, 'sb-reorder-handle')[0]
    assert.ok(handle)
    handle.props.onDragstart?.({ stopPropagation() {}, preventDefault() {}, dataTransfer: { setData() {}, files: [] } })
    assert.ok(harness.events.some((item) => item[0] === 'drag-start' && item[1] === 0))
  } finally {
    harness.app.unmount()
  }
})

test('滚动到分镜前会先请求列表露出该 id，且不把剧集 id 当成分镜 id', async () => {
  const dramaId = 7
  const episodeId = 21
  const storyboardId = 101
  assert.notEqual(dramaId, episodeId)
  assert.notEqual(storyboardId, dramaId)
  const revealed = []
  subscribeStoryboardListReveal(async (id) => {
    revealed.push(id)
    return true
  })
  const bindings = useFilmCreateStoryboardBindings({
    storyboards: { value: [{ id: storyboardId, episode_id: episodeId }] },
    characters: { value: [] },
    props: { value: [] },
    scenes: { value: [] },
    storyboardsAPI: { update: async () => {} },
    sbCharacterIds: { value: {} },
    sbPropIds: { value: {} },
    sbSceneId: { value: {} },
    saveProjectSettings: () => {},
  })
  await bindings.scrollToStoryboard(storyboardId)
  assert.deepEqual(revealed, [String(storyboardId)])
  assert.notEqual(revealed[0], String(dramaId))
  assert.notEqual(revealed[0], String(episodeId))

  const navSource = readFileSync(new URL('../src/composables/filmCreate/useNavigation.js', import.meta.url), 'utf8')
  assert.match(navSource, /isStoryboardDomId\(id\)/)
  assert.match(navSource, /revealStoryboardListTarget\(id\)/)
})
