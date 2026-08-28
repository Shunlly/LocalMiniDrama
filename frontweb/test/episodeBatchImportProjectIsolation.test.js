import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { compileScript, parse } from '@vue/compiler-sfc'
import { createRenderer, defineComponent, h, nextTick } from 'vue'
import { ElMessage as RawElMessage } from 'element-plus'

import { createProjectInstanceLifecycle } from '../src/utils/projectInstanceLifecycle.js'
import request from '../src/utils/request.js'

const componentUrl = new URL('../src/components/EpisodeBatchImportDialog.vue', import.meta.url)
const source = readFileSync(componentUrl, 'utf8')
const { descriptor, errors } = parse(source, { filename: componentUrl.pathname })
assert.deepEqual(errors, [])

function dataModule(code) {
  return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
}

const elementPlusStubUrl = dataModule(`
  function notify(type, message) {
    const record = { type, message }
    globalThis.__episodeBatchImportMessages.push(record)
    return { close() { record.closed = true } }
  }
  export const ElMessage = {
    error: (message) => notify('error', message),
    success: (message) => notify('success', message),
    warning: (message) => notify('warning', message),
  }
`)
const iconsStubUrl = dataModule('export const Upload = { render() { return null } }')

let compiledSource = compileScript(descriptor, {
  id: 'episode-batch-import-project-isolation',
  inlineTemplate: true,
}).content

for (const [specifier, resolved] of [
  ['vue', import.meta.resolve('vue')],
  ['element-plus', elementPlusStubUrl],
  ['@element-plus/icons-vue', iconsStubUrl],
  ['@/utils/projectInstanceLifecycle.js', new URL('../src/utils/projectInstanceLifecycle.js', import.meta.url).href],
]) {
  compiledSource = compiledSource
    .replaceAll(`from '${specifier}'`, `from '${resolved}'`)
    .replaceAll(`from "${specifier}"`, `from "${resolved}"`)
}

const EpisodeBatchImportDialog = (await import(dataModule(compiledSource))).default

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
  createElement: (type) => createHostNode(type),
  createText: (text) => createHostNode('#text', text),
  createComment: (text) => createHostNode('#comment', text),
  setText(node, text) {
    node.text = text
  },
  setElementText(node, text) {
    const child = createHostNode('#text', text)
    child.parent = node
    node.children = [child]
  },
  parentNode: (node) => node.parent,
  nextSibling(node) {
    if (!node.parent) return null
    return node.parent.children[node.parent.children.indexOf(node) + 1] || null
  },
  querySelector: () => null,
  setScopeId() {},
  cloneNode: (node) => ({ ...node, props: { ...node.props }, children: [...node.children] }),
  insertStaticContent(content, parent, anchor) {
    const node = createHostNode('#static', content)
    insertHostNode(node, parent, anchor)
    return [node, node]
  },
})

function findAll(node, predicate, matches = []) {
  if (predicate(node)) matches.push(node)
  for (const child of node.children || []) findAll(child, predicate, matches)
  return matches
}

function textContent(node) {
  return `${node.text || ''}${(node.children || []).map(textContent).join('')}`
}

function clickButton(root, label) {
  const button = findAll(root, (node) => node.type === 'button' && textContent(node).includes(label))[0]
  assert.ok(button, `missing button: ${label}`)
  button.props.onClick?.()
}

function createDeferred() {
  let resolve
  const promise = new Promise((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

const SlotStub = defineComponent({
  setup(_props, { attrs, slots }) {
    return () => h('slot-stub', attrs, slots.default?.())
  },
})

const DialogStub = defineComponent({
  props: ['modelValue'],
  setup(props, { slots }) {
    return () => props.modelValue
      ? h('dialog-stub', {}, [slots.default?.(), slots.footer?.()])
      : null
  },
})

const ButtonStub = defineComponent({
  setup(_props, { attrs, slots }) {
    return () => h('button', attrs, slots.default?.())
  },
})

function mountDialog(importHandler) {
  const root = createHostNode('root')
  const app = renderer.createApp(EpisodeBatchImportDialog, {
    startEpisodeNumber: 1,
    importHandler,
  })
  app.component('AccessibleDialog', DialogStub)
  app.component('el-button', ButtonStub)
  for (const name of ['el-tabs', 'el-tab-pane', 'el-form', 'el-form-item', 'el-icon', 'el-table']) {
    app.component(name, SlotStub)
  }
  app.component('el-input', SlotStub)
  app.component('el-input-number', SlotStub)
  app.component('el-table-column', defineComponent({ render: () => null }))
  app.mount(root)
  return { app, root }
}

async function flushUi() {
  await Promise.resolve()
  await Promise.resolve()
  await nextTick()
}

test('unmounting project A suppresses the deferred batch-import child continuation', async () => {
  globalThis.__episodeBatchImportMessages = []
  globalThis.FileReader = class {
    readAsText() {
      this.onload?.({ target: { result: '第一章\n项目 A 的内容' } })
    }
  }

  const request = createDeferred()
  const parentLifecycle = createProjectInstanceLifecycle()
  let saveCalls = 0
  let followUpCalls = 0
  const harness = mountDialog(async () => {
    saveCalls += 1
    await parentLifecycle.execute(() => request.promise)
    await parentLifecycle.execute(async () => { followUpCalls += 1 })
  })

  try {
    clickButton(harness.root, '批量导入剧集')
    await nextTick()
    const fileInput = findAll(harness.root, (node) => node.type === 'input' && node.props.type === 'file')[0]
    assert.ok(fileInput, 'missing TXT file input')
    fileInput.props.onChange({ target: { files: [{ name: 'project-a.txt' }] } })
    await nextTick()
    clickButton(harness.root, '确认导入配置')
    await nextTick()
    globalThis.__episodeBatchImportMessages.length = 0

    clickButton(harness.root, '确认导入集数')
    await Promise.resolve()
    assert.equal(saveCalls, 1)

    parentLifecycle.dispose()
    harness.app.unmount()
    request.resolve({ success: true })
    await flushUi()

    assert.equal(followUpCalls, 0)
    assert.deepEqual(globalThis.__episodeBatchImportMessages, [])
  } finally {
    parentLifecycle.dispose()
    harness.app.unmount()
    delete globalThis.__episodeBatchImportMessages
    delete globalThis.FileReader
  }
})

test('a deferred project A HTTP failure cannot create a global toast after project B mounts', async () => {
  globalThis.__episodeBatchImportMessages = []
  globalThis.FileReader = class {
    readAsText() {
      this.onload?.({ target: { result: '第一章\n项目 A 的内容' } })
    }
  }

  const requestResult = createDeferred()
  const parentLifecycle = createProjectInstanceLifecycle()
  const parentApi = parentLifecycle.guardApi({
    saveEpisodes() {
      return request.put('/dramas/101/episodes', { episodes: [] }, {
        adapter: async (config) => {
          await requestResult.promise
          const error = new Error('project A transport failed')
          error.config = config
          error.response = { data: { error: { message: '项目 A 保存失败' } } }
          throw error
        },
      })
    },
  })
  const originalRawError = RawElMessage.error
  RawElMessage.error = (message) => {
    globalThis.__episodeBatchImportMessages.push({ type: 'raw-error', message })
    return { close() {} }
  }
  const harness = mountDialog(() => parentApi.saveEpisodes())

  try {
    clickButton(harness.root, '批量导入剧集')
    await nextTick()
    const fileInput = findAll(harness.root, (node) => node.type === 'input' && node.props.type === 'file')[0]
    fileInput.props.onChange({ target: { files: [{ name: 'project-a.txt' }] } })
    await nextTick()
    clickButton(harness.root, '确认导入配置')
    await nextTick()
    globalThis.__episodeBatchImportMessages.length = 0

    clickButton(harness.root, '确认导入集数')
    await Promise.resolve()
    parentLifecycle.dispose()
    harness.app.unmount()
    requestResult.resolve()
    await flushUi()

    assert.deepEqual(globalThis.__episodeBatchImportMessages, [])
  } finally {
    RawElMessage.error = originalRawError
    parentLifecycle.dispose()
    harness.app.unmount()
    delete globalThis.__episodeBatchImportMessages
    delete globalThis.FileReader
  }
})
