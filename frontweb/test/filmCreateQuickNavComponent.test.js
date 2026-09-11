import test from 'node:test'
import assert from 'node:assert/strict'

import { h, nextTick, ref } from 'vue'

import {
  buttonByAriaLabel,
  click,
  compileIconStub,
  createHostRenderer,
  findByClass,
  loadCompiledSfc,
  mountHarness,
  textContent,
  vueUrl,
} from './helpers/vueComponentHarness.js'

const quickNavUrl = new URL('../src/components/filmCreate/FilmCreateQuickNav.vue', import.meta.url)
const iconStubUrl = compileIconStub(['Check', 'Close', 'Expand', 'Fold', 'Loading', 'Minus', 'Plus', 'WarningFilled'])
const FilmCreateQuickNav = await loadCompiledSfc(
  quickNavUrl,
  'film-create-quick-nav-component',
  new Map([
    ['vue', vueUrl],
    ['@element-plus/icons-vue', iconStubUrl],
  ]),
)

const renderer = createHostRenderer()

function mountNav(initialProps = {}) {
  const props = ref({
    navCollapsed: false,
    navSteps: [
      { key: 'script', label: '故事剧本', anchor: 'anchor-script', status: 'pending', count: 0 },
      { key: 'chars', label: '角色', anchor: 'anchor-characters', status: 'partial', count: 2 },
      { key: 'video', label: '交付与导出', anchor: 'anchor-video', status: 'generating', count: 0 },
    ],
    activeNavAnchor: 'anchor-characters',
    storyboards: [
      { id: 31, title: '林间开场', segment_title: '', segment_index: 0 },
      { id: 32, title: '', segment_title: '', segment_index: 0 },
    ],
    allActiveTaskItems: [],
    allActiveTaskLabels: [],
    pipelineStopping: false,
    storyboardMenuExpanded: true,
    ...initialProps,
  })
  const events = []
  const mounted = mountHarness(renderer, () => h(FilmCreateQuickNav, {
    ...props.value,
    'onUpdate:storyboardMenuExpanded': (value) => {
      props.value = { ...props.value, storyboardMenuExpanded: value }
    },
    onToggleNav: () => events.push(['toggle-nav']),
    onScrollToAnchor: (anchor, fallback) => events.push(['scroll-to-anchor', anchor, fallback]),
    onCancelActiveTask: (item) => events.push(['cancel-active-task', item.id]),
  }))
  return { ...mounted, events, props }
}

test('导航步骤把完成状态写进中文 title 和读屏名称', async () => {
  const harness = mountNav()
  try {
    await nextTick()
    const pending = buttonByAriaLabel(harness.root, '跳转到故事剧本（未开始）')
    const partial = buttonByAriaLabel(harness.root, '跳转到角色（部分完成）')
    const generating = buttonByAriaLabel(harness.root, '跳转到交付与导出（生成中）')
    assert.ok(pending)
    assert.ok(partial)
    assert.ok(generating)
    assert.equal(pending.props.title, '跳转到故事剧本（未开始）')
    assert.equal(partial.props.title, '跳转到角色（部分完成）')
    assert.equal(generating.props.title, '跳转到交付与导出（生成中）')
    assert.equal(partial.props['aria-current'], 'step')
    click(pending)
    assert.deepEqual(harness.events, [['scroll-to-anchor', 'anchor-script', 'anchor-script']])
  } finally {
    harness.app.unmount()
  }
})

test('分镜列表和溢出任务给出中文下一步名称，不用英文省略号', async () => {
  const harness = mountNav({
    allActiveTaskItems: Array.from({ length: 9 }, (_, index) => ({
      id: `task-${index + 1}`,
      label: `任务${index + 1}`,
      kind: 'image',
    })),
    allActiveTaskLabels: Array.from({ length: 9 }, (_, index) => `任务${index + 1}`),
  })
  try {
    await nextTick()
    const firstShot = buttonByAriaLabel(harness.root, '跳转到分镜 1：林间开场')
    const secondShot = buttonByAriaLabel(harness.root, '跳转到分镜 2：未命名')
    assert.ok(firstShot)
    assert.ok(secondShot)
    const overflow = findByClass(harness.root, 'atp-more')[0]
    assert.ok(overflow)
    assert.equal(overflow.props.role, 'status')
    assert.match(overflow.props['aria-label'], /还有 1 个任务未列出：任务9/)
    assert.match(textContent(overflow), /还有 1 个任务未列出/)
    assert.doesNotMatch(textContent(harness.root), /\.\.\./)
    click(firstShot)
    assert.deepEqual(harness.events, [['scroll-to-anchor', 'sb-31', 'anchor-storyboard-images']])
  } finally {
    harness.app.unmount()
  }
})
