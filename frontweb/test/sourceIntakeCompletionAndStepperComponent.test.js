import test from 'node:test'
import assert from 'node:assert/strict'

import { h, nextTick, ref } from 'vue'

import { formatDuration } from '../src/utils/timelineSummary.js'
import {
  buttonByText,
  click,
  compileIconStub,
  createHostRenderer,
  findByClass,
  findByType,
  hasClass,
  loadCompiledSfc,
  mountHarness,
  textContent,
  vueUrl,
} from './helpers/vueComponentHarness.js'

const bannerUrl = new URL('../src/components/sourceIntake/SourceIntakeCompletionBanner.vue', import.meta.url)
const stepperUrl = new URL('../src/components/sourceIntake/SourceIntakeStepper.vue', import.meta.url)
const iconStubUrl = compileIconStub(['ArrowDown', 'ArrowUp'])
const SourceIntakeCompletionBanner = await loadCompiledSfc(
  bannerUrl,
  'source-intake-completion-banner',
  new Map([
    ['vue', vueUrl],
    ['@element-plus/icons-vue', iconStubUrl],
  ]),
)
const SourceIntakeStepper = await loadCompiledSfc(
  stepperUrl,
  'source-intake-stepper',
  new Map([
    ['@/utils/sourceWorkflowState', new URL('../src/utils/sourceWorkflowState.js', import.meta.url).href],
  ]),
)
const renderer = createHostRenderer()

function sampleTimeline(overrides = {}) {
  return {
    episodeCount: 3,
    trackCount: 8,
    itemCount: 12,
    durationSec: 125,
    placeholderItemCount: 2,
    ...overrides,
  }
}

function mountBanner(initial = {}) {
  const workflowHistoryExpanded = ref(Boolean(initial.historyExpanded))
  const events = []
  const mounted = mountHarness(renderer, () => h(SourceIntakeCompletionBanner, {
    completionTitle: initial.title || '草稿结构已完成',
    qaPresentation: {
      scoreLabel: initial.scoreLabel || '质量检查 95',
      statusLabel: initial.statusLabel || '通过',
    },
    completionSummaryReady: initial.summaryReady ?? true,
    completionEpisodeCount: initial.episodeCount ?? 3,
    timelineSummary: sampleTimeline(initial.timeline),
    formatDuration,
    completionPlaceholderCount: initial.placeholderCount ?? 2,
    workflowHistoryExpanded: workflowHistoryExpanded.value,
    'onUpdate:workflowHistoryExpanded': (value) => {
      workflowHistoryExpanded.value = value
    },
    onEnterProduction: () => events.push('enter-production'),
    onFocusEpisodeList: () => events.push('focus-episode-list'),
  }))
  return { ...mounted, events, workflowHistoryExpanded }
}

function sampleSteps() {
  return [
    { id: 'intake', number: 1, label: '导入素材', status: 'done', statusLabel: '已完成', summary: '已导入 1 条' },
    { id: 'process', number: 2, label: '处理', status: 'active', statusLabel: '进行中', summary: '正在改编' },
    { id: 'qa', number: 3, label: '质量检查', status: 'ready', statusLabel: '可开始', summary: '等待处理完成' },
    { id: 'remediation', number: 4, label: '修复', status: 'blocked', statusLabel: '未开始', summary: '等待质量检查' },
    { id: 'delivery', number: 5, label: '交付', status: 'ready', statusLabel: '未开始', summary: '等待检查' },
  ]
}

function mountStepper({ activeStepId = 'process', inspectedStepId = 'intake' } = {}) {
  const steps = sampleSteps()
  const flowState = { steps, activeStepId }
  const inspectedFlowStep = steps.find((step) => step.id === inspectedStepId) || steps[0]
  const events = []
  const mounted = mountHarness(renderer, () => h(SourceIntakeStepper, {
    flowState,
    inspectedFlowStep,
    onSelect: (stepId) => events.push(stepId),
  }))
  return { ...mounted, events, flowState }
}

test('完成横幅展示质量检查/分集/轨道/时长/占位，并交出制作与分集入口', async () => {
  const harness = mountBanner()
  try {
    const text = textContent(harness.root)
    assert.match(text, /草稿结构已完成/)
    assert.match(text, /质量检查 95/)
    assert.match(text, /质量检查/)
    assert.match(text, /通过/)
    assert.match(text, /分集/)
    assert.match(text, /3 集/)
    assert.match(text, /轨道/)
    assert.match(text, /8 轨/)
    assert.match(text, /时长/)
    assert.match(text, /2:05/)
    assert.match(text, /占位/)
    assert.match(text, /2 项/)
    assert.doesNotMatch(text, /交付摘要整理中/)
    assert.doesNotMatch(text, /Invalid Date/)

    click(buttonByText(harness.root, '进入制作'))
    click(buttonByText(harness.root, '查看分集'))
    assert.deepEqual(harness.events, ['enter-production', 'focus-episode-list'])

    const historyButton = buttonByText(harness.root, '流程记录')
    assert.equal(historyButton.props['aria-expanded'], false)
    click(historyButton)
    await nextTick()
    assert.equal(harness.workflowHistoryExpanded.value, true)
  } finally {
    harness.app.unmount()
  }
})

test('完成摘要未就绪时只提示整理中，不展示轨道时长占位数字', () => {
  const harness = mountBanner({
    title: '结构处理已完成，交付摘要整理中',
    summaryReady: false,
    timeline: { trackCount: 0, durationSec: 0, placeholderItemCount: 0 },
    placeholderCount: 0,
    episodeCount: 0,
  })
  try {
    const text = textContent(harness.root)
    assert.match(text, /结构处理已完成，交付摘要整理中/)
    assert.match(text, /交付摘要整理中，轨道、时长和占位统计将在时间线加载后显示/)
    assert.equal(findByClass(harness.root, 'workflow-complete-metrics').length, 0)
    assert.doesNotMatch(text, /0 轨/)
    assert.doesNotMatch(text, /0:00/)
    assert.doesNotMatch(text, /Invalid Date/)
    assert.ok(buttonByText(harness.root, '进入制作'))
    assert.ok(buttonByText(harness.root, '查看分集'))
  } finally {
    harness.app.unmount()
  }
})

test('步骤条缺少中文标签时仍用质量检查，不把 qa 读给用户', () => {
  const events = []
  const steps = [
    { id: 'intake', number: 1, label: '导入素材', status: 'done', statusLabel: '已完成', summary: '' },
    { id: 'process', number: 2, label: '启动处理', status: 'done', statusLabel: '已完成', summary: '' },
    { id: 'qa', number: 3, label: '', status: 'ready', statusLabel: '可开始', summary: '' },
    { id: 'remediation', number: 4, label: '修复', status: 'pending', statusLabel: '未开始', summary: '' },
    { id: 'delivery', number: 5, label: '剧集 / 时间线', status: 'pending', statusLabel: '未开始', summary: '' },
  ]
  const harness = mountHarness(renderer, () => h(SourceIntakeStepper, {
    flowState: { steps, activeStepId: 'qa' },
    inspectedFlowStep: steps[2],
    onSelect: (stepId) => events.push(stepId),
  }))
  try {
    const qaStep = findByClass(harness.root, 'flow-step')[2]
    assert.equal(qaStep.props['aria-label'], '质量检查')
    assert.doesNotMatch(String(qaStep.props['aria-label'] || ''), /^qa$/i)
  } finally {
    harness.app.unmount()
  }
})

test('步骤条区分当前进度和查看中的历史步骤，点击只发出选择事件', () => {
  const harness = mountStepper({ activeStepId: 'process', inspectedStepId: 'intake' })
  try {
    const steps = findByClass(harness.root, 'flow-step')
    assert.equal(steps.length, 5)
    assert.equal(findByType(harness.root, 'nav')[0].props['aria-label'], '素材处理步骤')

    const intake = steps[0]
    const process = steps[1]
    assert.equal(hasClass(intake, 'is-current'), false)
    assert.equal(hasClass(intake, 'is-selected'), true)
    assert.equal(intake.props['aria-current'], undefined)
    assert.equal(Boolean(intake.props['aria-pressed']), true)
    assert.equal(hasClass(process, 'is-current'), true)
    assert.equal(hasClass(process, 'is-selected'), false)
    assert.equal(process.props['aria-current'], 'step')
    assert.equal(Boolean(process.props['aria-pressed']), false)

    for (const step of steps) {
      const label = String(step.props['aria-label'] || '')
      assert.match(label, /[\u4e00-\u9fff]/)
      assert.doesNotMatch(label, /^qa$/i)
    }
    assert.equal(steps[2].props['aria-label'], '质量检查')

    click(intake)
    click(process)
    assert.deepEqual(harness.events, ['intake', 'process'])
    assert.equal(harness.flowState.activeStepId, 'process')
  } finally {
    harness.app.unmount()
  }
})