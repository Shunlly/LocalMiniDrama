const INTERACTIVE_SELECTOR = [
  'a[href]',
  'button',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  'summary',
  '[contenteditable]:not([contenteditable="false"])',
  '[tabindex]:not([tabindex^="-"])',
].join(',')

function normalizedText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function isElementHidden(element, boundary) {
  const view = element?.ownerDocument?.defaultView
  let current = element
  while (current) {
    if (
      current.hidden
      || current.hasAttribute?.('hidden')
      || current.inert
      || current.hasAttribute?.('inert')
      || current.getAttribute?.('aria-hidden') === 'true'
    ) {
      return true
    }
    const style = view?.getComputedStyle?.(current)
    if (style?.display === 'none' || style?.visibility === 'hidden' || style?.visibility === 'collapse') {
      return true
    }
    if (current === boundary) break
    current = current.parentElement
  }
  return false
}

function isInteractive(element) {
  if (!element || typeof element.focus !== 'function') return false
  if (element.disabled || element.getAttribute?.('aria-disabled') === 'true') return false
  const tabindex = element.getAttribute?.('tabindex')
  if (tabindex != null && Number(tabindex) < 0) return false

  const tagName = element.tagName?.toLowerCase()
  if (tagName === 'a') return element.hasAttribute?.('href')
  if (tagName === 'button' || tagName === 'select' || tagName === 'textarea' || tagName === 'summary') {
    return true
  }
  if (tagName === 'input') return element.getAttribute?.('type') !== 'hidden'
  if (element.hasAttribute?.('contenteditable')) return element.getAttribute('contenteditable') !== 'false'
  return tabindex != null && Number(tabindex) >= 0
}

function isFocusable(element, boundary) {
  if (!isInteractive(element) || isElementHidden(element, boundary)) return false
  if (typeof element.getClientRects === 'function' && element.getClientRects().length === 0) return false
  return true
}

function textFromIds(element, ids) {
  const document = element.ownerDocument
  if (!document?.getElementById) return ''
  return ids
    .split(/\s+/)
    .map((id) => normalizedText(document.getElementById(id)?.textContent))
    .filter(Boolean)
    .join(' ')
}

function associatedLabelText(element) {
  if (element.labels?.length) {
    const labels = Array.from(element.labels)
      .map((label) => normalizedText(label.textContent))
      .filter(Boolean)
    if (labels.length) return labels.join(' ')
  }

  const wrappingLabel = element.closest?.('label')
  const wrappingText = normalizedText(wrappingLabel?.textContent)
  if (wrappingText) return wrappingText

  const id = element.getAttribute?.('id')
  const document = element.ownerDocument
  if (!id || !document?.querySelector) return ''
  const escapedId = globalThis.CSS?.escape ? globalThis.CSS.escape(id) : id.replace(/["\\]/g, '\\$&')
  return normalizedText(document.querySelector(`label[for="${escapedId}"]`)?.textContent)
}

function accessibleName(element) {
  const ariaLabel = normalizedText(element.getAttribute?.('aria-label'))
  if (ariaLabel) return ariaLabel

  const labelledBy = element.getAttribute?.('aria-labelledby')
  const labelledText = labelledBy ? textFromIds(element, labelledBy) : ''
  if (labelledText) return labelledText

  const labelText = associatedLabelText(element)
  if (labelText) return labelText

  const tagName = element.tagName?.toLowerCase()
  const type = element.getAttribute?.('type')?.toLowerCase()
  if (tagName === 'input' && ['button', 'submit', 'reset', 'image'].includes(type)) {
    const inputName = normalizedText(element.getAttribute?.(type === 'image' ? 'alt' : 'value'))
    if (inputName) return inputName
  }

  if (['button', 'a', 'summary'].includes(tagName)) {
    const content = normalizedText(element.textContent)
    if (content) return content
  }

  return normalizedText(element.getAttribute?.('title'))
}

function classListHas(element, className) {
  const list = element?.classList
  if (!list) return false
  if (typeof list.contains === 'function') return list.contains(className)
  if (typeof list.has === 'function') return list.has(className)
  return false
}

function isDialogCloseControl(element, boundary) {
  let current = element
  while (current && current !== boundary) {
    if (classListHas(current, 'el-dialog__headerbtn') || classListHas(current, 'el-dialog__close')) {
      return true
    }
    current = current.parentElement
  }
  const name = accessibleName(element)
  return name === '关闭此对话框' || name === '关闭对话框'
}

function isTextEntryControl(element) {
  const tagName = element.tagName?.toLowerCase()
  if (tagName === 'textarea' || tagName === 'select') return true
  if (element.hasAttribute?.('contenteditable') && element.getAttribute('contenteditable') !== 'false') return true
  if (tagName !== 'input') return false
  const type = (element.getAttribute?.('type') || 'text').toLowerCase()
  return !['button', 'submit', 'reset', 'checkbox', 'radio', 'file', 'hidden', 'image', 'range', 'color'].includes(type)
}

export function findDialogFocusTarget(dialogElement) {
  if (!dialogElement?.querySelectorAll) return null
  const autofocusTarget = Array.from(dialogElement.querySelectorAll('[autofocus]'))
    .find((element) => isFocusable(element, dialogElement))
  if (autofocusTarget) return autofocusTarget

  const candidates = Array.from(dialogElement.querySelectorAll(INTERACTIVE_SELECTOR))
    .filter((element) => isFocusable(element, dialogElement) && !isDialogCloseControl(element, dialogElement))

  const namedField = candidates.find((element) => isTextEntryControl(element) && accessibleName(element))
  if (namedField) return namedField

  const unnamedField = candidates.find((element) => isTextEntryControl(element))
  if (unnamedField) return unnamedField

  return candidates.find((element) => accessibleName(element)) || null
}

function focusElement(element) {
  if (!element || typeof element.focus !== 'function') return false
  try {
    element.focus({ preventScroll: true })
  } catch {
    element.focus()
  }
  return element.ownerDocument?.activeElement === element
}

function dialogLayer(dialogElement) {
  return dialogElement?.closest?.('.el-overlay')
    || dialogElement?.closest?.('[role="dialog"]')
    || dialogElement
}

function captureAttributes(element) {
  return {
    ariaHidden: {
      present: element.hasAttribute('aria-hidden'),
      value: element.getAttribute('aria-hidden'),
    },
    inert: {
      present: element.hasAttribute('inert'),
      value: element.getAttribute('inert'),
      supported: 'inert' in element,
      propertyValue: 'inert' in element ? Boolean(element.inert) : false,
    },
  }
}

function makeInactive(element, snapshots) {
  if (!element?.setAttribute) return
  if (!snapshots.has(element)) snapshots.set(element, captureAttributes(element))
  element.setAttribute('aria-hidden', 'true')
  element.setAttribute('inert', '')
  if ('inert' in element) element.inert = true
}

function restoreAttributes(element, snapshots) {
  const snapshot = snapshots.get(element)
  if (!snapshot) return

  if (snapshot.inert.supported) element.inert = snapshot.inert.propertyValue
  if (snapshot.inert.present) element.setAttribute('inert', snapshot.inert.value)
  else element.removeAttribute('inert')

  if (snapshot.ariaHidden.present) element.setAttribute('aria-hidden', snapshot.ariaHidden.value)
  else element.removeAttribute('aria-hidden')
  snapshots.delete(element)
}

function canRestoreFocus(element) {
  if (!element || typeof element.focus !== 'function' || element.isConnected === false) return false
  return !isElementHidden(element, null)
}

export function createDialogAccessibilityManager(options = {}) {
  const stack = []
  const snapshots = new Map()
  const fixedDocument = options.document
  const appSelector = options.appSelector || '#app'

  const currentDocument = () => fixedDocument || globalThis.document

  function reconcile() {
    const inactiveElements = new Set()
    const document = currentDocument()
    if (stack.length) {
      const app = document?.querySelector?.(appSelector)
      if (app) inactiveElements.add(app)
      for (const entry of stack.slice(0, -1)) {
        if (entry.layerElement) inactiveElements.add(entry.layerElement)
      }
    }

    for (const element of Array.from(snapshots.keys())) {
      if (!inactiveElements.has(element)) restoreAttributes(element, snapshots)
    }
    for (const element of inactiveElements) makeInactive(element, snapshots)
  }

  function register(dialogElement, opener = currentDocument()?.activeElement) {
    if (!dialogElement) return null
    const existing = stack.find((entry) => entry.dialogElement === dialogElement)
    if (existing) return existing.token

    const entry = {
      dialogElement,
      layerElement: dialogLayer(dialogElement),
      opener,
      token: Symbol('accessible-dialog'),
    }
    stack.push(entry)
    reconcile()
    return entry.token
  }

  function focus(token) {
    const entry = stack.at(-1)
    if (!entry || entry.token !== token) return false
    return focusElement(findDialogFocusTarget(entry.dialogElement))
  }

  function unregister(token) {
    if (!token) return false
    const index = stack.findIndex((entry) => entry.token === token)
    if (index < 0) return false
    const wasTop = index === stack.length - 1
    const [entry] = stack.splice(index, 1)
    reconcile()

    if (wasTop) {
      if (!canRestoreFocus(entry.opener) || !focusElement(entry.opener)) {
        const nextEntry = stack.at(-1)
        if (nextEntry && !focus(nextEntry.token)) focusElement(nextEntry.dialogElement)
      }
    }
    return true
  }

  return { focus, register, unregister }
}

export const dialogAccessibility = createDialogAccessibilityManager()
