import test from 'node:test'
import assert from 'node:assert/strict'

import { defineComponent, h, nextTick, ref, watch } from 'vue'

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
import { describeMediaLibrarySourceImportProjectAction } from '../src/utils/mediaLibrarySourceImport.js'

const dialogUrl = new URL('../src/components/mediaLibrary/MediaLibrarySourceImportDialog.vue', import.meta.url)
const MediaLibrarySourceImportDialog = await loadCompiledSfc(
  dialogUrl,
  'media-library-source-import-dialog',
  new Map([
    ['vue', vueUrl],
  ]),
)

const renderer = createHostRenderer()
const RAIN_ID = 34
const MOON_ID = 56
assert.notEqual(RAIN_ID, MOON_ID)

const AccessibleDialogStub = defineComponent({
  name: 'AccessibleDialog',
  props: ['modelValue', 'title', 'width', 'destroyOnClose'],
  emits: ['update:modelValue', 'open', 'close', 'closed'],
  setup(props, { emit, slots }) {
    watch(() => props.modelValue, (visible, previous) => {
      if (visible && previous !== true) emit('open')
      if (!visible && previous === true) {
        emit('close')
        emit('closed')
      }
    }, { immediate: true })
    return () => {
      if (!props.modelValue) return null
      return h('dialog', { 'data-title': props.title || '', role: 'dialog', 'aria-label': props.title || '' }, [
        h('dialog-body', {}, slots.default?.()),
        h('dialog-footer', {}, slots.footer?.()),
      ])
    }
  },
})

function mountPicker(initial = {}) {
  const events = []
  const showPicker = ref(initial.showPicker !== false)
  const keyword = ref(initial.keyword ?? '')
  const page = ref(initial.page ?? 1)
  const mounted = mountHarness(renderer, () => h(MediaLibrarySourceImportDialog, {
    showPicker: showPicker.value,
    'onUpdate:showPicker': (value) => { showPicker.value = value },
    keyword: keyword.value,
    'onUpdate:keyword': (value) => { keyword.value = value },
    page: page.value,
    'onUpdate:page': (value) => { page.value = value },
    loading: Boolean(initial.loading),
    loadError: initial.loadError ?? '',
    projects: initial.projects ?? [],
    total: initial.total ?? (initial.projects?.length ?? 0),
    pageSize: initial.pageSize ?? 24,
    hasSuccessfulLoad: initial.hasSuccessfulLoad !== false,
    navigationLocked: Boolean(initial.navigationLocked),
    loadProjects: () => events.push(['load']),
    scheduleSearch: () => events.push(['search']),
    loadProjectPage: (value) => events.push(['page', value]),
    selectProject: (item) => events.push(['select', item.id]),
    createProjectFromPicker: () => events.push(['create']),
    resetPicker: () => events.push(['reset']),
  }), {
    components: {
      AccessibleDialog: AccessibleDialogStub,
    },
  })
  return { ...mounted, events, showPicker, keyword, page }
}

test('空项目列表给出中文空态和新建入口，取消会关掉弹窗', async () => {
  const harness = mountPicker()
  try {
    await nextTick()
    assert.equal(harness.events[0]?.[0], 'load')
    assert.match(textContent(harness.root), /选择目标项目/)
    assert.match(textContent(harness.root), /还没有可导入的项目/)
    assert.match(textContent(harness.root), /请先新建项目/)
    const [empty] = findByClass(harness.root, 'source-import-state')
    assert.ok(empty)
    assert.equal(empty.props.role, 'status')
    assert.equal(empty.props['aria-live'], 'polite')
    click(buttonByAriaLabel(harness.root, '新建项目后导入网页 URL'))
    click(buttonByAriaLabel(harness.root, '取消选择项目'))
    assert.equal(harness.showPicker.value, false)
    assert.ok(harness.events.some((event) => event[0] === 'create'))
  } finally {
    harness.app.unmount()
  }
})

test('加载失败展示中文错误并可重试，不会漏出英文技术信息', async () => {
  const harness = mountPicker({
    loadError: '项目服务暂时不可用（HTTP 503）',
    hasSuccessfulLoad: false,
    projects: [],
  })
  try {
    await nextTick()
    assert.match(textContent(harness.root), /项目列表加载失败/)
    assert.match(textContent(harness.root), /项目服务暂时不可用/)
    click(buttonByAriaLabel(harness.root, '重试加载项目列表'))
    assert.ok(harness.events.some((event) => event[0] === 'load'))
    assert.doesNotMatch(textContent(harness.root), /Network Error|Failed to fetch/i)
  } finally {
    harness.app.unmount()
  }
})

test('可选项目按钮使用导入到该项目的无障碍名称，不会点到另一个项目', async () => {
  const harness = mountPicker({
    projects: [
      { id: RAIN_ID, title: '雨巷', episodeCount: 2 },
      { id: MOON_ID, title: '月夜', episodeCount: 0 },
    ],
    total: 2,
  })
  try {
    await nextTick()
    const rain = buttonByAriaLabel(harness.root, describeMediaLibrarySourceImportProjectAction({ title: '雨巷' }))
    const moon = buttonByAriaLabel(harness.root, describeMediaLibrarySourceImportProjectAction({ title: '月夜' }))
    assert.ok(rain, '缺少导入到项目「雨巷」')
    assert.ok(moon)
    assert.match(textContent(rain), /雨巷/)
    assert.match(textContent(rain), /2 集/)
    click(rain)
    assert.deepEqual(harness.events.filter((event) => event[0] === 'select'), [['select', RAIN_ID]])
    assert.doesNotMatch(JSON.stringify(harness.events), new RegExp(String(MOON_ID)))
    const search = findAll(harness.root, (node) => node.type === 'input' && node.props?.['aria-label'] === '搜索项目')[0]
    assert.ok(search, '缺少搜索项目')
    assert.equal(search.props.placeholder, '搜索项目标题')
    assert.ok(buttonByText(harness.root, '取消'))
  } finally {
    harness.app.unmount()
  }
})


test('搜索无结果与空项目列表分开，清除搜索是中文', async () => {
  const harness = mountPicker({
    keyword: '雨巷',
    projects: [],
    total: 0,
    hasSuccessfulLoad: true,
  })
  try {
    await nextTick()
    const copy = textContent(harness.root)
    assert.match(copy, /没有匹配的项目/)
    assert.match(copy, /请更换关键词后再试/)
    assert.doesNotMatch(copy, /还没有可导入的项目/)
    assert.doesNotMatch(copy, /No data|No projects|Network Error/i)
    click(buttonByAriaLabel(harness.root, '清除项目搜索'))
    assert.equal(harness.keyword.value, '')
    assert.ok(harness.events.some((event) => event[0] === 'search'))
  } finally {
    harness.app.unmount()
  }
})
