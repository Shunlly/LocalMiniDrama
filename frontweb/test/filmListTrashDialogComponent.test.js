import test from 'node:test'
import assert from 'node:assert/strict'

import { defineComponent, h, nextTick, ref, watch } from 'vue'

import {
  buttonByAriaLabel,
  buttonByText,
  click,
  compileIconStub,
  createHostRenderer,
  findAll,
  findByClass,
  loadCompiledSfc,
  mountHarness,
  textContent,
  vueUrl,
} from './helpers/vueComponentHarness.js'
import {
  describeTrashLiveStatus,
  describeTrashRestoreBusyReason,
  formatDate,
} from '../src/components/filmList/filmListFormatters.js'

const dialogUrl = new URL('../src/components/filmList/FilmListTrashDialog.vue', import.meta.url)
const iconStubUrl = compileIconStub(['Delete', 'FolderOpened', 'RefreshLeft'])
const FilmListTrashDialog = await loadCompiledSfc(
  dialogUrl,
  'film-list-trash-dialog-component',
  new Map([
    ['vue', vueUrl],
    ['@element-plus/icons-vue', iconStubUrl],
  ]),
)

const renderer = createHostRenderer()
const RAIN_ID = 11
const MOON_ID = 22
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
      return h('dialog', { 'data-title': props.title || '' }, [
        h('dialog-body', {}, slots.default?.()),
        h('dialog-footer', {}, slots.footer?.()),
      ])
    }
  },
})

function mountTrash(initial = {}) {
  const events = []
  const showTrashDialog = ref(initial.showTrashDialog !== false)
  const trashPage = ref(initial.trashPage ?? 1)
  const mounted = mountHarness(renderer, () => h(FilmListTrashDialog, {
    showTrashDialog: showTrashDialog.value,
    'onUpdate:showTrashDialog': (value) => {
      showTrashDialog.value = value
    },
    trashPage: trashPage.value,
    'onUpdate:trashPage': (value) => {
      trashPage.value = value
    },
    trashLoading: Boolean(initial.trashLoading),
    trashError: initial.trashError ?? '',
    trashItems: initial.trashItems ?? [],
    trashTotal: initial.trashTotal ?? (initial.trashItems?.length ?? 0),
    trashPageSize: initial.trashPageSize ?? 10,
    trashAnnouncement: initial.trashAnnouncement ?? '',
    restoringId: initial.restoringId ?? null,
    formatDate,
    describeTrashLiveStatus,
    describeTrashRestoreBusyReason,
    loadTrash: () => events.push(['load']),
    restoreFromTrash: (item) => events.push(['restore', item.id]),
  }), {
    components: {
      AccessibleDialog: AccessibleDialogStub,
    },
  })
  return { ...mounted, events, showTrashDialog, trashPage }
}

test('回收站空态、失败重试和恢复入口都是中文', async () => {
  const empty = mountTrash()
  try {
    await nextTick()
    assert.equal(empty.events[0]?.[0], 'load')
    assert.match(textContent(empty.root), /移除后仍可恢复/)
    assert.match(textContent(empty.root), /回收站中没有项目/)
    assert.match(textContent(empty.root), /关闭后可回到项目列表新建或导入项目/)
    assert.match(textContent(empty.root), /回收站中共有 0 个项目/)
    const emptyClose = buttonByAriaLabel(empty.root, '关闭回收站') || buttonByText(empty.root, '关闭回收站')
    assert.ok(emptyClose)
    assert.match(textContent(emptyClose), /关闭回收站/)
    assert.ok(String(emptyClose.props['aria-label'] || '').includes('关闭回收站'))
    const emptySection = findByClass(empty.root, 'trash-empty')[0]
    const emptyPrimaries = findAll(emptySection, (node) => node.type === 'button' && node.props?.['data-variant'] === 'primary')
    assert.equal(emptyPrimaries.length, 0)
    click(buttonByText(empty.root, '关闭'))
    assert.equal(empty.showTrashDialog.value, false)
  } finally {
    empty.app.unmount()
  }

  const failed = mountTrash({ trashError: '回收站加载失败，请重试' })
  try {
    await nextTick()
    assert.match(textContent(failed.root), /回收站加载失败，请重试/)
    click(buttonByText(failed.root, '重试'))
    assert.deepEqual(failed.events.filter((event) => event[0] === 'load').slice(-1), [['load']])
  } finally {
    failed.app.unmount()
  }
})

test('恢复按钮按项目编号区分，忙时只禁用其他项目', async () => {
  const harness = mountTrash({
    trashItems: [
      { id: RAIN_ID, title: '雨巷', removed_at: '2026-09-01T00:00:00.000Z' },
      { id: MOON_ID, title: '月光', removed_at: '2026-09-02T00:00:00.000Z' },
    ],
    trashTotal: 2,
    restoringId: RAIN_ID,
  })
  try {
    await nextTick()
    assert.match(textContent(harness.root), /雨巷/)
    assert.match(textContent(harness.root), /月光/)
    assert.match(textContent(harness.root), /内容与关联素材已保留/)
    const rain = buttonByAriaLabel(harness.root, '恢复项目「雨巷」')
    const moon = buttonByAriaLabel(harness.root, '恢复项目「月光」')
    assert.ok(rain)
    assert.ok(moon)
    assert.equal(rain.props['data-loading'], true)
    assert.notEqual(rain.props.disabled, true)
    assert.equal(moon.props.disabled, true)
    assert.equal(moon.props.title, '正在恢复其他项目，请稍候')
    click(rain)
    assert.deepEqual(harness.events.filter((event) => event[0] === 'restore'), [['restore', RAIN_ID]])
  } finally {
    harness.app.unmount()
  }
})

test('回收站分页只在总数超过页大小时出现', async () => {
  const paged = mountTrash({
    trashItems: [{ id: RAIN_ID, title: '雨巷', removed_at: '2026-09-01T00:00:00.000Z' }],
    trashTotal: 12,
    trashPageSize: 10,
  })
  try {
    await nextTick()
    const pagination = findAll(paged.root, (node) => node.type === 'pagination')
    assert.equal(pagination.length, 1)
    assert.equal(pagination[0].props['aria-label'], '回收站分页')
    assert.equal(findByClass(paged.root, 'trash-list')[0].props['aria-label'], '已移除项目')
  } finally {
    paged.app.unmount()
  }
})
