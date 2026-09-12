import test from 'node:test'
import assert from 'node:assert/strict'

import { h, nextTick, ref } from 'vue'

import {
  buttonByAriaLabel,
  buttonByText,
  click,
  compileSfc,
  createHostRenderer,
  findAll,
  findByClass,
  loadCompiledSfc,
  mountHarness,
  textContent,
  vueUrl,
} from './helpers/vueComponentHarness.js'

const dramaDetailDir = new URL('../src/components/dramaDetail/', import.meta.url)

function compileLibraryChild(name, id, replacements = new Map([['vue', vueUrl]])) {
  return compileSfc(new URL(name, dramaDetailDir), id, replacements)
}

const compiledCover = compileLibraryChild('DramaDetailResourceCover.vue', 'drama-detail-resource-cover')
const compiledEmpty = compileLibraryChild('DramaDetailResourceEmptyState.vue', 'drama-detail-resource-empty-state')
const compiledLibraryList = compileLibraryChild('DramaDetailResourceLibraryList.vue', 'drama-detail-resource-library-list')
const compiledProductionList = compileLibraryChild('DramaDetailResourceProductionList.vue', 'drama-detail-resource-production-list')
const DramaDetailResourceLibrary = await loadCompiledSfc(
  new URL('DramaDetailResourceLibrary.vue', dramaDetailDir),
  'drama-detail-resource-library-component',
  new Map([
    ['vue', vueUrl],
    ['./DramaDetailResourceCover.vue', compiledCover],
    ['./DramaDetailResourceEmptyState.vue', compiledEmpty],
    ['./DramaDetailResourceLibraryList.vue', compiledLibraryList],
    ['./DramaDetailResourceProductionList.vue', compiledProductionList],
  ]),
)

const renderer = createHostRenderer()
const DRAMA_ID = 11
const EPISODE_ID = 22
const CHAR_ID = 101
assert.notEqual(DRAMA_ID, EPISODE_ID)

const HANDLER_NAMES = [
  'onResourceTabKeydown',
  'onCharKwInput',
  'onSceneKwInput',
  'onPropKwInput',
  'loadCharList',
  'loadSceneList',
  'loadPropList',
  'openImport',
  'openPreview',
  'openEditChar',
  'openEditScene',
  'openEditProp',
  'deleteChar',
  'deleteScene',
  'deleteProp',
  'openEditDramaChar',
  'openEditDramaScene',
  'openEditDramaProp',
  'goCreateOrAddEpisode',
]

function tabById(root, id) {
  return findAll(root, (node) => node.props?.id === id)[0]
}

function mountLibrary(initial = {}) {
  const events = []
  const activeResTab = ref(initial.activeResTab ?? 'lib-char')
  const charKw = ref(initial.charKw ?? '')
  const sceneKw = ref(initial.sceneKw ?? '')
  const propKw = ref(initial.propKw ?? '')
  const handlers = Object.fromEntries(HANDLER_NAMES.map((name) => [
    name,
    (...args) => {
      const payload = args.filter((arg) => !(arg && typeof arg === 'object' && typeof arg.stopPropagation === 'function'))
      events.push([name, ...payload])
    },
  ]))
  const mounted = mountHarness(renderer, () => h(DramaDetailResourceLibrary, {
    drama: initial.drama ?? { id: DRAMA_ID, characters: [], scenes: [], props: [] },
    currentEpisodeId: Object.prototype.hasOwnProperty.call(initial, 'currentEpisodeId') ? initial.currentEpisodeId : null,
    addingEpisode: Boolean(initial.addingEpisode),
    charList: initial.charList ?? [],
    charLoading: Boolean(initial.charLoading),
    charError: initial.charError ?? '',
    charTotal: initial.charTotal ?? 0,
    sceneList: initial.sceneList ?? [],
    sceneLoading: Boolean(initial.sceneLoading),
    sceneError: initial.sceneError ?? '',
    sceneTotal: initial.sceneTotal ?? 0,
    propList: initial.propList ?? [],
    propLoading: Boolean(initial.propLoading),
    propError: initial.propError ?? '',
    propTotal: initial.propTotal ?? 0,
    assetImageUrl: (item) => item?.image_url || '',
    characterRoleLabel: (role) => (role === 'main' ? '主角' : ''),
    propTypeLabel: (type) => (type === 'key' ? '关键道具' : ''),
    ...handlers,
    activeResTab: activeResTab.value,
    'onUpdate:activeResTab': (value) => { activeResTab.value = value },
    charKw: charKw.value,
    'onUpdate:charKw': (value) => { charKw.value = value },
    sceneKw: sceneKw.value,
    'onUpdate:sceneKw': (value) => { sceneKw.value = value },
    propKw: propKw.value,
    'onUpdate:propKw': (value) => { propKw.value = value },
  }))
  return { ...mounted, events, activeResTab, charKw }
}

test('角色库空态展示暂无记录，导入入口交给页面', async () => {
  const harness = mountLibrary()
  try {
    await nextTick()
    const empty = findByClass(harness.root, 'resource-empty-state')[0]
    assert.ok(empty)
    assert.equal(empty.props.role, 'status')
    assert.equal(empty.props['aria-label'], '空资源下一步')
    assert.match(textContent(empty), /暂无本剧角色库记录/)
    assert.match(textContent(empty), /可以从公共素材库导入角色/)
    click(buttonByText(harness.root, '从素材库导入角色'))
    assert.deepEqual(harness.events, [['openImport', 'char']])
    assert.doesNotMatch(textContent(harness.root), /Please|Failed|Network Error/i)
  } finally {
    harness.app.unmount()
  }
})

test('搜索无结果与加载失败保留中文空态，清除搜索会重试', async () => {
  const searchEmpty = mountLibrary({ charKw: '林深', charList: [] })
  try {
    await nextTick()
    assert.match(textContent(searchEmpty.root), /没有匹配的角色/)
    assert.match(textContent(searchEmpty.root), /试试其他关键词/)
    click(buttonByText(searchEmpty.root, '清除角色搜索'))
    await nextTick()
    assert.equal(searchEmpty.charKw.value, '')
    assert.deepEqual(searchEmpty.events, [['loadCharList']])
    assert.match(textContent(searchEmpty.root), /暂无本剧角色库记录/)
  } finally {
    searchEmpty.app.unmount()
  }

  const failed = mountLibrary({
    charError: '角色库加载失败，请稍后重试',
    charList: [{ id: CHAR_ID, name: '林深', description: '雨巷主角' }],
  })
  try {
    await nextTick()
    const alert = findByClass(failed.root, 'library-error')[0]
    assert.ok(alert)
    assert.equal(alert.props.role, 'alert')
    assert.match(textContent(alert), /角色库加载失败/)
    assert.match(textContent(alert), /当前仍显示上次成功加载的角色/)
    assert.match(textContent(failed.root), /林深/)
    click(buttonByText(failed.root, '重试'))
    click(buttonByText(failed.root, '编辑'))
    click(buttonByText(failed.root, '删除'))
    assert.deepEqual(failed.events, [
      ['loadCharList'],
      ['openEditChar', { id: CHAR_ID, name: '林深', description: '雨巷主角' }],
      ['deleteChar', { id: CHAR_ID, name: '林深', description: '雨巷主角' }],
    ])
    assert.doesNotMatch(textContent(failed.root), new RegExp(String(DRAMA_ID)))
  } finally {
    failed.app.unmount()
  }
})

test('制作资源空态在无分集时说明先新增一集', async () => {
  const missingEpisode = mountLibrary({ activeResTab: 'drama-char', currentEpisodeId: null })
  try {
    await nextTick()
    assert.match(textContent(missingEpisode.root), /本剧暂无制作角色/)
    assert.match(textContent(missingEpisode.root), /请先新增一集，再进入制作页提取角色/)
    const addFirst = buttonByAriaLabel(missingEpisode.root, '新增一集后再提取角色')
    assert.ok(addFirst)
    assert.equal(buttonByText(missingEpisode.root, '先去新增一集'), addFirst)
    assert.notEqual(addFirst.props['data-variant'], 'primary')
    click(addFirst)
    assert.deepEqual(missingEpisode.events, [['goCreateOrAddEpisode']])
  } finally {
    missingEpisode.app.unmount()
  }

  const ready = mountLibrary({
    activeResTab: 'lib-char',
    currentEpisodeId: EPISODE_ID,
    drama: { id: DRAMA_ID, characters: [], scenes: [], props: [] },
  })
  try {
    await nextTick()
    click(tabById(ready.root, 'drama-res-tab-drama-char'))
    await nextTick()
    assert.equal(ready.activeResTab.value, 'drama-char')
    assert.match(textContent(ready.root), /可进入制作页，从当前剧集提取角色/)
    const extract = buttonByAriaLabel(ready.root, '进入制作页提取角色')
    assert.ok(extract)
    assert.equal(extract.props['data-variant'], 'primary')
    click(extract)
    assert.deepEqual(ready.events, [['goCreateOrAddEpisode']])
    assert.doesNotMatch(textContent(ready.root), new RegExp(String(EPISODE_ID)))
  } finally {
    ready.app.unmount()
  }
})
