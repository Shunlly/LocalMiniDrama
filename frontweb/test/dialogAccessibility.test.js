import test from 'node:test'
import assert from 'node:assert/strict'

const utilityUrl = new URL('../src/utils/dialogAccessibility.js', import.meta.url)
const accessibility = await import(utilityUrl).catch(() => null)

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName.toUpperCase()
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
  }

  append(...children) {
    for (const child of children) {
      child.parentElement = this
      this.children.push(child)
    }
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
    return selector.split(',').some((part) => this.matchesSingle(part.trim()))
  }

  matchesSingle(selector) {
    if (selector === '[autofocus]') return this.hasAttribute('autofocus')
    if (selector === '[inert]') return this.hasAttribute('inert') || this.inert
    if (selector === '[aria-hidden="true"]') return this.getAttribute('aria-hidden') === 'true'
    if (selector === '.el-overlay') return this.classList.has('el-overlay')
    if (selector === 'label') return this.tagName === 'LABEL'
    if (selector.startsWith('label[for="')) {
      const id = selector.slice(11, -2)
      return this.tagName === 'LABEL' && this.getAttribute('for') === id
    }
    if (selector.startsWith('#')) return this.getAttribute('id') === selector.slice(1)
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
    return false
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

  getElementById(id) {
    return this.querySelector(`#${id}`)
  }
}

function requireAccessibility() {
  assert.ok(accessibility, 'dialog accessibility utility must exist')
  return accessibility
}

function createDialogLayer(document) {
  const overlay = document.createElement('div', { class: 'el-overlay' })
  const dialog = document.createElement('div', { class: 'el-dialog' })
  overlay.append(dialog)
  document.body.append(overlay)
  return { dialog, overlay }
}

test('autofocus wins over an earlier named interactive control', () => {
  const { findDialogFocusTarget } = requireAccessibility()
  const document = new FakeDocument()
  const { dialog } = createDialogLayer(document)
  const firstButton = document.createElement('button', { 'aria-label': 'Cancel' })
  const autofocusInput = document.createElement('input', { autofocus: '' })
  dialog.append(firstButton, autofocusInput)

  assert.equal(findDialogFocusTarget(dialog), autofocusInput)
})

test('focus selection skips hidden, disabled, and unnamed controls', () => {
  const { findDialogFocusTarget } = requireAccessibility()
  const document = new FakeDocument()
  const { dialog } = createDialogLayer(document)
  const disabled = document.createElement('button', { 'aria-label': 'Disabled', disabled: true })
  const hidden = document.createElement('button', { 'aria-label': 'Hidden' })
  hidden.style.display = 'none'
  const unnamed = document.createElement('input')
  const label = document.createElement('label', { for: 'title', textContent: 'Title' })
  const named = document.createElement('input', { id: 'title' })
  dialog.append(disabled, hidden, unnamed, label, named)

  assert.equal(findDialogFocusTarget(dialog), named)
})

test('nested dialogs isolate the app and every lower dialog layer', () => {
  const { createDialogAccessibilityManager } = requireAccessibility()
  const document = new FakeDocument()
  const app = document.createElement('main', { id: 'app' })
  const outerTrigger = document.createElement('button', { 'aria-label': 'Open dialog' })
  app.append(outerTrigger)
  document.body.append(app)
  outerTrigger.focus()

  const firstLayer = createDialogLayer(document)
  const innerTrigger = document.createElement('button', { 'aria-label': 'Open nested dialog' })
  firstLayer.dialog.append(innerTrigger)
  const manager = createDialogAccessibilityManager({ document })
  const firstToken = manager.register(firstLayer.dialog, outerTrigger)

  assert.equal(app.inert, true)
  assert.equal(app.getAttribute('aria-hidden'), 'true')
  assert.equal(firstLayer.overlay.inert, false)

  innerTrigger.focus()
  const secondLayer = createDialogLayer(document)
  const secondToken = manager.register(secondLayer.dialog, innerTrigger)

  assert.equal(firstLayer.overlay.inert, true)
  assert.equal(firstLayer.overlay.getAttribute('aria-hidden'), 'true')
  assert.equal(secondLayer.overlay.inert, false)

  manager.unregister(secondToken)
  assert.equal(firstLayer.overlay.inert, false)
  assert.equal(firstLayer.overlay.hasAttribute('aria-hidden'), false)
  assert.equal(app.inert, true)
  assert.equal(document.activeElement, innerTrigger)

  manager.unregister(firstToken)
  assert.equal(app.inert, false)
  assert.equal(app.hasAttribute('aria-hidden'), false)
  assert.equal(document.activeElement, outerTrigger)
})

test('attribute snapshots are restored exactly after close and out-of-order cleanup', () => {
  const { createDialogAccessibilityManager } = requireAccessibility()
  const document = new FakeDocument()
  const app = document.createElement('main', { id: 'app' })
  app.setAttribute('aria-hidden', 'false')
  document.body.append(app)
  const firstLayer = createDialogLayer(document)
  firstLayer.overlay.setAttribute('aria-hidden', 'legacy')
  const secondLayer = createDialogLayer(document)
  const manager = createDialogAccessibilityManager({ document })

  const firstToken = manager.register(firstLayer.dialog, null)
  const secondToken = manager.register(secondLayer.dialog, null)
  assert.equal(firstLayer.overlay.getAttribute('aria-hidden'), 'true')

  manager.unregister(firstToken)
  assert.equal(firstLayer.overlay.getAttribute('aria-hidden'), 'legacy')
  assert.equal(firstLayer.overlay.inert, false)
  assert.equal(app.getAttribute('aria-hidden'), 'true')

  manager.unregister(secondToken)
  assert.equal(app.getAttribute('aria-hidden'), 'false')
  assert.equal(app.inert, false)
})
