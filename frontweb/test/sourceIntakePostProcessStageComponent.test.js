import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { h } from 'vue'

import { formatDuration } from '../src/utils/timelineSummary.js'
import {
  actionGateReasons,
  buttonByText,
  compileSfc,
  createHostRenderer,
  findAll,
  findByClass,
  findByType,
  loadCompiledSfc,
  mountHarness,
  textContent,
  vueUrl,
} from './helpers/vueComponentHarness.js'

const panelUrl = new URL('../src/components/SourceIntakeWorkflowPanel.vue', import.meta.url)
const qaUrl = new URL('../src/components/sourceIntake/SourceIntakeQaStageCard.vue', import.meta.url)
const remediationUrl = new URL('../src/components/sourceIntake/SourceIntakeRemediationStageCard.vue', import.meta.url)
const deliveryUrl = new URL('../src/components/sourceIntake/SourceIntakeDeliveryStageCard.vue', import.meta.url)
const launchUrl = new URL('../src/components/sourceIntake/SourceIntakeLaunchModeCard.vue', import.meta.url)
const actionGateUrl = new URL('../src/components/filmCreate/ActionGate.vue', import.meta.url)
const compiledActionGateUrl = compileSfc(actionGateUrl, 'source-intake-post-process-action-gate', new Map([['vue', vueUrl]]))
const replacements = new Map([
  ['vue', vueUrl],
  ['@/components/filmCreate/ActionGate.vue', compiledActionGateUrl],
  ['@/utils/qaReport', new URL('../src/utils/qaReport.js', import.meta.url).href],
  ['@/utils/timelineSummary', new URL('../src/utils/timelineSummary.js', import.meta.url).href],
])
const SourceIntakeQaStageCard = await loadCompiledSfc(qaUrl, 'source-intake-qa-stage-card', replacements)
const SourceIntakeRemediationStageCard = await loadCompiledSfc(
  remediationUrl,
  'source-intake-remediation-stage-card',
  replacements,
)
const SourceIntakeDeliveryStageCard = await loadCompiledSfc(
  deliveryUrl,
  'source-intake-delivery-stage-card',
  replacements,
)
const renderer = createHostRenderer()
const panelSource = readFileSync(panelUrl, 'utf8')
const launchSource = readFileSync(launchUrl, 'utf8')

function emptyQa(overrides = {}) {
  return {
    id: null,
    passed: false,
    issueCount: 0,
    checks: [],
    remediationActions: [],
    ...overrides,
  }
}

function samplePresentation(overrides = {}) {
  return {
    scopeLabel: '草稿结构检查',
    scoreLabel: '草稿结构检查 95 分',
    statusLabel: '草稿结构检查已通过',
    notice: '该评分仅评估脚本与流程结构；草稿占位媒体不计为可交付成片。',
    ...overrides,
  }
}

function sampleTimeline(overrides = {}) {
  return {
    episodeCount: 3,
    trackCount: 8,
    itemCount: 12,
    placeholderItemCount: 2,
    durationSec: 125,
    trackTypes: ['video', 'subtitle'],
    hasRequiredTracks: false,
    hasPlaceholderItems: true,
    hasOnlyPlaceholderItems: false,
    ...overrides,
  }
}

function tagTypes(root) {
  return findByType(root, 'span')
    .filter((node) => Object.prototype.hasOwnProperty.call(node.props || {}, 'data-el-tag'))
    .map((node) => node.props['data-el-tag'])
}

function disabledGates(root) {
  return findAll(root, (node) => node.props?.['aria-disabled'] === 'true' || node.props?.['aria-disabled'] === true)
}

function mountQa(initial = {}) {
  const events = []
  const mounted = mountHarness(renderer, () => h(SourceIntakeQaStageCard, {
    qaPresentation: samplePresentation(initial.presentation),
    latestQa: emptyQa(initial.qa),
    qaReason: initial.qaReason || '',
    qaRunning: Boolean(initial.qaRunning),
    displayedQaIssues: initial.issues || [],
    displayedQaRecommendations: initial.recommendations || [],
    onRunQa: () => events.push('run-qa'),
    onSelectStep: (stepId) => events.push(['select-step', stepId]),
  }))
  return { ...mounted, events }
}

function mountRemediation(initial = {}) {
  const events = []
  const mounted = mountHarness(renderer, () => h(SourceIntakeRemediationStageCard, {
    latestQa: emptyQa(initial.qa),
    remediateReason: initial.remediateReason || '',
    remediating: Boolean(initial.remediating),
    remediationStatus: initial.remediationStatus || '',
    onRemediate: () => events.push('remediate'),
    onSelectStep: (stepId) => events.push(['select-step', stepId]),
  }))
  return { ...mounted, events }
}

function mountDelivery(initial = {}) {
  const events = []
  const mounted = mountHarness(renderer, () => h(SourceIntakeDeliveryStageCard, {
    timelineSummary: sampleTimeline(initial.timeline),
    dramaEpisodeCount: initial.dramaEpisodeCount || 0,
    formatDuration,
    onSelectStep: (stepId) => events.push(['select-step', stepId]),
  }))
  return { ...mounted, events }
}

test('父面板仍保留刷新、启动模式和 AI 配置入口，并把后续阶段交给子卡片', () => {
  assert.match(panelSource, /<ActionGate label="刷新" :reason="refreshBusyReason">/)
  assert.match(panelSource, /{{ loading \? '正在刷新' : '刷新' }}/)
  assert.match(panelSource, /<SourceIntakeLaunchModeCard/)
  assert.match(panelSource, /v-if="inspectedFlowStep\.id === 'intake' \|\| inspectedFlowStep\.id === 'process'"/)
  assert.match(panelSource, /@open-ai-config="openAiConfigForReadiness"/)
  assert.match(panelSource, /<SourceIntakeIntakeStageForm/)
  assert.match(panelSource, /v-model="form"/)
  assert.match(panelSource, /@source-file-change="handleSourceFile"/)
  assert.match(panelSource, /@start-workflow="startWorkflow"/)
  assert.match(panelSource, /<SourceIntakeProcessStageCard/)
  assert.match(panelSource, /@retry="retryRun"/)
  assert.match(panelSource, /class="poll-status-banner"/)
  assert.match(panelSource, /@click="resumePolling"/)
  assert.match(panelSource, /<SourceIntakeQaStageCard/)
  assert.match(panelSource, /<SourceIntakeRemediationStageCard/)
  assert.match(panelSource, /<SourceIntakeDeliveryStageCard/)
  assert.match(panelSource, /inspectedFlowStep\.id === 'qa'/)
  assert.match(panelSource, /inspectedFlowStep\.id === 'remediation'/)
  assert.match(launchSource, /aria-label="工作流启动模式"/)
  assert.match(launchSource, /前往 AI 配置/)
  assert.doesNotMatch(panelSource, /from 'element-plus'/)
})

test('QA 卡片空态展示中文引导，并把审计动作交给父级', () => {
  const harness = mountQa()
  try {
    const text = textContent(harness.root)
    assert.match(text, /草稿结构检查/)
    assert.match(text, /还没有 QA 结果/)
    assert.match(text, /执行 QA 审计/)
    assert.doesNotMatch(text, /Invalid Date/)
    assert.equal(findByClass(harness.root, 'qa-line').length, 0)
    buttonByText(harness.root, '去启动处理').props.onClick()
    const button = buttonByText(harness.root, '执行 QA 审计')
    assert.equal(Boolean(button.props.disabled), false)
    button.props.onClick()
    assert.deepEqual(harness.events, [['select-step', 'process'], 'run-qa'])
  } finally {
    harness.app.unmount()
  }
})

test('QA 卡片展示草稿通知、问题、检查项和建议，未知检查项回落到其他检查', () => {
  const harness = mountQa({
    qa: {
      id: 8,
      passed: false,
      issueCount: 2,
      checks: [
        { key: 'source_intake', passed: true },
        { key: 'vendor_specific', passed: false },
      ],
    },
    presentation: {
      scopeLabel: '草稿结构检查',
      scoreLabel: '草稿结构检查 80 分',
      statusLabel: '草稿结构检查未通过',
    },
    issues: [{ code: 'missing-track', message: '缺少对白轨道' }],
    recommendations: ['补齐对白后再交付'],
  })
  try {
    const text = textContent(harness.root)
    assert.match(text, /草稿结构检查 80 分/)
    assert.match(text, /该评分仅评估脚本与流程结构/)
    assert.match(text, /草稿结构检查未通过 \/ 2 个问题/)
    assert.match(text, /缺少对白轨道/)
    assert.match(text, /素材导入：通过/)
    assert.match(text, /其他检查：未通过/)
    assert.match(text, /补齐对白后再交付/)
    assert.match(text, /完整 QA 明细/)
    assert.deepEqual(tagTypes(harness.root), ['warning'])
    assert.doesNotMatch(text, /Invalid Date/)
    assert.doesNotMatch(text, /pass\/fail/)
  } finally {
    harness.app.unmount()
  }
})

test('QA 已通过但没有可展示说明时保留中文空态，并通过 ActionGate 暴露禁用原因', () => {
  const harness = mountQa({
    qa: { id: 9, passed: true, issueCount: 1, checks: [] },
    presentation: {
      scopeLabel: '正式交付检查',
      scoreLabel: '正式交付检查 95 分',
      statusLabel: '正式交付检查已通过',
      notice: '',
    },
    qaReason: '正在执行 QA 审计，请稍候。',
    qaRunning: true,
  })
  try {
    const text = textContent(harness.root)
    assert.match(text, /检查结果已记录，暂无可以展示的说明/)
    assert.match(text, /暂无可以展示的修复建议/)
    assert.doesNotMatch(text, /该评分仅评估脚本与流程结构/)
    assert.deepEqual(tagTypes(harness.root), ['success'])
    const button = buttonByText(harness.root, '执行 QA 审计')
    assert.equal(Boolean(button.props.disabled), true)
    assert.equal(Boolean(button.props['data-loading']), true)
    assert.deepEqual(actionGateReasons(harness.root), ['正在执行 QA 审计，请稍候。'])
    const gate = disabledGates(harness.root)[0]
    assert.equal(gate.props.role, 'group')
    assert.equal(String(gate.props.tabindex), '0')
    assert.equal(gate.props['aria-label'], '执行 QA 审计不可用：正在执行 QA 审计，请稍候。')
  } finally {
    harness.app.unmount()
  }
})

test('修复卡片列出自动与人工建议，并把一键修复交给父级', () => {
  const harness = mountRemediation({
    qa: {
      id: 3,
      passed: false,
      remediationActions: [
        { code: 'retry-media', label: '重跑媒体步骤', automated: true },
        { code: 'manual-copy', label: '核对文案', automated: false },
      ],
    },
    remediationStatus: '已提交自动修复，正在等待处理结果。',
  })
  try {
    const text = textContent(harness.root)
    assert.match(text, /修复建议/)
    assert.match(text, /重跑媒体步骤：可自动执行/)
    assert.match(text, /核对文案：需要人工处理/)
    assert.match(text, /已提交自动修复，正在等待处理结果。/)
    assert.doesNotMatch(text, /去执行 QA/)
    buttonByText(harness.root, '一键修复').props.onClick()
    assert.deepEqual(harness.events, ['remediate'])
  } finally {
    harness.app.unmount()
  }
})

test('修复卡片在 QA 已通过时提示无需修复，空态则回到 QA 步骤', () => {
  const passed = mountRemediation({ qa: { id: 4, passed: true, remediationActions: [] } })
  try {
    const text = textContent(passed.root)
    assert.match(text, /QA 已通过，不需要修复/)
    assert.equal(buttonByText(passed.root, '去执行 QA'), undefined)
  } finally {
    passed.app.unmount()
  }

  const empty = mountRemediation({
    qa: { passed: false, remediationActions: [] },
    remediateReason: '正在启动自动修复，请稍候。',
    remediating: true,
  })
  try {
    const text = textContent(empty.root)
    assert.match(text, /还没有可自动修复的建议/)
    const retry = buttonByText(empty.root, '去执行 QA')
    retry.props.onClick()
    assert.deepEqual(empty.events, [['select-step', 'qa']])
    const fixButton = buttonByText(empty.root, '一键修复')
    assert.equal(Boolean(fixButton.props.disabled), true)
    assert.deepEqual(actionGateReasons(empty.root), ['正在启动自动修复，请稍候。'])
    const gate = disabledGates(empty.root)[0]
    assert.equal(gate.props['aria-label'], '一键修复不可用：正在启动自动修复，请稍候。')
  } finally {
    empty.app.unmount()
  }
})

test('交付卡片展示剧集、轨道、时长和占位，并回到导入步骤', () => {
  const harness = mountDelivery()
  try {
    const text = textContent(harness.root)
    assert.match(text, /剧集 \/ 时间线/)
    assert.match(text, /3 集/)
    assert.match(text, /8 轨/)
    assert.match(text, /2:05/)
    assert.match(text, /视频 \/ 字幕/)
    assert.match(text, /2 条占位/)
    assert.match(text, /含占位/)
    assert.deepEqual(tagTypes(harness.root), ['warning'])
    assert.doesNotMatch(text, /Invalid Date/)
    buttonByText(harness.root, '继续导入故事素材').props.onClick()
    assert.deepEqual(harness.events, [['select-step', 'intake']])
  } finally {
    harness.app.unmount()
  }
})

test('交付卡片区分占位、缺轨、仅有剧集和完全空态', () => {
  const placeholderOnly = mountDelivery({
    timeline: {
      episodeCount: 1,
      trackCount: 1,
      itemCount: 2,
      placeholderItemCount: 2,
      durationSec: 0,
      trackTypes: ['video'],
      hasRequiredTracks: false,
      hasPlaceholderItems: true,
      hasOnlyPlaceholderItems: true,
    },
  })
  try {
    assert.match(textContent(placeholderOnly.root), /占位/)
    assert.doesNotMatch(textContent(placeholderOnly.root), /含占位/)
    assert.deepEqual(tagTypes(placeholderOnly.root), ['warning'])
  } finally {
    placeholderOnly.app.unmount()
  }

  const ready = mountDelivery({
    timeline: {
      episodeCount: 2,
      trackCount: 7,
      itemCount: 9,
      placeholderItemCount: 0,
      durationSec: 90,
      trackTypes: ['video', 'subtitle', 'voice', 'dialogue', 'effect', 'bgm', 'transition'],
      hasRequiredTracks: true,
      hasPlaceholderItems: false,
      hasOnlyPlaceholderItems: false,
    },
  })
  try {
    const text = textContent(ready.root)
    assert.match(text, /9 条/)
    assert.match(text, /1:30/)
    assert.deepEqual(tagTypes(ready.root), ['success'])
  } finally {
    ready.app.unmount()
  }

  const episodesOnly = mountDelivery({
    timeline: {
      episodeCount: 0,
      trackCount: 0,
      itemCount: 0,
      placeholderItemCount: 0,
      durationSec: 0,
      trackTypes: [],
      hasRequiredTracks: false,
      hasPlaceholderItems: false,
      hasOnlyPlaceholderItems: false,
    },
    dramaEpisodeCount: 4,
  })
  try {
    const text = textContent(episodesOnly.root)
    assert.match(text, /4 集已生成/)
    assert.match(text, /时间线尚未生成/)
    assert.equal(tagTypes(episodesOnly.root).length, 0)
  } finally {
    episodesOnly.app.unmount()
  }

  const empty = mountDelivery({
    timeline: {
      episodeCount: 0,
      trackCount: 0,
      itemCount: 0,
      placeholderItemCount: 0,
      durationSec: 0,
      trackTypes: [],
      hasRequiredTracks: false,
      hasPlaceholderItems: false,
      hasOnlyPlaceholderItems: false,
    },
  })
  try {
    assert.match(textContent(empty.root), /完成素材处理后，这里会显示剧集与时间线摘要/)
    buttonByText(empty.root, '去启动处理').props.onClick()
    assert.deepEqual(empty.events, [['select-step', 'process']])
  } finally {
    empty.app.unmount()
  }
})
