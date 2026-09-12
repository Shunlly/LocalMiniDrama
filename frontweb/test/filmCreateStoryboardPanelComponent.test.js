import test from 'node:test'
import assert from 'node:assert/strict'

import { h, nextTick, ref } from 'vue'

import {
  actionGateReasons,
  buttonByText,
  click,
  compileIconStub,
  compileSfc,
  createHostRenderer,
  dataModule,
  findByTestId,
  findByType,
  loadCompiledSfc,
  mountHarness,
  textContent,
  vueUrl,
} from './helpers/vueComponentHarness.js'

const actionGateUrl = new URL('../src/components/filmCreate/ActionGate.vue', import.meta.url)
const configBarUrl = new URL('../src/components/filmCreate/FilmCreateStoryboardConfigBar.vue', import.meta.url)
const emptyStateUrl = new URL('../src/components/filmCreate/FilmCreateStoryboardEmptyState.vue', import.meta.url)
const toolbarUrl = new URL('../src/components/filmCreate/FilmCreateStoryboardToolbar.vue', import.meta.url)
const listUrl = new URL('../src/components/filmCreate/FilmCreateStoryboardList.vue', import.meta.url)
const panelUrl = new URL('../src/components/filmCreate/FilmCreateStoryboardPanel.vue', import.meta.url)

const EMPTY_SCRIPT_REASON = '当前集还没有剧本，请先编写或导入剧本'
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
]

const iconStubUrl = compileIconStub([
  'ArrowDown',
  'ArrowUp',
  'Delete',
  'Plus',
  'QuestionFilled',
  'Rank',
])
const compiledActionGateUrl = compileSfc(actionGateUrl, 'storyboard-panel-action-gate', new Map([['vue', vueUrl]]))
const compiledConfigBarUrl = compileSfc(
  configBarUrl,
  'storyboard-panel-config-bar',
  new Map([
    ['vue', vueUrl],
    ['@element-plus/icons-vue', iconStubUrl],
    ['@/components/filmCreate/ActionGate.vue', compiledActionGateUrl],
  ]),
)
const statusStubUrl = dataModule(`
  import { defineComponent } from ${JSON.stringify(vueUrl)}
  export default defineComponent({
    name: 'FilmCreateStoryboardStatusStripStub',
    setup() { return () => null },
  })
`)
const columnStubUrl = dataModule(`
  import { defineComponent, h } from ${JSON.stringify(vueUrl)}
  export default defineComponent({
    name: 'FilmCreateStoryboardColumnStub',
    setup() { return () => h('div', { 'data-testid': 'storyboard-column-stub' }) },
  })
`)
const compiledEmptyStateUrl = compileSfc(
  emptyStateUrl,
  'storyboard-panel-empty-state',
  new Map([
    ['vue', vueUrl],
    ['@/components/filmCreate/ActionGate.vue', compiledActionGateUrl],
  ]),
)
const compiledToolbarUrl = compileSfc(
  toolbarUrl,
  'storyboard-panel-toolbar',
  new Map([
    ['vue', vueUrl],
    ['@element-plus/icons-vue', iconStubUrl],
  ]),
)
const compiledListUrl = compileSfc(
  listUrl,
  'storyboard-panel-list',
  new Map([
    ['vue', vueUrl],
    ['@/components/filmCreate/FilmCreateStoryboardToolbar.vue', compiledToolbarUrl],
    ['@/components/filmCreate/FilmCreateStoryboardImageColumn.vue', columnStubUrl],
    ['@/components/filmCreate/FilmCreateStoryboardScriptColumn.vue', columnStubUrl],
    ['@/components/filmCreate/FilmCreateStoryboardVideoColumn.vue', columnStubUrl],
  ]),
)
const FilmCreateStoryboardPanel = await loadCompiledSfc(
  panelUrl,
  'film-create-storyboard-panel-component',
  new Map([
    ['vue', vueUrl],
    ['@/components/filmCreate/FilmCreateStoryboardConfigBar.vue', compiledConfigBarUrl],
    ['@/components/filmCreate/FilmCreateStoryboardEmptyState.vue', compiledEmptyStateUrl],
    ['@/components/filmCreate/FilmCreateStoryboardList.vue', compiledListUrl],
    ['@/components/filmCreate/FilmCreateStoryboardStatusStrip.vue', statusStubUrl],
  ]),
)

const renderer = createHostRenderer()

function buttonsByText(root, label) {
  return findByType(root, 'button').filter((node) => textContent(node).replace(/\s+/g, ' ').trim() === label)
}

function requireButton(root, label) {
  const button = buttonByText(root, label)
  assert.ok(button, `缺少按钮：${label}`)
  return button
}

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
  props.onGenerateStoryboard = () => events.push(['generate-storyboard'])
  props.onAddSingleStoryboard = () => events.push(['add-single-storyboard'])
  props.onAddEpisode = () => events.push(['add-episode'])
  return props
}

function mountPanel(initialProps = {}) {
  const events = []
  const props = ref({
    storyboards: [],
    hasAnyEpisode: true,
    currentEpisodeId: 22,
    ...defaultFnProps(events),
    ...initialProps,
  })
  const mounted = mountHarness(renderer, () => h(FilmCreateStoryboardPanel, props.value))
  return { ...mounted, events, props }
}

test('空剧本时工具栏和空态生成分镜都禁用，并展示中文原因', async () => {
  const harness = mountPanel({
    storyboardActionDisabledReason: EMPTY_SCRIPT_REASON,
    episodeActionDisabledReason: EMPTY_SCRIPT_REASON,
  })
  try {
    await nextTick()
    const toolbar = requireButton(harness.root, 'AI 生成分镜')
    const emptyGenerate = requireButton(harness.root, '生成分镜')
    assert.equal(toolbar.props.disabled, true)
    assert.equal(emptyGenerate.props.disabled, true)
    assert.equal(toolbar.props.title, EMPTY_SCRIPT_REASON)
    assert.equal(emptyGenerate.props.title, EMPTY_SCRIPT_REASON)
    assert.ok(actionGateReasons(harness.root).includes(EMPTY_SCRIPT_REASON))
    const gates = findByType(harness.root, 'span').filter((node) => node.props?.role === 'group')
    assert.ok(gates.some((gate) => gate.props['aria-label'] === `AI 生成分镜不可用：${EMPTY_SCRIPT_REASON}`))
    assert.ok(gates.some((gate) => gate.props['aria-label'] === `生成分镜不可用：${EMPTY_SCRIPT_REASON}`))
    assert.match(textContent(harness.root), /还没有分镜，可生成分镜或添加一个分镜/)
  } finally {
    harness.app.unmount()
  }
})

test('没有禁用原因时，空态生成分镜可以启动', async () => {
  const harness = mountPanel()
  try {
    await nextTick()
    const emptyGenerate = requireButton(harness.root, '生成分镜')
    assert.notEqual(emptyGenerate.props.disabled, true)
    click(emptyGenerate)
    click(requireButton(harness.root, 'AI 生成分镜'))
    assert.deepEqual(harness.events, [['generate-storyboard'], ['generate-storyboard']])
  } finally {
    harness.app.unmount()
  }
})

test('没有剧集时，空态指向创建剧集，而不是生成分镜', async () => {
  const harness = mountPanel({
    hasAnyEpisode: false,
    currentEpisodeId: null,
    storyboardActionDisabledReason: EMPTY_SCRIPT_REASON,
    episodeActionDisabledReason: '请先创建或选择剧集',
  })
  try {
    await nextTick()
    assert.equal(buttonsByText(harness.root, '生成分镜').length, 0)
    assert.match(textContent(harness.root), /请先创建或选择剧集，再生成或添加分镜/)
    click(requireButton(harness.root, '去创建剧集'))
    assert.deepEqual(harness.events, [['add-episode']])
    const toolbar = requireButton(harness.root, 'AI 生成分镜')
    assert.equal(toolbar.props.disabled, true)
    assert.equal(toolbar.props.title, EMPTY_SCRIPT_REASON)
  } finally {
    harness.app.unmount()
  }
})

test('有分镜时列表壳渲染工具条并接到三列，不显示空态', async () => {
  const harness = mountPanel({
    storyboards: [{ id: 101, title: '开场', storyboard_number: 1 }],
  })
  try {
    await nextTick()
    assert.equal(buttonsByText(harness.root, '生成分镜').length, 0)
    assert.doesNotMatch(textContent(harness.root), /还没有分镜/)
    requireButton(harness.root, '插入分镜')
    requireButton(harness.root, '后插')
    requireButton(harness.root, '全能模式')
    assert.equal(findByTestId(harness.root, 'storyboard-column-stub').length, 3)
  } finally {
    harness.app.unmount()
  }
})
