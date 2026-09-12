import test from 'node:test'
import assert from 'node:assert/strict'

import { h, nextTick } from 'vue'

import {
  buttonByAriaLabel,
  buttonByText,
  click,
  compileIconStub,
  compileSfc,
  createHostRenderer,
  findByClass,
  findByType,
  loadCompiledSfc,
  mountHarness,
  textContent,
  vueUrl,
} from './helpers/vueComponentHarness.js'

const sidebarUrl = new URL('../src/components/dramaCanvas/CanvasProductionSidebar.vue', import.meta.url)
const workflowListUrl = new URL('../src/components/dramaCanvas/CanvasWorkflowSidebarList.vue', import.meta.url)
const windowedListUrl = new URL('../src/components/dramaCanvas/CanvasWindowedList.vue', import.meta.url)

const iconStubUrl = compileIconStub(['ArrowDown', 'ArrowUp', 'Rank'])
const compiledWindowedListUrl = compileSfc(
  windowedListUrl,
  'canvas-windowed-list-production',
  new Map([
    ['@/utils/listWindow.js', new URL('../src/utils/listWindow.js', import.meta.url).href],
  ]),
)
const compiledWorkflowListUrl = compileSfc(
  workflowListUrl,
  'canvas-workflow-sidebar-list',
  new Map([
    ['vue', vueUrl],
    ['@element-plus/icons-vue', iconStubUrl],
  ]),
)
const CanvasProductionSidebar = await loadCompiledSfc(
  sidebarUrl,
  'canvas-production-sidebar-component',
  new Map([
    ['vue', vueUrl],
    ['@/components/dramaCanvas/CanvasWindowedList.vue', compiledWindowedListUrl],
    ['@/components/dramaCanvas/CanvasWorkflowSidebarList.vue', compiledWorkflowListUrl],
  ]),
)

const renderer = createHostRenderer()
const DRAMA_ID = 11
const CHARACTER_ID = 101
const SCENE_ID = 202
const PROP_ID = 303
assert.notEqual(DRAMA_ID, CHARACTER_ID)

function mountSidebar(initialProps = {}) {
  const events = []
  const props = {
    drama: { id: DRAMA_ID, characters: [], scenes: [], props: [] },
    canvasMode: 'production',
    highlightAssetId: null,
    workflowGroups: [],
    activeGroupId: null,
    workflowStoryboardDetails: {},
    workflowOrderSaving: false,
    workflowRunning: false,
    focusScriptNode: () => events.push(['focus-script']),
    openCreateDialog: (type) => events.push(['create', type]),
    clearAssetHighlight: () => events.push(['clear-highlight']),
    selectSidebarAsset: (id) => events.push(['select', id]),
    setActiveGroupId: (id) => events.push(['select-group', id]),
    reorderWorkflowStoryboards: (payload) => events.push(['reorder', payload]),
    onCreateWorkflowGroup: () => events.push(['create-workflow']),
    ...initialProps,
  }
  const mounted = mountHarness(renderer, () => h(CanvasProductionSidebar, props))
  return { ...mounted, events, props }
}

function createButtons(root, label) {
  return findByType(root, 'button').filter((node) => node.props?.['aria-label'] === label)
}

test('制作侧栏空态展示暂无角色、场景、道具，并可新建', () => {
  const harness = mountSidebar()
  try {
    const pageText = textContent(harness.root)
    assert.match(pageText, /素材库/)
    assert.match(pageText, /剧本/)
    assert.match(pageText, /暂无角色/)
    assert.match(pageText, /暂无场景/)
    assert.match(pageText, /暂无道具/)
    assert.match(pageText, /尚未创建工作流/)
    click(buttonByText(harness.root, '编辑'))
    click(buttonByAriaLabel(harness.root, '新建角色'))
    click(buttonByAriaLabel(harness.root, '新建场景'))
    click(buttonByAriaLabel(harness.root, '新建道具'))
    click(buttonByAriaLabel(harness.root, '去创建分组'))
    assert.deepEqual(harness.events, [
      ['focus-script'],
      ['create', 'character'],
      ['create', 'scene'],
      ['create', 'prop'],
      ['create-workflow'],
    ])
  } finally {
    harness.app.unmount()
  }
})

test('有素材时展示中文名称，未命名回落，定位入口可用', async () => {
  const harness = mountSidebar({
    drama: {
      id: DRAMA_ID,
      characters: [{ id: CHARACTER_ID, name: '林深' }, { id: 102, name: '' }],
      scenes: [{ id: SCENE_ID, location: '雨巷' }, { id: 203, location: '' }],
      props: [{ id: PROP_ID, name: '油纸伞' }, { id: 304, name: '' }],
    },
    highlightAssetId: `char:${CHARACTER_ID}`,
  })
  try {
    await nextTick()
    const pageText = textContent(harness.root)
    assert.match(pageText, /林深/)
    assert.match(pageText, /雨巷/)
    assert.match(pageText, /油纸伞/)
    assert.match(pageText, /未命名/)
    assert.doesNotMatch(pageText, /暂无角色/)
    assert.doesNotMatch(pageText, /暂无场景/)
    assert.doesNotMatch(pageText, /暂无道具/)
    const character = buttonByAriaLabel(harness.root, '定位角色林深')
    assert.ok(character)
    assert.match(character.props.class, /active/)
    click(character)
    click(buttonByAriaLabel(harness.root, '定位场景雨巷'))
    click(buttonByAriaLabel(harness.root, '定位道具油纸伞'))
    click(buttonByText(harness.root, '清除'))
    assert.deepEqual(harness.events, [
      ['select', `char:${CHARACTER_ID}`],
      ['select', `scene:${SCENE_ID}`],
      ['select', `prop:${PROP_ID}`],
      ['clear-highlight'],
    ])
    assert.equal(buttonByAriaLabel(harness.root, '定位角色未命名').props['aria-label'], '定位角色未命名')
    assert.equal(buttonByAriaLabel(harness.root, '定位场景未命名').props['aria-label'], '定位场景未命名')
    assert.equal(buttonByAriaLabel(harness.root, '定位道具未命名').props['aria-label'], '定位道具未命名')
  } finally {
    harness.app.unmount()
  }
})

test('自由模式不展示剧本编辑和工作流；运行中排序给出中文原因', async () => {
  const production = mountSidebar({ canvasMode: 'production' })
  try {
    assert.equal(createButtons(production.root, '新建角色').length, 2)
    assert.ok(buttonByText(production.root, '+'))
  } finally {
    production.app.unmount()
  }

  const free = mountSidebar({ canvasMode: 'free' })
  try {
    assert.doesNotMatch(textContent(free.root), /尚未创建工作流/)
    assert.equal(buttonByText(free.root, '编辑'), undefined)
    assert.equal(buttonByText(free.root, '+'), undefined)
    assert.equal(createButtons(free.root, '新建角色').length, 1)
    assert.equal(textContent(createButtons(free.root, '新建角色')[0]).trim(), '新建')
    assert.match(textContent(findByClass(free.root, 'sidebar-title')[0]), /素材库/)
  } finally {
    free.app.unmount()
  }

  const running = mountSidebar({
    workflowRunning: true,
    workflowGroups: [{
      id: 'wf-1',
      title: '第一组',
      pipeline: ['image', 'video'],
      storyboard_ids: ['501', '502'],
    }],
    workflowStoryboardDetails: {
      501: { title: '开场', storyboardNumber: 1, episodeTitle: '第 1 集' },
      502: { title: '对峙', storyboardNumber: 2, episodeTitle: '第 1 集' },
    },
  })
  try {
    await nextTick()
    assert.match(textContent(running.root), /第一组/)
    assert.match(textContent(running.root), /生图 → 生视频/)
    assert.match(textContent(running.root), /开场/)
    const moveUp = buttonByAriaLabel(running.root, '上移开场不可用：当前不能调整工作流分镜顺序')
    const moveDown = buttonByAriaLabel(running.root, '下移开场不可用：当前不能调整工作流分镜顺序')
    assert.ok(moveUp)
    assert.ok(moveDown)
    assert.equal(moveUp.props.disabled, true)
    assert.equal(moveUp.props.title, '当前不能调整工作流分镜顺序')
  } finally {
    running.app.unmount()
  }
})
