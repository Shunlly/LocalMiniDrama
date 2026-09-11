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
  findAll,
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
function compilePipelineChild(name, id) {
  return compileSfc(
    new URL(`../src/components/filmCreate/${name}`, import.meta.url),
    id,
    new Map([
      ['vue', vueUrl],
      ['@/components/filmCreate/ActionGate.vue', compiledActionGateUrl],
    ]),
  )
}
const compiledPipelineActionsUrl = compilePipelineChild('FilmCreatePipelineActions.vue', 'pipeline-panel-actions')
const compiledPipelineStepsUrl = compilePipelineChild('FilmCreatePipelineSteps.vue', 'pipeline-panel-steps')
const compiledPipelineStatusUrl = compilePipelineChild('FilmCreatePipelineStatus.vue', 'pipeline-panel-status')
const FilmCreatePipelinePanel = await loadCompiledSfc(
  pipelinePanelUrl,
  'film-create-pipeline-panel-component',
  new Map([
    ['vue', vueUrl],
    ['@element-plus/icons-vue', iconStubUrl],
    ['@/components/StylePickerButton.vue', stylePickerStubUrl],
    ['@/components/filmCreate/ActionGate.vue', compiledActionGateUrl],
    ['./FilmCreatePipelineActions.vue', compiledPipelineActionsUrl],
    ['./FilmCreatePipelineSteps.vue', compiledPipelineStepsUrl],
    ['./FilmCreatePipelineStatus.vue', compiledPipelineStatusUrl],
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
    assert.equal(production.props.title, EMPTY_SCRIPT_REASON)
    assert.equal(draft.props.title, EMPTY_SCRIPT_REASON)
    assert.equal(production.props['aria-label'], `一键生成成片不可用：${EMPTY_SCRIPT_REASON}`)
    assert.equal(draft.props['aria-label'], `仅生成文本框架不可用：${EMPTY_SCRIPT_REASON}`)
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
    const skip = requireButton(harness.root, '立即开始下一阶段')
    assert.equal(skip.props.disabled, true)
    assert.match(skip.props['aria-label'], /正在停止全流程/)
    const countdown = findByTestId(harness.root, 'film-pipeline-countdown')[0]
    assert.ok(countdown)
    assert.equal(countdown.props.role, 'timer')
    assert.match(countdown.props['aria-label'], /剩余 8 秒/)
    click(skip)
    assert.deepEqual(harness.events, [])
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
    const skip = requireButton(harness.root, '立即开始下一阶段')
    assert.equal(skip.props.disabled, true)
    assert.match(skip.props['aria-label'], /停止未完成/)
    const pauseCountdown = requireButton(harness.root, '暂停倒计时')
    assert.equal(pauseCountdown.props.disabled, true)
    assert.match(String(pauseCountdown.props['aria-label'] || pauseCountdown.props.title || ''), /停止未完成/)
    click(retryStop)
    click(skip)
    assert.deepEqual(harness.events, [['cancel']])
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

test('展开按钮有中文名称，启动中一键成片给出读屏原因', async () => {
  const harness = mountPipeline({
    starting: true,
    productionReadinessState: 'ready',
  })
  try {
    await nextTick()
    const toggle = findByTestId(harness.root, 'film-pipeline-toggle')[0]
    assert.ok(toggle)
    assert.equal(toggle.props['aria-label'], '展开全流程详情')
    assert.equal(toggle.props.title, '展开全流程详情')
    const compact = findByTestId(harness.root, 'film-pipeline-action')[0]
    assert.ok(compact)
    assert.equal(compact.props.title, '正在确认完整成片的运行条件')
    assert.equal(compact.props['aria-label'], '一键生成成片不可用：正在确认完整成片的运行条件')
    const production = findByType(harness.root, 'button').find((node) => (
      textContent(node).replace(/\s+/g, ' ').trim() === '一键生成成片' && node !== compact
    ))
    assert.ok(production)
    assert.equal(production.props.disabled, true)
    assert.equal(production.props.title, '正在确认完整成片的运行条件')
    assert.equal(production.props['aria-label'], '正在确认完整成片的运行条件')
    const settings = requireButton(harness.root, '生成设置')
    assert.equal(settings.props['aria-label'], '全流程生成设置')
  } finally {
    harness.app.unmount()
  }
})

test('没有剧集时空态下一步是添加一集', async () => {
  const harness = mountPipeline({ hasEpisode: false })
  try {
    await nextTick()
    assert.match(textContent(harness.root), /还没有剧集/)
    assert.match(textContent(harness.root), /下一步/)
    const add = findByTestId(harness.root, 'film-pipeline-empty-action')[0]
    assert.ok(add)
    assert.equal(add.props['aria-label'], '添加一集')
    click(add)
    assert.deepEqual(harness.events, [['add-episode']])
  } finally {
    harness.app.unmount()
  }
})


test('就绪后紧凑入口会启动一键成片，能力检查失败则重试', async () => {
  const ready = mountPipeline({ productionReadinessState: 'ready' })
  try {
    await nextTick()
    const compact = findByTestId(ready.root, 'film-pipeline-action')[0]
    assert.ok(compact)
    assert.notEqual(compact.props.disabled, true)
    assert.equal(compact.props['aria-label'], '一键生成成片')
    click(compact)
    assert.deepEqual(ready.events, [['start-one-click']])
  } finally {
    ready.app.unmount()
  }

  const failed = mountPipeline({ productionReadinessState: 'error' })
  try {
    await nextTick()
    click(findByTestId(failed.root, 'film-pipeline-action')[0])
    const retry = requireButton(failed.root, '重试检查')
    assert.equal(retry.props['aria-label'], '重试检查')
    click(retry)
    assert.deepEqual(failed.events, [['retry-readiness'], ['retry-readiness']])
  } finally {
    failed.app.unmount()
  }

  const missing = mountPipeline({
    productionReadinessState: 'missing',
    productionReadinessServiceType: 'video',
  })
  try {
    await nextTick()
    const primary = findByTestId(missing.root, 'film-pipeline-action')[0]
    const secondary = findByTestId(missing.root, 'film-pipeline-secondary-action')[0]
    assert.ok(primary)
    assert.ok(secondary)
    assert.match(textContent(primary), /先跑草稿预演/)
    assert.match(textContent(secondary), /配置缺失服务/)
    assert.match(secondary.props.class, /is-secondary/)
    assert.notEqual(primary.props.disabled, true)
    assert.equal(requireButton(missing.root, '一键生成成片').props.disabled, true)
    assert.notEqual(requireButton(missing.root, '仅生成文本框架').props.disabled, true)
    const config = requireButton(missing.root, '前往 AI 配置')
    assert.equal(config.props['aria-label'], '前往 AI 配置')
    click(primary)
    click(secondary)
    assert.deepEqual(missing.events, [['start-text-framework'], ['open-ai-config', 'video']])
  } finally {
    missing.app.unmount()
  }
})

test('运行中可暂停和停止；生成设置改比例会保存', async () => {
  const harness = mountPipeline({ running: true, currentStep: '分镜生图', stepIndex: 2, stepTotal: 6 })
  try {
    await nextTick()
    const pause = requireButton(harness.root, '暂停')
    const stop = requireButton(harness.root, '停止')
    assert.equal(pause.props['aria-label'], '暂停')
    assert.equal(stop.props['aria-label'], '停止')
    click(pause)
    click(stop)
    const ratio = findAll(harness.root, (node) => node.type === 'select' && node.props?.['aria-label'] === '生成设置：画面比例')[0]
    assert.ok(ratio)
    ratio.props.onChange({ target: { value: '9:16' } })
    assert.deepEqual(harness.events, [
      ['pause'],
      ['cancel'],
      ['update:aspectRatio', '9:16'],
      ['save-settings', false],
    ])
  } finally {
    harness.app.unmount()
  }
})

test('缺配置时主次按钮与 readiness 一致，倒计时英文收成中文', async () => {
  const missing = mountPipeline({
    productionReadinessState: 'missing',
    productionReadinessServiceType: 'tts',
  })
  try {
    await nextTick()
    const compact = findByTestId(missing.root, 'film-pipeline-action')[0]
    const secondary = findByTestId(missing.root, 'film-pipeline-secondary-action')[0]
    assert.match(textContent(compact), /先跑草稿预演/)
    assert.match(textContent(secondary), /配置缺失服务/)
    assert.match(secondary.props.class, /is-secondary/)
    assert.equal(requireButton(missing.root, '一键生成成片').props.disabled, true)
    assert.notEqual(requireButton(missing.root, '仅生成文本框架').props.disabled, true)
  } finally {
    missing.app.unmount()
  }

  const countdown = mountPipeline({
    running: true,
    countdown: 6,
    countdownMessage: 'timeout of 15000ms',
    currentStep: 'Failed to fetch storyboard',
  })
  try {
    await nextTick()
    assert.doesNotMatch(textContent(countdown.root), /timeout of 15000ms|Failed to fetch/i)
    assert.match(textContent(countdown.root), /即将进入下一阶段|正在执行全流程生成/)
    const region = findByTestId(countdown.root, 'film-pipeline-countdown')[0]
    assert.equal(region.props.role, 'timer')
    assert.match(region.props['aria-label'], /剩余 6 秒/)
    assert.doesNotMatch(region.props['aria-label'], /timeout of 15000ms|Failed to fetch/i)
    const skip = findByTestId(countdown.root, 'film-pipeline-skip-countdown')[0]
    assert.ok(skip)
    assert.notEqual(skip.props.disabled, true)
    assert.equal(skip.props['aria-label'], '立即开始下一阶段')
  } finally {
    countdown.app.unmount()
  }
})
