import test from 'node:test'
import assert from 'node:assert/strict'

import {
  applyPlainTextToOmniEditor,
  OMNI_AT_CHIP_CLASS,
  refreshOmniChipLabels,
  serializeOmniEditor,
} from '../src/components/omniAt/omniAtEditorDom.js'
import { describeChipAriaLabel } from '../src/components/omniAt/omniAtEditorUx.js'

function createFakeDoc() {
  function createElement(tag) {
    const attrs = {}
    const dataset = {}
    const el = {
      nodeType: 1,
      tagName: String(tag).toUpperCase(),
      className: '',
      contentEditable: 'true',
      textContent: '',
      childNodes: [],
      dataset,
      ownerDocument: null,
      classList: {
        contains(name) {
          return String(el.className).split(/\s+/).includes(name)
        },
      },
      setAttribute(key, value) { attrs[key] = String(value) },
      getAttribute(key) { return attrs[key] },
      appendChild(child) {
        el.childNodes.push(child)
        return child
      },
      addEventListener() {},
      querySelectorAll(selector) {
        const cls = String(selector).replace(/^\./, '')
        const out = []
        function walk(node) {
          if (node.nodeType === 1 && node.classList.contains(cls)) out.push(node)
          for (const child of node.childNodes || []) walk(child)
        }
        walk(el)
        return out
      },
    }
    Object.defineProperty(el, 'innerHTML', {
      set() {
        el.childNodes = []
        el.textContent = ''
      },
      get() { return '' },
    })
    return el
  }
  return {
    createElement,
    createTextNode(value) {
      return { nodeType: 3, nodeValue: value, textContent: value, childNodes: [] }
    },
  }
}

function createEditor() {
  const doc = createFakeDoc()
  const el = doc.createElement('div')
  el.ownerDocument = doc
  return el
}

const slots = [
  { index: 1, kind: 'scene', name: '客厅' },
  { index: 12, kind: 'character', name: '阿珍' },
]

test('把展示名写成芯片后序列化仍是 @图片N，且 @图片12 不会被 @图片1 吞掉', () => {
  const el = createEditor()
  const bound = []
  applyPlainTextToOmniEditor(el, '@客厅 看向 @阿珍', slots, {
    bindChip(chip) { bound.push(chip.dataset.n) },
  })
  assert.deepEqual(bound, ['1', '12'])
  assert.equal(serializeOmniEditor(el), '@图片1 看向 @图片12')
  const chips = el.querySelectorAll('.' + OMNI_AT_CHIP_CLASS)
  assert.equal(chips[0].getAttribute('role'), 'button')
  assert.equal(chips[0].getAttribute('tabindex'), '0')
  assert.equal(chips[0].getAttribute('aria-label'), describeChipAriaLabel('@客厅', '@图片1'))
  assert.equal(chips[1].getAttribute('aria-label'), describeChipAriaLabel('@阿珍', '@图片12'))
})

test('空内容和无效索引不会生成芯片', () => {
  const el = createEditor()
  applyPlainTextToOmniEditor(el, '', slots)
  assert.equal(serializeOmniEditor(el), '')
  applyPlainTextToOmniEditor(el, '@图片0 无效', slots)
  assert.equal(serializeOmniEditor(el), '@图片0 无效')
})

test('槽位改名后刷新芯片标签，仍按 index 而不是名称串台', () => {
  const el = createEditor()
  applyPlainTextToOmniEditor(el, '@图片1 @图片12', slots)
  refreshOmniChipLabels(el, [
    { index: 1, kind: 'scene', name: '雨巷' },
    { index: 12, kind: 'character', name: '阿珍' },
  ])
  const chips = el.querySelectorAll('.' + OMNI_AT_CHIP_CLASS)
  assert.equal(chips[0].textContent, '@雨巷')
  assert.equal(chips[1].textContent, '@阿珍')
  assert.equal(serializeOmniEditor(el), '@图片1 @图片12')
})
