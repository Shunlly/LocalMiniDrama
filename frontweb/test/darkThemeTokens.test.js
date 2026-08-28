import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../src/styles/theme.css', import.meta.url), 'utf8')

test('dark theme maps Element Plus surfaces and text to the product tokens', () => {
  const darkTokens = source.match(/:root,\s*\n?html\.dark\s*\{([\s\S]*?)\n\}/)?.[1]
  assert.ok(darkTokens, 'the default dark token block must remain explicit')

  for (const [token, value] of [
    ['--el-bg-color', 'var(--bg-card)'],
    ['--el-bg-color-page', 'var(--bg-page)'],
    ['--el-bg-color-overlay', 'var(--bg-card)'],
    ['--el-text-color-primary', 'var(--text-primary)'],
    ['--el-text-color-regular', 'var(--text-primary)'],
    ['--el-text-color-secondary', 'var(--text-muted)'],
    ['--el-border-color', 'var(--border-color)'],
    ['--el-fill-color', 'var(--bg-inner)'],
    ['--el-fill-color-blank', 'var(--bg-card)'],
    ['--el-fill-color-light', 'var(--bg-hover)'],
    ['--el-color-warning-light-9', 'rgba(245, 158, 11, .14)'],
  ]) {
    assert.match(darkTokens, new RegExp(`${token}:\\s*${value.replace(/[()]/g, '\\$&')};`))
  }
})
