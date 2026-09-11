import test from 'node:test'
import assert from 'node:assert/strict'

import { defineComponent, h, nextTick, ref, watch } from 'vue'

import {
  buttonByText,
  compileSfc,
  createDeferred,
  createHostRenderer,
  dataModule,
  findByClass,
  findByType,
  flushUi,
  loadCompiledSfc,
  mountHarness,
  textContent,
  vueUrl,
} from './helpers/vueComponentHarness.js'

const pickerUrl = new URL('../src/components/GlobalMediaPickerDialog.vue', import.meta.url)
const DRAMA_ID = 11
const OTHER_DRAMA_ID = 22
assert.notEqual(DRAMA_ID, OTHER_DRAMA_ID)

const assetsApiStubUrl = dataModule(`
  export const assetsAPI = {
    list(params, options) {
      return globalThis.__globalMediaPickerEmptyLockState.list(params, options)
    },
  }
`)

const cardModuleUrl = compileSfc(new URL('../src/components/globalMediaPicker/GlobalMediaPickerCard.vue', import.meta.url), 'gmp-card')
const emptyModuleUrl = compileSfc(new URL('../src/components/globalMediaPicker/GlobalMediaPickerEmpty.vue', import.meta.url), 'gmp-empty')
const footerModuleUrl = compileSfc(new URL('../src/components/globalMediaPicker/GlobalMediaPickerFooter.vue', import.meta.url), 'gmp-footer')
const presentationModuleUrl = new URL('../src/components/globalMediaPicker/globalMediaPickerPresentation.js', import.meta.url).href

const GlobalMediaPickerDialog = await loadCompiledSfc(
  pickerUrl,
  'global-media-picker-empty-lock',
  new Map([
    ['vue', vueUrl],
    ['@/api/assets', assetsApiStubUrl],
    ['./globalMediaPicker/GlobalMediaPickerCard.vue', cardModuleUrl],
    ['./globalMediaPicker/GlobalMediaPickerEmpty.vue', emptyModuleUrl],
    ['./globalMediaPicker/GlobalMediaPickerFooter.vue', footerModuleUrl],
    ['./globalMediaPicker/globalMediaPickerPresentation.js', presentationModuleUrl],
  ]),
)

const renderer = createHostRenderer()

const AccessibleDialogStub = defineComponent({
  name: 'AccessibleDialog',
  props: ['modelValue', 'title', 'width', 'destroyOnClose'],
  emits: ['update:modelValue', 'closed'],
  setup(props, { emit, slots }) {
    watch(() => props.modelValue, (visible, previousVisible) => {
      if (previousVisible && !visible) emit('closed')
    })
    return () => {
      if (!props.modelValue) return null
      return h('dialog', { 'data-title': props.title || '' }, [
        h('dialog-body', {}, slots.default?.()),
        h('dialog-footer', {}, slots.footer?.()),
      ])
    }
  },
})

function footerStatus(root) {
  const node = findByClass(root, 'picker-footer__status')[0]
  return node ? textContent(node).trim() : ''
}

function confirmButton(root) {
  return buttonByText(root, '选择素材')
}

function pickerEmpty(root) {
  return findByClass(root, 'picker-empty')[0] || null
}

function pickerError(root) {
  return findByClass(root, 'picker-error')[0] || null
}

function cardButtons(root) {
  return findByType(root, 'button').filter((node) => findByClass(node, 'picker-card').length || node.props?.class === 'picker-card' || String(node.props?.class || '').includes('picker-card'))
}

function hasPickerCardClass(node) {
  const value = node.props?.class
  if (typeof value === 'string') return value.split(/\s+/).includes('picker-card')
  if (Array.isArray(value)) return value.some((entry) => String(entry).includes('picker-card'))
  if (value && typeof value === 'object') return Boolean(value['picker-card'])
  return false
}

function mediaCards(root) {
  return findByType(root, 'button').filter(hasPickerCardClass)
}

function createListController() {
  const calls = []
  const requests = []
  globalThis.__globalMediaPickerEmptyLockState = {
    list(params, options) {
      calls.push({ params: JSON.parse(JSON.stringify(params)), signal: options?.signal })
      const deferred = createDeferred()
      requests.push({ ...deferred, params, options })
      return deferred.promise
    },
  }
  return { calls, requests }
}

function mountPicker(initialProps = {}) {
  const visible = ref(false)
  const selections = []
  const libraryOpens = []
  const mounted = mountHarness(renderer, () => h(GlobalMediaPickerDialog, {
    modelValue: visible.value,
    title: '选择素材',
    accept: initialProps.accept || 'image',
    context: initialProps.context || {
      projectTitle: '演示项目',
      episodeLabel: '第1集',
      dramaId: DRAMA_ID,
      reusePolicy: 'current-or-global',
    },
    'onUpdate:modelValue': (value) => { visible.value = value },
    onSelect: (item) => selections.push(item),
    onOpenLibrary: () => libraryOpens.push('open-library'),
  }), {
    components: { AccessibleDialog: AccessibleDialogStub },
  })
  return { ...mounted, visible, selections, libraryOpens }
}

async function openPicker(harness) {
  harness.visible.value = true
  await flushUi(nextTick)
}

test('空素材库展示中文空态，确认按钮保持写锁', async () => {
  const controller = createListController()
  const harness = mountPicker()
  try {
    await openPicker(harness)
    controller.requests[0].resolve({ items: [], pagination: { total: 0 } })
    await flushUi(nextTick)

    const empty = pickerEmpty(harness.root)
    assert.ok(empty)
    assert.match(textContent(empty), /素材中心还是空的/)
    assert.ok(buttonByText(empty, '前往素材中心上传'))
    assert.equal(buttonByText(empty, '清除筛选'), undefined)
    assert.equal(confirmButton(harness.root).props.disabled, true)
    assert.equal(footerStatus(harness.root), '未选择素材')
    confirmButton(harness.root).props.onClick()
    assert.deepEqual(harness.selections, [])

    buttonByText(empty, '前往素材中心上传').props.onClick()
    await nextTick()
    assert.deepEqual(harness.libraryOpens, ['open-library'])
    assert.equal(harness.visible.value, false)
  } finally {
    harness.app.unmount()
    delete globalThis.__globalMediaPickerEmptyLockState
  }
})

test('筛选后没有素材时给出清除筛选，而不是空库上传', async () => {
  const controller = createListController()
  const harness = mountPicker({ accept: 'all' })
  try {
    await openPicker(harness)
    controller.requests[0].resolve({ items: [], pagination: { total: 0 } })
    await flushUi(nextTick)

    const radios = findByType(harness.root, 'radio-group')[0]
    radios.props.onSelect('image')
    await flushUi(nextTick)
    assert.equal(controller.calls[1].params.type, 'image')
    controller.requests[1].resolve({ items: [], pagination: { total: 0 } })
    await flushUi(nextTick)

    const empty = pickerEmpty(harness.root)
    assert.ok(empty)
    assert.match(textContent(empty), /当前筛选下没有素材/)
    assert.ok(buttonByText(empty, '清除筛选'))
    assert.equal(confirmButton(harness.root).props.disabled, true)
  } finally {
    harness.app.unmount()
    delete globalThis.__globalMediaPickerEmptyLockState
  }
})

test('加载中和加载失败都会锁住确认，失败文案保持中文', async () => {
  const controller = createListController()
  const harness = mountPicker()
  try {
    await openPicker(harness)
    assert.equal(confirmButton(harness.root).props.disabled, true)
    assert.equal(footerStatus(harness.root), '正在加载素材')
    assert.equal(pickerEmpty(harness.root), null)
    confirmButton(harness.root).props.onClick()
    assert.deepEqual(harness.selections, [])

    controller.requests[0].reject(new Error('Network Error'))
    await flushUi(nextTick)
    const error = pickerError(harness.root)
    assert.ok(error)
    assert.match(textContent(error), /暂时无法加载素材，请检查服务状态后重试/)
    assert.equal(footerStatus(harness.root), '素材加载失败，请重试')
    assert.equal(pickerEmpty(harness.root), null)
    assert.equal(confirmButton(harness.root).props.disabled, true)
    confirmButton(harness.root).props.onClick()
    assert.deepEqual(harness.selections, [])
    assert.doesNotMatch(textContent(harness.root), /Network Error/)
  } finally {
    harness.app.unmount()
    delete globalThis.__globalMediaPickerEmptyLockState
  }
})

test('类型或项目范围不兼容时确认保持写锁，兼容素材才能选中', async () => {
  const controller = createListController()
  const harness = mountPicker({
    accept: 'image',
    context: {
      projectTitle: '演示项目',
      dramaId: DRAMA_ID,
      reusePolicy: 'current-or-global',
      usageLabel: '分镜参考图',
    },
  })
  try {
    await openPicker(harness)
    controller.requests[0].resolve({
      items: [
        { id: 1, type: 'video', name: '镜头视频', drama_id: DRAMA_ID },
        { id: 2, type: 'image', name: '其他项目图', drama_id: OTHER_DRAMA_ID },
        { id: 3, type: 'image', name: '当前项目图', drama_id: DRAMA_ID },
      ],
      pagination: { total: 3 },
    })
    await flushUi(nextTick)

    const cards = mediaCards(harness.root)
    assert.equal(cards.length, 3)
    cards[0].props.onClick()
    await nextTick()
    assert.equal(confirmButton(harness.root).props.disabled, true)
    assert.equal(footerStatus(harness.root), '当前用途只接受图片素材')
    confirmButton(harness.root).props.onClick()
    assert.deepEqual(harness.selections, [])

    cards[1].props.onClick()
    await nextTick()
    assert.equal(confirmButton(harness.root).props.disabled, true)
    assert.match(footerStatus(harness.root), /其他项目素材不能直接用于当前项目/)
    confirmButton(harness.root).props.onClick()
    assert.deepEqual(harness.selections, [])

    cards[2].props.onClick()
    await nextTick()
    assert.notEqual(confirmButton(harness.root).props.disabled, true)
    assert.match(footerStatus(harness.root), /当前项目图 已就绪/)
    confirmButton(harness.root).props.onClick()
    assert.equal(harness.selections.length, 1)
    assert.equal(harness.selections[0].id, 3)
    assert.equal(harness.selections[0].drama_id, DRAMA_ID)
    assert.notEqual(harness.selections[0].drama_id, OTHER_DRAMA_ID)
  } finally {
    harness.app.unmount()
    delete globalThis.__globalMediaPickerEmptyLockState
  }
})

test('空数据时取消会关闭弹窗，确认保持写锁', async () => {
  const controller = createListController()
  const harness = mountPicker()
  try {
    await openPicker(harness)
    controller.requests[0].resolve({ items: [], pagination: { total: 0 } })
    await flushUi(nextTick)
    assert.equal(confirmButton(harness.root).props.disabled, true)
    buttonByText(harness.root, '取消').props.onClick()
    await nextTick()
    assert.equal(harness.visible.value, false)
    assert.deepEqual(harness.selections, [])
  } finally {
    harness.app.unmount()
    delete globalThis.__globalMediaPickerEmptyLockState
  }
})
