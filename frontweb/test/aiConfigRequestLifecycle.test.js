import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

function readSource(url) {
  return readFileSync(url, 'utf8').replace(/\r\n?/g, '\n')
}

const source = readSource(new URL('../src/components/AIConfigContent.vue', import.meta.url))
const connectionDialogSource = readSource(new URL('../src/components/aiConfig/AiConfigConnectionTestDialog.vue', import.meta.url))
const generationSettingsSource = readSource(new URL('../src/composables/useAiConfigGenerationSettings.js', import.meta.url))
const connectionTestSource = readSource(new URL('../src/utils/aiConfigConnectionTest.js', import.meta.url))
const vendorLockSource = readSource(new URL('../src/composables/useAiConfigVendorLock.js', import.meta.url))
const pageRequestsSource = readSource(new URL('../src/composables/useAiConfigPageRequests.js', import.meta.url))
const requestOptionsSource = readSource(new URL('../src/utils/aiConfigRequestOptions.js', import.meta.url))
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
  assert.match(pageRequestsSource, /function abortAiConfigPageRequests\(\)/)
  assert.match(source, /onBeforeUnmount\(\(\) => \{\s*abortAiConfigPageRequests\(\)/)
  assert.match(source, /restoreTestedCoverageCardFocus\(\) \{\s*connectionTestAbortController\?\.abort\(\)/)

  const listLoader = sourceBetween('async function loadList()', 'async function openTest')
  const vendorStart = vendorLockSource.indexOf('async function loadVendorLock')
  const vendorEnd = vendorLockSource.indexOf('return {', vendorStart)
  assert.ok(vendorStart >= 0 && vendorEnd > vendorStart)
  const vendorLoader = vendorLockSource.slice(vendorStart, vendorEnd)
  for (const loader of [listLoader, vendorLoader]) {
    assert.match(loader, /AbortController/)
    assert.match(loader, /withRequestRetry/)
    assert.match(loader, /isRequestCanceled/)
    assert.match(loader, /describeServiceLoadError/)
  }
  assert.match(source, /abortVendorLockRequest\(\)/)
  assert.doesNotMatch(source, /vendorLockAbortController/)
  assert.match(source, /abortGenerationSettingsRequest\(\)/)
  assert.doesNotMatch(source, /generationSettingsAbortController/)
  assert.match(source, /abortDiscoverModelsRequest\(\)/)
  assert.doesNotMatch(source, /discoverModelsAbortController/)
  const generationStart = generationSettingsSource.indexOf('async function loadGenerationSettings')
  const generationEnd = generationSettingsSource.indexOf('function onConcurrencyChange', generationStart)
  assert.ok(generationStart >= 0 && generationEnd > generationStart)
  const generationLoader = generationSettingsSource.slice(generationStart, generationEnd)
  assert.match(generationLoader, /AbortController/)
  assert.match(generationLoader, /loadGenerationSettingsPayload/)
  assert.match(generationLoader, /shouldIgnoreGenerationSettingsError/)
  assert.match(generationLoader, /describeGenerationSettingsLoadError/)
  assert.match(requestOptionsSource, /function jsonRequestOptions\(signal/)
  assert.match(requestOptionsSource, /suppressErrorToast: true/)
})

test('连接测试失败可重试且取消不会记成失败', () => {
  const connectionTest = sourceBetween('async function openTest', 'const {')
  assert.match(pageRequestsSource, /function retryConnectionTest/)
  assert.match(connectionDialogSource, /@click="retryConnectionTest"/)
  assert.match(source, /:retry-connection-test="retryConnectionTest"/)
  assert.match(connectionTest, /if \(isUserFacingAbort\(e, controller\.signal\)\) \{[\s\S]*?return/)
  assert.doesNotMatch(connectionTest, /controller\.signal\.aborted/)
  assert.match(connectionTestSource, /toUserFacingError\(error, '暂时无法完成连接测试，请稍后重试。'/)
  const cancelIdx = connectionTest.indexOf('isUserFacingAbort(e, controller.signal)')
  const returnIdx = connectionTest.indexOf('return', cancelIdx)
  const failedIdx = connectionTest.indexOf("connectionStatusStore.set(row.id, 'failed'")
  assert.ok(cancelIdx >= 0 && returnIdx > cancelIdx && returnIdx < failedIdx)
})

test('requestError 把超时 abort 视为可重试超时而不是取消', () => {
  assert.match(requestError, /if \(isRequestTimeout\(error, signal\)\) return false/)
  assert.match(requestError, /timeoutFromAbortSignal\(error\?\.config\?\.signal\)/)
  assert.match(requestError, /if \(isRequestTimeout\(error, signal\)\) return true/)
})
