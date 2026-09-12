import test from 'node:test'
import assert from 'node:assert/strict'

import { h, nextTick } from 'vue'

import {
  buttonByAriaLabel,
  buttonByText,
  click,
  compileIconStub,
  createHostRenderer,
  findByClass,
  loadCompiledSfc,
  mountHarness,
  textContent,
  vueUrl,
} from './helpers/vueComponentHarness.js'

const toolbarUrl = new URL('../src/components/filmCreate/FilmCreateStoryboardToolbar.vue', import.meta.url)
const iconStubUrl = compileIconStub(['ArrowDown', 'ArrowUp', 'Delete', 'Plus', 'Rank'])
const FilmCreateStoryboardToolbar = await loadCompiledSfc(
  toolbarUrl,
  'film-create-storyboard-toolbar-component',
  new Map([
    ['vue', vueUrl],
    ['@element-plus/icons-vue', iconStubUrl],
  ]),
)

const renderer = createHostRenderer()
const SB_ID = 101
const SB_NUMBER = 7
const INDEX = 1
assert.notEqual(SB_ID, SB_NUMBER)
assert.notEqual(SB_ID, INDEX)
assert.notEqual(SB_NUMBER, INDEX + 1)

function moveCopy({ actionLabel, index, reason = '' }) {
  const name = `${actionLabel}分镜${index + 1}`
  return {
    disabled: Boolean(reason),
    title: reason ? `${actionLabel}不可用：${reason}` : actionLabel,
    ariaLabel: reason ? `${name}不可用：${reason}` : name,
  }
}

function defaultMoveCopies(length) {
  return Array.from({ length }, (_, index) => ({
    up: moveCopy({ actionLabel: '上移', index, reason: index === 0 ? '已经是第一条分镜' : '' }),
    down: moveCopy({
      actionLabel: '下移',
      index,
      reason: index === length - 1 ? '已经是最后一条分镜' : '',
    }),
  }))
}

function mountToolbar(initial = {}) {
  const events = []
  const sb = {
    id: SB_ID,
    title: initial.title ?? '林间开场',
    storyboard_number: SB_NUMBER,
    movement: initial.movement ?? '',
  }
  const storyboards = initial.storyboards ?? [
    { id: 11, title: '前一条', storyboard_number: 6 },
    sb,
    { id: 22, title: '后一条', storyboard_number: 8 },
  ]
  const i = initial.i ?? INDEX
  const reorderHandleReason = initial.reorderHandleReason ?? ''
  const mounted = mountHarness(renderer, () => h(FilmCreateStoryboardToolbar, {
    sb,
    i,
    storyboards,
    storyboardGenerating: Boolean(initial.storyboardGenerating),
    universalOmniPolishRunning: Boolean(initial.universalOmniPolishRunning),
    storyboardReorderBusy: Boolean(initial.storyboardReorderBusy),
    dropTargetStoryboardIndex: initial.dropTargetStoryboardIndex ?? null,
    storyboardMoveCopies: initial.storyboardMoveCopies ?? defaultMoveCopies(storyboards.length),
    getMovementLabel: (value) => (value === 'pan' ? '横摇' : value),
    isSbUniversalMode: (id) => id === SB_ID && Boolean(initial.universalMode),
    reorderHandleReason: () => reorderHandleReason,
    onMoveStoryboardUp: (target, index) => events.push(['move-up', target.id, index]),
    onMoveStoryboardDown: (target, index) => events.push(['move-down', target.id, index]),
    onReorderDragStart: () => events.push(['drag-start']),
    onReorderDragOver: () => events.push(['drag-over']),
    onReorderDragEnd: () => events.push(['drag-end']),
    onReorderDrop: () => events.push(['drop']),
    onOpenVideoParamsDialog: (target) => events.push(['open-config', target.id]),
    onToggleSbUniversalMode: (target) => events.push(['toggle-mode', target.id]),
    onInsertStoryboardBefore: (target) => events.push(['insert-before', target.id]),
    onInsertStoryboardAfter: (target) => events.push(['insert-after', target.id]),
    onDeleteSingleStoryboard: (id) => events.push(['delete', id]),
  }))
  return { ...mounted, events, sb }
}

test('分镜行头展示序号标题，插入删除配置按分镜编号和 id 分开发出', async () => {
  const harness = mountToolbar({ movement: 'pan' })
  try {
    await nextTick()
    const text = textContent(harness.root)
    assert.match(text, /林间开场/)
    const numberLabel = findByClass(harness.root, 'sb-ctrl-num')[0]
    assert.ok(numberLabel)
    assert.equal(textContent(numberLabel).trim(), String(INDEX + 1))
    assert.match(text, /横摇/)
    assert.doesNotMatch(text, /还没有分镜/)
    assert.doesNotMatch(text, /AI 生成分镜/)

    const insert = buttonByAriaLabel(harness.root, `在分镜${INDEX + 1}前插入新分镜`)
    assert.ok(insert, '缺少按行号插入的分镜按钮')
    assert.equal(buttonByAriaLabel(harness.root, `在分镜${SB_NUMBER}前插入新分镜`), undefined)
    const insertAfter = buttonByAriaLabel(harness.root, `在分镜${INDEX + 1}后插入新分镜`)
    assert.ok(insertAfter, '缺少按行号后插的分镜按钮')
    assert.equal(insertAfter.props.title, '在本镜头后插入新分镜')
    assert.equal(buttonByAriaLabel(harness.root, `在分镜${SB_NUMBER}后插入新分镜`), undefined)
    assert.ok(buttonByText(harness.root, '后插'), '后插按钮可见文案应为「后插」')
    click(insert)
    click(insertAfter)
    click(buttonByText(harness.root, '⚙ 分镜配置'))
    click(buttonByText(harness.root, '全能模式'))
    const remove = buttonByAriaLabel(harness.root, `删除分镜${SB_NUMBER}`)
    assert.ok(remove, '删除读屏名称应使用 storyboard_number 而不是行号或 id')
    assert.equal(buttonByAriaLabel(harness.root, `删除分镜${INDEX + 1}`), undefined)
    click(remove)
    assert.deepEqual(harness.events, [
      ['insert-before', SB_ID],
      ['insert-after', SB_ID],
      ['open-config', SB_ID],
      ['toggle-mode', SB_ID],
      ['delete', SB_ID],
    ])
  } finally {
    harness.app.unmount()
  }
})

test('全能模式按钮按 sb.id 切换文案，拖放目标只作用在当前行', async () => {
  const universal = mountToolbar({ universalMode: true })
  try {
    await nextTick()
    assert.ok(buttonByText(universal.root, '经典分镜'))
    assert.equal(buttonByText(universal.root, '全能模式'), undefined)
    click(buttonByText(universal.root, '经典分镜'))
    assert.deepEqual(universal.events, [['toggle-mode', SB_ID]])
  } finally {
    universal.app.unmount()
  }

  const dropTarget = mountToolbar({ dropTargetStoryboardIndex: INDEX })
  try {
    await nextTick()
    const bar = findByClass(dropTarget.root, 'sb-ctrl-bar')[0]
    assert.ok(bar)
    assert.equal(bar.props.class.includes('sb-ctrl-bar--drop-target'), true)
  } finally {
    dropTarget.app.unmount()
  }
})

test('只有一条分镜时排序手柄和上下移都展示中文禁用原因', async () => {
  const reason = '至少两条分镜才能调整顺序'
  const sb = {
    id: SB_ID,
    title: '单独分镜',
    storyboard_number: SB_NUMBER,
    movement: '',
  }
  const harness = mountToolbar({
    title: sb.title,
    i: 0,
    storyboards: [sb],
    reorderHandleReason: reason,
    storyboardMoveCopies: [{
      up: moveCopy({ actionLabel: '上移', index: 0, reason }),
      down: moveCopy({ actionLabel: '下移', index: 0, reason }),
    }],
  })
  try {
    await nextTick()
    const handle = buttonByAriaLabel(harness.root, `拖动排序分镜1不可用：${reason}`)
    assert.ok(handle)
    assert.equal(handle.props.disabled, true)
    assert.equal(handle.props.draggable, false)
    assert.equal(handle.props.title, reason)

    const moveUp = buttonByAriaLabel(harness.root, `上移分镜1不可用：${reason}`)
    const moveDown = buttonByAriaLabel(harness.root, `下移分镜1不可用：${reason}`)
    assert.ok(moveUp)
    assert.ok(moveDown)
    assert.equal(moveUp.props.disabled, true)
    assert.equal(moveDown.props.disabled, true)
    assert.equal(moveUp.props.title, `上移不可用：${reason}`)
    assert.equal(moveDown.props.title, `下移不可用：${reason}`)
  } finally {
    harness.app.unmount()
  }
})

test('生成中禁用拖动排序；中间行可以上移下移并回传 id 与行号', async () => {
  const generating = mountToolbar({
    storyboardGenerating: true,
    reorderHandleReason: '正在生成分镜，请等待完成',
  })
  try {
    await nextTick()
    const handle = buttonByAriaLabel(generating.root, `拖动排序分镜${INDEX + 1}不可用：正在生成分镜，请等待完成`)
    assert.ok(handle)
    assert.equal(handle.props.disabled, true)
    assert.equal(handle.props.title, '正在生成分镜，请等待完成')
  } finally {
    generating.app.unmount()
  }

  const movable = mountToolbar()
  try {
    await nextTick()
    const handle = buttonByAriaLabel(movable.root, `拖动排序分镜${INDEX + 1}，按上下方向键移动`)
    assert.ok(handle)
    assert.notEqual(handle.props.disabled, true)
    assert.equal(handle.props.draggable, true)
    const moveUp = buttonByAriaLabel(movable.root, `上移分镜${INDEX + 1}`)
    const moveDown = buttonByAriaLabel(movable.root, `下移分镜${INDEX + 1}`)
    assert.ok(moveUp)
    assert.ok(moveDown)
    assert.notEqual(moveUp.props.disabled, true)
    assert.notEqual(moveDown.props.disabled, true)
    click(moveUp)
    click(moveDown)
    assert.deepEqual(movable.events, [
      ['move-up', SB_ID, INDEX],
      ['move-down', SB_ID, INDEX],
    ])
  } finally {
    movable.app.unmount()
  }
})