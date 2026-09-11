import test from 'node:test'
import assert from 'node:assert/strict'

import { h, nextTick, ref } from 'vue'

import {
  buttonByText,
  compileIconStub,
  createHostRenderer,
  findByClass,
  findByType,
  loadCompiledSfc,
  mountHarness,
  textContent,
  vueUrl,
} from './helpers/vueComponentHarness.js'

const stageUrl = new URL('../src/components/sourceIntake/SourceIntakeCurrentStageCard.vue', import.meta.url)
const launchUrl = new URL('../src/components/sourceIntake/SourceIntakeLaunchModeCard.vue', import.meta.url)
const iconStubUrl = compileIconStub(['Setting'])
const SourceIntakeCurrentStageCard = await loadCompiledSfc(stageUrl, 'source-intake-current-stage-card')
const SourceIntakeLaunchModeCard = await loadCompiledSfc(
  launchUrl,
  'source-intake-launch-mode-card',
  new Map([
    ['vue', vueUrl],
    ['@element-plus/icons-vue', iconStubUrl],
  ]),
)
const renderer = createHostRenderer()

function sampleStep(overrides = {}) {
  return {
    id: 'intake',
    number: 1,
    label: '导入素材',
    summary: '已导入 1 条',
    status: 'done',
    statusLabel: '已完成',
    ...overrides,
  }
}

function mountStage(step = {}) {
  return mountHarness(renderer, () => h(SourceIntakeCurrentStageCard, {
    inspectedFlowStep: sampleStep(step),
  }))
}

function mountLaunch(initial = {}) {
  const workflowMode = ref(initial.mode || 'draft')
  const events = []
  const mounted = mountHarness(renderer, () => h(SourceIntakeLaunchModeCard, {
    workflowMode: workflowMode.value,
    'onUpdate:workflowMode': (value) => {
      workflowMode.value = value
    },
    workflowModeShortLabel: workflowMode.value === 'production' ? '正式制作' : '草稿预演',
    workflowModeDescription: workflowMode.value === 'production'
      ? '调用正式 AI 服务生成可交付媒体。'
      : '用于快速验证改编与镜头流程。',
    isWorkflowLaunchBusy: Boolean(initial.busy),
    sourceUploadBusyReason: initial.busyReason || '',
    readinessChecking: Boolean(initial.checking),
    productionReadiness: initial.readiness ?? null,
    onChange: () => events.push('change'),
    onOpenAiConfig: () => events.push('open-ai-config'),
  }))
  return { ...mounted, events, workflowMode }
}

function tagTypes(root) {
  return findByType(root, 'span')
    .filter((node) => Object.prototype.hasOwnProperty.call(node.props || {}, 'data-el-tag'))
    .map((node) => node.props['data-el-tag'])
}

test('当前阶段卡片展示查看中步骤的编号、摘要和状态标签', () => {
  const harness = mountStage()
  try {
    const text = textContent(harness.root)
    assert.match(text, /导入素材/)
    assert.match(text, /已导入 1 条/)
    assert.match(text, /已完成/)
    assert.match(text, /1/)
    assert.deepEqual(tagTypes(harness.root), ['success'])
    assert.equal(findByClass(harness.root, 'workflow-focus-head').length, 1)
    assert.equal(findByClass(harness.root, 'stage-number').length, 1)
  } finally {
    harness.app.unmount()
  }
})

test('当前阶段状态标签按 done/active/blocked 映射颜色', () => {
  const cases = [
    ['done', 'success'],
    ['partial', 'warning'],
    ['active', 'warning'],
    ['error', 'danger'],
    ['blocked', 'danger'],
    ['ready', 'info'],
  ]
  for (const [status, tag] of cases) {
    const harness = mountStage({ status, statusLabel: status })
    try {
      assert.deepEqual(tagTypes(harness.root), [tag], status)
    } finally {
      harness.app.unmount()
    }
  }
})

test('启动模式卡片默认展示草稿预演，并把模式切换事件交给父级', async () => {
  const harness = mountLaunch()
  try {
    const text = textContent(harness.root)
    assert.match(text, /启动模式/)
    assert.match(text, /草稿预演/)
    assert.match(text, /正式制作/)
    assert.match(text, /用于快速验证/)
    assert.equal(findByClass(harness.root, 'production-readiness').length, 0)
    assert.doesNotMatch(text, /Invalid Date/)

    const group = findByType(harness.root, 'radio-group')[0]
    assert.equal(group.props['aria-label'], '工作流启动模式')
    assert.equal(Boolean(group.props.disabled), false)
    group.props.onSelect('production')
    await nextTick()
    assert.equal(harness.workflowMode.value, 'production')
    assert.deepEqual(harness.events, ['change'])
  } finally {
    harness.app.unmount()
  }
})

test('启动忙时禁用模式切换并展示中文原因，不混入 newWorkflowRunReason', () => {
  const harness = mountLaunch({
    busy: true,
    busyReason: '正在启动 草稿预演，请稍候。',
  })
  try {
    const text = textContent(harness.root)
    assert.match(text, /正在启动 草稿预演，请稍候。/)
    const group = findByType(harness.root, 'radio-group')[0]
    assert.equal(Boolean(group.props.disabled), true)
    assert.equal(findByClass(harness.root, 'action-reason').length, 1)
    assert.doesNotMatch(text, /newWorkflowRunReason/)
  } finally {
    harness.app.unmount()
  }
})

test('正式制作缺口时提示不能启动，并交出 AI 配置入口', () => {
  const harness = mountLaunch({
    mode: 'production',
    readiness: {
      ready: false,
      missing_capabilities: [
        { key: 'text', label: '文本模型', detail: '未配置可用文本服务' },
      ],
    },
  })
  try {
    const text = textContent(harness.root)
    assert.match(text, /正式制作暂不能启动/)
    assert.match(text, /文本模型/)
    assert.match(text, /未配置可用文本服务/)
    const readiness = findByClass(harness.root, 'production-readiness')[0]
    assert.equal(readiness.props.role, 'alert')
    const configButton = buttonByText(harness.root, '前往 AI 配置')
    assert.ok(configButton)
    configButton.props.onClick()
    assert.deepEqual(harness.events, ['open-ai-config'])
  } finally {
    harness.app.unmount()
  }
})

test('正式制作检查中与就绪时不展示缺口入口', () => {
  const checking = mountLaunch({ mode: 'production', checking: true, readiness: { ready: false, missing_capabilities: [] } })
  try {
    const text = textContent(checking.root)
    assert.match(text, /正在检查正式制作能力/)
    assert.match(text, /正在核对文本/)
    assert.equal(buttonByText(checking.root, '前往 AI 配置'), undefined)
  } finally {
    checking.app.unmount()
  }

  const ready = mountLaunch({
    mode: 'production',
    readiness: { ready: true, missing_capabilities: [] },
  })
  try {
    const text = textContent(ready.root)
    assert.match(text, /正式制作能力已就绪/)
    assert.equal(buttonByText(ready.root, '前往 AI 配置'), undefined)
    const readiness = findByClass(ready.root, 'production-readiness')[0]
    assert.equal(readiness.props.role, 'status')
  } finally {
    ready.app.unmount()
  }
})
