import test from 'node:test'
import assert from 'node:assert/strict'

import { h, nextTick, reactive } from 'vue'

import {
  buttonByAriaLabel,
  click,
  compileIconStub,
  createHostRenderer,
  findAll,
  loadCompiledSfc,
  mountHarness,
  textContent,
  vueUrl,
} from './helpers/vueComponentHarness.js'
import {
  actionLabel,
  itemUrl,
  mediaOriginLabel,
  mediaSelectionLabel,
  thumbnailAlt,
} from '../src/components/mediaLibrary/mediaLibraryFormatters.js'

const cardUrl = new URL('../src/components/mediaLibrary/MediaLibraryCard.vue', import.meta.url)
const iconStubUrl = compileIconStub(['CircleCheck', 'Delete', 'ZoomIn'])
const MediaLibraryCard = await loadCompiledSfc(
  cardUrl,
  'media-library-card-component',
  new Map([
    ['vue', vueUrl],
    ['@element-plus/icons-vue', iconStubUrl],
  ]),
)

const renderer = createHostRenderer()
const RAIN_ID = 11
const MOON_ID = 22
assert.notEqual(RAIN_ID, MOON_ID)
const WRITE_LOCK_REASON = '素材数据加载失败，成功重试前不能上传、选择或删除'

function mountCard(initial = {}) {
  const events = []
  const selectedIds = reactive(new Set(initial.selectedIds || []))
  const item = initial.item || {
    id: RAIN_ID,
    name: '雨巷',
    type: 'image',
    local_path: 'media/rain.png',
  }
  const hovered = initial.hovered === true
  const mounted = mountHarness(renderer, () => h(MediaLibraryCard, {
    item,
    selectedIds,
    mediaWriteLocked: Boolean(initial.mediaWriteLocked),
    mediaWriteLockReason: initial.mediaWriteLockReason ?? '',
    ...(initial.writeLockDescribedBy ? { writeLockDescribedBy: initial.writeLockDescribedBy } : {}),
    itemUrl,
    thumbnailAlt,
    formatSize: () => '1.2 MB',
    mediaItemFileSize: () => 1200,
    mediaOriginLabel,
    isActionLayerVisible: (id) => hovered || selectedIds.has(id),
    showPointerActions: (id) => events.push(['hover', id]),
    hidePointerActions: (id) => events.push(['leave', id]),
    showKeyboardActions: (id) => events.push(['focus', id]),
    hideKeyboardActions: (id) => events.push(['blur', id]),
    selectionLabel: (current) => mediaSelectionLabel(current, selectedIds.has(current.id)),
    setItemSelected: (current, selected) => events.push(['select', current.id, selected]),
    actionLabel,
    openPreview: (current) => events.push(['preview', current.id]),
    deleteItem: (current) => events.push(['delete', current.id]),
  }))
  return { ...mounted, events, selectedIds, item }
}

test('本地素材卡片展示中文名称、来源和选择控件', async () => {
  const harness = mountCard()
  try {
    await nextTick()
    assert.match(textContent(harness.root), /雨巷/)
    assert.match(textContent(harness.root), /全局上传，可跨项目复用/)
    const checkbox = findAll(harness.root, (node) => node.type === 'input' && node.props?.type === 'checkbox')[0]
    assert.ok(checkbox)
    assert.equal(checkbox.props['aria-label'], '选择素材：雨巷')
    assert.equal(checkbox.props['aria-describedby'], undefined)
    assert.notEqual(checkbox.props.disabled, true)
    checkbox.props.onChange({ target: { checked: true } })
    assert.deepEqual(harness.events.filter((event) => event[0] === 'select'), [['select', RAIN_ID, true]])
  } finally {
    harness.app.unmount()
  }
})

test('写锁禁用选择和删除，预览仍可点且文案带素材名', async () => {
  const harness = mountCard({
    mediaWriteLocked: true,
    mediaWriteLockReason: WRITE_LOCK_REASON,
    hovered: true,
  })
  try {
    await nextTick()
    const checkbox = findAll(harness.root, (node) => node.type === 'input' && node.props?.type === 'checkbox')[0]
    const preview = buttonByAriaLabel(harness.root, '预览素材：雨巷')
    const removed = buttonByAriaLabel(harness.root, '删除素材：雨巷')
    assert.ok(checkbox)
    assert.ok(preview)
    assert.ok(removed)
    assert.equal(checkbox.props.disabled, true)
    assert.equal(checkbox.props.title, WRITE_LOCK_REASON)
    assert.equal(checkbox.props['aria-describedby'], 'media-write-lock-reason')
    assert.equal(removed.props.disabled, true)
    assert.equal(removed.props.title, WRITE_LOCK_REASON)
    assert.equal(removed.props['aria-describedby'], 'media-write-lock-reason')
    assert.notEqual(preview.props.disabled, true)
    click(preview)
    assert.deepEqual(harness.events.filter((event) => event[0] === 'preview'), [['preview', RAIN_ID]])
    assert.equal(buttonByAriaLabel(harness.root, '预览素材：月光'), undefined)
  } finally {
    harness.app.unmount()
  }
})

test('视频卡片用静音预览，空名称显示未命名，悬停把当前卡片 id 交给页面', async () => {
  const harness = mountCard({
    item: {
      id: MOON_ID,
      name: '',
      type: 'video',
      local_path: 'media/moon.mp4',
    },
  })
  try {
    await nextTick()
    assert.match(textContent(harness.root), /未命名/)
    const video = findAll(harness.root, (node) => node.type === 'video')[0]
    assert.ok(video)
    assert.equal(video.props.src, '/static/media/moon.mp4')
    assert.ok(video.props.muted === true || video.props.muted === '' || video.props.muted === '')
    assert.equal(video.props['aria-label'], '素材缩略图：未命名素材')
    assert.equal(findAll(harness.root, (node) => node.type === 'img').length, 0)
    const card = findAll(harness.root, (node) => node.props?.class && String(node.props.class).includes('media-card'))[0]
    assert.ok(card)
    card.props.onMouseenter()
    card.props.onMouseleave()
    assert.deepEqual(harness.events, [['hover', MOON_ID], ['leave', MOON_ID]])
    assert.doesNotMatch(JSON.stringify(harness.events), new RegExp(String(RAIN_ID)))
  } finally {
    harness.app.unmount()
  }
})

test('写锁 aria-describedby 使用传入的原因 id，不会和默认 id 混用', async () => {
  const customReasonId = 'media-card-lock-reason-rain'
  assert.notEqual(customReasonId, 'media-write-lock-reason')
  const harness = mountCard({
    mediaWriteLocked: true,
    mediaWriteLockReason: WRITE_LOCK_REASON,
    writeLockDescribedBy: customReasonId,
    hovered: true,
  })
  try {
    await nextTick()
    const checkbox = findAll(harness.root, (node) => node.type === 'input' && node.props?.type === 'checkbox')[0]
    const removed = buttonByAriaLabel(harness.root, '删除素材：雨巷')
    assert.ok(checkbox)
    assert.ok(removed)
    assert.equal(checkbox.props['aria-describedby'], customReasonId)
    assert.equal(removed.props['aria-describedby'], customReasonId)
    assert.notEqual(checkbox.props['aria-describedby'], 'media-write-lock-reason')
  } finally {
    harness.app.unmount()
  }
})
