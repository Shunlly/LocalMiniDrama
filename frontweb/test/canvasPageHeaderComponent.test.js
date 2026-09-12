import test from 'node:test'
import assert from 'node:assert/strict'

import { h, nextTick } from 'vue'

import {
  buttonByAriaLabel,
  buttonByText,
  click,
  createHostRenderer,
  findAll,
  findByClass,
  loadCompiledSfc,
  mountHarness,
  textContent,
  vueUrl,
} from './helpers/vueComponentHarness.js'

const headerUrl = new URL('../src/components/dramaCanvas/CanvasPageHeader.vue', import.meta.url)
const canvasExperienceCopyUrl = new URL('../src/components/dramaCanvas/canvasExperienceCopy.js', import.meta.url)
const CanvasPageHeader = await loadCompiledSfc(
  headerUrl,
  'canvas-page-header-component',
  new Map([
    ['vue', vueUrl],
    ['./canvasExperienceCopy.js', canvasExperienceCopyUrl.href],
  ]),
)

const renderer = createHostRenderer()

function selectByAriaLabel(root, label) {
  return findAll(root, (node) => node.type === 'select' && node.props?.['aria-label'] === label)[0]
}

function mountHeader(initialProps = {}, slots = {}) {
  const events = []
  const props = {
    pageTitle: '演示短剧',
    episodes: [],
    filterEpisodeId: null,
    layoutSaveState: '',
    layoutSaveError: '',
    episodeGenerating: false,
    freeCanvasReadOnly: false,
    freeCanvasCompatibilityMessage: '',
    scopedMediaWarning: '',
    mediaLoading: false,
    goProjectList: () => events.push(['go-project-list']),
    requestEpisodeFilterChange: (value) => events.push(['filter-episode', value]),
    retryCanvasSave: () => events.push(['retry-save']),
    cancelEpisodeGenerate: () => events.push(['cancel-generate']),
    goListMode: () => events.push(['go-list-mode']),
    retryUnknownStoryboardMedia: () => events.push(['retry-media']),
    ...initialProps,
  }
  const mounted = mountHarness(renderer, () => h(CanvasPageHeader, props, slots))
  return { ...mounted, events, props }
}

test('页头展示品牌、集数筛选，工具栏槽位仍能挂上 AI 分镜', () => {
  const harness = mountHeader({
    episodes: [
      { id: 11, title: '开场', episode_number: 1 },
      { id: 22, title: '', episode_number: 2 },
    ],
    filterEpisodeId: 11,
  }, {
    toolbar: () => h('div', { 'data-testid': 'canvas-toolbar-slot' }, [
      h('button', { type: 'button', 'aria-label': 'AI 分镜' }, 'AI 分镜'),
    ]),
  })
  try {
    const pageText = textContent(harness.root)
    assert.match(pageText, /本地短剧助手/)
    assert.match(pageText, /画布模式/)
    assert.match(pageText, /演示短剧/)
    const logo = buttonByAriaLabel(harness.root, '返回项目列表')
    assert.ok(logo)
    assert.match(logo.props.class, /logo/)
    click(logo)
    assert.deepEqual(harness.events, [['go-project-list']])

    const episodeSelect = selectByAriaLabel(harness.root, '筛选画布集数')
    assert.ok(episodeSelect)
    assert.equal(episodeSelect.props.placeholder, '全部集数')
    assert.match(textContent(episodeSelect), /开场/)
    assert.match(textContent(episodeSelect), /第2集/)

    const storyboard = buttonByAriaLabel(harness.root, 'AI 分镜')
    assert.ok(storyboard, '页头 toolbar 槽位必须还能挂上 AI 分镜')
    assert.equal(textContent(storyboard).trim(), 'AI 分镜')
  } finally {
    harness.app.unmount()
  }
})

test('保存失败展示中文错误和重试，批量生成可取消', async () => {
  const saving = mountHeader({ layoutSaveState: 'saving' })
  try {
    assert.match(textContent(saving.root), /保存中…/)
    assert.equal(buttonByAriaLabel(saving.root, '重试保存画布'), undefined)
  } finally {
    saving.app.unmount()
  }

  const saved = mountHeader({ layoutSaveState: 'saved' })
  try {
    assert.match(textContent(saved.root), /已保存/)
  } finally {
    saved.app.unmount()
  }

  const failed = mountHeader({
    layoutSaveState: 'error',
    layoutSaveError: '画布布局保存失败，请稍后重试',
    episodeGenerating: true,
  })
  try {
    await nextTick()
    assert.match(textContent(failed.root), /保存失败/)
    assert.match(textContent(failed.root), /画布布局保存失败，请稍后重试/)
    const retry = buttonByAriaLabel(failed.root, '重试保存画布')
    assert.ok(retry)
    assert.equal(textContent(retry).trim(), '重试保存')
    click(retry)
    const cancel = buttonByAriaLabel(failed.root, '取消批量生成')
    assert.ok(cancel)
    assert.equal(textContent(cancel).trim(), '取消')
    click(cancel)
    assert.deepEqual(failed.events, [['retry-save'], ['cancel-generate']])
  } finally {
    failed.app.unmount()
  }
})

test('只读兼容和媒体告警展示中文原因与动作', () => {
  const harness = mountHeader({
    freeCanvasReadOnly: true,
    freeCanvasCompatibilityMessage: '当前自由画布版本不兼容，只能查看',
    scopedMediaWarning: '部分分镜媒体查询失败',
    mediaLoading: false,
  })
  try {
    const warnings = findByClass(harness.root, 'canvas-warning-bar')
    assert.ok(warnings.length >= 2)
    assert.match(textContent(harness.root), /当前自由画布版本不兼容，只能查看/)
    assert.match(textContent(harness.root), /部分分镜媒体查询失败/)
    const listMode = buttonByText(harness.root, '列表模式')
    assert.ok(listMode)
    assert.equal(listMode.props['aria-label'], '返回列表模式')
    assert.equal(listMode.props.title, '返回列表模式')
    click(listMode)
    const retryMedia = buttonByText(harness.root, '重试媒体查询')
    assert.ok(retryMedia)
    click(retryMedia)
    assert.deepEqual(harness.events, [['go-list-mode'], ['retry-media']])
  } finally {
    harness.app.unmount()
  }
})
