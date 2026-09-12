import test from 'node:test'
import assert from 'node:assert/strict'

import { h, nextTick } from 'vue'

import {
  buttonByAriaLabel,
  click,
  compileIconStub,
  createHostRenderer,
  findByClass,
  findByType,
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

function visibleButtonText(node) {
  return textContent(node).replace(/\s+/g, ' ').trim()
}

function assertEmptyStateButtons(root, sectionClass, { primaryText = '', allowZeroPrimary = false } = {}) {
  const section = findByClass(root, sectionClass)[0]
  assert.ok(section, `missing ${sectionClass}`)
  const buttons = findByType(section, 'button')
  assert.ok(buttons.length > 0, `${sectionClass} should have buttons`)
  const primaries = buttons.filter((node) => node.props['data-variant'] === 'primary')
  if (allowZeroPrimary) assert.ok(primaries.length <= 1, `${sectionClass} can have at most one primary`)
  else assert.equal(primaries.length, 1, `${sectionClass} should have exactly one primary`)
  if (primaryText) {
    assert.match(visibleButtonText(primaries[0]), new RegExp(primaryText))
    assert.ok(String(primaries[0].props['aria-label'] || '').includes(primaryText))
  }
  for (const button of buttons) {
    const visible = visibleButtonText(button)
    const label = String(button.props['aria-label'] || '')
    assert.ok(visible, 'empty-state button needs visible text')
    assert.ok(label.includes(visible), `${visible} should be inside aria-label "${label}"`)
  }
}


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
    const material = buttonByAriaLabel(harness.root, '前往素材中心')
    const trash = buttonByAriaLabel(harness.root, '查看回收站')
    assert.ok(created)
    assert.ok(imported)
    assert.ok(material)
    assert.ok(trash)
    assert.equal(created.props['data-variant'], 'primary')
    assert.notEqual(imported.props['data-variant'], 'primary')
    assert.notEqual(material.props['data-variant'], 'primary')
    assert.notEqual(trash.props['data-variant'], 'primary')
    assert.match(textContent(material), /前往素材中心/)
    assert.match(textContent(trash), /查看回收站/)
    assert.equal(material.props['aria-label'], '前往素材中心')
    assert.equal(trash.props['aria-label'], '查看回收站')
    assert.notEqual(created.props.disabled, true)
    click(created)
    click(imported)
    click(material)
    click(trash)
    assert.deepEqual(harness.events, ['new', 'import', 'material', 'trash'])
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

test('\u7a7a\u9879\u76ee\u8d77\u6b65\u8def\u5f84\u53ea\u6709\u4e00\u4e2a\u4e3b\u6309\u94ae\uff0c\u4e14\u8bfb\u5c4f\u540d\u5305\u542b\u53ef\u89c1\u6587\u6848', async () => {
  const harness = mountToolbar({
    dramas: [],
    filteredDramas: [],
    hasProjectFilters: false,
    exampleList: [{ filename: 'demo.zip', name: '\u96e8\u5df7\u793a\u4f8b' }],
  })
  try {
    await nextTick()
    assertEmptyStateButtons(harness.root, 'action-card--empty', { primaryText: '\u65b0\u5efa\u9879\u76ee' })
    assert.equal(findByClass(harness.root, 'action-card--search-empty').length, 0)
  } finally {
    harness.app.unmount()
  }
})

test('\u7b5b\u9009\u7a7a\u6001\u53ea\u6709\u4e00\u4e2a\u4e3b\u6309\u94ae\uff0c\u6e05\u9664\u7b5b\u9009\u7684\u8bfb\u5c4f\u540d\u5305\u542b\u53ef\u89c1\u6587\u6848', async () => {
  const harness = mountToolbar({
    projectSearch: 'moon',
    dramas: [{ id: 1, title: '\u96e8\u5df7' }],
    filteredDramas: [],
    hasProjectFilters: true,
    projectListCountLabel: '0 \u4e2a\u9879\u76ee',
  })
  try {
    await nextTick()
    assertEmptyStateButtons(harness.root, 'action-card--search-empty', { primaryText: '\u65b0\u5efa\u9879\u76ee' })
    const clear = buttonByAriaLabel(harness.root, '\u6e05\u9664\u7b5b\u9009\u5e76\u67e5\u770b\u5168\u90e8\u9879\u76ee')
    assert.ok(clear)
    assert.match(visibleButtonText(clear), /\u6e05\u9664\u7b5b\u9009/)
  } finally {
    harness.app.unmount()
  }
})
