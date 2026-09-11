import test from 'node:test'
import assert from 'node:assert/strict'

import { createSourceIntakeLaunchController } from '../src/components/sourceIntake/sourceIntakeLaunchActions.js'

function ref(value) {
  return { value }
}

function createLaunch(overrides = {}) {
  const messages = []
  const sourceOperationMessage = ref('')
  const sourceOperationError = ref('')
  const startingSourceId = ref(null)
  const workflowStarting = ref(false)
  const productionReadiness = ref(null)
  const form = { title: '雨巷', source_type: 'novel', target_episode_count: 3, source_url: '', text: '正文' }
  const controller = createSourceIntakeLaunchController({
    isLaunchBusy: () => false,
    getBlockedReason: () => '',
    getSelectedFilename: () => '',
    getDramaId: () => 12,
    form,
    getDrama: () => ({ title: '雨巷', style: '诗意' }),
    getWorkflowMode: () => 'draft',
    checkReadiness: async () => ({ ready: true }),
    lifecycle: { isActive: () => true },
    sourceFile: ref(null),
    hasWebSourceUrl: () => false,
    createSourceFromForm: async () => ({ source: { id: 88, title: '雨巷', source_type: 'novel' } }),
    startNovel2Anime: async (payload) => ({ id: 'run-9', payload }),
    resetSourceInput: () => messages.push(['reset']),
    refreshAndConfirmRun: async () => true,
    markWorkflowRefreshUnconfirmed: () => messages.push(['unconfirmed']),
    persistProcessStep: () => messages.push(['process']),
    showWorkflowMessage: (type, message) => messages.push([type, message]),
    emitRefresh: () => messages.push(['refresh']),
    productionReadiness,
    loadSources: async () => messages.push(['load-sources']),
    sourceOperationMessage,
    sourceOperationError,
    startingSourceId,
    workflowStarting,
    getWorkflowModeShortLabel: () => '草稿预演',
    importSourceOnly: async () => messages.push(['import-only']),
    isUserFacingAbort: () => false,
    toUserFacingError: (error, fallback) => error?.message || fallback,
    sourceIntakeFailureMessage: (error, fallback) => error?.message || fallback,
    assertSourceWorkflowLifecycleActive: () => {},
    ...overrides,
  })
  return { controller, messages, sourceOperationMessage, sourceOperationError, startingSourceId, workflowStarting }
}

test('纯文本启动成功后会清空输入并进入处理步骤', async () => {
  const started = []
  const { controller, messages, sourceOperationMessage } = createLaunch({
    startNovel2Anime: async (payload) => {
      started.push(payload)
      return { id: 'run-9' }
    },
  })
  await controller.startWorkflow()
  assert.equal(started[0].qa_mode, 'draft')
  assert.equal(started[0].drama_id, 12)
  assert.ok(messages.some((item) => item[0] === 'reset'))
  assert.ok(messages.some((item) => item[0] === 'process'))
  assert.match(sourceOperationMessage.value, /草稿预演 流程已启动/)
})

test('启动后快照未确认时不会假装已进入处理步骤', async () => {
  const { controller, messages } = createLaunch({
    refreshAndConfirmRun: async () => false,
  })
  await controller.startWorkflow()
  assert.ok(messages.some((item) => item[0] === 'unconfirmed'))
  assert.equal(messages.some((item) => item[0] === 'process'), false)
})

test('从已有素材启动会带上 source_id', async () => {
  const started = []
  const { controller, messages, startingSourceId, workflowStarting } = createLaunch({
    startNovel2Anime: async (payload) => {
      started.push(payload)
      return { id: 'run-from-source' }
    },
  })
  await controller.startExistingSource({ id: 44, title: '旧素材', source_type: 'novel' })
  assert.equal(started[0].source_id, 44)
  assert.equal(started[0].drama_id, 12)
  assert.ok(messages.some((item) => item[0] === 'process'))
  assert.match(messages.find((item) => item[0] === 'success')[1], /已从素材启动 草稿预演/)
  assert.equal(startingSourceId.value, null)
  assert.equal(workflowStarting.value, false)
})

test('无效素材记录会直接抛出，空状态动作会分发导入或启动', async () => {
  const { controller, messages } = createLaunch()
  await assert.rejects(() => controller.startWorkflowFromSource({}), /素材记录无效/)
  await controller.runSourceEmptyStateAction('import')
  await controller.runSourceEmptyStateAction('start')
  assert.ok(messages.some((item) => item[0] === 'import-only'))
  assert.ok(messages.some((item) => item[0] === 'process'))
})
