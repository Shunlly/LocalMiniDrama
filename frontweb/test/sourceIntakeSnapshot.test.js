import test from 'node:test'
import assert from 'node:assert/strict'

import {
  applySourceIntakeWorkflowSnapshot,
  createSourceIntakeDataActions,
  fetchSourceIntakeWorkflowSnapshot,
  loadSourceIntakeWorkflowData,
  refreshAndConfirmSourceIntakeRun,
} from '../src/components/sourceIntake/sourceIntakeSnapshot.js'

function ref(value) {
  return { value }
}

test('快照拉取会并行拉素材、运行、QA、就绪度和时间线', async () => {
  const calls = []
  const snapshot = await fetchSourceIntakeWorkflowSnapshot({
    dramaId: 9,
    generation: 3,
    targetEpisodeCount: 8,
    style: '赛博',
    sourceIntakeAPI: { listForDrama: async (id) => { calls.push(['sources', id]); return [{ id: 1 }] } },
    workflowRunsAPI: {
      list: async (query) => { calls.push(['runs', query]); return [{ id: 'run-1' }] },
      get: async (id) => { calls.push(['run', id]); return { id, status: 'running' } },
      getNovel2AnimeReadiness: async (payload) => { calls.push(['ready', payload]); return { ready: true } },
    },
    qaReportsAPI: { list: async (query) => { calls.push(['qa', query]); return [{ id: 'qa-1' }] } },
    timelinesAPI: { getDramaTimeline: async (id) => { calls.push(['timeline', id]); return { episodeCount: 2 } } },
    normalizeProductionReadiness: (value) => ({ ...value, normalized: true }),
  })
  assert.equal(snapshot.dramaId, 9)
  assert.equal(snapshot.generation, 3)
  assert.equal(snapshot.selectedRun.id, 'run-1')
  assert.equal(snapshot.readiness.normalized, true)
  assert.deepEqual(calls.find((item) => item[0] === 'ready')[1], {
    drama_id: 9,
    qa_mode: 'production',
    target_episode_count: 8,
    style: '赛博',
  })
})

test('时间线失败时快照仍提交，其它剧的快照不会写进当前状态', async () => {
  const snapshot = await fetchSourceIntakeWorkflowSnapshot({
    dramaId: 2,
    generation: 1,
    targetEpisodeCount: 1,
    style: '',
    sourceIntakeAPI: { listForDrama: async () => [] },
    workflowRunsAPI: {
      list: async () => [],
      get: async () => { throw new Error('should not get run') },
      getNovel2AnimeReadiness: async () => ({ ready: false }),
    },
    qaReportsAPI: { list: async () => [] },
    timelinesAPI: { getDramaTimeline: async () => { throw new Error('timeline down') } },
    normalizeProductionReadiness: (value) => value,
  })
  assert.equal(snapshot.timeline, null)
  assert.equal(snapshot.selectedRun, null)

  const sources = ref([])
  const applied = applySourceIntakeWorkflowSnapshot(snapshot, {
    isActive: () => true,
    dramaId: 99,
    sources,
    runs: ref([]),
    reports: ref([]),
    productionReadiness: ref(null),
    selectedRun: ref(null),
    timeline: ref('keep'),
    workflowDataError: ref('旧错误'),
    startPoll: () => { throw new Error('should not poll') },
  })
  assert.equal(applied, false)
  assert.deepEqual(sources.value, [])
})

test('刷新确认只在 applied 且包含目标 run 时为真，加载失败走中文回调', async () => {
  assert.equal(await refreshAndConfirmSourceIntakeRun(async () => ({ status: 'applied', data: { runs: [{ id: 7 }] } }), 7), true)
  assert.equal(await refreshAndConfirmSourceIntakeRun(async () => ({ status: 'stale', data: { runs: [{ id: 7 }] } }), 7), false)
  assert.equal(await refreshAndConfirmSourceIntakeRun(async () => { throw new Error('down') }, 7), false)

  const events = []
  assert.equal(await loadSourceIntakeWorkflowData({ dramaId: 0 }), undefined)
  const ignored = await loadSourceIntakeWorkflowData({
    dramaId: 3,
    beginLoad: () => events.push('begin'),
    endLoad: () => events.push('end'),
    refreshWorkflowSnapshot: async () => { throw new Error('canceled') },
    shouldIgnoreError: () => true,
    onFailed: () => events.push('failed'),
  })
  assert.equal(ignored.status, 'ignored')
  assert.deepEqual(events, ['begin', 'end'])

  const failedEvents = []
  const failed = await loadSourceIntakeWorkflowData({
    dramaId: 3,
    beginLoad: () => failedEvents.push('begin'),
    endLoad: () => failedEvents.push('end'),
    refreshWorkflowSnapshot: async () => { throw new Error('timeout') },
    shouldIgnoreError: () => false,
    onFailed: (error) => failedEvents.push(error.message),
  })
  assert.equal(failed.status, 'failed')
  assert.deepEqual(failedEvents, ['begin', 'timeout', 'end'])
})

test('loadData 会累计 loading，失败时写下中文流程错误', async () => {
  const loading = ref(false)
  const workflowDataError = ref('')
  const sourceOperationMessage = ref('')
  const actions = createSourceIntakeDataActions({
    getDramaId: () => 4,
    refreshWorkflowSnapshot: async () => { throw new Error('timeout') },
    loading,
    workflowDataError,
    shouldIgnoreError: () => false,
    toUserFacingError: (_error, fallback) => fallback,
    sourceImportController: {
      loadSources: async () => 'sources',
      markRefreshUnconfirmed: (message) => { sourceOperationMessage.value = message },
    },
    refreshUnconfirmedMessage: '刷新未确认',
    sourceOperationMessage,
  })
  const failed = await actions.loadData()
  assert.equal(failed.status, 'failed')
  assert.equal(loading.value, false)
  assert.match(workflowDataError.value, /加载素材流程状态失败/)
  assert.equal(await actions.loadSources(), 'sources')
  actions.markWorkflowRefreshUnconfirmed()
  assert.equal(sourceOperationMessage.value, '刷新未确认')
})
