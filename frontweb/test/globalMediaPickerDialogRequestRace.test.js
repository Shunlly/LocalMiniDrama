import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'

import { compileScript, parse } from '@vue/compiler-sfc'
import { createRenderer, defineComponent, h, nextTick, ref, watch } from 'vue'

const componentUrl = new URL('../src/components/GlobalMediaPickerDialog.vue', import.meta.url)
const source = readFileSync(componentUrl, 'utf8')
const { descriptor, errors } = parse(source, { filename: componentUrl.pathname })
assert.deepEqual(errors, [])

function dataModule(code) {
  return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
}

const vueUrl = import.meta.resolve('vue')
const assetsApiStubUrl = dataModule(`
  export const assetsAPI = {
    list(params, options) {
      return globalThis.__globalMediaPickerDialogTestState.list(params, options)
    },
  }
`)
const mediaLibraryStubUrl = dataModule(`
  export function formatMediaSize(size) {
    if (size == null || size === '') return ''
    return String(size)
  }

  export function createLatestMediaRequestGuard() {
    let latestRequestId = 0
    return {
      begin() {
        latestRequestId += 1
        return latestRequestId
      },
      commit(requestId, update) {
        if (requestId !== latestRequestId) return false
        update()
        return true
      },
    }
  }

  export function getMediaOriginLabel(item = {}, options = {}) {
    return item?.source_drama_title || options.globalLabel || '全局上传'
  }

  export function mediaPickerIncompatibleReason() {
    return ''
  }
`)

let compiledSource = compileScript(descriptor, {
  id: 'global-media-picker-dialog-request-race',
  inlineTemplate: true,
}).content

for (const [specifier, resolved] of [
  ['vue', vueUrl],
  ['@/api/assets', assetsApiStubUrl],
  ['@/utils/mediaLibrary', mediaLibraryStubUrl],
]) {
  compiledSource = compiledSource
    .replaceAll(`from '${specifier}'`, `from '${resolved}'`)
    .replaceAll(`from "${specifier}"`, `from "${resolved}"`)
}

const GlobalMediaPickerDialog = (await import(dataModule(compiledSource))).default

function createHostNode(type, text = '') {
  return { type, text, props: {}, children: [], parent: null }
}

function insertHostNode(child, parent, anchor = null) {
  if (child.parent) {
    const currentIndex = child.parent.children.indexOf(child)
    if (currentIndex >= 0) child.parent.children.splice(currentIndex, 1)
  }
  child.parent = parent
  const anchorIndex = anchor ? parent.children.indexOf(anchor) : -1
  if (anchorIndex >= 0) parent.children.splice(anchorIndex, 0, child)
  else parent.children.push(child)
}

const renderer = createRenderer({
  patchProp(element, key, _previous, next) {
    element.props[key] = next
  },
  insert: insertHostNode,
  remove(child) {
    if (!child.parent) return
    const index = child.parent.children.indexOf(child)
    if (index >= 0) child.parent.children.splice(index, 1)
    child.parent = null
  },
  createElement(type) {
    return createHostNode(type)
  },
  createText(text) {
    return createHostNode('#text', text)
  },
  createComment(text) {
    return createHostNode('#comment', text)
  },
  setText(node, text) {
    node.text = text
  },
  setElementText(node, text) {
    const child = createHostNode('#text', text)
    child.parent = node
    node.children = [child]
  },
  parentNode(node) {
    return node.parent
  },
  nextSibling(node) {
    if (!node.parent) return null
    return node.parent.children[node.parent.children.indexOf(node) + 1] || null
  },
  querySelector() {
    return null
  },
  setScopeId(element, id) {
    if (!element.scopeIds) element.scopeIds = []
    element.scopeIds.push(id)
  },
  cloneNode(node) {
    return { ...node, props: { ...node.props }, children: [...node.children] }
  },
  insertStaticContent(content, parent, anchor) {
    const node = createHostNode('#static', content)
    insertHostNode(node, parent, anchor)
    return [node, node]
  },
})

function callListener(listener, value) {
  if (Array.isArray(listener)) {
    for (const entry of listener) entry(value)
    return
  }
  listener?.(value)
}

const ElDialogStub = defineComponent({
  props: ['modelValue', 'title'],
  emits: ['closed'],
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

const ElButtonStub = defineComponent({
  props: ['disabled', 'size', 'type'],
  setup(props, { attrs, slots }) {
    return () => h('button', {
      ...attrs,
      disabled: Boolean(props.disabled),
      'data-variant': props.type || '',
    }, slots.default?.())
  },
})

const ElInputStub = defineComponent({
  props: ['modelValue', 'clearable', 'placeholder'],
  emits: ['update:modelValue'],
  setup(props, { attrs, emit }) {
    return () => h('input', {
      ...attrs,
      value: props.modelValue ?? '',
      onInput: (event) => {
        emit('update:modelValue', event.target.value)
        callListener(attrs.onInput, event.target.value)
      },
    })
  },
})

const ElRadioGroupStub = defineComponent({
  props: ['modelValue', 'size'],
  emits: ['update:modelValue'],
  setup(props, { attrs, emit, slots }) {
    return () => h('radio-group', {
      ...attrs,
      value: props.modelValue,
      onSelect: (value) => {
        emit('update:modelValue', value)
        callListener(attrs.onChange, value)
      },
    }, slots.default?.())
  },
})

const ElRadioButtonStub = defineComponent({
  props: ['value'],
  setup(props, { slots }) {
    return () => h('radio-button', { value: props.value }, slots.default?.())
  },
})

const ElPaginationStub = defineComponent({
  props: ['currentPage', 'pageSize', 'total', 'layout'],
  setup(props, { attrs }) {
    return () => h('pagination', {
      ...attrs,
      currentPage: props.currentPage,
      pageSize: props.pageSize,
      total: props.total,
      onSelectPage: (value) => {
        callListener(attrs['onUpdate:currentPage'], value)
        callListener(attrs.onCurrentChange, value)
      },
    })
  },
})

const ElTooltipStub = defineComponent({
  props: ['content', 'visible'],
  setup(props, { slots }) {
    return () => h('tooltip', { content: props.content, visible: props.visible }, slots.default?.())
  },
})

function registerElementStubs(app) {
  app.component('AccessibleDialog', ElDialogStub)
  app.component('el-dialog', ElDialogStub)
  app.component('el-button', ElButtonStub)
  app.component('el-input', ElInputStub)
  app.component('el-radio-group', ElRadioGroupStub)
  app.component('el-radio-button', ElRadioButtonStub)
  app.component('el-pagination', ElPaginationStub)
  app.component('el-tooltip', ElTooltipStub)
  app.directive('loading', {})
}

function findAll(node, predicate, matches = []) {
  if (predicate(node)) matches.push(node)
  for (const child of node.children || []) findAll(child, predicate, matches)
  return matches
}

function textContent(node) {
  return `${node.text || ''}${(node.children || []).map(textContent).join('')}`
}

function hasClass(node, className) {
  const value = node.props?.class
  if (typeof value === 'string') return value.split(/\s+/).includes(className)
  if (Array.isArray(value)) return value.some((entry) => hasClass({ props: { class: entry } }, className))
  if (value && typeof value === 'object') return Boolean(value[className])
  return false
}

function flushUi() {
  return Promise.resolve()
    .then(() => Promise.resolve())
    .then(() => nextTick())
}

function createDeferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function createRequestController() {
  const calls = []
  const requests = []
  globalThis.__globalMediaPickerDialogTestState = {
    list(params, options) {
      calls.push(JSON.parse(JSON.stringify(params)))
      const deferred = createDeferred()
      requests.push({ ...deferred, params, options })
      return deferred.promise
    },
  }
  return { calls, requests }
}

function mountPicker({ accept = 'image' } = {}) {
  const visible = ref(false)
  const selections = []
  const Harness = defineComponent({
    setup() {
      return () => h(GlobalMediaPickerDialog, {
        modelValue: visible.value,
        title: 'Pick media',
        accept,
        context: {
          projectTitle: 'Demo Project',
          episodeLabel: 'Episode 1',
          storyboardLabel: 'Shot 1',
          usageLabel: 'Reference',
        },
        'onUpdate:modelValue': (value) => { visible.value = value },
        onSelect: (item) => selections.push(item),
      })
    },
  })
  const root = createHostNode('root')
  const app = renderer.createApp(Harness)
  registerElementStubs(app)
  app.mount(root)
  return { app, root, selections, visible }
}

function openPicker(harness) {
  harness.visible.value = true
  return nextTick()
}

function closePicker(harness) {
  harness.visible.value = false
  return nextTick()
}

function cardButtons(root) {
  return findAll(root, (node) => node.type === 'button' && Object.hasOwn(node.props, 'aria-pressed'))
}

function confirmButton(root) {
  const [button] = findAll(root, (node) => node.type === 'button' && node.props['data-variant'] === 'primary')
  assert.ok(button, 'missing confirm button')
  return button
}

function pickerGrid(root) {
  const [grid] = findAll(root, (node) => hasClass(node, 'picker-grid'))
  assert.ok(grid, 'missing picker grid')
  return grid
}

function pickerError(root) {
  return findAll(root, (node) => hasClass(node, 'picker-error'))[0] || null
}

function pickerEmpty(root) {
  return findAll(root, (node) => hasClass(node, 'picker-empty'))[0] || null
}

function footerStatus(root) {
  const [node] = findAll(root, (entry) => hasClass(entry, 'picker-footer__status'))
  assert.ok(node, 'missing picker footer status')
  return textContent(node)
}

function pagination(root) {
  const [node] = findAll(root, (entry) => entry.type === 'pagination')
  assert.ok(node, 'missing pagination')
  return node
}

function searchInput(root) {
  const [node] = findAll(root, (entry) => entry.type === 'input')
  assert.ok(node, 'missing search input')
  return node
}

function mediaTypeFilter(root) {
  const [node] = findAll(root, (entry) => entry.type === 'radio-group')
  assert.ok(node, 'missing media type filter')
  return node
}

test('older failures cannot override a newer successful reopen request', async () => {
  const controller = createRequestController()
  const harness = mountPicker()
  try {
    await openPicker(harness)
    assert.equal(controller.requests.length, 1)

    await closePicker(harness)
    assert.equal(controller.requests[0].options.signal.aborted, true)
    assert.equal(controller.requests[0].options.suppressErrorToast, true)
    await openPicker(harness)
    assert.equal(controller.requests.length, 2)

    controller.requests[1].resolve({
      items: [{ id: 22, type: 'image', name: 'latest-open' }],
      pagination: { total: 1 },
    })
    await flushUi()

    controller.requests[0].reject(new Error('older failed'))
    await flushUi()

    assert.match(textContent(harness.root), /latest-open/)
    assert.equal(pickerError(harness.root), null)
    assert.equal(pickerEmpty(harness.root), null)
    assert.equal(pickerGrid(harness.root).props['aria-busy'], false)
  } finally {
    harness.app.unmount()
    delete globalThis.__globalMediaPickerDialogTestState
  }
})

test('older successes cannot replace the latest error state, empty state stays hidden, and confirm stays disabled', async () => {
  const controller = createRequestController()
  const harness = mountPicker()
  try {
    await openPicker(harness)
    await closePicker(harness)
    await openPicker(harness)
    assert.equal(controller.requests.length, 2)

    controller.requests[1].reject(new Error('latest failed'))
    await flushUi()

    const errorNode = pickerError(harness.root)
    assert.ok(errorNode)
    assert.match(textContent(errorNode), /暂时无法加载素材，请检查服务状态后重试/)
    assert.equal(footerStatus(harness.root), '素材加载失败，请重试')
    assert.equal(cardButtons(harness.root).length, 0)
    assert.equal(pickerEmpty(harness.root), null)
    assert.equal(confirmButton(harness.root).props.disabled, true)

    controller.requests[0].resolve({
      items: [{ id: 1, type: 'image', name: 'older success' }],
      pagination: { total: 1 },
    })
    await flushUi()

    assert.match(textContent(pickerError(harness.root)), /暂时无法加载素材，请检查服务状态后重试/)
    assert.equal(cardButtons(harness.root).length, 0)
    assert.equal(pickerEmpty(harness.root), null)
    assert.equal(confirmButton(harness.root).props.disabled, true)
  } finally {
    harness.app.unmount()
    delete globalThis.__globalMediaPickerDialogTestState
  }
})

test('older successes cannot replace the newest page result, and loading disables confirm while a newer query is pending', async () => {
  const controller = createRequestController()
  const harness = mountPicker()
  try {
    await openPicker(harness)
    controller.requests[0].resolve({
      items: [{ id: 1, type: 'image', name: 'page one' }],
      pagination: { total: 80 },
    })
    await flushUi()

    cardButtons(harness.root)[0].props.onClick()
    await nextTick()
    assert.equal(confirmButton(harness.root).props.disabled, false)

    pagination(harness.root).props.onSelectPage(2)
    await nextTick()
    assert.equal(controller.requests.length, 2)
    assert.equal(confirmButton(harness.root).props.disabled, true)
    assert.equal(footerStatus(harness.root), '正在加载素材')
    assert.equal(cardButtons(harness.root).every((button) => button.props['aria-pressed'] === false), true)
    assert.equal(pickerGrid(harness.root).props['aria-busy'], true)
    confirmButton(harness.root).props.onClick()
    await nextTick()
    assert.deepEqual(harness.selections, [])

    pagination(harness.root).props.onSelectPage(3)
    await nextTick()
    assert.equal(controller.requests.length, 3)
    assert.equal(controller.requests[1].options.signal.aborted, true)

    controller.requests[2].resolve({
      items: [{ id: 3, type: 'image', name: 'page three' }],
      pagination: { total: 80 },
    })
    await flushUi()

    controller.requests[1].resolve({
      items: [{ id: 2, type: 'image', name: 'page two' }],
      pagination: { total: 80 },
    })
    await flushUi()

    assert.match(textContent(harness.root), /page three/)
    assert.doesNotMatch(textContent(harness.root), /page two/)
    assert.equal(pickerError(harness.root), null)
  } finally {
    harness.app.unmount()
    delete globalThis.__globalMediaPickerDialogTestState
  }
})

test('closing and reopening resets filters back to the default query intent', async () => {
  const controller = createRequestController()
  const harness = mountPicker()
  try {
    await openPicker(harness)
    controller.requests[0].resolve({
      items: [{ id: 1, type: 'image', name: 'page one' }],
      pagination: { total: 80 },
    })
    await flushUi()

    mediaTypeFilter(harness.root).props.onSelect('video')
    await nextTick()
    assert.equal(controller.requests.length, 2)
    controller.requests[1].resolve({
      items: [{ id: 2, type: 'video', name: 'videos' }],
      pagination: { total: 80 },
    })
    await flushUi()

    callListener(searchInput(harness.root).props.onInput, { target: { value: 'cats' } })
    await delay(320)
    await nextTick()
    assert.equal(controller.requests.length, 3)
    controller.requests[2].resolve({
      items: [{ id: 3, type: 'video', name: 'filtered videos' }],
      pagination: { total: 80 },
    })
    await flushUi()

    pagination(harness.root).props.onSelectPage(2)
    await nextTick()
    assert.equal(controller.requests.length, 4)
    controller.requests[3].resolve({
      items: [{ id: 4, type: 'video', name: 'filtered page two' }],
      pagination: { total: 80 },
    })
    await flushUi()

    await closePicker(harness)
    await openPicker(harness)

    assert.equal(controller.requests.length, 5)
    assert.deepEqual(controller.calls[4], { page: 1, page_size: 24 })
    assert.equal(mediaTypeFilter(harness.root).props.value, 'all')
    assert.equal(searchInput(harness.root).props.value, '')
  } finally {
    harness.app.unmount()
    delete globalThis.__globalMediaPickerDialogTestState
  }
})
