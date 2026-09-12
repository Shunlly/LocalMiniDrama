import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { nextTick, ref } from 'vue'

import { useAiConfigWriteLock } from '../src/composables/useAiConfigWriteLock.js'

const vueSource = readFileSync(new URL('../src/components/AIConfigContent.vue', import.meta.url), 'utf8')
const writeLockSource = readFileSync(new URL('../src/composables/useAiConfigWriteLock.js', import.meta.url), 'utf8')

const LIST_STATE = 'ready'
const VENDOR_RESOLVED = true
assert.notEqual(LIST_STATE, 'idle')
assert.notEqual(LIST_STATE, 'error')
assert.equal(VENDOR_RESOLVED, true)

function createLock(overrides = {}) {
  return useAiConfigWriteLock({
    configLoadState: overrides.configLoadState || ref('idle'),
    vendorLockResolved: overrides.vendorLockResolved || ref(false),
    saving: overrides.saving || ref(false),
    bulkKeySaving: overrides.bulkKeySaving || ref(false),
    batchDeleting: overrides.batchDeleting || ref(false),
    oneKeyTongyiSaving: overrides.oneKeyTongyiSaving || ref(false),
    oneKeyVolcSaving: overrides.oneKeyVolcSaving || ref(false),
    oneKeyAgnesSaving: overrides.oneKeyAgnesSaving || ref(false),
    selectedRows: overrides.selectedRows || ref([{ id: 41 }]),
  })
}

test('写入锁在列表未就绪时优先于厂商锁定原因，且不抽走 loadList/openTest', () => {
  assert.match(vueSource, /useAiConfigWriteLock\(/)
  assert.match(vueSource, /async function loadList\(\)/)
  assert.match(vueSource, /async function openTest\(row\)/)
  assert.doesNotMatch(writeLockSource, /async function loadList\(/)
  assert.doesNotMatch(writeLockSource, /async function openTest\(/)
  assert.doesNotMatch(writeLockSource, /useAiConfigList/)

  const pending = createLock()
  assert.equal(pending.configWriteLocked.value, true)
  assert.equal(pending.configWriteLockReason.value, '配置列表尚未就绪')
  assert.equal(pending.canAutoOpenMissingService.value, false)

  const vendorPending = createLock({
    configLoadState: ref('ready'),
    vendorLockResolved: ref(false),
  })
  assert.equal(vendorPending.configWriteLocked.value, true)
  assert.equal(vendorPending.configWriteLockReason.value, '厂商锁定状态尚未解析')
  assert.equal(vendorPending.canAutoOpenMissingService.value, false)
})

test('列表与厂商锁定都就绪后才允许写入；保存中仍锁定并清空勾选', async () => {
  const selectedRows = ref([{ id: 41 }, { id: 11 }])
  const saving = ref(false)
  const lock = createLock({
    configLoadState: ref('ready'),
    vendorLockResolved: ref(true),
    selectedRows,
    saving,
  })
  assert.equal(lock.configWriteLocked.value, false)
  assert.equal(lock.configWriteLockReason.value, '')
  assert.equal(lock.canAutoOpenMissingService.value, true)
  assert.equal(selectedRows.value.length, 2)

  saving.value = true
  await nextTick()
  assert.equal(lock.configWriteLocked.value, true)
  assert.equal(lock.configWriteLockReason.value, '正在保存配置，请稍候')
  assert.deepEqual(selectedRows.value, [])
})