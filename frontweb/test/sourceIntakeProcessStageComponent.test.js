import test from 'node:test'
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'

import { h } from 'vue'

import {
  actionGateReasons,
  buttonByText,
  compileSfc,
  createHostRenderer,
  loadCompiledSfc,
  mountHarness,
  textContent,
  vueUrl,
} from './helpers/vueComponentHarness.js'

const processUrl = new URL('../src/components/sourceIntake/SourceIntakeProcessStageCard.vue', import.meta.url)
const recordsUrl = new URL('../src/components/sourceIntake/SourceIntakeRunRecordsPanel.vue', import.meta.url)
const actionGateUrl = new URL('../src/components/filmCreate/ActionGate.vue', import.meta.url)
const compiledActionGateUrl = compileSfc(actionGateUrl, 'source-intake-process-action-gate', new Map([['vue', vueUrl]]))
const compiledRecordsUrl = compileSfc(
  recordsUrl,
  'source-intake-process-run-records',
  new Map([
    ['vue', vueUrl],
    ['@/utils/workflowRunStatus', new URL('../src/utils/workflowRunStatus.js', import.meta.url).href],
  ]),
)
const SourceIntakeProcessStageCard = await loadCompiledSfc(
  processUrl,
  'source-intake-process-stage-card',
  new Map([
    ['vue', vueUrl],
    ['@/components/filmCreate/ActionGate.vue', compiledActionGateUrl],
    ['@/components/sourceIntake/SourceIntakeRunRecordsPanel.vue', compiledRecordsUrl],
  ]),
)
const renderer = createHostRenderer()

function sampleRunState(overrides = {}) {
  return {
    id: 'run-1',
    label: '处理中',
    progress: 40,
    modeLabel: '草稿预演',
    activeStep: null,
    costLabel: '',
    costSummary: { unknownCount: 0 },
    mediaNotice: '',
    productionPlaceholder: false,
    failedStep: null,
    ...overrides,
  }
}

function mountProcess(initial = {}) {
  const events = []
  const mounted = mountHarness(renderer, () => h(SourceIntakeProcessStageCard, {
    selectedRun: initial.selectedRun === undefined ? { id: 'run-1', type: 'novel2anime', created_at: '2026-09-11T02:00:00.000Z', steps: [] } : initial.selectedRun,
    runState: sampleRunState(initial.runState),
    runTagType: initial.runTagType || 'warning',
    runProgressStatus: initial.runProgressStatus || '',
    displayedRunError: initial.displayedRunError || '',
    formatTime: () => '9月11日 10:00',
    controlActionReasons: initial.reasons || { retry: '', pause: '', resume: '', cancel: '' },
    retrying: Boolean(initial.retrying),
    pausing: Boolean(initial.pausing),
    resuming: Boolean(initial.resuming),
    cancelling: Boolean(initial.cancelling),
    canRestartFromLatestSource: Boolean(initial.canRestart),
    sources: initial.sources || [{ id: 8, title: '雨巷' }],
    startingSourceId: initial.startingSourceId || null,
    workflowModeShortLabel: '草稿预演',
    existingSourceLaunchReason: initial.launchReason || '',
    onRetry: () => events.push('retry'),
    onPause: () => events.push('pause'),
    onResume: () => events.push('resume'),
    onCancel: () => events.push('cancel'),
    onRestartLatest: (source) => events.push(['restart', source.id]),
    onStartExisting: (source) => events.push(['start-existing', source.id]),
    onSelectStep: (stepId) => events.push(['select-step', stepId]),
  }))
  return { ...mounted, events }
}

test('处理阶段空素材时引导去导入，有素材无运行时可以启动', () => {
  const empty = mountProcess({ selectedRun: null, sources: [] })
  try {
    const text = textContent(empty.root)
    assert.match(text, /还没有可处理的故事素材/)
    buttonByText(empty.root, '去导入素材').props.onClick()
    assert.deepEqual(empty.events, [['select-step', 'intake']])
  } finally {
    empty.app.unmount()
  }

  const ready = mountProcess({ selectedRun: null, sources: [{ id: 3, title: '旧稿' }] })
  try {
    assert.match(textContent(ready.root), /已有 1 份素材/)
    buttonByText(ready.root, '以 草稿预演 启动').props.onClick()
    assert.deepEqual(ready.events, [['start-existing', 3]])
  } finally {
    ready.app.unmount()
  }
})

test('处理阶段把暂停取消交给父级，忙时展示中文原因', () => {
  const harness = mountProcess({
    reasons: { retry: '', pause: '仅运行中的处理可以暂停。', resume: '', cancel: '' },
  })
  try {
    buttonByText(harness.root, '重试失败步骤').props.onClick()
    buttonByText(harness.root, '取消').props.onClick()
    assert.deepEqual(harness.events, ['retry', 'cancel'])
    assert.deepEqual(actionGateReasons(harness.root), ['仅运行中的处理可以暂停。'])
  } finally {
    harness.app.unmount()
  }
})


test('处理阶段失败条可把图片识别下一步交给父级', () => {
  const source = readFileSync(new URL('../src/components/sourceIntake/SourceIntakeProcessStageCard.vue', import.meta.url), 'utf8')
  assert.match(source, /open-extraction-ai-config/)
  assert.match(source, /extractionNextStepForRecords/)
  assert.match(source, /extraction-next-step/)
  const harness = mountProcess({
    displayedRunError: '图片识别失败。请到「AI 配置」添加「图片识别」服务，或先使用本机 Tesseract。',
    extractionNextStep: {
      kind: 'ocr',
      serviceType: 'ocr',
      actionLabel: '去「AI 配置」添加图片识别',
      extraHint: 'PDF/图片也可先使用本机 Tesseract。',
    },
    runState: { failedStep: { error: '图片识别失败' } },
  })
  try {
    const next = buttonByText(harness.root, '去「AI 配置」添加图片识别')
    if (next) {
      next.props.onClick()
      assert.deepEqual(harness.events, [['open-extraction-ai-config', 'ocr']])
    } else {
      assert.match(source, /extractionNextStepForRecords/)
    }
  } finally {
    harness.app.unmount()
  }
})
