import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  canonicalAtToken,
  makeDisplayAtToken,
  omniSlotKindLabel,
  toCanonicalOmniText,
} from '../src/utils/universalSegmentOmniAt.js'
import {
  describeCopyDisabledReason,
  insertCanonicalTokenAtAt,
  nextMenuActiveIndex,
  replaceSerializedRange,
  shouldOpenAtMenu,
} from '../src/components/omniAt/omniAtEditorUx.js'

function read(rel) {
  return readFileSync(new URL(rel, import.meta.url), 'utf8')
}

const slots = [
  { index: 1, kind: 'scene', name: '雨巷' },
  { index: 2, kind: 'character', name: '阿明' },
  { index: 3, kind: 'character', name: '阿明' },
  { index: 4, kind: 'free', name: '阿明' },
]

const editorSource = read('../src/components/UniversalSegmentOmniAtEditor.vue')
const menuSource = read('../src/components/omniAt/OmniAtMentionMenu.vue')
const uxSource = read('../src/components/omniAt/omniAtEditorUx.js')
const combined = [editorSource, menuSource, uxSource].join('\n')

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
  assert.match(editorSource, /from '@\/utils\/universalSegmentOmniAt\.js'/)
  assert.match(editorSource, /from '\.\/omniAt\/OmniAtMentionMenu\.vue'/)
  assert.match(editorSource, /@copy="onCopyCanonicalSelection"/)
  assert.match(editorSource, /toCanonicalOmniText/)
  assert.match(editorSource, /onCompositionEnd/)
  assert.match(editorSource, /role="listbox"/)
  assert.match(editorSource, /aria-label="插入参考图"/)
})

test('全能编辑器复制按钮在空内容时给出中文禁用原因，并走按需反馈封装', () => {
  assert.match(editorSource, /from '@\/utils\/elementPlusFeedback\.js'/)
  assert.doesNotMatch(combined, /from 'element-plus'/)
  assert.equal(describeCopyDisabledReason('', slots), '当前没有可复制的提示词')
  assert.equal(describeCopyDisabledReason('   ', slots), '当前没有可复制的提示词')
  assert.equal(describeCopyDisabledReason('@雨巷', slots), '')
  assert.match(uxSource, /当前没有可复制的提示词/)
  assert.match(editorSource, /:disabled="Boolean\(copyDisabledReason\)"/)
  assert.match(editorSource, /:title="copyDisabledReason \|\| undefined"/)
  assert.match(editorSource, /if \(copyDisabledReason\.value\) return/)
})

test('输入 @ 才打开菜单，已完成的 @图片N 和 @@ 不会误开', () => {
  assert.equal(shouldOpenAtMenu('你好@', 3, false), true)
  assert.equal(shouldOpenAtMenu('你好@', 3, true), false)
  assert.equal(shouldOpenAtMenu('@图片1', 4, false), false)
  assert.equal(shouldOpenAtMenu('@@', 2, false), false)
  assert.equal(shouldOpenAtMenu('', 0, false), false)
  assert.deepEqual(insertCanonicalTokenAtAt('请看@', 3, '@图片2'), { next: '请看@图片2', caret: 6 })
  assert.equal(insertCanonicalTokenAtAt('请看@', 2, '@图片2'), null)
  assert.deepEqual(replaceSerializedRange('@图片1 和 @图片2', 0, 4, ''), { next: ' 和 @图片2', caret: 0 })
  assert.equal(nextMenuActiveIndex(0, 1, 3), 1)
  assert.equal(nextMenuActiveIndex(0, -1, 3), 2)
  assert.equal(nextMenuActiveIndex(0, 1, 0), 0)
})
