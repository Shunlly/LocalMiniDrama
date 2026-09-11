import test from 'node:test'
import assert from 'node:assert/strict'

import { h, nextTick, ref } from 'vue'

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

const headerUrl = new URL('../src/components/filmList/FilmListHeader.vue', import.meta.url)
const bannersUrl = new URL('../src/components/filmList/FilmListFailureBanners.vue', import.meta.url)
const toolbarUrl = new URL('../src/components/filmList/FilmListWorkspaceToolbar.vue', import.meta.url)

const iconStubUrl = compileIconStub([
  'ArrowDown',
  'Box',
  'Collection',
  'Delete',
  'Download',
  'Files',
  'FolderOpened',
  'MagicStick',
  'Moon',
  'PictureFilled',
  'Plus',
  'QuestionFilled',
  'RefreshLeft',
  'Search',
  'Setting',
  'Sunny',
  'Upload',
  'User',
])

const replacements = new Map([
  ['vue', vueUrl],
  ['@element-plus/icons-vue', iconStubUrl],
])

const FilmListHeader = await loadCompiledSfc(headerUrl, 'film-list-header', replacements)
const FilmListFailureBanners = await loadCompiledSfc(bannersUrl, 'film-list-failure-banners', replacements)
const FilmListWorkspaceToolbar = await loadCompiledSfc(toolbarUrl, 'film-list-workspace-toolbar', replacements)

const renderer = createHostRenderer()

const CLEAR = '\u6e05\u9664\u7b5b\u9009'
const CLEAR_ALL = '\u6e05\u9664\u7b5b\u9009\u5e76\u67e5\u770b\u5168\u90e8\u9879\u76ee'
const NEW_PROJECT = '\u65b0\u5efa\u9879\u76ee'
const LOAD_FAIL = '\u9879\u76ee\u6570\u636e\u52a0\u8f7d\u5931\u8d25'
const RETRY_LOAD = '\u91cd\u8bd5\u52a0\u8f7d'
const IMPORT_FAIL = '\u9879\u76ee\u5305\u5bfc\u5165\u5931\u8d25'
const NO_MATCH = '\u6ca1\u6709\u5339\u914d\u7684\u9879\u76ee'
const NO_PROJECTS = '\u8fd8\u6ca1\u6709\u77ed\u5267\u9879\u76ee'

function noop() {}

test('\u9879\u76ee\u5217\u8868\u9875\u5934\u4fdd\u7559\u54c1\u724c\u5e76\u628a\u65b0\u5efa\u9879\u76ee\u70b9\u51fb\u4ea4\u7ed9\u9875\u9762', () => {
  const calls = []
  const harness = mountHarness(renderer, () => h(FilmListHeader, {
    isDark: false,
    listWriteLocked: false,
    listWriteLockReason: '',
    listError: '',
    backupNavItem: { id: 'backup' },
    importing: false,
    goMaterialCenter: noop,
    openSemanticLibrary: noop,
    goFreeCreate: noop,
    openTrash: noop,
    toggleTheme: noop,
    goBackup: noop,
    triggerImport: noop,
    goNewProject: () => calls.push('new'),
  }))
  try {
    assert.match(textContent(harness.root), /LocalMiniDrama/)
    assert.match(textContent(harness.root), /\u672c\u5730\u77ed\u5267\u52a9\u624b/)
    const created = buttonByAriaLabel(harness.root, NEW_PROJECT) || buttonByText(harness.root, NEW_PROJECT)
    assert.ok(created)
    click(created)
    assert.deepEqual(calls, ['new'])
  } finally {
    harness.app.unmount()
  }
})

test('\u5199\u9501\u65f6\u65b0\u5efa\u4e0e\u5bfc\u5165\u4fdd\u7559\u4e2d\u6587 title', () => {
  const reason = '\u9879\u76ee\u6570\u636e\u52a0\u8f7d\u5931\u8d25\uff0c\u6210\u529f\u91cd\u8bd5\u524d\u4e0d\u80fd\u65b0\u589e\u6216\u5bfc\u5165'
  const harness = mountHarness(renderer, () => h(FilmListHeader, {
    isDark: true,
    listWriteLocked: true,
    listWriteLockReason: reason,
    listError: '\u9879\u76ee\u670d\u52a1\u6682\u65f6\u4e0d\u53ef\u7528',
    backupNavItem: null,
    importing: false,
    goMaterialCenter: noop,
    openSemanticLibrary: noop,
    goFreeCreate: noop,
    openTrash: noop,
    toggleTheme: noop,
    goBackup: noop,
    triggerImport: noop,
    goNewProject: noop,
  }))
  try {
    const created = buttonByAriaLabel(harness.root, NEW_PROJECT)
    assert.ok(created)
    assert.equal(created.props.disabled, true)
    assert.equal(created.props.title, reason)
    const imported = buttonByAriaLabel(harness.root, '\u5bfc\u5165\u9879\u76ee\u5305')
    assert.ok(imported)
    assert.equal(imported.props.disabled, true)
    assert.equal(imported.props.title, reason)
  } finally {
    harness.app.unmount()
  }
})

test('\u52a0\u8f7d\u5931\u8d25\u6a2a\u5e45\u4fdd\u7559 assertive live region\uff0c\u91cd\u8bd5\u4f1a\u8c03\u7528\u9875\u9762 loadList', () => {
  const calls = []
  const harness = mountHarness(renderer, () => h(FilmListFailureBanners, {
    listError: '\u65e0\u6cd5\u8fde\u63a5\u9879\u76ee\u670d\u52a1',
    listIsStale: false,
    loading: false,
    exportFailure: null,
    exportingId: null,
    importFailure: null,
    importing: false,
    listWriteLocked: true,
    listWriteLockReason: '',
    loadList: () => calls.push('load'),
    onExport: noop,
    triggerImport: noop,
    dismissImportFailure: noop,
  }))
  try {
    const banner = findByClass(harness.root, 'data-load-state')[0]
    assert.ok(banner)
    assert.equal(banner.props.role, 'alert')
    assert.equal(banner.props['aria-live'], 'assertive')
    assert.equal(banner.props.tabindex, '-1')
    assert.match(textContent(banner), new RegExp(LOAD_FAIL))
    const retry = buttonByText(harness.root, RETRY_LOAD)
    assert.ok(retry)
    click(retry)
    assert.deepEqual(calls, ['load'])
  } finally {
    harness.app.unmount()
  }
})

test('\u5bfc\u5165\u5931\u8d25\u6a2a\u5e45\u51fa\u73b0\u65f6\u4f1a\u62ff\u5230\u7126\u70b9\uff0c\u4e14 aria-live \u4ecd\u662f assertive', async () => {
  const importFailure = ref(null)
  const harness = mountHarness(renderer, () => h(FilmListFailureBanners, {
    listError: '',
    listIsStale: false,
    loading: false,
    exportFailure: null,
    exportingId: null,
    importFailure: importFailure.value,
    importing: false,
    listWriteLocked: false,
    listWriteLockReason: '',
    loadList: noop,
    onExport: noop,
    triggerImport: noop,
    dismissImportFailure: noop,
  }))
  try {
    assert.equal(findByClass(harness.root, 'import-failure-state').length, 0)
    importFailure.value = { fileName: 'demo.zip', message: '\u8bf7\u9009\u62e9 .zip \u683c\u5f0f\u7684\u9879\u76ee\u5305' }
    await nextTick()
    await nextTick()
    const banner = findByClass(harness.root, 'import-failure-state')[0]
    assert.ok(banner)
    assert.equal(banner.props.role, 'alert')
    assert.equal(banner.props['aria-live'], 'assertive')
    assert.equal(banner.props.tabindex, '-1')
    assert.match(textContent(banner), new RegExp(IMPORT_FAIL))
  } finally {
    harness.app.unmount()
  }
})

test('\u7b5b\u9009\u65e0\u7ed3\u679c\u65f6\u7a7a\u6001\u548c\u5de5\u5177\u6761\u90fd\u80fd\u6e05\u9664\u7b5b\u9009', () => {
  const calls = []
  const harness = mountHarness(renderer, () => h(FilmListWorkspaceToolbar, {
    projectSearch: 'moon',
    projectStatusFilter: 'draft',
    projectSort: 'updated-desc',
    loading: false,
    hasSuccessfulListLoad: true,
    listError: '',
    dramas: [{ id: 1, title: 'Alpha' }],
    filteredDramas: [],
    hasProjectFilters: true,
    projectListCountLabel: '0 \u4e2a\u9879\u76ee',
    listWriteLocked: false,
    listWriteLockReason: '',
    importing: false,
    exampleList: [],
    importingExample: null,
    goNewProject: noop,
    triggerImport: noop,
    goMaterialCenter: noop,
    openTrash: noop,
    onImportExample: noop,
    clearProjectFilters: () => calls.push('clear'),
    'onUpdate:projectSearch': noop,
    'onUpdate:projectStatusFilter': noop,
    'onUpdate:projectSort': noop,
  }))
  try {
    assert.match(textContent(harness.root), new RegExp(NO_MATCH))
    const toolbarClear = findByClass(harness.root, 'workspace-clear-filters')[0]
    assert.ok(toolbarClear)
    assert.equal(toolbarClear.props['aria-label'], CLEAR)
    const emptyClear = findByClass(harness.root, 'action-btn-clear-filters')[0]
    assert.ok(emptyClear)
    assert.equal(emptyClear.props['aria-label'], CLEAR_ALL)
    click(emptyClear)
    click(toolbarClear)
    assert.deepEqual(calls, ['clear', 'clear'])
  } finally {
    harness.app.unmount()
  }
})

test('\u7a7a\u9879\u76ee\u8d77\u6b65\u8def\u5f84\u4ecd\u53ef\u70b9\u65b0\u5efa\u9879\u76ee', () => {
  const calls = []
  const harness = mountHarness(renderer, () => h(FilmListWorkspaceToolbar, {
    projectSearch: '',
    projectStatusFilter: 'all',
    projectSort: 'updated-desc',
    loading: false,
    hasSuccessfulListLoad: true,
    listError: '',
    dramas: [],
    filteredDramas: [],
    hasProjectFilters: false,
    projectListCountLabel: '\u6682\u65e0\u9879\u76ee',
    listWriteLocked: false,
    listWriteLockReason: '',
    importing: false,
    exampleList: [],
    importingExample: null,
    goNewProject: () => calls.push('new'),
    triggerImport: noop,
    goMaterialCenter: noop,
    openTrash: noop,
    onImportExample: noop,
    clearProjectFilters: noop,
  }))
  try {
    assert.match(textContent(harness.root), new RegExp(NO_PROJECTS))
    const created = buttonByAriaLabel(harness.root, NEW_PROJECT) || buttonByText(harness.root, NEW_PROJECT)
    assert.ok(created)
    click(created)
    assert.deepEqual(calls, ['new'])
    assert.equal(findByClass(harness.root, 'workspace-clear-filters').length, 0)
  } finally {
    harness.app.unmount()
  }
})
