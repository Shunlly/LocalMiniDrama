import test from 'node:test'
import assert from 'node:assert/strict'

import { h, nextTick } from 'vue'

import {
  buttonByAriaLabel,
  click,
  compileIconStub,
  createHostRenderer,
  dataModule,
  loadCompiledSfc,
  mountHarness,
  textContent,
  vueUrl,
} from './helpers/vueComponentHarness.js'

const gridUrl = new URL('../src/components/mediaLibrary/MediaLibraryLocalGrid.vue', import.meta.url)
const iconStubUrl = compileIconStub(['Files', 'Upload', 'Loading', 'Refresh'])
const childStubUrl = dataModule(`
  import { defineComponent, h } from ${JSON.stringify(vueUrl)}
  export default defineComponent({
    name: 'MediaLibraryChildStub',
    setup() {
      return () => h('div', { 'data-stub': 'media-child' })
    },
  })
`)
const MediaLibraryLocalGrid = await loadCompiledSfc(
  gridUrl,
  'media-library-local-grid-component',
  new Map([
    ['vue', vueUrl],
    ['@element-plus/icons-vue', iconStubUrl],
    ['./MediaLibraryCard.vue', childStubUrl],
    ['./MediaLibraryEmptyState.vue', childStubUrl],
  ]),
)

const renderer = createHostRenderer()

function noop() {}

function mountGrid(initial = {}) {
  const events = []
  const mounted = mountHarness(renderer, () => h(MediaLibraryLocalGrid, {
    page: 1,
    'onUpdate:page': noop,
    loadError: initial.loadError ?? '',
    mediaIsStale: Boolean(initial.mediaIsStale),
    loading: Boolean(initial.loading),
    mediaRetryLoadDisableReason: initial.mediaRetryLoadDisableReason ?? '',
    mediaAccessState: initial.mediaAccessState ?? {
      showEntryStrip: true,
      navigationLocked: false,
      writeLocked: false,
    },
    mediaWriteLocked: Boolean(initial.mediaWriteLocked),
    uploading: Boolean(initial.uploading),
    mediaUploadDisableReason: initial.mediaUploadDisableReason ?? '',
    mediaNavigationLockReason: initial.mediaNavigationLockReason ?? '',
    mediaSourceImportDisableReason: initial.mediaSourceImportDisableReason ?? '',
    mediaWriteLockReason: initial.mediaWriteLockReason ?? '',
    uploadProgress: initial.uploadProgress ?? { current: 0, total: 0 },
    uploadFeedback: initial.uploadFeedback ?? null,
    mediaItems: initial.mediaItems ?? [{ id: 5, name: '已有素材' }],
    selectedIds: initial.selectedIds ?? new Set(),
    hasSuccessfulMediaLoad: initial.hasSuccessfulMediaLoad !== false,
    hasActiveFilters: Boolean(initial.hasActiveFilters),
    total: initial.total ?? 1,
    pageSize: initial.pageSize ?? 30,
    visibleSelectedMediaCount: initial.visibleSelectedMediaCount ?? 0,
    mediaBatchDeleteDisableReason: initial.mediaBatchDeleteDisableReason ?? '',
    returnTo: initial.returnTo ?? '',
    loadMedia: noop,
    triggerUpload: () => events.push(['upload']),
    goSourceImport: () => events.push(['source-import']),
    goBack: () => events.push(['go-back']),
    itemUrl: noop,
    thumbnailAlt: () => '',
    formatSize: () => '',
    mediaItemFileSize: () => 0,
    mediaOriginLabel: () => '',
    isActionLayerVisible: () => false,
    showPointerActions: noop,
    hidePointerActions: noop,
    showKeyboardActions: noop,
    hideKeyboardActions: noop,
    selectionLabel: () => '',
    setItemSelected: noop,
    actionLabel: () => '',
    openPreview: noop,
    deleteItem: noop,
    clearFilters: noop,
    batchDelete: noop,
  }))
  return { ...mounted, events }
}

test('入口条无 returnTo 时返回项目首页，有 returnTo 时改回制作台', async () => {
  const home = mountGrid()
  try {
    await nextTick()
    assert.match(textContent(home.root), /角色 \/ 场景 \/ 道具入库/)
    const backHome = buttonByAriaLabel(home.root, '返回项目首页')
    assert.ok(backHome)
    assert.match(textContent(backHome), /返回项目首页/)
    assert.equal(buttonByAriaLabel(home.root, '返回制作台'), undefined)
    click(backHome)
    assert.deepEqual(home.events, [['go-back']])
  } finally {
    home.app.unmount()
  }

  const studio = mountGrid({ returnTo: '/film/12?episode=4' })
  try {
    await nextTick()
    const backStudio = buttonByAriaLabel(studio.root, '返回制作台')
    assert.ok(backStudio)
    assert.match(textContent(backStudio), /返回制作台/)
    assert.equal(buttonByAriaLabel(studio.root, '返回项目首页'), undefined)
    click(backStudio)
    assert.deepEqual(studio.events, [['go-back']])
  } finally {
    studio.app.unmount()
  }
})


test('加载失败展示中文下一步，不漏英文', async () => {
  const harness = mountGrid({
    loadError: '素材服务暂时不可用（HTTP 503）',
    mediaIsStale: false,
    hasSuccessfulMediaLoad: false,
    mediaItems: [],
    mediaAccessState: { showEntryStrip: true, navigationLocked: false, writeLocked: true },
  })
  try {
    await nextTick()
    const copy = textContent(harness.root)
    assert.match(copy, /素材数据加载失败/)
    assert.match(copy, /下一步/)
    assert.match(copy, /重试加载/)
    assert.doesNotMatch(copy, /Network Error|Failed to fetch|No data|Loading\.\.\.|AbortError/i)
    const retry = buttonByAriaLabel(harness.root, '重试加载素材')
    assert.ok(retry)
  } finally {
    harness.app.unmount()
  }
})

test('上传失败给出中文下一步并可重新上传', async () => {
  const harness = mountGrid({
    uploadFeedback: {
      tone: 'error',
      title: '素材上传失败',
      detail: '1 个文件上传失败：night.png。这些文件没有写入素材库。',
    },
  })
  try {
    await nextTick()
    const copy = textContent(harness.root)
    assert.match(copy, /素材上传失败/)
    assert.match(copy, /下一步/)
    assert.match(copy, /100MB/)
    assert.doesNotMatch(copy, /Network Error|Failed to fetch|Upload failed/i)
    const retry = buttonByAriaLabel(harness.root, '重新上传素材到素材中心')
    assert.ok(retry)
    click(retry)
    assert.deepEqual(harness.events, [['upload']])
  } finally {
    harness.app.unmount()
  }
})
