import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ref } from 'vue'

import { useAiConfigFormActions } from '../src/composables/useAiConfigFormActions.js'
import { useAiConfigRowMutations } from '../src/composables/useAiConfigRowMutations.js'
import { useFilmCreateProductionReadiness } from '../src/composables/filmCreate/useFilmCreateProductionReadiness.js'
import { createDramaCanvasProductionGates } from '../src/components/dramaCanvas/dramaCanvasBatchGenerate.js'
import {
  AI_CONFIG_CHANGED_CHANNEL,
  AI_CONFIG_CHANGED_EVENT,
  publishAiConfigChanged,
  sanitizeAiConfigChangeDetail,
  subscribeAiConfigChanged,
} from '../src/utils/aiConfigChangeBus.js'

const hadWindow = Object.prototype.hasOwnProperty.call(globalThis, 'window')
const previousWindow = hadWindow ? globalThis.window : undefined
if (typeof globalThis.window === 'undefined' || typeof globalThis.window.dispatchEvent !== 'function') {
  globalThis.window = new EventTarget()
}

test.after(() => {
  if (hadWindow) globalThis.window = previousWindow
  else delete globalThis.window
})

function readSource(url) {
  return readFileSync(url, 'utf8').replace(/\r\n?/g, '\n')
}

const formActionsSource = readSource(new URL('../src/composables/useAiConfigFormActions.js', import.meta.url))
const productionReadinessSource = readSource(new URL('../src/composables/filmCreate/useFilmCreateProductionReadiness.js', import.meta.url))
const canvasGatesSource = readSource(new URL('../src/components/dramaCanvas/dramaCanvasBatchGenerate.js', import.meta.url))
const aiConfigContentSource = readSource(new URL('../src/components/AIConfigContent.vue', import.meta.url))
const filmCreateSource = readSource(new URL('../src/views/FilmCreate.vue', import.meta.url))

const DRAMA_ID = 11
const EPISODE_ID = 22
const TEXT_CONFIG_ID = 41
assert.notEqual(DRAMA_ID, EPISODE_ID)

function jsonOk(data) {
  return new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function payloadHasSecret(value) {
  return /api[_-]?key|sk-[A-Za-z0-9]|secret|password|token/i.test(JSON.stringify(value))
}

async function waitFor(predicate, message) {
  const started = Date.now()
  while (Date.now() - started < 1000) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(message)
}

function createSilentMessages() {
  return { success() {}, error() {}, warning() {}, info() {} }
}

function createFormActions(overrides = {}) {
  const saved = overrides.saved || {
    id: TEXT_CONFIG_ID,
    service_type: 'video',
    name: '默认视频',
    provider: 'local',
    api_protocol: 'openai',
    base_url: 'http://127.0.0.1:11434/v1',
    api_key: '********',
    api_key_set: true,
    model: ['demo-video'],
    default_model: 'demo-video',
    endpoint: '',
    query_endpoint: '',
    is_default: true,
    priority: 0,
    updated_at: '2026-09-12T00:00:00.000Z',
  }
  const form = ref(overrides.form || {
    service_type: 'video',
    name: '默认视频',
    provider: 'local',
    api_protocol: 'openai',
    base_url: 'http://127.0.0.1:11434/v1',
    api_key: 'sk-live-should-not-leak',
    modelText: 'demo-video',
    default_model: 'demo-video',
    endpoint: '',
    query_endpoint: '',
    is_default: true,
    priority: 0,
  })
  const list = ref(overrides.list || [])
  const emits = []
  const published = []
  const api = useAiConfigFormActions({
    emit: (name) => emits.push(name),
    ElMessage: createSilentMessages(),
    ElMessageBox: { async confirm() {} },
    configWriteLocked: ref(false),
    form,
    formRef: ref({ async validate() { return true } }),
    editingId: ref(null),
    editingUpdatedAt: ref(''),
    presetModelPick: ref(''),
    advancedFormSections: ref([]),
    dialogVisible: ref(true),
    configDialogSaved: ref(false),
    configFormBaseline: ref(''),
    configDialogScrollRef: ref(null),
    saving: ref(false),
    list,
    async loadList() {
      list.value = [saved]
      return true
    },
    resetDiscoverModelsState() {},
    clearConfigValidationSummary() {},
    async handleConfigValidationFailure() {},
    onServiceTypeChange() {},
    activeServiceFilter: ref('video'),
    apiKeyInputRef: ref(null),
    modelListInputRef: ref(null),
    workflowInputRef: ref(null),
    isComfyUiForm: ref(false),
    isDeepSeekOfficialForm: ref(false),
    invalidateConnectionTestResults() {},
    revealSavedConfigs() {},
    aiAPI: {
      async create() { return saved },
      async update() { return saved },
    },
    async runWithOwnedRequestErrorToast(operation) { return operation() },
    publishAiConfigChanged(detail) {
      const payload = publishAiConfigChanged(detail)
      published.push(payload)
      return payload
    },
    ...overrides.deps,
  })
  return { api, emits, published, form, list, saved }
}

function createProductionReadiness(overrides = {}) {
  return useFilmCreateProductionReadiness({
    dramaId: ref(DRAMA_ID),
    productionReadinessLoading: ref(false),
    productionReadinessFailed: ref(false),
    authoritativeProductionReadiness: ref(null),
    videoCapabilityLoading: ref(false),
    videoCapabilityFailed: ref(false),
    videoCapabilityConfigs: ref([]),
    listenToAiConfigChanges: true,
    ...overrides,
  })
}

function createCanvasGates(calls) {
  const productionReadinessState = ref({ status: 'idle', data: null })
  const freeCanvasVideoCapability = ref(null)
  return createDramaCanvasProductionGates({
    listenToAiConfigChanges: true,
    dramaId: ref(DRAMA_ID),
    readinessRequestId: ref(0),
    freeCanvasCapabilityRequestId: ref(0),
    productionReadinessState,
    freeCanvasVideoCapability,
    workflowRunsAPI: {
      async getNovel2AnimeReadiness(payload) {
        calls.push({ type: 'readiness', payload })
        return {
          ready: true,
          qa_mode: 'production',
          capabilities: [
            { key: 'video', ready: true, service_type: 'video' },
            { key: 'tts', ready: true, service_type: 'tts' },
            { key: 'ffmpeg', ready: true },
          ],
          missing_capabilities: [],
        }
      },
    },
    aiAPI: {
      async list(serviceType) {
        calls.push({ type: 'video', serviceType })
        return []
      },
    },
    safeFreeCanvasError: (_error, fallback) => fallback,
  })
}

test('AI 配置变更总线只保留无密钥元数据', () => {
  const payload = sanitizeAiConfigChangeDetail({
    action: 'save',
    serviceType: 'video',
    configId: TEXT_CONFIG_ID,
    isDefault: true,
    api_key: 'sk-live-should-not-leak',
    token: 'abc',
    password: 'p@ss',
    settings: { api_key: 'nested-secret' },
  })
  assert.deepEqual(payload, {
    action: 'save',
    serviceType: 'video',
    configId: String(TEXT_CONFIG_ID),
    isDefault: true,
  })
  assert.equal(payloadHasSecret(payload), false)
})

test('同页自定义事件和跨标签 BroadcastChannel 都能收到脱敏负载', async () => {
  const localEvents = []
  const windowEvents = []
  const tabEvents = []
  const stop = subscribeAiConfigChanged((detail) => localEvents.push(detail))
  const onWindow = (event) => windowEvents.push(event.detail)
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener(AI_CONFIG_CHANGED_EVENT, onWindow)
  }
  const otherTab = new BroadcastChannel(AI_CONFIG_CHANGED_CHANNEL)
  otherTab.addEventListener('message', (event) => tabEvents.push(event.data))
  try {
    const published = publishAiConfigChanged({
      action: 'delete',
      serviceType: 'video',
      configId: TEXT_CONFIG_ID,
      api_key: 'sk-live-should-not-leak',
      access_token: 'tok-secret',
    })
    assert.equal(payloadHasSecret(published), false)
    assert.equal(localEvents.length, 1)
    assert.equal(payloadHasSecret(localEvents[0]), false)
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      assert.equal(windowEvents.length, 1)
      assert.equal(payloadHasSecret(windowEvents[0]), false)
    }
    await waitFor(
      () => tabEvents.some((item) => item.action === 'delete' && item.configId === String(TEXT_CONFIG_ID)),
      '另一个标签应通过 BroadcastChannel 收到变更',
    )
    const tabPayload = tabEvents.find((item) => item.action === 'delete')
    assert.equal(payloadHasSecret(tabPayload), false)
  } finally {
    stop()
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener(AI_CONFIG_CHANGED_EVENT, onWindow)
    }
    otherTab.close()
  }
})

test('保存或设默认成功后，制作页 readiness 会刷新且事件不含密钥', async () => {
  const fetchCalls = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url)
    fetchCalls.push({ url: target, body: options.body })
    if (target.includes('/workflows/novel2anime/readiness')) {
      return jsonOk({
        ready: true,
        qa_mode: 'production',
        missing_capabilities: [],
        capabilities: [],
      })
    }
    if (target.includes('/ai-configs?service_type=video')) {
      return jsonOk([])
    }
    throw new Error(`不应请求 ${target}`)
  }
  const busEvents = []
  const stopBus = subscribeAiConfigChanged((detail) => busEvents.push(detail))
  const readiness = createProductionReadiness()
  const { api, emits, published, form } = createFormActions()
  try {
    assert.match(form.value.api_key, /sk-live/)
    await api.submit()
    assert.deepEqual(emits, ['configuration-changed'])
    await waitFor(
      () => fetchCalls.some((item) => item.url.includes('/workflows/novel2anime/readiness'))
        && fetchCalls.some((item) => item.url.includes('/ai-configs?service_type=video')),
      '保存成功后制作页应刷新正式制作能力和视频能力',
    )
    const readinessBody = JSON.parse(fetchCalls.find((item) => item.url.includes('/readiness')).body)
    assert.equal(readinessBody.drama_id, DRAMA_ID)
    assert.equal(readinessBody.episode_id, undefined)
    assert.notEqual(readinessBody.drama_id, EPISODE_ID)
    assert.ok(published.length >= 1)
    assert.ok(busEvents.length >= 1)
    for (const detail of [...published, ...busEvents]) {
      assert.equal(payloadHasSecret(detail), false)
      assert.equal(detail.api_key, undefined)
    }
    assert.equal(form.value.api_key, 'sk-live-should-not-leak')
  } finally {
    readiness.stopAiConfigChangeListener()
    stopBus()
    globalThis.fetch = originalFetch
  }
})

test('删除配置成功后，画布页 readiness 会刷新且事件不含密钥', async () => {
  const canvasCalls = []
  const busEvents = []
  const stopBus = subscribeAiConfigChanged((detail) => busEvents.push(detail))
  const gates = createCanvasGates(canvasCalls)
  const { api } = createFormActions()
  const mutations = useAiConfigRowMutations({
    ElMessage: createSilentMessages(),
    ElMessageBox: { async confirm() {} },
    configWriteLocked: ref(false),
    bulkKeyInput: ref(''),
    bulkKeyVisible: ref(false),
    bulkKeySaving: ref(false),
    selectedRows: ref([]),
    batchDeleting: ref(false),
    async loadList() { return true },
    list: ref([]),
    invalidateConnectionTestResults() {},
    notifyConfigurationChanged: api.notifyConfigurationChanged,
    aiAPI: {
      async delete() { return { ok: true } },
    },
  })
  try {
    await mutations.onDelete({
      id: TEXT_CONFIG_ID,
      name: '默认视频',
      service_type: 'video',
      api_key: 'sk-live-should-not-leak',
    })
    await waitFor(
      () => canvasCalls.some((item) => item.type === 'readiness')
        && canvasCalls.some((item) => item.type === 'video'),
      '删除成功后画布页应刷新正式制作能力和视频能力',
    )
    assert.equal(canvasCalls.find((item) => item.type === 'readiness').payload.drama_id, DRAMA_ID)
    assert.notEqual(canvasCalls.find((item) => item.type === 'readiness').payload.drama_id, EPISODE_ID)
    assert.equal(canvasCalls.find((item) => item.type === 'video').serviceType, 'video')
    assert.ok(busEvents.length >= 1)
    for (const detail of busEvents) {
      assert.equal(payloadHasSecret(detail), false)
      assert.equal(detail.api_key, undefined)
    }
  } finally {
    gates.stopAiConfigChangeListener()
    stopBus()
  }
})

test('未挂载页面时默认不订阅，避免测试或后台实例误刷新', async () => {
  const fetchCalls = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    fetchCalls.push(String(url))
    return jsonOk({ ready: true, missing_capabilities: [], capabilities: [] })
  }
  try {
    useFilmCreateProductionReadiness({
      dramaId: ref(DRAMA_ID),
      productionReadinessLoading: ref(false),
      productionReadinessFailed: ref(false),
      authoritativeProductionReadiness: ref(null),
      videoCapabilityLoading: ref(false),
      videoCapabilityFailed: ref(false),
      videoCapabilityConfigs: ref([]),
    })
    publishAiConfigChanged({ action: 'save' })
    await new Promise((resolve) => setTimeout(resolve, 30))
    assert.deepEqual(fetchCalls, [])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('保存成功通知仍留在表单 actions，页面继续自己负责 loadList/openTest', () => {
  assert.match(formActionsSource, /import \{ publishAiConfigChanged as defaultPublishAiConfigChanged \} from '@\/utils\/aiConfigChangeBus\.js'/)
  assert.match(formActionsSource, /function notifyConfigurationChanged\(\) \{\s*emit\('configuration-changed'\)\s*publishAiConfigChanged\(\{ action: 'changed' \}\)\s*\}/)
  assert.match(productionReadinessSource, /subscribeAiConfigChanged\(/)
  assert.match(productionReadinessSource, /refreshVideoGenerationCapability\(\),\s*refreshProductionReadiness\(\)/)
  assert.match(canvasGatesSource, /subscribeAiConfigChanged\(/)
  assert.match(canvasGatesSource, /refreshProductionReadiness\(\),\s*refreshFreeCanvasVideoCapability\(\)/)
  assert.match(aiConfigContentSource, /async function loadList\(\)/)
  assert.match(aiConfigContentSource, /async function openTest\(row\)/)
  assert.match(productionReadinessSource, /aiConfigWorkspaceOpen/)
  assert.match(filmCreateSource, /useFilmCreateProductionReadiness\(/)
  assert.match(filmCreateSource, /aiConfigWorkspaceOpen:\s*showAiConfigDialog/)
})

test('制作页 AI 配置工作台打开时，保存广播不抢先检查正式能力', async () => {
  const fetchCalls = []
  const originalFetch = globalThis.fetch
  const aiConfigWorkspaceOpen = ref(true)
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url)
    fetchCalls.push({ url: target, body: options.body })
    if (target.includes('/workflows/novel2anime/readiness')) {
      return jsonOk({
        ready: true,
        qa_mode: 'production',
        missing_capabilities: [],
        capabilities: [],
      })
    }
    if (target.includes('/ai-configs?service_type=video')) {
      return jsonOk([])
    }
    throw new Error(`不应请求 ${target}`)
  }
  const readiness = createProductionReadiness({ aiConfigWorkspaceOpen })
  try {
    publishAiConfigChanged({ action: 'save' })
    await new Promise((resolve) => setTimeout(resolve, 30))
    assert.deepEqual(fetchCalls, [])
    aiConfigWorkspaceOpen.value = false
    publishAiConfigChanged({ action: 'save' })
    await waitFor(
      () => fetchCalls.some((item) => item.url.includes('/workflows/novel2anime/readiness'))
        && fetchCalls.some((item) => item.url.includes('/ai-configs?service_type=video')),
      '工作台关闭后应恢复广播刷新正式能力与视频能力',
    )
    const readinessBody = JSON.parse(fetchCalls.find((item) => item.url.includes('/readiness')).body)
    assert.equal(readinessBody.drama_id, DRAMA_ID)
    assert.equal(readinessBody.episode_id, undefined)
    assert.notEqual(readinessBody.drama_id, EPISODE_ID)
  } finally {
    readiness.stopAiConfigChangeListener()
    globalThis.fetch = originalFetch
  }
})
