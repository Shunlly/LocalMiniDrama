import test from 'node:test'
import assert from 'node:assert/strict'

import { h, nextTick } from 'vue'

import {
  click,
  createHostRenderer,
  findAll,
  loadCompiledSfc,
  mountHarness,
  textContent,
  vueUrl,
} from './helpers/vueComponentHarness.js'
import { canonicalAtToken, makeDisplayAtToken, omniSlotKindLabel as kindLabel } from '../src/utils/universalSegmentOmniAt.js'

const menuUrl = new URL('../src/components/omniAt/OmniAtMentionMenu.vue', import.meta.url)
const uxUrl = new URL('../src/components/omniAt/omniAtEditorUx.js', import.meta.url).href
const OmniAtMentionMenu = await loadCompiledSfc(menuUrl, 'omni-at-mention-menu', new Map([
  ['vue', vueUrl],
  ['./omniAtEditorUx.js', uxUrl],
]))

const renderer = createHostRenderer()
const slots = [
  { index: 1, kind: 'scene', name: '客厅', thumbUrl: '' },
  { index: 2, kind: 'character', name: '阿明', thumbUrl: 'http://example/a.png' },
]

test('没有参考图时菜单是状态空态，不是可点击占位', async () => {
  const events = []
  const harness = mountHarness(renderer, () => h(OmniAtMentionMenu, {
    slots: [],
    menuStyle: { top: '8px', left: '8px' },
    menuActiveIndex: 0,
    kindLabel,
    menuPrimaryAt: (slot) => makeDisplayAtToken(slot.index, slots),
    canonicalAt: (index) => canonicalAtToken(index),
    onPick: (index) => events.push(['pick', index]),
    onHover: (index) => events.push(['hover', index]),
  }))
  try {
    await nextTick()
    assert.match(textContent(harness.root), /当前没有可用的参考图/)
    const status = findAll(harness.root, (node) => node.props?.role === 'status')
    assert.equal(status.length, 1)
    assert.equal(findAll(harness.root, (node) => node.type === 'button').length, 0)
    const clickableDivs = findAll(harness.root, (node) => ['div', 'span'].includes(node.type) && node.props.onClick)
    assert.equal(clickableDivs.length, 0)
    assert.deepEqual(events, [])
  } finally {
    harness.app.unmount()
  }
})

test('菜单项是原生按钮，点击和悬停都走选项而不是包装层', async () => {
  const events = []
  const harness = mountHarness(renderer, () => h(OmniAtMentionMenu, {
    slots,
    menuStyle: {},
    menuActiveIndex: 1,
    kindLabel,
    menuPrimaryAt: (slot) => makeDisplayAtToken(slot.index, slots),
    canonicalAt: (index) => canonicalAtToken(index),
    onPick: (index) => events.push(['pick', index]),
    onHover: (index) => events.push(['hover', index]),
  }))
  try {
    await nextTick()
    const buttons = findAll(harness.root, (node) => node.type === 'button')
    assert.equal(buttons.length, 2)
    assert.equal(buttons[0].props.role, 'option')
    assert.equal(buttons[1].props['aria-selected'], true)
    assert.match(textContent(buttons[0]), /场景/)
    assert.match(textContent(buttons[0]), /提交 @图片1/)
    click(buttons[1])
    buttons[0].props.onMouseenter?.()
    assert.deepEqual(events, [['pick', 2], ['hover', 0]])
  } finally {
    harness.app.unmount()
  }
})
