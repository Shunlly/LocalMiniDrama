import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

function readSource(url) {
  return readFileSync(url, 'utf8').replace(/\r\n?/g, '\n')
}

const source = readSource(new URL('../src/components/AIConfigContent.vue', import.meta.url))
const requestError = readSource(new URL('../src/utils/requestError.js', import.meta.url))

function sourceBetween(start, end) {
  const startIndex = source.indexOf(start)
  const endIndex = source.indexOf(end, startIndex + start.length)
  assert.ok(startIndex >= 0, `missing ${start}`)
  assert.ok(endIndex > startIndex, `missing ${end}`)
  return source.slice(startIndex, endIndex)
}

test('AI 配置页在卸载和重新加载时取消过期请求', () => {
  assert.match(source, /from '@\/utils\/requestError'/)
  assert.match(source, /function abortAiConfigPageRequests\(\)/)
  assert.match(source, /onBeforeUnmount\(\(\) => \{\s*abortAiConfigPageRequests\(\)/)
  assert.match(source, /restoreTestedCoverageCardFocus\(\) \{\s*connectionTestAbortController\?\.abort\(\)/)

  const loaders = [
    sourceBetween('async function loadList()', 'function parseModelText'),
    sourceBetween('async function loadVendorLock()', 'async function retryConfigDependencies'),
  ]
  for (const loader of loaders) {
    assert.match(loader, /AbortController/)
    assert.match(loader, /withRequestRetry/)
    assert.match(loader, /isRequestCanceled/)
    assert.match(loader, /describeServiceLoadError/)
  }
  const generationLoader = sourceBetween('async function loadGenerationSettings', 'function onConcurrencyChange')
  assert.match(generationLoader, /AbortController/)
  assert.match(generationLoader, /loadGenerationSettingsPayload/)
  assert.match(generationLoader, /shouldIgnoreGenerationSettingsError/)
  assert.match(generationLoader, /describeGenerationSettingsLoadError/)
  assert.match(source, /function jsonRequestOptions\(signal/)
  assert.match(source, /suppressErrorToast: true/)
})

test('连接测试失败可重试且取消不会记成失败', () => {
  const connectionTest = sourceBetween('async function openTest', 'async function onDelete')
  assert.match(connectionTest, /function retryConnectionTest/)
  assert.match(source, /@click="retryConnectionTest"/)
  assert.match(connectionTest, /if \(isRequestCanceled\(e\) \|\| controller\.signal\.aborted\) \{[\s\S]*?return/)
  const cancelIdx = connectionTest.indexOf('isRequestCanceled(e)')
  const returnIdx = connectionTest.indexOf('return', cancelIdx)
  const failedIdx = connectionTest.indexOf("connectionStatusStore.set(row.id, 'failed'")
  assert.ok(cancelIdx >= 0 && returnIdx > cancelIdx && returnIdx < failedIdx)
})

test('requestError 把超时 abort 视为可重试超时而不是取消', () => {
  assert.match(requestError, /if \(isRequestTimeout\(error, signal\)\) return false/)
  assert.match(requestError, /timeoutFromAbortSignal\(error\?\.config\?\.signal\)/)
  assert.match(requestError, /if \(isRequestTimeout\(error, signal\)\) return true/)
})
