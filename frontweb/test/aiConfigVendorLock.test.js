import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { useAiConfigVendorLock } from '../src/composables/useAiConfigVendorLock.js'

const vueSource = readFileSync(new URL('../src/components/AIConfigContent.vue', import.meta.url), 'utf8')

function jsonRequestOptions(signal) {
  return { signal, timeout: 1000, suppressErrorToast: true }
}

test('厂商锁定读取失败会保持写锁定并给出中文重试说明', async () => {
  const api = {
    async getVendorLock() {
      const error = new Error('connect ECONNREFUSED')
      error.code = 'ECONNREFUSED'
      throw error
    },
  }
  const lock = useAiConfigVendorLock({ aiAPI: api, jsonRequestOptions })
  assert.equal(lock.vendorLockResolved.value, false)
  await lock.loadVendorLock()
  assert.equal(lock.vendorLockResolved.value, false)
  assert.match(lock.vendorLockError.value, /暂时无法确认厂商锁定状态，请稍后重试/)
  assert.doesNotMatch(lock.vendorLockError.value, /ECONNREFUSED/)
})

test('成功读取后解除依赖锁定；取消不会写成失败', async () => {
  const api = {
    async getVendorLock() {
      return { enabled: true, config_file: 'vendor-lock.yaml' }
    },
  }
  const lock = useAiConfigVendorLock({ aiAPI: api, jsonRequestOptions })
  await lock.loadVendorLock()
  assert.equal(lock.vendorLockResolved.value, true)
  assert.equal(lock.vendorLock.value.enabled, true)
  assert.equal(lock.vendorLockError.value, '')

  let calls = 0
  const slow = useAiConfigVendorLock({
    jsonRequestOptions,
    aiAPI: {
      async getVendorLock({ signal }) {
        calls += 1
        await new Promise((resolve) => setTimeout(resolve, 50))
        if (signal?.aborted) {
          const error = new Error('canceled')
          error.code = 'ERR_CANCELED'
          throw error
        }
        return { enabled: false, config_file: '' }
      },
    },
  })
  const pending = slow.loadVendorLock()
  slow.abortVendorLockRequest()
  await pending
  assert.equal(slow.vendorLockResolved.value, false)
  assert.equal(slow.vendorLockError.value, '')
  assert.equal(calls >= 1, true)
})

test('页面重试仍同时刷新锁定和列表，loadList/openTest 留在页面', () => {
  assert.match(vueSource, /useAiConfigVendorLock\(/)
  assert.match(vueSource, /async function retryConfigDependencies\(\) \{\s*await Promise\.all\(\[loadVendorLock\(\), loadList\(\)\]\)\s*\}/)
  assert.match(vueSource, /async function loadList\(\)/)
  assert.match(vueSource, /async function openTest\(row\)/)
  assert.doesNotMatch(vueSource, /async function loadVendorLock\(\)/)
})
