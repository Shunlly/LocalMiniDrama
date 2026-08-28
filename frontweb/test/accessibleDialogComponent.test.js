import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

import { compileScript, parse } from '@vue/compiler-sfc'
import { createRenderer, defineComponent, h, nextTick, ref } from 'vue'

const componentUrl = new URL('../src/components/AccessibleDialog.vue', import.meta.url)
const componentSource = existsSync(componentUrl) ? readFileSync(componentUrl, 'utf8') : ''

function dataModule(code) {
  return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
}

async function compileAccessibleDialog() {
  assert.notEqual(componentSource, '', 'AccessibleDialog.vue must exist')
  const { descriptor, errors } = parse(componentSource, { filename: componentUrl.pathname })
  assert.deepEqual(errors, [])
  let compiledSource = compileScript(descriptor, {
    id: 'accessible-dialog-component',
    inlineTemplate: true,
  }).content
  const utilityStubUrl = dataModule(`
    export const dialogAccessibility = {
      register(dialog, opener) {
        const token = { dialog, opener }
        globalThis.__accessibleDialogCalls.push(['register', dialog, opener])
        return token
      },
      focus(token) {
        globalThis.__accessibleDialogCalls.push(['focus', token])
        if (globalThis.__accessibleDialogFocusResult === false) return false
        globalThis.document.activeElement = globalThis.__accessibleDialogFocusTarget
        return true
      },
      unregister(token) {
        globalThis.__accessibleDialogCalls.push(['unregister', token])
      },
    }
  `)
  for (const [specifier, resolved] of [
    ['vue', import.meta.resolve('vue')],
    ['@/utils/dialogAccessibility.js', utilityStubUrl],
  ]) {
    compiledSource = compiledSource
      .replaceAll(`from '${specifier}'`, `from '${resolved}'`)
      .replaceAll(`from "${specifier}"`, `from "${resolved}"`)
  }
  return (await import(dataModule(compiledSource))).default
}

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
  setScopeId() {},
  cloneNode(node) {
    return { ...node, props: { ...node.props }, children: [...node.children] }
  },
  insertStaticContent(content, parent, anchor) {
    const node = createHostNode('#static', content)
    insertHostNode(node, parent, anchor)
    return [node, node]
  },
})

function findAll(node, type, matches = []) {
  if (node.type === type) matches.push(node)
  for (const child of node.children || []) findAll(child, type, matches)
  return matches
}

function textContent(node) {
  return `${node.text || ''}${(node.children || []).map(textContent).join('')}`
}

const exposedDialogElement = { nodeType: 1, id: 'dialog-element' }
const focusTrapContainer = { id: 'focus-trap-container' }
const managedFocusTarget = { id: 'managed-focus-target' }

const ElDialogStub = defineComponent({
  inheritAttrs: false,
  props: {
    modelValue: Boolean,
    appendToBody: Boolean,
    width: String,
    closeOnClickModal: Boolean,
    beforeClose: Function,
  },
  emits: ['update:modelValue', 'open', 'opened', 'close', 'closed', 'openAutoFocus', 'closeAutoFocus'],
  setup(props, { attrs, emit, expose, slots }) {
    expose({ dialogContentRef: globalThis.__accessibleDialogContentRef || { $el: exposedDialogElement } })
    return () => h('dialog-stub', {
      ...attrs,
      'data-model-value': props.modelValue,
      'data-append-to-body': props.appendToBody,
      'data-width': props.width,
      'data-close-on-click-modal': props.closeOnClickModal,
      onRequestModelUpdate: (value) => emit('update:modelValue', value),
      onTriggerOpen: () => emit('open'),
      onTriggerOpened: () => emit('opened'),
      onTriggerClose: (event) => emit('close', event),
      onTriggerClosed: () => emit('closed'),
      onTriggerOpenAutoFocus: (event) => {
        emit('openAutoFocus', event)
        nextTick(() => {
          globalThis.document.activeElement = focusTrapContainer
        })
      },
      onTriggerCloseAutoFocus: (event) => emit('closeAutoFocus', event),
      onInvokeBeforeClose: (done) => props.beforeClose?.(done),
    }, [
      h('default-slot', {}, slots.default?.()),
      h('header-slot', {}, slots.header?.({
        close: () => 'closed',
        titleId: 'dialog-title',
        titleClass: 'el-dialog__title',
      })),
      h('footer-slot', {}, slots.footer?.()),
    ])
  },
})

async function mountDialog() {
  const AccessibleDialog = await compileAccessibleDialog()
  const visible = ref(true)
  const events = []
  const beforeClose = (done) => {
    events.push('before-close')
    done()
  }
  const Harness = defineComponent({
    setup() {
      return () => h(AccessibleDialog, {
        modelValue: visible.value,
        'onUpdate:modelValue': (value) => {
          events.push(['update:modelValue', value])
          visible.value = value
        },
        appendToBody: false,
        width: '640px',
        closeOnClickModal: false,
        beforeClose,
        class: 'business-dialog',
        onOpen: () => events.push('open'),
        onOpened: () => events.push('opened'),
        onClose: (event) => events.push(['close', event]),
        onClosed: (event) => events.push(event === undefined ? 'closed' : ['closed', event]),
        onOpenAutoFocus: (event) => events.push(event === undefined ? 'open-auto-focus' : ['open-auto-focus', event]),
        onCloseAutoFocus: (event) => events.push(['close-auto-focus', event]),
      }, {
        default: () => h('main-content', {}, 'Body content'),
        header: ({ titleId, titleClass }) => h('heading-content', {
          'data-title-id': titleId,
          'data-title-class': titleClass,
        }, 'Dialog heading'),
        footer: () => h('footer-content', {}, 'Dialog actions'),
      })
    },
  })
  const root = createHostNode('root')
  const app = renderer.createApp(Harness)
  app.component('el-dialog', ElDialogStub)
  app.mount(root)
  await nextTick()
  return { app, beforeClose, events, root, visible }
}

test('wrapper forces append-to-body while preserving attrs, v-model, and named slots', async () => {
  globalThis.__accessibleDialogCalls = []
  globalThis.document = { activeElement: { id: 'launch-button' } }
  const harness = await mountDialog()
  try {
    const [dialog] = findAll(harness.root, 'dialog-stub')
    assert.equal(dialog.props['data-append-to-body'], true)
    assert.equal(dialog.props['data-width'], '640px')
    assert.equal(dialog.props['data-close-on-click-modal'], false)
    assert.match(dialog.props.class, /business-dialog/)
    assert.match(textContent(dialog), /Body content/)
    assert.match(textContent(dialog), /Dialog heading/)
    assert.match(textContent(dialog), /Dialog actions/)
    const [heading] = findAll(dialog, 'heading-content')
    assert.equal(heading.props['data-title-id'], 'dialog-title')
    assert.equal(heading.props['data-title-class'], 'el-dialog__title')

    let beforeCloseCompleted = false
    dialog.props.onInvokeBeforeClose(() => { beforeCloseCompleted = true })
    assert.equal(beforeCloseCompleted, true)
    assert.deepEqual(harness.events, ['before-close'])

    dialog.props.onRequestModelUpdate(false)
    await nextTick()
    assert.equal(harness.visible.value, false)
    assert.deepEqual(harness.events.at(-1), ['update:modelValue', false])
  } finally {
    harness.app.unmount()
    delete globalThis.__accessibleDialogCalls
    delete globalThis.document
  }
})

test('wrapper manages focus lifecycle before forwarding dialog events', async () => {
  globalThis.__accessibleDialogCalls = []
  globalThis.__accessibleDialogFocusTarget = managedFocusTarget
  const opener = { id: 'launch-button' }
  globalThis.document = { activeElement: opener }
  const harness = await mountDialog()
  try {
    const [dialog] = findAll(harness.root, 'dialog-stub')
    dialog.props.onTriggerOpen()
    dialog.props.onTriggerOpenAutoFocus()
    await nextTick()
    await nextTick()
    assert.equal(globalThis.document.activeElement, managedFocusTarget)
    dialog.props.onTriggerOpened()
    dialog.props.onTriggerClosed()

    assert.equal(globalThis.__accessibleDialogCalls[0][0], 'register')
    assert.equal(globalThis.__accessibleDialogCalls[0][1], exposedDialogElement)
    assert.equal(globalThis.__accessibleDialogCalls[0][2], opener)
    assert.equal(globalThis.__accessibleDialogCalls[1][0], 'focus')
    assert.equal(globalThis.__accessibleDialogCalls[2][0], 'unregister')
    assert.deepEqual(harness.events, ['open', 'open-auto-focus', 'opened', 'closed'])
  } finally {
    harness.app.unmount()
    delete globalThis.__accessibleDialogCalls
    delete globalThis.__accessibleDialogFocusTarget
    delete globalThis.document
  }
})

test('unmount unregisters an open dialog exactly once', async () => {
  globalThis.__accessibleDialogCalls = []
  globalThis.document = { activeElement: { id: 'launch-button' } }
  const harness = await mountDialog()
  const [dialog] = findAll(harness.root, 'dialog-stub')
  dialog.props.onTriggerOpen()
  harness.app.unmount()

  assert.equal(globalThis.__accessibleDialogCalls.filter(([name]) => name === 'unregister').length, 1)
  delete globalThis.__accessibleDialogCalls
  delete globalThis.document
})

test('包装器完整透传自动聚焦和关闭事件参数', async () => {
  globalThis.__accessibleDialogCalls = []
  globalThis.__accessibleDialogFocusTarget = managedFocusTarget
  globalThis.document = { activeElement: { id: 'launch-button' } }
  const harness = await mountDialog()
  try {
    const [dialog] = findAll(harness.root, 'dialog-stub')
    const openFocusEvent = { type: 'open-auto-focus' }
    const closeEvent = { type: 'close' }
    const closeFocusEvent = { type: 'close-auto-focus' }

    dialog.props.onTriggerOpen()
    dialog.props.onTriggerOpenAutoFocus(openFocusEvent)
    dialog.props.onTriggerClose(closeEvent)
    dialog.props.onTriggerCloseAutoFocus(closeFocusEvent)
    await nextTick()
    await nextTick()

    assert.deepEqual(harness.events, [
      'open',
      ['open-auto-focus', openFocusEvent],
      ['close', closeEvent],
      ['close-auto-focus', closeFocusEvent],
    ])
  } finally {
    harness.app.unmount()
    delete globalThis.__accessibleDialogCalls
    delete globalThis.__accessibleDialogFocusTarget
    delete globalThis.document
  }
})

test('520px 视口下弹窗外壳和内容都受视口宽度约束', () => {
  assert.match(componentSource, /\.accessible-dialog\.el-dialog \{[\s\S]*?box-sizing: border-box;[\s\S]*?max-width: calc\(100vw - 24px\);/)
  assert.match(componentSource, /@media \(max-width: 520px\) \{[\s\S]*?display: flex;[\s\S]*?width: calc\(100vw - 24px\) !important;[\s\S]*?flex-direction: column;/)
  assert.match(componentSource, /\.accessible-dialog\.el-dialog > \.el-dialog__body[\s\S]*?min-width: 0;[\s\S]*?max-width: 100%;/)
  assert.match(componentSource, /\.accessible-dialog\.el-dialog > \.el-dialog__body \{[\s\S]*?min-height: 0;[\s\S]*?flex: 1 1 auto;[\s\S]*?overflow-x: auto;[\s\S]*?overflow-y: auto;/)
})

test('弹窗默认禁止点遮罩关闭', () => {
  assert.match(componentSource, /closeOnClickModal:\s*\{\s*type:\s*Boolean,\s*default:\s*false/)
  assert.match(componentSource, /:close-on-click-modal="closeOnClickModal"/)
})
test('Element Plus 未暴露 $el 时按 data-id 注册真实弹窗节点', async () => {
  globalThis.__accessibleDialogCalls = []
  globalThis.__accessibleDialogContentRef = { resetPosition() {}, updatePosition() {} }
  const opener = { id: 'launch-button' }
  const resolved = { nodeType: 1, id: 'queried-dialog' }
  globalThis.document = {
    activeElement: opener,
    querySelector(selector) {
      const id = globalThis.__accessibleDialogQueryId
      return id && String(selector).includes(id) ? resolved : null
    },
  }
  const harness = await mountDialog()
  try {
    const [dialog] = findAll(harness.root, 'dialog-stub')
    const dialogId = dialog.props['data-accessible-dialog-id']
    assert.equal(typeof dialogId, 'string')
    assert.match(dialogId, /^accessible-dialog-/)
    globalThis.__accessibleDialogQueryId = dialogId
    dialog.props.onTriggerOpen()
    assert.equal(globalThis.__accessibleDialogCalls[0][0], 'register')
    assert.equal(globalThis.__accessibleDialogCalls[0][1], resolved)
    assert.equal(globalThis.__accessibleDialogCalls[0][2], opener)
  } finally {
    harness.app.unmount()
    delete globalThis.__accessibleDialogCalls
    delete globalThis.__accessibleDialogContentRef
    delete globalThis.__accessibleDialogQueryId
    delete globalThis.document
  }
})

test('初始焦点失败后 opened 会重试而不是锁死关闭按钮', async () => {
  globalThis.__accessibleDialogCalls = []
  globalThis.__accessibleDialogFocusTarget = managedFocusTarget
  globalThis.__accessibleDialogFocusResult = false
  globalThis.document = { activeElement: { id: 'launch-button' } }
  const harness = await mountDialog()
  try {
    const [dialog] = findAll(harness.root, 'dialog-stub')
    dialog.props.onTriggerOpen()
    dialog.props.onTriggerOpenAutoFocus()
    await nextTick()
    await nextTick()
    assert.equal(globalThis.__accessibleDialogCalls.filter(([name]) => name === 'focus').length, 1)
    assert.notEqual(globalThis.document.activeElement, managedFocusTarget)
    globalThis.__accessibleDialogFocusResult = true
    dialog.props.onTriggerOpened()
    assert.equal(globalThis.document.activeElement, managedFocusTarget)
    assert.equal(globalThis.__accessibleDialogCalls.filter(([name]) => name === 'focus').length, 2)
  } finally {
    harness.app.unmount()
    delete globalThis.__accessibleDialogCalls
    delete globalThis.__accessibleDialogFocusTarget
    delete globalThis.__accessibleDialogFocusResult
    delete globalThis.document
  }
})

test('打开自动聚焦会阻止默认焦点落到关闭按钮', () => {
  assert.match(componentSource, /function handleOpenAutoFocus\(event, \.\.\.args\)/)
  assert.match(componentSource, /event\?\.preventDefault\?\.\(\)/)
  assert.match(componentSource, /:data-accessible-dialog-id="instanceId"/)
})
