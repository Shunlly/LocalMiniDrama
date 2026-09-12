import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { compileScript, parse } from '@vue/compiler-sfc'
import { createRenderer, defineComponent, h, nextTick } from 'vue'
import { ElMessage as RawElMessage } from '../src/utils/elementPlusFeedback.js'

import { createProjectInstanceLifecycle } from '../src/utils/projectInstanceLifecycle.js'
import request from '../src/utils/request.js'

const componentUrl = new URL('../src/components/EpisodeBatchImportDialog.vue', import.meta.url)
const parentSource = readFileSync(componentUrl, 'utf8')
const previewSource = readFileSync(new URL('../src/components/episodeBatchImport/EpisodeBatchImportPreviewPanel.vue', import.meta.url), 'utf8')
const footerSource = readFileSync(new URL('../src/components/episodeBatchImport/EpisodeBatchImportFooter.vue', import.meta.url), 'utf8')
const chaptersSource = readFileSync(new URL('../src/components/episodeBatchImport/episodeBatchImportChapters.js', import.meta.url), 'utf8')
const source = [parentSource, previewSource, footerSource, chaptersSource].join('\n')
const { descriptor, errors } = parse(parentSource, { filename: componentUrl.pathname })
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
  export const ElMessageBox = {
    async confirm() { return true },
  }
`)
const iconsStubUrl = dataModule('export const Upload = { render() { return null } }')

function compileLocalVue(rel, id) {
  const url = new URL(rel, import.meta.url)
  const localSource = readFileSync(url, 'utf8')
  const parsed = parse(localSource, { filename: url.pathname })
  assert.deepEqual(parsed.errors, [])
  let compiled = compileScript(parsed.descriptor, { id, inlineTemplate: true }).content
  compiled = compiled
    .replaceAll("from 'vue'", `from '${import.meta.resolve('vue')}'`)
    .replaceAll('from "vue"', `from '${import.meta.resolve('vue')}'`)
  return dataModule(compiled)
}

const previewModuleUrl = compileLocalVue('../src/components/episodeBatchImport/EpisodeBatchImportPreviewPanel.vue', 'episode-batch-import-preview')
const footerModuleUrl = compileLocalVue('../src/components/episodeBatchImport/EpisodeBatchImportFooter.vue', 'episode-batch-import-footer')
const chaptersModuleUrl = new URL('../src/components/episodeBatchImport/episodeBatchImportChapters.js', import.meta.url).href

let compiledSource = compileScript(descriptor, {
  id: 'episode-batch-import-project-isolation',
  inlineTemplate: true,
}).content

for (const [specifier, resolved] of [
  ['vue', import.meta.resolve('vue')],
  ['element-plus', elementPlusStubUrl],
  ['@/utils/elementPlusFeedback.js', elementPlusStubUrl],
  ['@element-plus/icons-vue', iconsStubUrl],
  ['@/utils/projectInstanceLifecycle.js', new URL('../src/utils/projectInstanceLifecycle.js', import.meta.url).href],
  ['./episodeBatchImport/EpisodeBatchImportPreviewPanel.vue', previewModuleUrl],
  ['./episodeBatchImport/EpisodeBatchImportFooter.vue', footerModuleUrl],
  ['./episodeBatchImport/episodeBatchImportChapters.js', chaptersModuleUrl],
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
  for (const name of ['el-tabs', 'el-form', 'el-form-item', 'el-icon', 'el-table']) {
    app.component(name, SlotStub)
  }
  app.component('el-tab-pane', defineComponent({
    setup(_props, { attrs, slots }) {
      return () => h('tab-pane-stub', attrs, [slots.label?.(), slots.default?.()])
    },
  }))
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

test('批量导入空状态和禁用原因保持简体中文', () => {
  assert.match(source, /from '@\/utils\/elementPlusFeedback\.js'/)
  assert.doesNotMatch(source, /from 'element-plus'/)
  assert.match(source, /还没有可导入的集数预览/)
  assert.match(source, /请先在「导入设置」中选择 TXT 文件，再点击「确认导入配置」/)
  assert.match(source, />返回导入设置</)
  assert.match(source, /const configConfirmDisabledReason = computed/)
  assert.match(source, /const previewTabDisabledReason = computed/)
  assert.match(source, /请先选择包含章节文本的 TXT 文件/)
  assert.match(source, /请先完成预览确认/)
  assert.match(source, /请先选择文件并确认导入配置/)
  assert.match(source, /正在导入剧集，请完成后再关闭/)
  assert.match(source, /:disabled="Boolean\(configConfirmDisabledReason\)"/)
  assert.match(source, /:disabled="Boolean\(importConfirmDisabledReason\)"/)
  assert.match(source, /:disabled="importing"/)
  assert.match(source, /:disabled="!previewReady"/)
  assert.match(source, /:title="previewTabDisabledReason"/)
  assert.match(source, /:title="importing \? '正在导入剧集，请完成后再选择文件。' : ''"/)
  assert.match(source, /:title="closeDisabledReason"/)
  assert.match(source, /:title="importing \? '正在导入剧集，请完成后再返回。' : ''"/)
  assert.match(source, /:title="configConfirmDisabledReason"/)
  assert.match(source, /:title="importConfirmDisabledReason"/)
  assert.match(source, /ElMessage\.error\('文件内容为空，请选择包含章节文本的 TXT 文件'\)/)
  assert.match(source, /ElMessage\.warning\('请选择 TXT 文本文件'\)/)
  assert.match(source, /读取文件失败，请重新选择 TXT 文件/)
  assert.doesNotMatch(source, /ElMessage\.error\('读取文件失败'\)/)
})

test('空 TXT 和非法扩展名给出中文失败，确认按钮保持禁用', async () => {
  globalThis.__episodeBatchImportMessages = []
  globalThis.FileReader = class {
    readAsText() {
      this.onload?.({ target: { result: '   \n' } })
    }
  }
  const harness = mountDialog(async () => {})
  try {
    clickButton(harness.root, '批量导入剧集')
    await nextTick()
    const fileInput = findAll(harness.root, (node) => node.type === 'input' && node.props.type === 'file')[0]
    assert.ok(fileInput, 'missing TXT file input')

    fileInput.props.onChange({ target: { files: [{ name: 'story.md' }], value: 'story.md' } })
    await nextTick()
    assert.equal(
      globalThis.__episodeBatchImportMessages.some((item) => String(item.message).includes('请选择 TXT')),
      true,
    )

    globalThis.__episodeBatchImportMessages.length = 0
    fileInput.props.onChange({ target: { files: [{ name: 'empty.txt' }], value: 'empty.txt' } })
    await nextTick()
    assert.equal(
      globalThis.__episodeBatchImportMessages.some((item) => String(item.message).includes('文件内容为空')),
      true,
    )
    const confirm = findAll(harness.root, (node) => node.type === 'button' && textContent(node).includes('确认导入配置'))[0]
    assert.ok(confirm, 'missing confirm config button')
    assert.equal(Boolean(confirm.props.disabled), true)
    assert.match(String(confirm.props.title || ''), /请先选择包含章节文本的 TXT 文件/)
  } finally {
    harness.app.unmount()
    delete globalThis.__episodeBatchImportMessages
    delete globalThis.FileReader
  }
})

test('预览确认页签未就绪时给出中文禁用原因，且不改坏已有按钮 title', async () => {
  globalThis.__episodeBatchImportMessages = []
  globalThis.FileReader = class {
    readAsText() {
      this.onload?.({ target: { result: '第一章\n正文' } })
    }
  }
  const harness = mountDialog(async () => {})
  const findButton = (label) => findAll(harness.root, (node) => node.type === 'button' && textContent(node).includes(label))[0]
  const findPreviewPane = () => findAll(harness.root, (node) => node.type === 'tab-pane-stub' && node.props.name === 'preview')[0]
  const findPreviewTitle = () => findAll(harness.root, (node) => (
    String(node.props.title || '').includes('请先选择文件并确认导入配置')
    || (node.type === 'span' && textContent(node).includes('2. 预览确认'))
  ))[0]
  try {
    clickButton(harness.root, '批量导入剧集')
    await nextTick()

    const previewPane = findPreviewPane()
    assert.ok(previewPane, 'missing preview tab')
    assert.equal(Boolean(previewPane.props.disabled), true)
    const previewTitle = findPreviewTitle()
    assert.ok(previewTitle, 'missing preview tab title')
    assert.match(String(previewTitle.props.title || ''), /请先选择文件并确认导入配置/)
    assert.match(textContent(harness.root), /请先选择文件并确认导入配置/)

    const selectFile = findButton('选择 TXT 文件')
    const cancel = findButton('取消')
    const confirm = findButton('确认导入配置')
    assert.ok(selectFile, 'missing select file button')
    assert.ok(cancel, 'missing cancel button')
    assert.ok(confirm, 'missing confirm config button')
    assert.equal(selectFile.props.title, '')
    assert.equal(cancel.props.title, '')
    assert.match(String(confirm.props.title || ''), /请先选择包含章节文本的 TXT 文件/)
    assert.equal(findButton('上一步'), undefined)

    const fileInput = findAll(harness.root, (node) => node.type === 'input' && node.props.type === 'file')[0]
    fileInput.props.onChange({ target: { files: [{ name: 'story.txt' }], value: 'story.txt' } })
    await nextTick()
    assert.equal(Boolean(findPreviewPane().props.disabled), true)
    assert.match(String(findPreviewTitle().props.title || ''), /请先选择文件并确认导入配置/)
    assert.equal(findButton('确认导入配置').props.title, '')
    assert.match(textContent(harness.root), /请先选择文件并确认导入配置/)

    clickButton(harness.root, '确认导入配置')
    await nextTick()
    assert.equal(Boolean(findPreviewPane().props.disabled), false)
    assert.equal(findPreviewTitle().props.title, '')
    assert.equal(textContent(harness.root).includes('请先选择文件并确认导入配置'), false)

    const back = findButton('上一步')
    const importConfirm = findButton('确认导入集数')
    assert.ok(back, 'missing back button')
    assert.ok(importConfirm, 'missing import confirm button')
    assert.equal(back.props.title, '')
    assert.equal(importConfirm.props.title, '')
  } finally {
    harness.app.unmount()
    delete globalThis.__episodeBatchImportMessages
    delete globalThis.FileReader
  }
})

test('空数据时取消会直接关闭，不弹出放弃确认', async () => {
  globalThis.__episodeBatchImportMessages = []
  const harness = mountDialog(async () => {})
  try {
    clickButton(harness.root, '批量导入剧集')
    await nextTick()
    assert.equal(findAll(harness.root, (node) => node.type === 'dialog-stub').length, 1)
    clickButton(harness.root, '取消')
    await nextTick()
    assert.equal(findAll(harness.root, (node) => node.type === 'dialog-stub').length, 0)
    assert.deepEqual(globalThis.__episodeBatchImportMessages, [])
  } finally {
    harness.app.unmount()
    delete globalThis.__episodeBatchImportMessages
  }
})
