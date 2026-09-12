import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { remainingExtractNamedFunction } from './helpers/remainingSourceBetween.js'

function read(rel) {
  return readFileSync(new URL(rel, import.meta.url), 'utf8')
}

const parentSource = read('../src/components/PromptEditor.vue')
const sidebarSource = read('../src/components/promptEditor/PromptEditorSidebar.vue')
const paneSource = read('../src/components/promptEditor/PromptEditorPane.vue')
const combined = [parentSource, sidebarSource, paneSource].join('\n')

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

const parentTemplate = templateOnly(parentSource)
const sidebarTemplate = templateOnly(sidebarSource)
const paneTemplate = templateOnly(paneSource)
const combinedTemplate = `${parentTemplate}\n${sidebarTemplate}\n${paneTemplate}`
const describeSaveDisabledReason = new Function(
  `'use strict'; ${remainingExtractNamedFunction(parentSource, 'describeSaveDisabledReason')}; return describeSaveDisabledReason;`,
)()
const describeResetDisabledReason = new Function(
  `'use strict'; ${remainingExtractNamedFunction(parentSource, 'describeResetDisabledReason')}; return describeResetDisabledReason;`,
)()

test('提示词侧栏项可 Tab 聚焦并用 Enter/Space 选中', () => {
  const menuItems = openingTags(sidebarTemplate, ['button']).filter((tag) => tag.includes('v-for="p in prompts"'))
  assert.equal(menuItems.length, 1)
  assert.match(menuItems[0], /type="button"/)
  assert.match(menuItems[0], /tabindex="0"/)
  assert.match(menuItems[0], /@click="selectPrompt\(p\.key\)"/)
  assert.match(menuItems[0], /@keydown\.enter\.prevent="selectPrompt\(p\.key\)"/)
  assert.match(menuItems[0], /@keydown\.space\.prevent="selectPrompt\(p\.key\)"/)
  assert.match(sidebarSource, /aria-label="提示词列表"/)
  assert.match(sidebarSource, /\.menu-item:focus-visible/)
  assert.match(parentSource, /<PromptEditorSidebar[\s\S]*:select-prompt="selectPrompt"/)
  assert.doesNotMatch(parentSource, /from '@\/api\/prompts'[\s\S]*promptsAPI\.(create|delete)/)

  const clickableDivs = openingTags(combinedTemplate, ['div', 'span', 'li', 'p', 'article', 'section']).filter((tag) => /@click/.test(tag))
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

  const saveButton = openingTags(paneTemplate, ['el-button']).find((tag) => tag.includes("@click=\"$emit('save')\""))
  const resetButton = openingTags(paneTemplate, ['el-button']).find((tag) => tag.includes("@click=\"$emit('reset')\""))
  assert.ok(saveButton)
  assert.ok(resetButton)
  assert.match(saveButton, /:disabled="Boolean\(saveDisabledReason\)"/)
  assert.match(saveButton, /:title="saveDisabledReason \|\| undefined"/)
  assert.match(saveButton, /:aria-label="saveDisabledReason \? `保存不可用：\${saveDisabledReason}` : undefined"/)
  assert.match(resetButton, /:disabled="Boolean\(resetDisabledReason\)"/)
  assert.match(resetButton, /:title="resetDisabledReason \|\| undefined"/)
  assert.match(resetButton, /:aria-label="resetDisabledReason \? `恢复默认不可用：\${resetDisabledReason}` : undefined"/)
  assert.match(parentTemplate, /@save="save\(currentPrompt\)"/)
  assert.match(parentTemplate, /@reset="reset\(currentPrompt\)"/)
})

test('说明文案使用系统提示词，不再出现 System Prompt', () => {
  assert.match(parentSource, /可自定义 AI 生成各阶段使用的系统提示词。/)
  assert.doesNotMatch(combined, /System Prompt/)
  assert.match(parentSource, /from '@\/utils\/elementPlusFeedback\.js'/)
  assert.doesNotMatch(combined, /from 'element-plus'/)
  assert.match(parentSource, /from '@\/api\/prompts'/)
  assert.match(parentSource, /promptsAPI\.list\(\)/)
  assert.match(parentSource, /promptsAPI\.update\(p\.key, content\.trim\(\)\)/)
  assert.match(parentSource, /promptsAPI\.reset\(p\.key\)/)
  assert.match(parentSource, /isUserFacingAbort/)
  assert.match(parentSource, /保存提示词失败，请稍后重试/)
  assert.match(parentSource, /恢复默认失败，请稍后重试/)
})

test('加载失败不伪装成空列表，成功且无数据才显示空态', () => {
  assert.match(parentSource, /const loadError = ref\(''\)/)
  assert.match(parentSource, /const hasSuccessfulLoad = ref\(false\)/)
  assert.match(parentSource, /v-if="loading && !hasSuccessfulLoad"/)
  assert.match(parentSource, /aria-label="重新加载提示词"/)
  assert.match(parentSource, /description="暂无系统提示词"/)
  assert.match(parentSource, /v-if="hasSuccessfulLoad && !loadError && !prompts\.length"/)
  assert.match(parentSource, /v-else-if="hasSuccessfulLoad"/)
  assert.match(parentSource, /description="请选择一条提示词"/)
  assert.match(parentSource, /ElMessage\.error\('加载提示词失败'\)/)
})
