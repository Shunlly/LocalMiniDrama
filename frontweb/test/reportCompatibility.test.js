import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

const legacyReportUrl = new URL('../public/reports/ui-flow-20260710/report.html', import.meta.url)
const historicalReportUrl = new URL('../public/reports/ui-flow-20260710-final/report.html', import.meta.url)

test('the published legacy report URL resolves to the retained historical report', () => {
  assert.equal(existsSync(legacyReportUrl), true)
  assert.equal(existsSync(historicalReportUrl), true)
  const source = readFileSync(legacyReportUrl, 'utf8')
  assert.ok(source.includes('url=../ui-flow-20260710-final/report.html'))
  assert.ok(source.includes('href="../ui-flow-20260710-final/report.html"'))
  assert.match(source, /历史验收报告/)
})

test('the historical report cannot be mistaken for current release approval', () => {
  const source = readFileSync(historicalReportUrl, 'utf8')
  assert.match(source, /历史基线，非当前发布批准/)
  assert.doesNotMatch(source, /<p>允许合入并发布本轮/)
  assert.match(source, /不能作为当前版本的发布批准/)
})
