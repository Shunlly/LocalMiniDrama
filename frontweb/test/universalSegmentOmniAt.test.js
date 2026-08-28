import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  canonicalAtToken,
  makeDisplayAtToken,
  omniSlotKindLabel,
  toCanonicalOmniText,
} from '../src/utils/universalSegmentOmniAt.js'

const slots = [
  { index: 1, kind: 'scene', name: '雨巷' },
  { index: 2, kind: 'character', name: '阿明' },
  { index: 3, kind: 'character', name: '阿明' },
  { index: 4, kind: 'free', name: '阿明' },
]

test('无效或空索引不会回落到 @图片1', () => {
  assert.equal(canonicalAtToken(0), '')
  assert.equal(canonicalAtToken(-2), '')
  assert.equal(canonicalAtToken('x'), '')
  assert.equal(canonicalAtToken(null), '')
  assert.equal(makeDisplayAtToken(0, slots), '')
  assert.equal(canonicalAtToken('2'), '@图片2')
})

test('同名角色与自由参考图使用不同展示前缀，仍映射回各自的 @图片N', () => {
  assert.equal(omniSlotKindLabel('free'), '参考')
  assert.equal(makeDisplayAtToken(1, slots), '@雨巷')
  assert.equal(makeDisplayAtToken(2, slots), '@角色·阿明·2')
  assert.equal(makeDisplayAtToken(3, slots), '@角色·阿明·3')
  assert.equal(makeDisplayAtToken(4, slots), '@参考·阿明')
  assert.equal(
    toCanonicalOmniText('@雨巷里 @角色·阿明·3 看向 @参考·阿明', slots),
    '@图片1里 @图片3 看向 @图片4',
  )
})

test('粘贴展示名或规范名都能还原，且 @图片12 不会被 @图片1 吞掉', () => {
  const mixedSlots = [
    { index: 1, kind: 'scene', name: '客厅' },
    { index: 12, kind: 'character', name: '阿珍' },
  ]
  assert.equal(toCanonicalOmniText('', mixedSlots), '')
  assert.equal(toCanonicalOmniText('@客厅 @图片12 出门', mixedSlots), '@图片1 @图片12 出门')
  assert.equal(toCanonicalOmniText('@阿珍挥手', mixedSlots), '@图片12挥手')
  assert.equal(toCanonicalOmniText('@图片12', [{ index: '12', kind: 'prop', name: '杯' }]), '@图片12')
})

test('全能编辑器会拦截复制粘贴并走规范 @图片N 转换', () => {
  const source = readFileSync(new URL('../src/components/UniversalSegmentOmniAtEditor.vue', import.meta.url), 'utf8')
  assert.match(source, /from '@\/utils\/universalSegmentOmniAt\.js'/)
  assert.match(source, /@copy="onCopyCanonicalSelection"/)
  assert.match(source, /toCanonicalOmniText/)
  assert.match(source, /onCompositionEnd/)
})
