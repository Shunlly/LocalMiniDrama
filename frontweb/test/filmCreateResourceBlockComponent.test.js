import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { compileScript, parse } from '@vue/compiler-sfc'
import { h, nextTick } from 'vue'

import {
  buttonByText,
  compileIconStub,
  compileSfc,
  createHostRenderer,
  loadCompiledSfc,
  mountHarness,
  textContent,
  vueUrl,
} from './helpers/vueComponentHarness.js'

const actionGateUrl = new URL('../src/components/filmCreate/ActionGate.vue', import.meta.url)
const characterBlockUrl = new URL('../src/components/filmCreate/FilmCreateCharacterBlock.vue', import.meta.url)
const propBlockUrl = new URL('../src/components/filmCreate/FilmCreatePropBlock.vue', import.meta.url)
const sceneBlockUrl = new URL('../src/components/filmCreate/FilmCreateSceneBlock.vue', import.meta.url)
const panelSource = readFileSync(new URL('../src/components/filmCreate/FilmCreateResourcePanel.vue', import.meta.url), 'utf8')
const characterSource = readFileSync(characterBlockUrl, 'utf8')
const propSource = readFileSync(propBlockUrl, 'utf8')
const sceneSource = readFileSync(sceneBlockUrl, 'utf8')

const EMPTY_SCRIPT_REASON = '当前集还没有剧本，请先编写或导入剧本'

const iconStubUrl = compileIconStub([
  'ArrowDown',
  'ArrowUp',
  'Delete',
  'MagicStick',
  'Upload',
  'VideoPlay',
  'ZoomIn',
])
const compiledActionGateUrl = compileSfc(actionGateUrl, 'resource-block-action-gate', new Map([['vue', vueUrl]]))
const blockReplacements = new Map([
  ['vue', vueUrl],
  ['@element-plus/icons-vue', iconStubUrl],
  ['@/components/filmCreate/ActionGate.vue', compiledActionGateUrl],
])
const FilmCreateCharacterBlock = await loadCompiledSfc(characterBlockUrl, 'resource-character-block', blockReplacements)
const renderer = createHostRenderer()

function requiredFns() {
  return {
    hasAssetImage: () => false,
    assetImageUrl: () => '',
    localPathToUrl: (value) => value || '',
    parseExtraImages: () => [],
    missingAssetImageReason: () => '',
    assetErrorText: () => '',
    uploadResourceClick: () => {},
    resourceDragOver: () => {},
    resourceDragLeave: () => {},
    resourceDrop: () => {},
    charRoleLabel: () => '主角',
    getCharAffectedStoryboards: () => [],
    sd2ActionLabel: () => '认证资产',
    sd2VoiceActionLabel: () => '上传音色',
    sd2CertActionTitle: () => '将角色主图登记为认证资产',
  }
}

test('资源面板把三个区块交给子组件，自己保留折叠壳和空态', () => {
  assert.match(panelSource, /<FilmCreateCharacterBlock/)
  assert.match(panelSource, /<FilmCreatePropBlock/)
  assert.match(panelSource, /<FilmCreateSceneBlock/)
  assert.match(panelSource, /class="resource-block-title">角色<\/span>/)
  assert.match(panelSource, /class="resource-block-title">道具<\/span>/)
  assert.match(panelSource, /class="resource-block-title">场景<\/span>/)
  assert.match(panelSource, /v-if="characters.length === 0"/)
  assert.match(panelSource, /v-if="propItems.length === 0"/)
  assert.match(panelSource, /v-if="scenes.length === 0"/)
  assert.match(panelSource, /#empty/)
  assert.doesNotMatch(panelSource, /v-for="char in characters"/)
  assert.doesNotMatch(panelSource, /v-for="prop in propItems"/)
  assert.doesNotMatch(panelSource, /v-for="scene in scenes"/)
  assert.match(characterSource, /v-for="char in characters"/)
  assert.match(propSource, /v-for="prop in propItems"/)
  assert.match(sceneSource, /v-for="scene in scenes"/)
  assert.match(characterSource, /<slot name="empty" \/>/)
  assert.match(propSource, /<slot name="empty" \/>/)
  assert.match(sceneSource, /<slot name="empty" \/>/)
})

test('角色区块空剧本时提取按钮禁用，列表卡片仍可渲染', async () => {
  const events = []
  const mounted = mountHarness(renderer, () => h(FilmCreateCharacterBlock, {
    characters: [{ id: 3, name: '李华', appearance: '黑发' }],
    characterGenerationDisabledReason: EMPTY_SCRIPT_REASON,
    ...requiredFns(),
    onGenerateCharacters: () => events.push('generate-characters'),
  }))
  try {
    await nextTick()
    const extract = buttonByText(mounted.root, '剧本自动提取角色')
    assert.ok(extract)
    assert.equal(extract.props.disabled, true)
    assert.equal(extract.props.title, EMPTY_SCRIPT_REASON)
    assert.match(textContent(mounted.root), /李华/)
    assert.match(textContent(mounted.root), /黑发/)
    assert.deepEqual(events, [])
  } finally {
    mounted.app.unmount()
  }
})

test('三个资源区块组件都可以编译', () => {
  for (const [source, filename, id] of [
    [characterSource, 'FilmCreateCharacterBlock.vue', 'character-block-compile'],
    [propSource, 'FilmCreatePropBlock.vue', 'prop-block-compile'],
    [sceneSource, 'FilmCreateSceneBlock.vue', 'scene-block-compile'],
  ]) {
    const parsed = parse(source, { filename })
    assert.deepEqual(parsed.errors.map((error) => String(error)), [])
    assert.doesNotThrow(() => compileScript(parsed.descriptor, { id }))
  }
})
