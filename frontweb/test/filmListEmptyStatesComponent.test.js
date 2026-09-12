import test from 'node:test'
import assert from 'node:assert/strict'

import { h, nextTick } from 'vue'

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

const bannersUrl = new URL('../src/components/filmList/FilmListFailureBanners.vue', import.meta.url)
const toolbarUrl = new URL('../src/components/filmList/FilmListWorkspaceToolbar.vue', import.meta.url)
const iconStubUrl = compileIconStub([
  'Delete',
  'Files',
  'FolderOpened',
  'Plus',
  'QuestionFilled',
  'RefreshLeft',
  'Search',
  'Upload',
])
const replacements = new Map([
  ['vue', vueUrl],
  ['@element-plus/icons-vue', iconStubUrl],
])
const FilmListFailureBanners = await loadCompiledSfc(bannersUrl, 'film-list-empty-banners', replacements)
const FilmListWorkspaceToolbar = await loadCompiledSfc(toolbarUrl, 'film-list-empty-toolbar', replacements)
const renderer = createHostRenderer()
const WRITE_LOCK_REASON = '项目数据加载失败，成功重试前不能新增或导入'

function noop() {}

function mountToolbar(initial = {}) {
  const events = []
  const mounted = mountHarness(renderer, () => h(FilmListWorkspaceToolbar, {
    projectSearch: initial.projectSearch ?? '',
    projectStatusFilter: initial.projectStatusFilter ?? 'all',
    projectSort: initial.projectSort ?? 'updated-desc',
    loading: Boolean(initial.loading),
    hasSuccessfulListLoad: initial.hasSuccessfulListLoad !== false,
    listError: initial.listError ?? '',
    dramas: initial.dramas ?? [],
    filteredDramas: initial.filteredDramas ?? [],
    hasProjectFilters: Boolean(initial.hasProjectFilters),
    projectListCountLabel: initial.projectListCountLabel ?? '暂无项目',
    listWriteLocked: Boolean(initial.listWriteLocked),
    listWriteLockReason: initial.listWriteLockReason ?? '',
    importing: Boolean(initial.importing),
    exampleList: initial.exampleList ?? [],
    importingExample: initial.importingExample ?? null,
    goNewProject: () => events.push('new'),
    triggerImport: () => events.push('import'),
    goMaterialCenter: () => events.push('material'),
    openTrash: () => events.push('trash'),
    onImportExample: () => events.push('example'),
    clearProjectFilters: () => events.push('clear'),
  }))
  return { ...mounted, events }
}

function mountBanners(initial = {}) {
  const events = []
  const mounted = mountHarness(renderer, () => h(FilmListFailureBanners, {
    listError: initial.listError ?? '',
    listIsStale: Boolean(initial.listIsStale),
    loading: Boolean(initial.loading),
    exportFailure: initial.exportFailure ?? null,
    exportingId: initial.exportingId ?? null,
    importFailure: initial.importFailure ?? null,
    importing: Boolean(initial.importing),
    listWriteLocked: Boolean(initial.listWriteLocked),
    listWriteLockReason: initial.listWriteLockReason ?? '',
    loadList: () => events.push('retry'),
    onExport: noop,
    triggerImport: () => events.push('import'),
    dismissImportFailure: () => events.push('dismiss'),
  }))
  return { ...mounted, events }
}

test('空列表起步路径可以新建、导入，不出现筛选空态', async () => {
  const harness = mountToolbar({
    dramas: [],
    filteredDramas: [],
    hasProjectFilters: false,
  })
  try {
    await nextTick()
    assert.match(textContent(harness.root), /还没有短剧项目/)
    assert.doesNotMatch(textContent(harness.root), /没有匹配的项目/)
    const created = buttonByAriaLabel(harness.root, '新建项目')
    const imported = buttonByAriaLabel(harness.root, '导入项目包')
    assert.ok(created)
    assert.ok(imported)
    assert.notEqual(created.props.disabled, true)
    click(created)
    click(imported)
    assert.deepEqual(harness.events, ['new', 'import'])
  } finally {
    harness.app.unmount()
  }
})

test('筛选无结果时可以清除筛选或新建项目', async () => {
  const harness = mountToolbar({
    projectSearch: 'moon',
    dramas: [{ id: 1, title: '雨巷' }],
    filteredDramas: [],
    hasProjectFilters: true,
    projectListCountLabel: '0 个项目',
  })
  try {
    await nextTick()
    assert.match(textContent(harness.root), /没有匹配的项目/)
    assert.doesNotMatch(textContent(harness.root), /还没有短剧项目/)
    const clear = buttonByAriaLabel(harness.root, '清除筛选并查看全部项目')
    const created = buttonByAriaLabel(harness.root, '新建项目')
    assert.ok(clear)
    assert.ok(created)
    assert.notEqual(created.props.disabled, true)
    click(clear)
    click(created)
    assert.deepEqual(harness.events, ['clear', 'new'])
  } finally {
    harness.app.unmount()
  }
})

test('写锁时筛选空态的新建项目会说明中文原因', async () => {
  const harness = mountToolbar({
    projectSearch: 'moon',
    dramas: [{ id: 1, title: '雨巷' }],
    filteredDramas: [],
    hasProjectFilters: true,
    listWriteLocked: true,
    listWriteLockReason: WRITE_LOCK_REASON,
  })
  try {
    await nextTick()
    const created = buttonByAriaLabel(harness.root, '新建项目')
    assert.ok(created)
    assert.equal(created.props.disabled, true)
    assert.equal(created.props.title, WRITE_LOCK_REASON)
    assert.equal(created.props['aria-describedby'], 'project-list-write-lock-reason')
    assert.deepEqual(harness.events, [])
  } finally {
    harness.app.unmount()
  }
})

test('加载失败空态提供重试，并说明成功后才能新建', async () => {
  const harness = mountBanners({
    listError: '无法连接项目服务',
    listIsStale: false,
  })
  try {
    await nextTick()
    const banner = findByClass(harness.root, 'data-load-state')[0]
    assert.ok(banner)
    assert.equal(banner.props.role, 'alert')
    assert.match(textContent(banner), /项目数据加载失败/)
    assert.match(textContent(banner), /请先重试加载。成功后即可新建或导入项目。/)
    const retry = buttonByAriaLabel(harness.root, '重试加载')
    assert.ok(retry)
    click(retry)
    assert.deepEqual(harness.events, ['retry'])
  } finally {
    harness.app.unmount()
  }
})

test('加载失败时工具条不冒充空项目起步路径', async () => {
  const harness = mountToolbar({
    hasSuccessfulListLoad: false,
    listError: '无法连接项目服务',
    dramas: [],
    filteredDramas: [],
  })
  try {
    await nextTick()
    assert.equal(buttonByAriaLabel(harness.root, '新建项目'), undefined)
    assert.doesNotMatch(textContent(harness.root), /还没有短剧项目/)
    assert.doesNotMatch(textContent(harness.root), /没有匹配的项目/)
  } finally {
    harness.app.unmount()
  }
})
