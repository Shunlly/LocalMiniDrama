import test from 'node:test'
import assert from 'node:assert/strict'

import { h, nextTick, ref } from 'vue'

import {
  actionGateReasons,
  buttonByAriaLabel,
  buttonByText,
  click,
  compileIconStub,
  compileSfc,
  createHostRenderer,
  findByType,
  loadCompiledSfc,
  mountHarness,
  textContent,
  vueUrl,
} from './helpers/vueComponentHarness.js'

const actionGateUrl = new URL('../src/components/filmCreate/ActionGate.vue', import.meta.url)
const panelUrl = new URL('../src/components/filmCreate/FilmCreateResourcePanel.vue', import.meta.url)
const characterBlockUrl = new URL('../src/components/filmCreate/FilmCreateCharacterBlock.vue', import.meta.url)
const propBlockUrl = new URL('../src/components/filmCreate/FilmCreatePropBlock.vue', import.meta.url)
const sceneBlockUrl = new URL('../src/components/filmCreate/FilmCreateSceneBlock.vue', import.meta.url)

const EMPTY_SCRIPT_REASON = '当前集还没有剧本，请先编写或导入剧本'
const EPISODE_REQUIRED_REASON = '请先创建或选择剧集'

const iconStubUrl = compileIconStub([
  'ArrowDown',
  'ArrowUp',
  'Delete',
  'MagicStick',
  'Upload',
  'VideoPlay',
  'ZoomIn',
])
const compiledActionGateUrl = compileSfc(actionGateUrl, 'resource-panel-action-gate', new Map([['vue', vueUrl]]))
const blockReplacements = new Map([
  ['vue', vueUrl],
  ['@element-plus/icons-vue', iconStubUrl],
  ['@/components/filmCreate/ActionGate.vue', compiledActionGateUrl],
])
const compiledCharacterBlockUrl = compileSfc(characterBlockUrl, 'film-create-character-block', blockReplacements)
const compiledPropBlockUrl = compileSfc(propBlockUrl, 'film-create-prop-block', blockReplacements)
const compiledSceneBlockUrl = compileSfc(sceneBlockUrl, 'film-create-scene-block', blockReplacements)
const FilmCreateResourcePanel = await loadCompiledSfc(
  panelUrl,
  'film-create-resource-panel-component',
  new Map([
    ['vue', vueUrl],
    ['@element-plus/icons-vue', iconStubUrl],
    ['@/components/filmCreate/ActionGate.vue', compiledActionGateUrl],
    ['@/components/filmCreate/FilmCreateCharacterBlock.vue', compiledCharacterBlockUrl],
    ['@/components/filmCreate/FilmCreatePropBlock.vue', compiledPropBlockUrl],
    ['@/components/filmCreate/FilmCreateSceneBlock.vue', compiledSceneBlockUrl],
  ]),
)

const renderer = createHostRenderer()

function buttonsByText(root, label) {
  return findByType(root, 'button').filter((node) => textContent(node).replace(/\s+/g, ' ').trim() === label)
}


function emptyStateButton(root, label) {
  const buttons = findByType(root, 'button').filter((node) => node.props?.['aria-label'] === label)
  const empty = buttons.find((node) => {
    let current = node
    while (current) {
      if (String(current.props?.class || '').includes('resource-empty-actions')) return true
      current = current.parent
    }
    return false
  })
  assert.ok(empty, `缺少空态按钮 ${label}`)
  return empty
}

function requireButton(root, label) {
  const button = buttonByText(root, label)
  assert.ok(button, `缺少按钮：${label}`)
  return button
}

function mountPanel(initialProps = {}) {
  const events = []
  const props = ref({
    characters: [],
    propItems: [],
    scenes: [],
    hasAnyEpisode: true,
    hasAssetImage: () => false,
    assetImageUrl: () => '',
    charRoleLabel: () => '角色',
    localPathToUrl: (value) => value || '',
    parseExtraImages: () => [],
    getCharAffectedStoryboards: () => [],
    getPropAffectedStoryboards: () => [],
    getSceneAffectedStoryboards: () => [],
    sd2ActionLabel: () => '',
    sd2VoiceActionLabel: () => '',
    onAddEpisode: () => events.push(['add-episode']),
    onSelectEpisode: () => events.push(['select-episode']),
    ...initialProps,
  })
  const listeners = {
    onGenerateCharacters: () => events.push(['generate-characters']),
    onExtractProps: () => events.push(['extract-props']),
    onExtractScenes: () => events.push(['extract-scenes']),
    onAddCharacter: () => events.push(['add-character']),
    onAddEpisode: () => events.push(['add-episode']),
    onSelectEpisode: () => events.push(['select-episode']),
  }
  const mounted = mountHarness(renderer, () => h(FilmCreateResourcePanel, { ...props.value, ...listeners }))
  return { ...mounted, events, props }
}

test('空剧本时角色/道具/场景提取都禁用，空态指向真实按钮', async () => {
  const harness = mountPanel({
    characterGenerationDisabledReason: EMPTY_SCRIPT_REASON,
    propsExtractionDisabledReason: EMPTY_SCRIPT_REASON,
    scenesExtractionDisabledReason: EMPTY_SCRIPT_REASON,
  })
  try {
    await nextTick()
    const pageText = textContent(harness.root)
    assert.match(pageText, /暂无角色，可用「剧本自动提取角色」或「添加角色」/)
    assert.match(pageText, /暂无道具，可用「从剧本提取道具」或「添加道具」/)
    assert.match(pageText, /暂无场景，可用「从剧本提取场景」或「添加场景」/)

    for (const label of ['剧本自动提取角色', '从剧本提取道具', '从剧本提取场景']) {
      const buttons = buttonsByText(harness.root, label)
      assert.ok(buttons.length >= 2, `${label} 应同时出现在区块头和空态`)
      for (const button of buttons) {
        assert.equal(button.props.disabled, true)
        assert.equal(button.props.title, EMPTY_SCRIPT_REASON)
      }
    }

    assert.ok(actionGateReasons(harness.root).includes(EMPTY_SCRIPT_REASON))
    const extractAria = buttonByAriaLabel(harness.root, '剧本自动提取角色')
    assert.ok(extractAria)
    assert.equal(extractAria.props.disabled, true)
    assert.equal(buttonsByText(harness.root, '去创建剧集').length, 0)
  } finally {
    harness.app.unmount()
  }
})

test('缺少剧集时，空态提取改成去创建剧集，区块头提取仍禁用', async () => {
  const harness = mountPanel({
    hasAnyEpisode: false,
    characterGenerationDisabledReason: EPISODE_REQUIRED_REASON,
    propsExtractionDisabledReason: EPISODE_REQUIRED_REASON,
    scenesExtractionDisabledReason: EPISODE_REQUIRED_REASON,
  })
  try {
    await nextTick()
    const createButtons = buttonsByText(harness.root, '去创建剧集')
    assert.equal(createButtons.length, 3)
    assert.equal(buttonByAriaLabel(harness.root, '去创建剧集后再提取角色')?.props.disabled, false)
    click(createButtons[0])
    assert.deepEqual(harness.events, [['add-episode']])

    const headerExtract = buttonsByText(harness.root, '剧本自动提取角色')
    assert.ok(headerExtract.length >= 1)
    assert.ok(headerExtract.every((button) => button.props.disabled === true))
    assert.ok(headerExtract.every((button) => button.props.title === EPISODE_REQUIRED_REASON))
    assert.equal(buttonByAriaLabel(harness.root, '剧本自动提取角色'), undefined)
  } finally {
    harness.app.unmount()
  }
})

test('无禁用原因时，空态提取会发出真实事件', async () => {
  const harness = mountPanel()
  try {
    await nextTick()
    click(emptyStateButton(harness.root, '剧本自动提取角色'))
    click(emptyStateButton(harness.root, '从剧本提取道具'))
    click(emptyStateButton(harness.root, '从剧本提取场景'))
    assert.deepEqual(harness.events, [
      ['generate-characters'],
      ['extract-props'],
      ['extract-scenes'],
    ])
    assert.equal(requireButton(harness.root, '剧本自动提取角色').props.disabled, false)
  } finally {
    harness.app.unmount()
  }
})
