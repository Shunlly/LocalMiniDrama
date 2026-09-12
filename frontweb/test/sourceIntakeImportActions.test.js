import test from 'node:test'
import assert from 'node:assert/strict'

import { createSourceIntakeImportActions } from '../src/components/sourceIntake/sourceIntakeImportActions.js'

function ref(value) {
  return { value }
}

function createImport(overrides = {}) {
  const calls = []
  const form = { title: '', source_type: 'novel', target_episode_count: 1, source_url: '', text: '正文' }
  const controller = createSourceIntakeImportActions({
    rawSourceUrl: ref(''),
    sourceUrlValidationMessage: ref(''),
    sourceFile: ref(null),
    sourceIntakeAPI: {
      createForDrama: async (dramaId, payload) => {
        calls.push(['create', dramaId, payload])
        return { source: { id: 7, title: payload.title } }
      },
      uploadForDrama: async (dramaId) => {
        calls.push(['upload', dramaId])
        return { source: { id: 8 } }
      },
      importUrlForDrama: async (dramaId) => {
        calls.push(['url', dramaId])
        return { source: { id: 9 } }
      },
      get: async (id) => ({ source: { id, title: '详情' } }),
    },
    getDramaId: () => 12,
    form,
    getDrama: () => ({ title: '雨巷', total_episodes: 6, style: '诗意' }),
    hasWebSourceUrl: () => false,
    clearSelectedFile: () => calls.push(['clear']),
    getImportController: () => ({
      importSource: async (payload) => { calls.push(['import', payload]) },
      refreshSources: async () => { calls.push(['refresh']) },
    }),
    sourceSaving: ref(false),
    isWorkflowLaunchBusy: () => false,
    getSelectedFilename: () => 'story.txt',
    sourceListRefreshing: ref(false),
    sourceFileReading: ref(false),
    workflowHistoryExpanded: ref(false),
    selectedFlowStepId: ref('delivery'),
    sourceUrlInput: ref({ focus: () => calls.push(['focus']) }),
    nextTickFn: async () => {},
    persistInspectedFlowStep: (stepId) => calls.push(['persist', stepId]),
    sourceDetailVisible: ref(false),
    sourceDetailLoading: ref(false),
    sourceDetail: ref(null),
    isLifecycleActive: () => true,
    showWorkflowMessage: (type, message) => calls.push([type, message]),
    isUserFacingAbort: () => false,
    toUserFacingError: (error, fallback) => error?.message || fallback,
    ...overrides,
  })
  return { controller, calls, form }
}

test('表单默认标题和集数来自剧目，纯文本导入走 createForDrama', async () => {
  const { controller, calls, form } = createImport()
  controller.syncDefaults()
  assert.equal(form.target_episode_count, 6)
  assert.equal(form.title, '雨巷 素材')
  const created = await controller.createSourceFromForm()
  assert.equal(created.source.id, 7)
  assert.equal(calls[0][0], 'create')
  controller.resetSourceInput()
  assert.equal(form.text, '')
  assert.ok(calls.includes(['clear']) || calls.some((item) => item[0] === 'clear'))
})

test('导入中不会重复提交，详情失败会提示中文', async () => {
  const sourceSaving = ref(false)
  const { controller, calls } = createImport({ sourceSaving })
  await controller.importSourceOnly()
  assert.deepEqual(calls.find((item) => item[0] === 'import'), ['import', { uploadedFilename: 'story.txt' }])
  sourceSaving.value = true
  await controller.importSourceOnly()
  assert.equal(calls.filter((item) => item[0] === 'import').length, 1)

  const sourceDetail = ref(null)
  const failed = createImport({
    sourceDetail,
    sourceIntakeAPI: {
      createForDrama: async () => ({}),
      uploadForDrama: async () => ({}),
      importUrlForDrama: async () => ({}),
      get: async () => { throw new Error('down') },
    },
  })
  await failed.controller.openSourceDetail({ id: 3 })
  assert.equal(failed.calls.at(-1)[0], 'error')
  assert.match(failed.calls.at(-1)[1], /加载素材详情失败|down/)
})

test('空状态去填写素材会聚焦网页地址输入', async () => {
  const { controller, calls } = createImport()
  await controller.focusSourceIntakeForm()
  assert.deepEqual(calls.filter((item) => item[0] === 'focus'), [['focus']])
})
