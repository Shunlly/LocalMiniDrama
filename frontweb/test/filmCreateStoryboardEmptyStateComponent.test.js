import test from 'node:test'
import assert from 'node:assert/strict'

import { h, nextTick } from 'vue'

import {
  actionGateReasons,
  buttonByText,
  click,
  compileSfc,
  createHostRenderer,
  findByClass,
  findByType,
  loadCompiledSfc,
  mountHarness,
  textContent,
  vueUrl,
} from './helpers/vueComponentHarness.js'

const actionGateUrl = new URL('../src/components/filmCreate/ActionGate.vue', import.meta.url)
const emptyStateUrl = new URL('../src/components/filmCreate/FilmCreateStoryboardEmptyState.vue', import.meta.url)
const compiledActionGateUrl = compileSfc(actionGateUrl, 'storyboard-empty-state-action-gate', new Map([['vue', vueUrl]]))
const FilmCreateStoryboardEmptyState = await loadCompiledSfc(
  emptyStateUrl,
  'film-create-storyboard-empty-state-component',
  new Map([
    ['vue', vueUrl],
    ['@/components/filmCreate/ActionGate.vue', compiledActionGateUrl],
  ]),
)

const renderer = createHostRenderer()
const EMPTY_SCRIPT_REASON = '当前集还没有剧本，请先编写或导入剧本'
const EPISODE_REASON = '请先创建或选择剧集'

function requireButton(root, label) {
  const button = buttonByText(root, label)
  assert.ok(button, `缺少按钮：${label}`)
  return button
}

function mountEmpty(initial = {}) {
  const events = []
  const mounted = mountHarness(renderer, () => h(FilmCreateStoryboardEmptyState, {
    hasAnyEpisode: initial.hasAnyEpisode ?? true,
    storyboardGenerating: Boolean(initial.storyboardGenerating),
    universalOmniPolishRunning: Boolean(initial.universalOmniPolishRunning),
    storyboardActionDisabledReason: initial.storyboardActionDisabledReason ?? '',
    episodeActionDisabledReason: initial.episodeActionDisabledReason ?? '',
    onGenerateStoryboard: () => events.push(['generate-storyboard']),
    onAddSingleStoryboard: () => events.push(['add-single-storyboard']),
    onAddEpisode: () => events.push(['add-episode']),
  }))
  return { ...mounted, events }
}

test('有剧集时空态提供生成和添加分镜，点击交给页面方法', async () => {
  const harness = mountEmpty()
  try {
    await nextTick()
    assert.match(textContent(harness.root), /还没有分镜，可生成分镜或添加一个分镜/)
    assert.doesNotMatch(textContent(harness.root), /请先创建或选择剧集，再生成或添加分镜/)
    assert.equal(buttonByText(harness.root, '去创建剧集'), undefined)
    click(requireButton(harness.root, '生成分镜'))
    click(requireButton(harness.root, '添加一个分镜'))
    assert.deepEqual(harness.events, [['generate-storyboard'], ['add-single-storyboard']])
  } finally {
    harness.app.unmount()
  }
})

test('空剧本时生成和添加都禁用，并展示中文原因', async () => {
  const harness = mountEmpty({
    storyboardActionDisabledReason: EMPTY_SCRIPT_REASON,
    episodeActionDisabledReason: EMPTY_SCRIPT_REASON,
  })
  try {
    await nextTick()
    const generate = requireButton(harness.root, '生成分镜')
    const addOne = requireButton(harness.root, '添加一个分镜')
    assert.equal(generate.props.disabled, true)
    assert.equal(addOne.props.disabled, true)
    assert.equal(generate.props.title, EMPTY_SCRIPT_REASON)
    assert.equal(addOne.props.title, EMPTY_SCRIPT_REASON)
    assert.ok(actionGateReasons(harness.root).includes(EMPTY_SCRIPT_REASON))
    const gates = findByType(harness.root, 'span').filter((node) => node.props?.role === 'group')
    assert.ok(gates.some((gate) => gate.props['aria-label'] === `生成分镜不可用：${EMPTY_SCRIPT_REASON}`))
    assert.ok(gates.some((gate) => gate.props['aria-label'] === `添加一个分镜不可用：${EMPTY_SCRIPT_REASON}`))
  } finally {
    harness.app.unmount()
  }
})

test('正在生成时按钮进入 loading，标题改为请稍候', async () => {
  const harness = mountEmpty({
    storyboardGenerating: true,
    storyboardActionDisabledReason: EMPTY_SCRIPT_REASON,
  })
  try {
    await nextTick()
    const generate = requireButton(harness.root, '生成分镜')
    assert.equal(generate.props['data-loading'], true)
    assert.equal(generate.props.disabled, true)
    assert.equal(generate.props.title, '正在生成分镜，请稍候')
    assert.ok(actionGateReasons(harness.root).includes(EMPTY_SCRIPT_REASON))
  } finally {
    harness.app.unmount()
  }
})

test('没有剧集时只提供去创建剧集，不展示生成分镜', async () => {
  const harness = mountEmpty({
    hasAnyEpisode: false,
    storyboardActionDisabledReason: EMPTY_SCRIPT_REASON,
    episodeActionDisabledReason: EPISODE_REASON,
  })
  try {
    await nextTick()
    assert.match(textContent(harness.root), /请先创建或选择剧集，再生成或添加分镜/)
    assert.doesNotMatch(textContent(harness.root), /还没有分镜，可生成分镜或添加一个分镜/)
    assert.equal(buttonByText(harness.root, '生成分镜'), undefined)
    assert.equal(buttonByText(harness.root, '添加一个分镜'), undefined)
    const create = requireButton(harness.root, '去创建剧集')
    assert.equal(create.props['aria-label'], '去创建剧集')
    click(create)
    assert.deepEqual(harness.events, [['add-episode']])
    const actions = findByClass(harness.root, 'empty-tip-actions')[0]
    const primaries = findByType(actions, 'button').filter((node) => node.props['data-variant'] === 'primary')
    assert.equal(primaries.length, 1)
    assert.ok(String(create.props['aria-label'] || '').includes(textContent(create).replace(/\s+/g, ' ').trim()))
  } finally {
    harness.app.unmount()
  }
})

test('有剧集空态只有一个 primary，禁用时读屏名仍包含可见文案', async () => {
  const harness = mountEmpty({
    storyboardActionDisabledReason: EMPTY_SCRIPT_REASON,
    episodeActionDisabledReason: EMPTY_SCRIPT_REASON,
  })
  try {
    await nextTick()
    const actions = findByClass(harness.root, 'empty-tip-actions')[0]
    const buttons = findByType(actions, 'button')
    const primaries = buttons.filter((node) => node.props['data-variant'] === 'primary')
    assert.equal(primaries.length, 1)
    assert.match(textContent(primaries[0]), /生成分镜/)
    for (const button of buttons) {
      const visible = textContent(button).replace(/\s+/g, ' ').trim()
      assert.ok(visible)
      assert.ok(String(button.props['aria-label'] || '').includes(visible), visible)
    }
    const generate = requireButton(harness.root, '生成分镜')
    assert.equal(generate.props['aria-label'], `生成分镜不可用：${EMPTY_SCRIPT_REASON}`)
    const addOne = requireButton(harness.root, '添加一个分镜')
    assert.equal(addOne.props['aria-label'], `添加一个分镜不可用：${EMPTY_SCRIPT_REASON}`)
  } finally {
    harness.app.unmount()
  }
})
