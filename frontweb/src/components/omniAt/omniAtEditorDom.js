import {
  canonicalAtToken,
  makeDisplayAtToken,
  toCanonicalOmniText,
} from '@/utils/universalSegmentOmniAt.js'
import { describeChipAriaLabel } from './omniAtEditorUx.js'

export const OMNI_AT_CHIP_CLASS = 'omni-at-chip'
const TEXT_NODE = 3
const ELEMENT_NODE = 1

export function createOmniChipElement(doc, {
  index,
  display,
  canonical,
  chipClass = OMNI_AT_CHIP_CLASS,
} = {}) {
  const span = doc.createElement('span')
  span.className = chipClass
  span.contentEditable = 'false'
  span.dataset.n = String(Number(index))
  span.textContent = display
  span.setAttribute('role', 'button')
  span.setAttribute('tabindex', '0')
  span.setAttribute('aria-label', describeChipAriaLabel(display, canonical))
  return span
}

export function updateOmniChipDisplay(chip, { index, display, canonical }) {
  if (!chip) return
  chip.dataset.n = String(index)
  chip.textContent = display
  chip.setAttribute('aria-label', describeChipAriaLabel(display, canonical))
}

export function serializeOmniEditor(el, { chipClass = OMNI_AT_CHIP_CLASS } = {}) {
  if (!el) return ''
  let out = ''
  function walk(node) {
    if (node.nodeType === TEXT_NODE) {
      out += node.nodeValue || ''
      return
    }
    if (node.nodeType === ELEMENT_NODE) {
      if (node.classList?.contains(chipClass)) {
        out += canonicalAtToken(node.dataset?.n) || ''
        return
      }
      for (const child of node.childNodes) walk(child)
    }
  }
  walk(el)
  return out.replace(/\u00a0/g, ' ')
}

export function applyPlainTextToOmniEditor(el, text, slots, {
  chipClass = OMNI_AT_CHIP_CLASS,
  bindChip,
} = {}) {
  if (!el) return
  const doc = el.ownerDocument || globalThis.document
  const raw = toCanonicalOmniText(text, slots)
  el.innerHTML = ''
  if (!raw) return
  const re = /@图片(\d+)/g
  let last = 0
  let match
  while ((match = re.exec(raw)) !== null) {
    const canonical = canonicalAtToken(match[1])
    if (!canonical) continue
    if (match.index > last) el.appendChild(doc.createTextNode(raw.slice(last, match.index)))
    const span = createOmniChipElement(doc, {
      index: match[1],
      display: makeDisplayAtToken(match[1], slots),
      canonical,
      chipClass,
    })
    bindChip?.(span)
    el.appendChild(span)
    last = match.index + match[0].length
  }
  if (last < raw.length) el.appendChild(doc.createTextNode(raw.slice(last)))
}

function chipCanonicalLength(node, chipClass = OMNI_AT_CHIP_CLASS) {
  if (!node?.classList?.contains(chipClass)) return 0
  return (canonicalAtToken(node.dataset?.n) || '').length
}

export function measureCanonicalPrefix(el, endContainer, endOffset, { chipClass = OMNI_AT_CHIP_CLASS } = {}) {
  const range = el.ownerDocument.createRange()
  range.selectNodeContents(el)
  range.setEnd(endContainer, endOffset)
  let len = 0
  function measure(node) {
    if (node.nodeType === TEXT_NODE) len += (node.textContent || '').length
    else if (node.nodeType === ELEMENT_NODE) {
      if (node.classList?.contains(chipClass)) len += chipCanonicalLength(node, chipClass)
      else node.childNodes.forEach(measure)
    }
  }
  range.cloneContents().childNodes.forEach(measure)
  return len
}

export function getCaretCanonicalOffset(el, options) {
  const win = el?.ownerDocument?.defaultView || globalThis.window
  const sel = win.getSelection()
  if (!sel || sel.rangeCount === 0 || !el) return 0
  const range = sel.getRangeAt(0)
  return measureCanonicalPrefix(el, range.endContainer, range.endOffset, options)
}

export function getCanonicalSelection(el, options) {
  const win = el?.ownerDocument?.defaultView || globalThis.window
  const sel = win.getSelection()
  if (!sel || sel.rangeCount === 0 || !el) {
    const off = getCaretCanonicalOffset(el, options)
    return { start: off, end: off }
  }
  const range = sel.getRangeAt(0)
  const a = measureCanonicalPrefix(el, range.startContainer, range.startOffset, options)
  const b = measureCanonicalPrefix(el, range.endContainer, range.endOffset, options)
  return { start: Math.min(a, b), end: Math.max(a, b) }
}

export function serializeOmniSelection(el, options) {
  const win = el?.ownerDocument?.defaultView || globalThis.window
  const sel = win.getSelection()
  if (!sel || sel.rangeCount === 0 || !el) return serializeOmniEditor(el, options)
  const range = sel.getRangeAt(0)
  if (range.collapsed) return serializeOmniEditor(el, options)
  const holder = el.ownerDocument.createElement('div')
  holder.appendChild(range.cloneContents())
  return serializeOmniEditor(holder, options)
}

export function setCaretCanonicalOffset(el, target, { chipClass = OMNI_AT_CHIP_CLASS } = {}) {
  if (!el || target < 0) return
  const doc = el.ownerDocument
  const sel = (doc.defaultView || globalThis.window).getSelection()
  const range = doc.createRange()
  let seen = 0
  let placed = false

  function walk(node) {
    if (placed) return
    if (node.nodeType === TEXT_NODE) {
      const length = (node.nodeValue || '').length
      if (seen + length >= target) {
        range.setStart(node, Math.min(target - seen, length))
        range.collapse(true)
        placed = true
        return
      }
      seen += length
      return
    }
    if (node.nodeType === ELEMENT_NODE && node.classList?.contains(chipClass)) {
      const length = chipCanonicalLength(node, chipClass)
      if (seen + length >= target) {
        if (target <= seen) range.setStartBefore(node)
        else range.setStartAfter(node)
        range.collapse(true)
        placed = true
        return
      }
      seen += length
      return
    }
    for (const child of node.childNodes) walk(child)
  }

  for (const child of el.childNodes) walk(child)
  if (!placed) {
    range.selectNodeContents(el)
    range.collapse(false)
  }
  sel.removeAllRanges()
  sel.addRange(range)
}

export function refreshOmniChipLabels(el, slots, { chipClass = OMNI_AT_CHIP_CLASS } = {}) {
  if (!el) return
  el.querySelectorAll('.' + chipClass).forEach((chip) => {
    if (!chip?.dataset) return
    const n = chip.dataset.n
    if (n == null) return
    const display = makeDisplayAtToken(n, slots)
    const canonical = canonicalAtToken(n)
    updateOmniChipDisplay(chip, { index: n, display, canonical })
  })
}