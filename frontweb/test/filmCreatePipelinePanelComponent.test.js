import test from 'node:test'
import assert from 'node:assert/strict'

import { h, nextTick, ref } from 'vue'

import {
  actionGateReasons,
  buttonByText,
  click,
  compileIconStub,
  compileSfc,
  createHostRenderer,
  dataModule,
  findByTestId,
  findByType,
  loadCompiledSfc,
  mountHarness,
  textContent,
  vueUrl,
} from './helpers/vueComponentHarness.js'

const actionGateUrl = new URL('../src/components/filmCreate/ActionGate.vue', import.meta.url)
const pipelinePanelUrl = new URL('../src/components/filmCreate/FilmCreatePipelinePanel.vue', import.meta.url)

const iconStubUrl = compileIconStub(['ArrowDown', 'ArrowRight', 'ArrowUp', 'Setting', 'VideoPlay'])
const stylePickerStubUrl = dataModule(`
  import { defineComponent, h } from ${JSON.stringify(vueUrl)}
  export default defineComponent({
    name: 'StylePickerButtonStub',
    props: { modelValue: { type: String, default: '' }, options: { type: Array, default: () => [] } },
    setup(props) {
      return () => h('button', { type: 'button', 'data-style-picker': 'true' }, props.modelValue || '风格')
    },
  })
`)
const compiledActionGateUrl = compileSfc(actionGateUrl, 'pipeline-panel-action-gate', new Map([['vue', vueUrl]]))
const FilmCreatePipelinePanel = await loadCompiledSfc(
  pipelinePanelUrl,
  'film-create-pipeline-panel-component',
  new Map([
    ['vue', vueUrl],
    ['@element-plus/icons-vue', iconStubUrl],
    ['@/components/StylePickerButton.vue', stylePickerStubUrl],
    ['@/components/filmCreate/ActionGate.vue', compiledActionGateUrl],
  ]),
)

const renderer = createHostRenderer()
const EMPTY_SCRIPT_REASON = '当前集还没有剧本，请先编写或导入剧本'
const pipelineEventListeners = {
  'onUpdate:aspectRatio': (value, events) => events.push(['update:aspectRatio', value]),
  'onUpdate:clipDuration': (value, events) => events.push(['update:clipDuration', value]),
  'onUpdate:scriptLanguage': (value, events) => events.push(['update:scriptLanguage', value]),
  'onUpdate:generationStyle': (value, events) => events.push(['update:generationStyle', value]),
  onSaveSettings: (value, events) => events.push(['save-settings', value]),
  onStartOneClick: (_value, events) => events.push(['start-one-click']),
  onStartTextFramework: (_value, events) => events.push(['start-text-framework']),
  onOpenAiConfig: (value, events) => events.push(['open-ai-config', value]),
  onPause: (_value, events) => events.push(['pause']),
  onResume: (_value, events) => events.push(['resume']),
  onCancel: (_value, events) => events.push(['cancel']),
  onSkipCountdown: (_value, events) => events.push(['skip-countdown']),
  onRetryReadiness: (_value, events) => events.push(['retry-readiness']),
  onAddEpisode: (_value, events) => events.push(['add-episode']),
}

function mountPipeline(initialProps = {}) {
  const props = ref({
    aspectRatio: '16:9',
    clipDuration: 5,
    scriptLanguage: 'zh',
    generationStyle: '',
    generationStyleOptions: [],
    disabledReason: '',
    productionDisabledReason: '',
    draftDisabledReason: '',
    productionReadinessReason: '',
    productionReadinessState: 'ready',
    productionReadinessServiceType: '',
    hasEpisode: true,
    starting: false,
    stopping: false,
    stopRequired: false,
    running: false,
    paused: false,
    errorLog: [],
    currentStep: '',
    stepIndex: 0,
    stepTotal: 0,
    countdown: 0,
    countdownMessage: '',
    activeTasks: [],
    ...initialProps,
  })
  const events = []
  const mounted = mountHarness(renderer, () => {
    const listeners = {}
    for (const [name, listener] of Object.entries(pipelineEventListeners)) {
      listeners[name] = (value) => listener(value, events)
    }
    return h(FilmCreatePipelinePanel, { ...props.value, ...listeners })
  })
  return { ...mounted, events, props }
}

function requireButton(root, label) {
  const button = buttonByText(root, label)
  assert.ok(button, `缺少按钮：${label}`)
  return button
}

test('空剧本时一键成片和文本框架都展示中文禁用原因，不会启动生成', () => {
  const harness = mountPipeline({
    productionDisabledReason: EMPTY_SCRIPT_REASON,
    draftDisabledReason: EMPTY_SCRIPT_REASON,
  })
  try {
    const production = requireButton(harness.root, '一键生成成片')
    const draft = requireButton(harness.root, '仅生成文本框架')
    assert.equal(production.props.disabled, true)
    assert.equal(draft.props.disabled, true)
    assert.deepEqual(actionGateReasons(harness.root), [EMPTY_SCRIPT_REASON, EMPTY_SCRIPT_REASON])
    const gates = findByType(harness.root, 'span').filter((node) => node.props?.role === 'group')
    assert.ok(gates.some((gate) => gate.props['aria-label'] === `一键生成成片不可用：${EMPTY_SCRIPT_REASON}`))
    assert.ok(gates.some((gate) => gate.props['aria-label'] === `仅生成文本框架不可用：${EMPTY_SCRIPT_REASON}`))
    assert.equal(findByTestId(harness.root, 'film-pipeline-action').length, 0)
  } finally {
    harness.app.unmount()
  }
})

test('停止中禁用暂停/停止/倒计时暂停，紧凑入口不再提供启动', async () => {
  const harness = mountPipeline({
    running: true,
    stopping: true,
    countdown: 8,
    countdownMessage: '即将进入下一阶段',
    currentStep: '[步骤 3/5] 正在生成分镜视频',
    stepIndex: 3,
    stepTotal: 5,
  })
  try {
    await nextTick()
    assert.match(textContent(harness.root), /正在停止全流程，请稍候/)
    assert.match(textContent(harness.root), /即将进入下一阶段/)
    assert.match(textContent(harness.root), /正在生成分镜视频/)
    assert.doesNotMatch(textContent(harness.root), /\[步骤 3\/5\]/)
    assert.equal(requireButton(harness.root, '暂停').props.disabled, true)
    assert.equal(requireButton(harness.root, '停止').props.disabled, true)
    assert.equal(requireButton(harness.root, '暂停倒计时').props.disabled, true)
    assert.equal(findByTestId(harness.root, 'film-pipeline-action').length, 0)
    click(requireButton(harness.root, '立即开始下一阶段'))
    assert.deepEqual(harness.events, [['skip-countdown']])
  } finally {
    harness.app.unmount()
  }
})

test('启动检查中紧凑入口不会误触发一键成片', async () => {
  const harness = mountPipeline({
    starting: true,
    productionReadinessState: 'ready',
  })
  try {
    await nextTick()
    const compact = findByTestId(harness.root, 'film-pipeline-action')[0]
    assert.ok(compact)
    assert.equal(compact.props.disabled, true)
    assert.equal(compact.props['aria-label'], '一键生成成片不可用：正在确认完整成片的运行条件')
    click(compact)
    assert.deepEqual(harness.events, [])
    assert.equal(requireButton(harness.root, '一键生成成片').props.disabled, true)
  } finally {
    harness.app.unmount()
  }
})

test('停止受阻时工具条只留重试停止，倒计时暂停仍可点', async () => {
  const harness = mountPipeline({
    running: true,
    stopRequired: true,
    countdown: 4,
    countdownMessage: '等待远端任务结束',
  })
  try {
    await nextTick()
    assert.equal(buttonByText(harness.root, '暂停'), undefined)
    assert.equal(buttonByText(harness.root, '继续'), undefined)
    const retryStop = requireButton(harness.root, '重试停止')
    assert.notEqual(retryStop.props.disabled, true)
    click(retryStop)
    click(requireButton(harness.root, '立即开始下一阶段'))
    assert.deepEqual(harness.events, [['cancel'], ['skip-countdown']])
    assert.ok(buttonByText(harness.root, '暂停倒计时'), '倒计时暂停入口仍在，因为停止受阻时 pauseDisabledReason 为空')
    assert.match(textContent(harness.root), /等待远端任务结束/)
    assert.match(textContent(harness.root), /全流程停止未完成/)
  } finally {
    harness.app.unmount()
  }
})

test('倒计时暂停后展示继续提示，英文错误日志收成中文', async () => {
  const harness = mountPipeline({
    running: true,
    paused: true,
    countdown: 6,
    countdownMessage: '等待供应商资源就绪',
    errorLog: [{ step: '分镜生图', message: 'Network Error' }],
  })
  try {
    await nextTick()
    assert.match(textContent(harness.root), /已暂停，点击“继续”恢复/)
    assert.equal(buttonByText(harness.root, '暂停倒计时'), undefined)
    click(requireButton(harness.root, '继续'))
    assert.deepEqual(harness.events, [['resume']])
    assert.match(textContent(harness.root), /\[分镜生图\] 操作失败，请稍后重试/)
    assert.doesNotMatch(textContent(harness.root), /Network Error/)
  } finally {
    harness.app.unmount()
  }
})