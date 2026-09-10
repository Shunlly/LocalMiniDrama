import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { remainingExtractNamedFunction } from './helpers/remainingSourceBetween.js'

const source = readFileSync(new URL('../src/components/PromptEditor.vue', import.meta.url), 'utf8')

function templateOnly(vueSource) {
  const start = vueSource.indexOf('<template')
  const end = vueSource.indexOf('<script', start)
  assert.ok(start >= 0 && end > start, '组件必须包含 template 与 script')
  return vueSource.slice(start, end)
}

function openingTags(fragment, tagNames) {
  const names = new Set(tagNames)
  const tags = []
  const matcher = /<([A-Za-z][\w-]*)\b/g
  let match
  while ((match = matcher.exec(fragment))) {
    if (!names.has(match[1])) continue
    let quote = ''
    let index = matcher.lastIndex
    for (; index < fragment.length; index += 1) {
      const character = fragment[index]
      if (quote) {
        if (character === quote) quote = ''
      } else if (character === '"' || character === "'") quote = character
      else if (character === '>') break
    }
    tags.push(fragment.slice(match.index, index + 1))
    matcher.lastIndex = index + 1
  }
  return tags
}

const template = templateOnly(source)
const describeSaveDisabledReason = new Function(
  `'use strict'; ${remainingExtractNamedFunction(source, 'describeSaveDisabledReason')}; return describeSaveDisabledReason;`,
)()
const describeResetDisabledReason = new Function(
  `'use strict'; ${remainingExtractNamedFunction(source, 'describeResetDisabledReason')}; return describeResetDisabledReason;`,
)()

test('提示词侧栏项可 Tab 聚焦并用 Enter/Space 选中', () => {
  const menuItems = openingTags(template, ['button']).filter((tag) => tag.includes('v-for="p in prompts"'))
  assert.equal(menuItems.length, 1)
  assert.match(menuItems[0], /type="button"/)
  assert.match(menuItems[0], /tabindex="0"/)
  assert.match(menuItems[0], /@click="selectPrompt\(p\.key\)"/)
  assert.match(menuItems[0], /@keydown\.enter\.prevent="selectPrompt\(p\.key\)"/)
  assert.match(menuItems[0], /@keydown\.space\.prevent="selectPrompt\(p\.key\)"/)
  assert.match(source, /aria-label="提示词列表"/)
  assert.match(source, /\.menu-item:focus-visible/)
  assert.doesNotMatch(source, /from '@\/api\/prompts'[\s\S]*promptsAPI\.(create|delete)/)

  const clickableDivs = openingTags(template, ['div', 'span', 'li', 'p', 'article', 'section']).filter((tag) => /@click/.test(tag))
  assert.deepEqual(clickableDivs, [])
})

test('保存和恢复默认禁用时给出中文原因', () => {
  const prompt = { key: 'story_system', is_customized: false }
  assert.equal(describeSaveDisabledReason(prompt, false), '当前没有未保存的修改')
  assert.equal(describeSaveDisabledReason(prompt, true), '')
  assert.equal(describeSaveDisabledReason(null, false), '当前没有可保存的提示词')
  assert.equal(describeResetDisabledReason(prompt, false), '当前已是系统默认提示词，无需恢复')
  assert.equal(describeResetDisabledReason(prompt, true), '')
  assert.equal(describeResetDisabledReason({ ...prompt, is_customized: true }, false), '')
  assert.equal(describeResetDisabledReason(null, false), '当前没有可恢复的提示词')

  for (const reason of [
    describeSaveDisabledReason(prompt, false),
    describeSaveDisabledReason(null, false),
    describeResetDisabledReason(prompt, false),
    describeResetDisabledReason(null, false),
  ]) {
    assert.match(reason, /[\u4e00-\u9fff]/)
    assert.doesNotMatch(reason, /save|reset|dirty|prompt|default|system/i)
  }

  const saveButton = openingTags(template, ['el-button']).find((tag) => tag.includes('@click="save(currentPrompt)"'))
  const resetButton = openingTags(template, ['el-button']).find((tag) => tag.includes('@click="reset(currentPrompt)"'))
  assert.ok(saveButton)
  assert.ok(resetButton)
  assert.match(saveButton, /:disabled="Boolean\(saveDisabledReason\)"/)
  assert.match(saveButton, /:title="saveDisabledReason \|\| undefined"/)
  assert.match(saveButton, /:aria-label="saveDisabledReason \? `保存不可用：\${saveDisabledReason}` : undefined"/)
  assert.match(resetButton, /:disabled="Boolean\(resetDisabledReason\)"/)
  assert.match(resetButton, /:title="resetDisabledReason \|\| undefined"/)
  assert.match(resetButton, /:aria-label="resetDisabledReason \? `恢复默认不可用：\${resetDisabledReason}` : undefined"/)
})

test('说明文案使用系统提示词，不再出现 System Prompt', () => {
  assert.match(source, /可自定义 AI 生成各阶段使用的系统提示词。/)
  assert.doesNotMatch(source, /System Prompt/)
  assert.match(source, /from '@\/api\/prompts'/)
  assert.match(source, /promptsAPI\.list\(\)/)
  assert.match(source, /promptsAPI\.update\(p\.key, content\.trim\(\)\)/)
  assert.match(source, /promptsAPI\.reset\(p\.key\)/)
})
