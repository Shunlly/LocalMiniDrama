import test from 'node:test'
import assert from 'node:assert/strict'

import { defineComponent, h, nextTick } from 'vue'
import { projectCardDestination as resolveProjectCardDestination } from '../src/utils/sourceImportNavigation.js'

import {
  buttonByAriaLabel,
  compileIconStub,
  createHostRenderer,
  findAll,
  findByClass,
  loadCompiledSfc,
  mountHarness,
  textContent,
  vueUrl,
} from './helpers/vueComponentHarness.js'

const gridUrl = new URL('../src/components/filmList/FilmListProjectGrid.vue', import.meta.url)
const iconStubUrl = compileIconStub([
  'ArrowRight',
  'Delete',
  'Download',
  'Edit',
  'Files',
  'MoreFilled',
  'PictureFilled',
])
const formattersUrl = new URL('../src/components/filmList/filmListFormatters.js', import.meta.url).href
const FilmListProjectGrid = await loadCompiledSfc(
  gridUrl,
  'film-list-project-grid-component',
  new Map([
    ['vue', vueUrl],
    ['@element-plus/icons-vue', iconStubUrl],
    ['./filmListFormatters.js', formattersUrl],
  ]),
)

const renderer = createHostRenderer()
const DRAMA_ID = 11
const OTHER_DRAMA_ID = 22
assert.notEqual(DRAMA_ID, OTHER_DRAMA_ID)
const WRITE_LOCK_REASON = '项目数据加载失败，成功重试前不能新增或导入'

const RouterLinkStub = defineComponent({
  name: 'RouterLink',
  props: ['to'],
  setup(props, { slots, attrs }) {
    return () => h('a', {
      ...attrs,
      href: '#',
      'data-to': JSON.stringify(props.to ?? null),
    }, slots.default?.())
  },
})

const ElDropdownItemStub = defineComponent({
  name: 'ElDropdownItemStub',
  props: ['command', 'disabled', 'divided', 'title'],
  setup(props, { slots, attrs }) {
    return () => h('button', {
      ...attrs,
      type: 'button',
      'data-command': props.command,
      disabled: Boolean(props.disabled),
      title: props.title,
    }, slots.default?.())
  },
})

function commandButton(root, command) {
  return findAll(root, (node) => node.type === 'button' && node.props?.['data-command'] === command)[0]
}

function linkByAriaLabel(root, label) {
  return findAll(root, (node) => node.type === 'a' && node.props?.['aria-label'] === label)[0]
}

function mountGrid(initial = {}) {
  const events = []
  const mounted = mountHarness(renderer, () => h(FilmListProjectGrid, {
    filteredDramas: initial.filteredDramas ?? [],
    sourceImportIntent: Boolean(initial.sourceImportIntent),
    projectListReturnTo: initial.projectListReturnTo ?? '/',
    exportingId: initial.exportingId ?? null,
    listWriteLocked: Boolean(initial.listWriteLocked),
    listWriteLockReason: initial.listWriteLockReason ?? '',
    projectCardDestination: initial.projectCardDestination ?? ((drama) => resolveProjectCardDestination(
      drama,
      Boolean(initial.sourceImportIntent),
      initial.projectListReturnTo ?? '/',
    )),
    projectCoverUrl: (drama) => drama.cover_url || '',
    projectCoverAlt: (drama) => drama.title || '未命名项目',
    markProjectCoverError: (drama) => events.push(['cover-error', drama.id]),
    formatStatus: (status) => ({ draft: '草稿', published: '已发布' }[status] || status || '草稿'),
    formatDate: (value) => value || '未知时间',
    formatStyle: (style) => style || '',
    formatGenre: (genre) => genre || '',
    totalStoryboards: (drama) => Number(drama.storyboardCount || 0),
    handleProjectAction: (action, drama) => events.push([action, drama.id]),
  }), {
    components: {
      RouterLink: RouterLinkStub,
      'router-link': RouterLinkStub,
      ElDropdownItem: ElDropdownItemStub,
      'el-dropdown-item': ElDropdownItemStub,
    },
  })
  return { ...mounted, events }
}

test('空列表不渲染卡片；无封面时展示中文空态', async () => {
  const empty = mountGrid()
  try {
    await nextTick()
    assert.equal(findByClass(empty.root, 'project-card').length, 0)
    assert.equal(findAll(empty.root, (node) => node.type === 'a').length, 0)
  } finally {
    empty.app.unmount()
  }

  const harness = mountGrid({
    filteredDramas: [
      { id: DRAMA_ID, title: '', description: '', status: 'draft', episodes: [], storyboardCount: 0, created_at: '2026-01-01', updated_at: '2026-01-02' },
      { id: OTHER_DRAMA_ID, title: '雨巷', description: '油纸伞', status: 'draft', episodes: [{ id: 1 }], storyboardCount: 3, created_at: '2026-01-03', updated_at: '2026-01-04' },
    ],
  })
  try {
    await nextTick()
    assert.match(textContent(harness.root), /未命名项目/)
    assert.match(textContent(harness.root), /暂无描述/)
    assert.match(textContent(harness.root), /尚无画面/)
    assert.match(textContent(harness.root), /待生成画面/)
    assert.match(textContent(harness.root), /继续制作/)
    assert.match(textContent(harness.root), /去创建剧集/)
    const unnamed = linkByAriaLabel(harness.root, '打开项目「未命名项目」')
    const named = linkByAriaLabel(harness.root, '打开项目「雨巷」')
    assert.ok(unnamed, '缺少未命名项目卡片')
    assert.ok(named)
    assert.ok(linkByAriaLabel(harness.root, '打开项目「未命名项目」的故事素材流程'))
    assert.ok(linkByAriaLabel(harness.root, '打开项目「雨巷」的故事素材流程'))
    assert.equal(JSON.parse(unnamed.props['data-to']).name, 'drama-detail')
    assert.equal(JSON.parse(named.props['data-to']).name, 'film')
    assert.equal(JSON.parse(named.props['data-to']).params.id, OTHER_DRAMA_ID)
    assert.doesNotMatch(unnamed.props['data-to'], new RegExp(String(OTHER_DRAMA_ID)))
  } finally {
    harness.app.unmount()
  }
})

test('写锁时编辑和移入回收站展示中文原因', async () => {
  const harness = mountGrid({
    listWriteLocked: true,
    listWriteLockReason: WRITE_LOCK_REASON,
    exportingId: DRAMA_ID,
    filteredDramas: [
      { id: DRAMA_ID, title: '雨巷', status: 'draft', episodes: [{ id: 1 }], storyboardCount: 1 },
    ],
  })
  try {
    await nextTick()
    const menu = buttonByAriaLabel(harness.root, '打开项目「雨巷」操作菜单')
    assert.ok(menu)
    const exported = commandButton(harness.root, 'export')
    const edited = commandButton(harness.root, 'edit')
    const trashed = commandButton(harness.root, 'trash')
    assert.ok(exported)
    assert.ok(edited)
    assert.ok(trashed)
    assert.equal(exported.props.disabled, true)
    assert.equal(exported.props.title, '正在导出该项目，请稍候')
    assert.equal(edited.props.disabled, true)
    assert.equal(trashed.props.disabled, true)
    assert.equal(edited.props.title, WRITE_LOCK_REASON)
    assert.equal(trashed.props.title, WRITE_LOCK_REASON)
    assert.equal(exported.props['aria-label'], '导出项目不可用：正在导出该项目，请稍候')
    assert.equal(edited.props['aria-label'], `编辑项目不可用：${WRITE_LOCK_REASON}`)
    assert.equal(trashed.props['aria-label'], `移入回收站不可用：${WRITE_LOCK_REASON}`)
    assert.match(textContent(exported), /导出项目/)
    assert.match(textContent(edited), /编辑项目/)
    assert.match(textContent(trashed), /移入回收站/)
  } finally {
    harness.app.unmount()
  }
})

test('导入意图下卡片改成导入网页 URL，菜单命令交给页面', async () => {
  const harness = mountGrid({
    sourceImportIntent: true,
    filteredDramas: [
      { id: OTHER_DRAMA_ID, title: '雨巷', status: 'draft', episodes: [{ id: 1 }], storyboardCount: 1 },
    ],
  })
  try {
    await nextTick()
    assert.match(textContent(harness.root), /导入网页 URL/)
    assert.doesNotMatch(textContent(harness.root), /继续制作/)
    assert.equal(linkByAriaLabel(harness.root, '打开项目「雨巷」的故事素材流程'), undefined)
    assert.doesNotMatch(textContent(harness.root), /故事素材/)
    const card = linkByAriaLabel(harness.root, '打开项目「雨巷」')
    assert.ok(card)
    assert.equal(findAll(harness.root, (node) => node.type === 'a').length, 1)
    const items = findAll(harness.root, (node) => node.type === 'dropdown-items')[0]
    assert.ok(items)
    items.props.onCommand('export')
    items.props.onCommand('edit')
    assert.deepEqual(harness.events, [['export', OTHER_DRAMA_ID], ['edit', OTHER_DRAMA_ID]])
    assert.doesNotMatch(JSON.stringify(harness.events), new RegExp(String(DRAMA_ID)))
  } finally {
    harness.app.unmount()
  }
})

test('无效剧集编号的卡片仍显示去创建剧集，不误写成继续制作', async () => {
  const harness = mountGrid({
    filteredDramas: [
      { id: DRAMA_ID, title: '残本', status: 'draft', episodes: [{ id: 'bad' }], storyboardCount: 0 },
    ],
  })
  try {
    await nextTick()
    assert.match(textContent(harness.root), /去创建剧集/)
    assert.doesNotMatch(textContent(harness.root), /继续制作/)
    assert.match(textContent(harness.root), /0/)
    assert.doesNotMatch(textContent(harness.root), /1 集/)
    const card = linkByAriaLabel(harness.root, '打开项目「残本」')
    assert.ok(card, '缺少去创建剧集读屏名称')
    assert.match(textContent(harness.root), /0\s*集/)
    assert.doesNotMatch(textContent(harness.root), /1\s*集/)
    assert.equal(JSON.parse(card.props['data-to']).hash, '#episode-list')
  } finally {
    harness.app.unmount()
  }
})
