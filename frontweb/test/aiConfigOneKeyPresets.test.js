import test from 'node:test'
import assert from 'node:assert/strict'
import { ref } from 'vue'

import { useAiConfigOneKeyPresets, TONGYI_CONFIGS } from '../src/composables/useAiConfigOneKeyPresets.js'

function createHarness({ loadConfirmed = false, confirm = true } = {}) {
  const messages = []
  const confirms = []
  const created = []
  const loadCalls = []
  const notifications = []
  const invalidations = []
  const configWriteLocked = ref(false)
  const oneKeyTongyiVisible = ref(false)
  const oneKeyTongyiKey = ref('')
  const oneKeyTongyiSaving = ref(false)
  const oneKeyVolcVisible = ref(false)
  const oneKeyVolcKey = ref('')
  const oneKeyVolcSaving = ref(false)
  const oneKeyAgnesVisible = ref(false)
  const oneKeyAgnesKey = ref('')
  const oneKeyAgnesSaving = ref(false)
  const list = ref([])
  const configLoadError = ref('')
  const harness = useAiConfigOneKeyPresets({
    ElMessage: {
      success(message) { messages.push(['success', message]) },
      error(message) { messages.push(['error', message]) },
    },
    ElMessageBox: {
      async confirm(message, title) {
        confirms.push([message, title])
        if (!confirm) throw 'cancel'
      },
    },
    aiAPI: {
      async create(payload) {
        created.push(payload)
        return { id: created.length, updated_at: '2026-09-11T00:00:00.000Z', api_key_set: true }
      },
    },
    async runAiConfigCreateBatch(configs, createOne) {
      const createdItems = []
      for (const cfg of configs) createdItems.push(await createOne(cfg))
      return { success: createdItems.length, failed: 0, created: createdItems }
    },
    configWriteLocked,
    oneKeyTongyiVisible,
    oneKeyTongyiKey,
    oneKeyTongyiSaving,
    oneKeyVolcVisible,
    oneKeyVolcKey,
    oneKeyVolcSaving,
    oneKeyAgnesVisible,
    oneKeyAgnesKey,
    oneKeyAgnesSaving,
    async loadList() {
      loadCalls.push(true)
      if (loadConfirmed) {
        list.value = created.map((item, index) => ({ id: index + 1, name: item.name }))
      }
      return true
    },
    list,
    configLoadError,
    invalidateConnectionTestResults() { invalidations.push(true) },
    notifyConfigurationChanged() { notifications.push(true) },
  })
  return {
    ...harness,
    messages,
    confirms,
    created,
    loadCalls,
    notifications,
    invalidations,
    configWriteLocked,
    oneKeyTongyiVisible,
    oneKeyTongyiKey,
    oneKeyTongyiSaving,
    list,
    configLoadError,
  }
}

test('写入锁定时一键预设不会打开弹窗或提交', async () => {
  const h = createHarness()
  h.configWriteLocked.value = true
  h.openOneKeyTongyi()
  assert.equal(h.oneKeyTongyiVisible.value, false)
  h.oneKeyTongyiKey.value = 'sk-test'
  await h.submitOneKeyTongyi()
  assert.equal(h.created.length, 0)
  assert.equal(h.loadCalls.length, 0)
  assert.equal(h.notifications.length, 0)
})

test('列表确认后才关闭弹窗并通知变更，未确认则提示重试', async () => {
  const unconfirmed = createHarness({ loadConfirmed: false })
  unconfirmed.oneKeyTongyiVisible.value = true
  unconfirmed.oneKeyTongyiKey.value = 'sk-test'
  await unconfirmed.submitOneKeyTongyi()
  assert.equal(unconfirmed.created.length, TONGYI_CONFIGS.length)
  assert.equal(unconfirmed.oneKeyTongyiVisible.value, true)
  assert.equal(unconfirmed.notifications.length, 0)
  assert.match(unconfirmed.configLoadError.value, /请点击“重试”刷新列表/)
  assert.equal(unconfirmed.messages[0][0], 'error')
  assert.equal(unconfirmed.oneKeyTongyiSaving.value, false)

  const confirmed = createHarness({ loadConfirmed: true })
  confirmed.oneKeyTongyiVisible.value = true
  confirmed.oneKeyTongyiKey.value = 'sk-test'
  await confirmed.submitOneKeyTongyi()
  assert.equal(confirmed.created.length, TONGYI_CONFIGS.length)
  assert.equal(confirmed.created[0].provider, 'qwen')
  assert.equal(confirmed.created[0].is_default, true)
  assert.equal(confirmed.oneKeyTongyiVisible.value, false)
  assert.equal(confirmed.notifications.length, 1)
  assert.equal(confirmed.invalidations.length, 1)
  assert.equal(confirmed.messages[0][0], 'success')
  assert.equal(confirmed.confirms[0][1], '一键创建确认')
  assert.match(confirmed.confirms[0][0], /预设只用于填表，不代表本应用已真实跑通对应厂商/)
})

test('取消一键创建确认后不会提交预设', async () => {
  const h = createHarness({ loadConfirmed: true, confirm: false })
  h.oneKeyTongyiVisible.value = true
  h.oneKeyTongyiKey.value = 'sk-test'
  await h.submitOneKeyTongyi()
  assert.equal(h.confirms.length, 1)
  assert.equal(h.created.length, 0)
  assert.equal(h.notifications.length, 0)
  assert.equal(h.oneKeyTongyiVisible.value, true)
})
