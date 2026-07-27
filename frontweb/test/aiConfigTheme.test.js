import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../src/components/AIConfigContent.vue', import.meta.url), 'utf8')

test('AI config dark theme covers page surfaces, teleported dialogs, controls, tables, and states', () => {
  const dialogTags = [...source.matchAll(/<AccessibleDialog\b[\s\S]*?>/g)].map((match) => match[0])
  assert.ok(dialogTags.length >= 7, 'expected every AI config dialog to be part of the contract')
  assert.ok(
    dialogTags.every((tag) => /class="[^"]*\bai-config-overlay\b[^"]*"/.test(tag)),
    'every teleported AI config dialog must carry the shared theme scope',
  )

  const darkTheme = source.match(
    /html\.dark \.ai-config-content,\s*html\.dark \.ai-config-overlay\s*\{([\s\S]*?)\n\}/,
  )?.[1]
  assert.ok(darkTheme, 'missing shared dark theme variables for the page and dialogs')

  for (const [token, value] of [
    ['--el-bg-color', 'var(--bg-card)'],
    ['--el-fill-color-blank', 'var(--bg-card)'],
    ['--el-fill-color-light', 'var(--bg-inner)'],
    ['--el-text-color-primary', 'var(--text-bright)'],
    ['--el-text-color-regular', 'var(--text-primary)'],
    ['--el-border-color', 'var(--border-muted)'],
    ['--el-table-bg-color', 'var(--bg-card)'],
    ['--el-table-header-bg-color', 'var(--bg-inner)'],
    ['--el-table-row-hover-bg-color', 'var(--bg-hover)'],
  ]) {
    assert.match(darkTheme, new RegExp(`${token}:\\s*${value.replace(/[()]/g, '\\$&')};`))
  }

  for (const tone of ['success', 'warning', 'danger', 'info']) {
    assert.match(darkTheme, new RegExp(`--ai-config-${tone}-surface:`))
    assert.match(darkTheme, new RegExp(`--ai-config-${tone}-text:`))
  }

  assert.match(
    source,
    /html\.dark :is\(\.ai-config-content, \.ai-config-overlay\) :is\([\s\S]*?\.el-input__wrapper[\s\S]*?\.el-select__wrapper[\s\S]*?\.el-textarea__inner[\s\S]*?\.el-input-number[\s\S]*?\)\s*\{[\s\S]*?background:\s*var\(--bg-inner\);/,
  )
  assert.match(
    source,
    /html\.dark :is\(\.ai-config-content, \.ai-config-overlay\) :is\([\s\S]*?\.tab-content[\s\S]*?\.el-scrollbar__wrap[\s\S]*?\.el-table__body-wrapper[\s\S]*?\)\s*\{[\s\S]*?scrollbar-color:\s*var\(--border-muted\) transparent;/,
  )
  assert.match(
    source,
    /html\.dark \.el-dialog:has\(\.ai-config-content\)\s*\{[\s\S]*?--el-dialog-bg-color:\s*var\(--bg-card\);/,
  )
  assert.match(source, /\.coverage-summary-card\.summary-success\s*\{[\s\S]*?var\(--ai-config-success-surface/)
  assert.match(source, /\.config-load-state--error\s*\{[\s\S]*?var\(--ai-config-danger-surface/)
})

test('AI config external links isolate the opener window', () => {
  const externalLinks = [...source.matchAll(/<a\b[^>]*target="_blank"[^>]*>/g)].map((match) => match[0])
  assert.ok(externalLinks.length > 0)
  assert.ok(
    externalLinks.every((tag) => /\brel="noopener noreferrer"/.test(tag)),
    'every target=_blank link must prevent reverse-tabnabbing',
  )
})

test('AI config selected workspace mode uses existing theme tokens', () => {
  const selectedMode = source.match(/\.config-workspace-mode\.active\s*\{([\s\S]*?)\n\}/)?.[1]
  assert.ok(selectedMode, 'missing selected AI configuration workspace mode')
  assert.match(selectedMode, /color:\s*var\(--accent-text\);/)
  assert.match(selectedMode, /border-color:\s*var\(--border-muted\);/)
  assert.match(selectedMode, /background:\s*var\(--bg-hover\);/)
})
