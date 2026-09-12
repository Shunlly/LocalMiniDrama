import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { effectScope, nextTick } from 'vue'

import { ElMessage } from '../src/utils/elementPlusFeedback.js'
import { useFreeCreateWorkspace } from '../src/composables/useFreeCreateWorkspace.js'
import { ensureWindowShim } from './helpers/vueRouterHarness.js'
import {
  FREE_CREATE_DRAFT_RESTORE_ERROR,
  FREE_CREATE_DRAFT_SAVE_ERROR,
  FREE_CREATE_DRAFT_STORAGE_KEY,
  FREE_CREATE_LEAVE_CONFIRM_BUTTON_TEXT,
  FREE_CREATE_LEAVE_CONFIRM_MESSAGE,
  FREE_CREATE_LEAVE_CONFIRM_TITLE,
  FREE_CREATE_LEAVE_STAY_BUTTON_TEXT,
  normalizeFreeCreateDraft,
  readFreeCreateDraft,
  writeFreeCreateDraft,
} from '../src/utils/freeCreate.js'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const freeCreatePageSource = read('../src/views/FreeCreate.vue')
const freeCreateHeaderSource = read('../src/components/freeCreate/FreeCreateHeader.vue')
const freeCreateInputSource = read('../src/components/freeCreate/FreeCreateInputPanel.vue')
const freeCreateResultSource = read('../src/components/freeCreate/FreeCreateResultPanel.vue')
const freeCreateWorkspaceSource = read('../src/composables/useFreeCreateWorkspace.js')

function createMemoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial))
  return {
    getItem(key) {
      return data.has(key) ? data.get(key) : null
    },
    setItem(key, value) {
      data.set(key, String(value))
    },
    raw: data,
  }
}

function ensureFreeCreateTestDom() {
  ensureWindowShim()
  if (globalThis.document) return
  const element = () => ({
    style: {},
    classList: { add() {}, remove() {} },
    setAttribute() {},
    appendChild() {},
    removeChild() {},
    addEventListener() {},
    removeEventListener() {},
  })
  globalThis.document = {
    body: element(),
    documentElement: element(),
    createElement: () => element(),
    createElementNS: () => element(),
    querySelector: () => null,
    getElementById: () => null,
    addEventListener() {},
    removeEventListener() {},
  }
}

function createWorkspace(overrides = {}) {
  return useFreeCreateWorkspace({
    router: { push() {}, resolve: () => ({ fullPath: '/free-create' }) },
    route: { query: overrides.query || {} },
    assetsApi: {
      async list() { return { items: [] } },
      async create() { return {} },
      async get() { return {} },
    },
    imagesApi: { async list() { return { items: [] } }, async create() { return {} } },
    videosApi: { async list() { return { items: [] } }, async get() { return {} }, async create() { return {} } },
    taskApi: { async get() { return {} }, async cancel() { return {} } },
    uploadApi: { async uploadImage() { return {} } },
    aiApi: { async list() { return [] } },
    generationSettingsApi: { async get() { return {} } },
    storage: overrides.storage === undefined ? createMemoryStorage() : overrides.storage,
  })
}

test('自由创作窄屏不横向撑开，空态读屏和离开确认保持中文', () => {
  assert.match(freeCreatePageSource, /overflow-x:\s*clip/)
  assert.match(freeCreatePageSource, /@media \(max-width: 900px\) \{[\s\S]*flex-direction: column/)
  assert.match(freeCreatePageSource, /@media \(max-width: 520px\) \{[\s\S]*padding: 12px/)
  assert.match(freeCreateHeaderSource, /flex-wrap:\s*wrap/)
  assert.match(freeCreateHeaderSource, /overflow-wrap:\s*anywhere/)
  assert.match(freeCreateHeaderSource, /@media \(max-width: 520px\) \{[\s\S]*flex-direction: column/)
  assert.match(freeCreateHeaderSource, /aria-label="返回项目首页"/)
  assert.match(freeCreateHeaderSource, />\s*返回项目首页\s*</)
  assert.match(freeCreateInputSource, /min-width: 0/)
  assert.match(freeCreateInputSource, /\.ref-upload-status \{[\s\S]*flex-wrap:\s*wrap/)
  assert.match(freeCreateResultSource, /minmax\(min\(200px, 100%\), 1fr\)/)
  assert.match(freeCreateResultSource, /class="empty-result" role="status" aria-live="polite" aria-atomic="true"/)
  assert.match(freeCreateResultSource, /<el-icon class="empty-icon" aria-hidden="true">/)
  assert.match(freeCreateResultSource, /class="generating-tip" role="status" aria-live="polite" aria-atomic="true"/)
  assert.match(freeCreateWorkspaceSource, /ElMessageBox\.confirm\(/)
  assert.match(freeCreateWorkspaceSource, /confirmButtonText: FREE_CREATE_LEAVE_CONFIRM_BUTTON_TEXT/)
  assert.match(freeCreateWorkspaceSource, /cancelButtonText: FREE_CREATE_LEAVE_STAY_BUTTON_TEXT/)
  assert.doesNotMatch(freeCreateWorkspaceSource, /window\.confirm/)
  assert.equal(FREE_CREATE_LEAVE_CONFIRM_TITLE, '离开自由创作')
  assert.equal(FREE_CREATE_LEAVE_CONFIRM_MESSAGE, '正在生成，离开将取消当前任务。仍要离开吗？')
  assert.equal(FREE_CREATE_LEAVE_CONFIRM_BUTTON_TEXT, '离开并取消')
  assert.equal(FREE_CREATE_LEAVE_STAY_BUTTON_TEXT, '继续生成')
  assert.match(freeCreateInputSource, /placeholder="例如：电影感、日式动漫…"/)
})

test('提示词草稿读写失败给出中文错误，不回落英文异常', () => {
  assert.deepEqual(normalizeFreeCreateDraft({
    mode: 'video',
    prompt: '海边灯塔',
    style: '电影感',
    aspectRatio: '9:16',
    duration: 8,
  }), {
    mode: 'video',
    prompt: '海边灯塔',
    style: '电影感',
    aspectRatio: '9:16',
    duration: 8,
  })
  assert.equal(normalizeFreeCreateDraft([]), null)

  const storage = createMemoryStorage()
  assert.equal(writeFreeCreateDraft(storage, {
    mode: 'image',
    prompt: '港口夜景',
    style: '日式动漫',
    aspectRatio: '4:3',
    duration: 5,
  }), true)
  assert.deepEqual(readFreeCreateDraft(storage), {
    mode: 'image',
    prompt: '港口夜景',
    style: '日式动漫',
    aspectRatio: '4:3',
    duration: 5,
  })

  assert.throws(
    () => readFreeCreateDraft({
      getItem() { return '{not-json' },
    }),
    (error) => error.message === FREE_CREATE_DRAFT_RESTORE_ERROR,
  )
  assert.throws(
    () => readFreeCreateDraft({
      getItem() { throw new Error('SecurityError') },
    }),
    (error) => error.message === FREE_CREATE_DRAFT_RESTORE_ERROR,
  )
  assert.throws(
    () => writeFreeCreateDraft({
      setItem() {
        const error = new Error('QuotaExceededError')
        error.name = 'QuotaExceededError'
        throw error
      },
    }, { prompt: '灯塔' }),
    (error) => error.message === FREE_CREATE_DRAFT_SAVE_ERROR,
  )
  assert.doesNotMatch(FREE_CREATE_DRAFT_SAVE_ERROR, /[A-Za-z]{3,}/)
  assert.doesNotMatch(FREE_CREATE_DRAFT_RESTORE_ERROR, /[A-Za-z]{3,}/)
})

test('工作区能恢复提示词草稿，深链接 mode 优先生效', async () => {
  ensureFreeCreateTestDom()
  const storage = createMemoryStorage({
    [FREE_CREATE_DRAFT_STORAGE_KEY]: JSON.stringify({
      mode: 'video',
      prompt: '港口夜景',
      style: '电影感',
      aspectRatio: '9:16',
      duration: 8,
    }),
  })
  const scope = effectScope()
  const workspace = scope.run(() => createWorkspace({
    storage,
    query: { mode: 'image' },
  }))
  try {
    await workspace.mount()
    assert.equal(workspace.prompt.value, '港口夜景')
    assert.equal(workspace.style.value, '电影感')
    assert.equal(workspace.mode.value, 'image')
    assert.equal(workspace.duration.value, 8)
    workspace.prompt.value = '灯塔清晨'
    await nextTick()
    assert.equal(JSON.parse(storage.getItem(FREE_CREATE_DRAFT_STORAGE_KEY)).prompt, '灯塔清晨')
  } finally {
    scope.stop()
  }
})

test('提示词保存失败和恢复失败都弹出中文错误', async () => {
  ensureFreeCreateTestDom()
  const errors = []
  const originalError = ElMessage.error
  ElMessage.error = (message) => {
    errors.push(message)
    return { close() {} }
  }
  const saveStorage = {
    getItem() { return null },
    setItem() {
      const error = new Error('QuotaExceededError')
      error.name = 'QuotaExceededError'
      throw error
    },
  }
  const restoreStorage = {
    getItem() { return '{broken' },
    setItem() {},
  }
  const saveScope = effectScope()
  const restoreScope = effectScope()
  try {
    const saveWorkspace = saveScope.run(() => createWorkspace({ storage: saveStorage }))
    await saveWorkspace.mount()
    saveWorkspace.prompt.value = '海边灯塔'
    await nextTick()
    assert.deepEqual(errors, [FREE_CREATE_DRAFT_SAVE_ERROR])

    const restoreWorkspace = restoreScope.run(() => createWorkspace({ storage: restoreStorage }))
    await restoreWorkspace.mount()
    assert.deepEqual(errors, [FREE_CREATE_DRAFT_SAVE_ERROR, FREE_CREATE_DRAFT_RESTORE_ERROR])
    assert.equal(restoreWorkspace.prompt.value, '')
  } finally {
    saveScope.stop()
    restoreScope.stop()
    ElMessage.error = originalError
  }
})
