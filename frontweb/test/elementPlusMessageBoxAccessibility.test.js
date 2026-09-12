import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { ElMessageBox, installMessageBoxAccessibility } from '../src/utils/elementPlusFeedback.js'
import { findDialogFocusTarget } from '../src/utils/dialogAccessibility.js'

const feedbackSource = readFileSync(new URL('../src/utils/elementPlusFeedback.js', import.meta.url), 'utf8')

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = String(tagName || 'div').toUpperCase()
    this.ownerDocument = ownerDocument
    this.parentElement = null
    this.children = []
    this.attributes = new Map()
    this.classList = new Set()
    this.disabled = false
    this.hidden = false
    this.inert = false
    this.textContent = ''
    this.focusCount = 0
    this.style = { display: '', visibility: '' }
    this.listeners = new Map()
  }

  append(...children) {
    for (const child of children) {
      if (child.parentElement) child.remove()
      child.parentElement = this
      this.children.push(child)
    }
  }

  remove() {
    const parent = this.parentElement
    if (!parent) return
    const index = parent.children.indexOf(this)
    if (index >= 0) parent.children.splice(index, 1)
    this.parentElement = null
  }

  setAttribute(name, value) {
    const normalizedValue = String(value)
    this.attributes.set(name, normalizedValue)
    if (name === 'class') this.classList = new Set(normalizedValue.split(/\s+/).filter(Boolean))
    if (name === 'inert') this.inert = true
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null
  }

  hasAttribute(name) {
    return this.attributes.has(name)
  }

  removeAttribute(name) {
    this.attributes.delete(name)
    if (name === 'inert') this.inert = false
  }

  matches(selector) {
    return String(selector || '').split(',').some((part) => this.matchesSingle(part.trim()))
  }

  matchesSingle(selector) {
    if (!selector) return false
    if (selector.startsWith('.') && !selector.includes('[') && !selector.includes(':') && !selector.includes(' ')) {
      return selector.slice(1).split('.').every((name) => name && this.classList.has(name))
    }
    if (selector.startsWith('#')) return this.getAttribute('id') === selector.slice(1)
    if (selector === '[autofocus]') return this.hasAttribute('autofocus')
    if (selector === '[inert]') return this.hasAttribute('inert') || this.inert
    if (selector === '[aria-hidden="true"]') return this.getAttribute('aria-hidden') === 'true'
    if (selector === '[role="dialog"]' || selector === "[role='dialog']") {
      return this.getAttribute('role') === 'dialog'
    }
    if (selector.startsWith('label[for="')) {
      const id = selector.slice(11, -2)
      return this.tagName === 'LABEL' && this.getAttribute('for') === id
    }
    if (selector === 'label') return this.tagName === 'LABEL'
    if (selector.startsWith('button')) return this.tagName === 'BUTTON'
    if (selector.startsWith('input')) return this.tagName === 'INPUT' && this.getAttribute('type') !== 'hidden'
    if (selector.startsWith('select')) return this.tagName === 'SELECT'
    if (selector.startsWith('textarea')) return this.tagName === 'TEXTAREA'
    if (selector.startsWith('summary')) return this.tagName === 'SUMMARY'
    if (selector.startsWith('a[')) return this.tagName === 'A' && this.hasAttribute('href')
    if (selector.startsWith('[contenteditable]')) {
      return this.hasAttribute('contenteditable') && this.getAttribute('contenteditable') !== 'false'
    }
    if (selector.startsWith('[tabindex]')) {
      return this.hasAttribute('tabindex') && Number(this.getAttribute('tabindex')) >= 0
    }
    return this.tagName === selector.toUpperCase()
  }

  querySelectorAll(selector) {
    const matches = []
    const visit = (element) => {
      for (const child of element.children) {
        if (child.matches(selector)) matches.push(child)
        visit(child)
      }
    }
    visit(this)
    return matches
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null
  }

  closest(selector) {
    let current = this
    while (current) {
      if (current.matches(selector)) return current
      current = current.parentElement
    }
    return null
  }

  contains(element) {
    if (element === this) return true
    return this.children.some((child) => child.contains(element))
  }

  focus() {
    if (!this.isConnected || this.disabled || this.inert) return
    this.ownerDocument.activeElement = this
    this.focusCount += 1
  }

  addEventListener(type, handler) {
    const list = this.listeners.get(type) || []
    list.push(handler)
    this.listeners.set(type, list)
  }

  dispatchEvent(event) {
    const payload = {
      type: event.type,
      key: event.key,
      target: event.target || this,
      currentTarget: this,
      bubbles: event.bubbles !== false,
    }
    for (const handler of this.listeners.get(payload.type) || []) handler(payload)
    const hook = this[`on${payload.type}`]
    if (typeof hook === 'function') hook(payload)
    if (payload.bubbles && this.parentElement) this.parentElement.dispatchEvent(payload)
    return true
  }

  click() {
    this.dispatchEvent({ type: 'click', target: this })
    if (typeof this.onclick === 'function') this.onclick({ type: 'click', target: this })
  }

  get isConnected() {
    return Boolean(this.ownerDocument?.body?.contains(this))
  }

  getClientRects() {
    if (this.hidden || this.style.display === 'none' || this.style.visibility === 'hidden') return []
    return [{}]
  }
}

class FakeDocument {
  constructor() {
    this.body = new FakeElement('body', this)
    this.activeElement = this.body
    this.defaultView = {
      getComputedStyle: (element) => ({
        display: element.style.display,
        visibility: element.style.visibility,
      }),
    }
  }

  createElement(tagName, attributes = {}) {
    const element = new FakeElement(tagName, this)
    for (const [name, value] of Object.entries(attributes)) {
      if (name === 'textContent') element.textContent = value
      else if (name === 'disabled') element.disabled = value
      else element.setAttribute(name, value)
    }
    return element
  }

  querySelector(selector) {
    if (this.body.matches(selector)) return this.body
    return this.body.querySelector(selector)
  }

  querySelectorAll(selector) {
    return this.body.querySelectorAll(selector)
  }

  getElementById(id) {
    return this.querySelector(`#${id}`)
  }
}

const originals = {
  confirm: ElMessageBox.confirm,
  alert: ElMessageBox.alert,
  prompt: ElMessageBox.prompt,
}
const hadDocument = Object.prototype.hasOwnProperty.call(globalThis, 'document')
const originalDocument = globalThis.document

function restoreDocument() {
  if (hadDocument) globalThis.document = originalDocument
  else delete globalThis.document
}

function restoreMessageBox() {
  ElMessageBox.confirm = originals.confirm
  ElMessageBox.alert = originals.alert
  ElMessageBox.prompt = originals.prompt
}

test.afterEach(() => {
  restoreMessageBox()
  restoreDocument()
})

function mountApp(document) {
  const app = document.createElement('main', { id: 'app' })
  const trigger = document.createElement('button', { type: 'button', textContent: '打开确认' })
  app.append(trigger)
  document.body.append(app)
  trigger.focus()
  return { app, trigger }
}

function mountMessageBox(document, options = {}) {
  const title = options.title || '删除确认'
  const message = options.message || '确定删除该项吗？'
  const confirmButtonText = options.confirmButtonText || '确定'
  const cancelButtonText = options.cancelButtonText || '取消'
  const overlay = document.createElement('div', { class: 'el-overlay is-message-box' })
  const wrap = document.createElement('div', {
    class: 'el-overlay-message-box',
    role: 'dialog',
    'aria-label': title,
    'aria-modal': 'true',
  })
  const box = document.createElement('div', { class: 'el-message-box', tabindex: '-1' })
  const header = document.createElement('div', { class: 'el-message-box__header' })
  const titleEl = document.createElement('span', { class: 'el-message-box__title', textContent: title })
  const closeButton = document.createElement('button', {
    type: 'button',
    class: 'el-message-box__headerbtn',
    'aria-label': '关闭此对话框',
  })
  closeButton.append(document.createElement('i', { class: 'el-message-box__close' }))
  header.append(titleEl, closeButton)

  const content = document.createElement('div', { class: 'el-message-box__content' })
  content.append(document.createElement('p', { textContent: message }))
  let input = null
  if (options.showInput) {
    input = document.createElement('input')
    content.append(input)
  }

  const buttons = document.createElement('div', { class: 'el-message-box__btns' })
  const cancelButton = document.createElement('button', {
    type: 'button',
    textContent: cancelButtonText,
  })
  const confirmButton = document.createElement('button', {
    type: 'button',
    class: 'el-button el-button--primary',
    textContent: confirmButtonText,
  })
  buttons.append(cancelButton, confirmButton)
  box.append(header, content, buttons)
  wrap.append(box)
  overlay.append(wrap)
  document.body.append(overlay)

  let settled = false
  let resolve
  let reject
  const closed = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })

  function close(action) {
    if (settled) return
    settled = true
    overlay.remove()
    if (action === 'confirm') resolve(options.showInput ? { value: input?.value || '', action } : action)
    else reject(action)
  }

  closeButton.onclick = () => close('close')
  cancelButton.onclick = () => close('cancel')
  confirmButton.onclick = () => close('confirm')
  box.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close('cancel')
  })

  return { overlay, box, closeButton, cancelButton, confirmButton, input, closed, close }
}

test('包装层不会改写中文按钮文案，并继续导出 confirm/alert/prompt', () => {
  assert.equal(typeof ElMessageBox.confirm, 'function')
  assert.equal(typeof ElMessageBox.alert, 'function')
  assert.equal(typeof ElMessageBox.prompt, 'function')
  assert.equal(typeof installMessageBoxAccessibility, 'function')
  assert.match(feedbackSource, /createMessageBoxFocusSession/)
  assert.match(feedbackSource, /queryOpenMessageBoxes/)
  assert.doesNotMatch(feedbackSource, /confirmButtonText:\s*['"]OK['"]/)
  assert.doesNotMatch(feedbackSource, /cancelButtonText:\s*['"]Cancel['"]/)
  assert.doesNotMatch(feedbackSource, /confirmButtonText:\s*['"]Confirm['"]/)
})

test('打开确认框后焦点离开触发按钮，Esc 可关闭且中文按钮文案不变', async () => {
  const document = new FakeDocument()
  globalThis.document = document
  const { trigger } = mountApp(document)
  assert.equal(document.activeElement, trigger)

  const options = Object.freeze({
    confirmButtonText: '删除',
    cancelButtonText: '取消',
    type: 'warning',
  })
  let received = null
  let ui = null
  ElMessageBox.confirm = (message, title, nextOptions) => {
    received = { message, title, options: nextOptions }
    ui = mountMessageBox(document, {
      message,
      title,
      confirmButtonText: nextOptions.confirmButtonText,
      cancelButtonText: nextOptions.cancelButtonText,
    })
    return ui.closed
  }

  const pending = ElMessageBox.confirm('确定删除该项吗？', '删除确认', options)
  assert.equal(received.message, '确定删除该项吗？')
  assert.equal(received.title, '删除确认')
  assert.equal(received.options, options)
  assert.equal(ui.confirmButton.textContent, '删除')
  assert.equal(ui.cancelButton.textContent, '取消')
  assert.equal(findDialogFocusTarget(ui.box), ui.confirmButton)
  assert.notEqual(document.activeElement, trigger)
  assert.equal(document.activeElement, ui.confirmButton)

  document.activeElement.dispatchEvent({ type: 'keydown', key: 'Escape' })
  await assert.rejects(pending, (error) => error === 'cancel')
  assert.equal(document.activeElement, trigger)
})

test('取消按钮可关闭确认框并回到触发器', async () => {
  const document = new FakeDocument()
  globalThis.document = document
  const { trigger } = mountApp(document)
  let ui = null
  ElMessageBox.confirm = (message, title, options) => {
    ui = mountMessageBox(document, {
      message,
      title,
      confirmButtonText: options.confirmButtonText,
      cancelButtonText: options.cancelButtonText,
    })
    return ui.closed
  }

  const pending = ElMessageBox.confirm('确定删除该项吗？', '删除确认', {
    confirmButtonText: '删除',
    cancelButtonText: '取消',
  })
  assert.equal(ui.cancelButton.textContent, '取消')
  assert.notEqual(document.activeElement, trigger)
  ui.cancelButton.click()
  await assert.rejects(pending, (error) => error === 'cancel')
  assert.equal(document.activeElement, trigger)
})

test('未传入按钮文案时仍使用中文默认值，不会改成英文', async () => {
  const document = new FakeDocument()
  globalThis.document = document
  mountApp(document)
  let received = null
  let ui = null
  ElMessageBox.confirm = (message, title, options) => {
    received = { message, title, options }
    ui = mountMessageBox(document, { message, title })
    return ui.closed
  }

  const pending = ElMessageBox.confirm('确定删除该项吗？', '删除确认')
  assert.equal(received.options, undefined)
  assert.equal(ui.confirmButton.textContent, '确定')
  assert.equal(ui.cancelButton.textContent, '取消')
  ui.close('confirm')
  assert.equal(await pending, 'confirm')
})

test('测试可以直接替换 ElMessageBox.confirm 桩', async () => {
  const calls = []
  ElMessageBox.confirm = async (message, title, options) => {
    calls.push({ message, title, options })
    return 'ok'
  }
  const result = await ElMessageBox.confirm('确定删除？', '删除确认', { confirmButtonText: '删除' })
  assert.equal(result, 'ok')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].message, '确定删除？')
  assert.equal(calls[0].title, '删除确认')
  assert.equal(calls[0].options.confirmButtonText, '删除')
})

test('prompt 打开后焦点落在输入框而不是触发按钮', async () => {
  const document = new FakeDocument()
  globalThis.document = document
  const { trigger } = mountApp(document)
  let ui = null
  ElMessageBox.prompt = (message, title, options) => {
    ui = mountMessageBox(document, {
      message,
      title,
      confirmButtonText: options?.confirmButtonText || '确定',
      cancelButtonText: options?.cancelButtonText || '取消',
      showInput: true,
    })
    return ui.closed
  }

  const pending = ElMessageBox.prompt('工作流名称', '创建工作流', {
    confirmButtonText: '创建',
    cancelButtonText: '取消',
  })
  assert.equal(ui.confirmButton.textContent, '创建')
  assert.equal(ui.cancelButton.textContent, '取消')
  assert.equal(findDialogFocusTarget(ui.box), ui.input)
  assert.notEqual(document.activeElement, trigger)
  assert.equal(document.activeElement, ui.input)
  ui.closeButton.click()
  await assert.rejects(pending, (error) => error === 'close')
  assert.equal(document.activeElement, trigger)
})
