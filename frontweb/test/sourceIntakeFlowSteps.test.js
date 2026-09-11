import test from 'node:test'
import assert from 'node:assert/strict'

import { createSourceIntakeFlowStepController } from '../src/components/sourceIntake/sourceIntakeFlowSteps.js'

function ref(value) {
  return { value }
}

function createFlow(overrides = {}) {
  const replaced = []
  const route = { query: { step: 'qa' }, hash: '#source-intake-workflow', fullPath: '/drama/3' }
  const controller = createSourceIntakeFlowStepController({
    route,
    router: {
      replace: async (location) => {
        replaced.push(location)
        route.query = location.query
      },
    },
    flowState: ref({ activeStepId: 'process', steps: [{ id: 'intake' }, { id: 'process' }, { id: 'qa' }] }),
    selectedFlowStepId: ref('process'),
    compactCompletionVisible: ref(true),
    workflowHistoryExpanded: ref(false),
    productionReadiness: ref({ ready: true }),
    sourceOperationError: ref('old'),
    sourceOperationMessage: ref('old-msg'),
    workflowMode: ref('draft'),
    form: { target_episode_count: 4 },
    getDramaId: () => 3,
    getDramaStyle: () => '诗意',
    workflowRunsAPI: {
      getNovel2AnimeReadiness: async (payload) => ({ ready: true, payload }),
    },
    readinessChecking: ref(false),
    ...overrides,
  })
  return { controller, replaced }
}

test('查看历史步骤会写入 query.step，并在完成后展开记录', () => {
  const selectedFlowStepId = ref('process')
  const workflowHistoryExpanded = ref(false)
  const { controller, replaced } = createFlow({
    selectedFlowStepId,
    workflowHistoryExpanded,
  })
  assert.equal(controller.requestedFlowStepFromRoute(), 'qa')
  controller.selectFlowStep('intake')
  assert.equal(selectedFlowStepId.value, 'intake')
  assert.equal(workflowHistoryExpanded.value, true)
  assert.equal(replaced[0].query.step, 'intake')
  controller.persistInspectedFlowStep(selectedFlowStepId.value)
  assert.equal(replaced.length, 1)
})

test('切到正式制作会检查 readiness；草稿模式只清空旧状态', async () => {
  const productionReadiness = ref({ ready: true })
  const sourceOperationError = ref('old')
  const workflowMode = ref('draft')
  const payloads = []
  const { controller } = createFlow({
    productionReadiness,
    sourceOperationError,
    workflowMode,
    workflowRunsAPI: {
      getNovel2AnimeReadiness: async (payload) => {
        payloads.push(payload)
        return { ready: false, missing_capabilities: [] }
      },
    },
  })
  await controller.handleWorkflowModeChange()
  assert.equal(payloads.length, 0)
  assert.equal(productionReadiness.value, null)
  workflowMode.value = 'production'
  await controller.handleWorkflowModeChange()
  assert.deepEqual(payloads[0], {
    drama_id: 3,
    qa_mode: 'production',
    target_episode_count: 4,
    style: '诗意',
  })
  assert.equal(productionReadiness.value.ready, false)
})
