import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { compileScript, parse } from '@vue/compiler-sfc'
import { createRenderer, defineComponent, h, nextTick, ref } from 'vue'

const vueUrl = import.meta.resolve('vue')
const actionGateUrl = new URL('../src/components/filmCreate/ActionGate.vue', import.meta.url)
const canvasActionGateUrl = new URL('../src/components/dramaCanvas/CanvasActionGate.vue', import.meta.url)
const pipelinePanelUrl = new URL('../src/components/filmCreate/FilmCreatePipelinePanel.vue', import.meta.url)
const disclosureStateUrl = new URL('../src/composables/useDisclosureState.js', import.meta.url)
const filmPipelineActionUrl = new URL('../src/utils/filmPipelineAction.js', import.meta.url)
const filmCreateSource = readFileSync(new URL('../src/views/FilmCreate.vue', import.meta.url), 'utf8')

test('FilmCreate script compiles without duplicate bindings', () => {
  const parsed = parse(filmCreateSource, { filename: 'FilmCreate.vue' })
  assert.deepEqual(parsed.errors, [])
  assert.doesNotThrow(() => compileScript(parsed.descriptor, { id: 'film-create-contract' }))
})

test('storyboard insertion command names the object it creates', () => {
  assert.doesNotMatch(filmCreateSource, />\s*＋ 新增\s*<\/el-button>/)
  assert.match(filmCreateSource, /:aria-label="`在分镜\$\{i \+ 1\}前插入新分镜`"/)
  assert.match(filmCreateSource, /<span>插入分镜<\/span>/)
})

function dataModule(source) {
  return `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
}

function compileSfc(componentUrl, id, replacements = new Map()) {
  const source = readFileSync(componentUrl, 'utf8')
  const { descriptor } = parse(source, { filename: componentUrl.pathname })
  let compiledSource = compileScript(descriptor, { id, inlineTemplate: true }).content

  for (const [specifier, resolved] of replacements) {
    compiledSource = compiledSource
      .replaceAll(`from '${specifier}'`, `from '${resolved}'`)
      .replaceAll(`from "${specifier}"`, `from "${resolved}"`)
  }
  return dataModule(compiledSource)
}

const iconStubUrl = dataModule(`
  import { defineComponent, h } from ${JSON.stringify(vueUrl)}
  const icon = (name) => defineComponent({
    name,
    setup() { return () => h('span', { 'data-icon': name }) },
  })
  export const ArrowDown = icon('ArrowDown')
  export const ArrowRight = icon('ArrowRight')
  export const ArrowUp = icon('ArrowUp')
  export const Setting = icon('Setting')
  export const VideoPlay = icon('VideoPlay')
`)

const disclosureStateModuleUrl = dataModule(
  readFileSync(disclosureStateUrl, 'utf8')
    .replace("from 'vue'", `from ${JSON.stringify(vueUrl)}`),
)

const filmPipelineActionModuleUrl = dataModule(readFileSync(filmPipelineActionUrl, 'utf8'))

const stylePickerStubUrl = dataModule(`
  import { defineComponent, h } from ${JSON.stringify(vueUrl)}
  export default defineComponent({
    name: 'StylePickerButtonStub',
    props: {
      modelValue: { type: String, default: '' },
      options: { type: Array, default: () => [] },
    },
    emits: ['update:modelValue', 'change'],
    setup(props, { emit }) {
      return () => h('button', {
        type: 'button',
        'data-style-picker': 'true',
        onClick: () => {
          emit('update:modelValue', 'runtime-style')
          emit('change', 'runtime-style')
        },
      }, props.modelValue || 'Choose style')
    },
  })
`)

const compiledActionGateUrl = compileSfc(actionGateUrl, 'film-action-gate-contract', new Map([
  ['vue', vueUrl],
]))

const compiledCanvasActionGateUrl = compileSfc(canvasActionGateUrl, 'canvas-action-gate-contract', new Map([
  ['vue', vueUrl],
]))

const compiledPipelinePanelUrl = compileSfc(
  pipelinePanelUrl,
  'film-pipeline-panel-contract',
  new Map([
    ['vue', vueUrl],
    ['@element-plus/icons-vue', iconStubUrl],
    ['@/components/StylePickerButton.vue', stylePickerStubUrl],
    ['@/components/filmCreate/ActionGate.vue', compiledActionGateUrl],
    ['@/composables/useDisclosureState', disclosureStateModuleUrl],
    ['@/utils/filmPipelineAction', filmPipelineActionModuleUrl],
  ]),
)

const ActionGate = (await import(compiledActionGateUrl)).default
const CanvasActionGate = (await import(compiledCanvasActionGateUrl)).default
const FilmCreatePipelinePanel = (await import(compiledPipelinePanelUrl)).default

test('FilmCreate never renders or forwards raw storyboard placeholder URLs', () => {
  assert.match(filmCreateSource, /v-else-if="storyboardImageUrl\(sb\)"/)
  assert.match(filmCreateSource, /return storyboardImageUrl\(sb\)/)
  assert.doesNotMatch(filmCreateSource, /v-else-if="sb\.(?:image_url|composed_image)/)
  assert.doesNotMatch(filmCreateSource, /imageUrl\(sb\.composed_image \|\| sb\.image_url\)/)
})

test('FilmCreate localizes legacy workflow camera movement values', () => {
  assert.match(filmCreateSource, /'slow push in': '缓慢推镜'/)
  assert.match(filmCreateSource, /'static hold': '固定镜头'/)
})

function createHostNode(type, text = '') {
  return { type, text, props: {}, style: {}, children: [], parent: null }
}

function insertHostNode(child, parent, anchor = null) {
  if (child.parent) {
    const currentIndex = child.parent.children.indexOf(child)
    if (currentIndex >= 0) child.parent.children.splice(currentIndex, 1)
  }
  child.parent = parent
  const anchorIndex = anchor ? parent.children.indexOf(anchor) : -1
  if (anchorIndex >= 0) parent.children.splice(anchorIndex, 0, child)
  else parent.children.push(child)
}

const renderer = createRenderer({
  patchProp(element, key, _previous, next) {
    element.props[key] = next
  },
  insert: insertHostNode,
  remove(child) {
    if (!child.parent) return
    const index = child.parent.children.indexOf(child)
    if (index >= 0) child.parent.children.splice(index, 1)
    child.parent = null
  },
  createElement(type) {
    return createHostNode(type)
  },
  createText(text) {
    return createHostNode('#text', text)
  },
  createComment(text) {
    return createHostNode('#comment', text)
  },
  setText(node, text) {
    node.text = text
  },
  setElementText(node, text) {
    const child = createHostNode('#text', text)
    child.parent = node
    node.children = [child]
  },
  parentNode(node) {
    return node.parent
  },
  nextSibling(node) {
    if (!node.parent) return null
    return node.parent.children[node.parent.children.indexOf(node) + 1] || null
  },
  querySelector() {
    return null
  },
  setScopeId(element, id) {
    if (!element.scopeIds) element.scopeIds = []
    element.scopeIds.push(id)
  },
  cloneNode(node) {
    return { ...node, props: { ...node.props }, children: [...node.children] }
  },
  insertStaticContent(content, parent, anchor) {
    const node = createHostNode('#static', content)
    insertHostNode(node, parent, anchor)
    return [node, node]
  },
})

const ElTooltipStub = defineComponent({
  props: ['content'],
  setup(props, { slots }) {
    return () => h('tooltip', { 'data-content': props.content }, slots.default?.())
  },
})

const ElPopoverStub = defineComponent({
  setup(_props, { slots }) {
    return () => h('popover', {}, [
      h('reference-slot', {}, slots.reference?.()),
      h('content-slot', {}, slots.default?.()),
    ])
  },
})

const ElButtonStub = defineComponent({
  props: ['disabled', 'loading', 'nativeType', 'plain', 'size', 'type'],
  setup(props, { attrs, slots }) {
    return () => h('button', {
      ...attrs,
      disabled: Boolean(props.disabled),
      type: props.nativeType || 'button',
      'data-loading': Boolean(props.loading),
      'data-variant': props.type || '',
    }, slots.default?.())
  },
})

const ElSelectStub = defineComponent({
  props: ['modelValue'],
  emits: ['update:modelValue'],
  setup(props, { attrs, emit, slots }) {
    return () => h('select', {
      ...attrs,
      value: props.modelValue,
      onChange: (event) => {
        const value = typeof props.modelValue === 'number'
          ? Number(event.target.value)
          : event.target.value
        emit('update:modelValue', value)
      },
    }, slots.default?.())
  },
})

const ElOptionStub = defineComponent({
  props: ['label', 'value'],
  setup(props) {
    return () => h('option', { value: props.value }, props.label)
  },
})

const ElIconStub = defineComponent({
  setup(_props, { slots }) {
    return () => h('span', { 'data-element-icon': 'true' }, slots.default?.())
  },
})

function registerElementStubs(app) {
  app.component('el-tooltip', ElTooltipStub)
  app.component('el-popover', ElPopoverStub)
  app.component('el-button', ElButtonStub)
  app.component('el-select', ElSelectStub)
  app.component('el-option', ElOptionStub)
  app.component('el-icon', ElIconStub)
}

function findAll(node, predicate, matches = []) {
  if (predicate(node)) matches.push(node)
  for (const child of node.children || []) findAll(child, predicate, matches)
  return matches
}

function findByType(root, type) {
  return findAll(root, (node) => node.type === type)
}

function textContent(node) {
  return `${node.text || ''}${(node.children || []).map(textContent).join('')}`
}

function buttonByText(root, label) {
  const button = findByType(root, 'button').find((node) => textContent(node).trim() === label)
  assert.ok(button, `missing button: ${label}`)
  return button
}

function mountActionGate(initialReason = 'Select an episode') {
  const reason = ref(initialReason)
  const Harness = defineComponent({
    setup() {
      return () => h(ActionGate, {
        reason: reason.value,
        label: 'Generate video',
      }, {
        default: () => h('button', { type: 'button' }, 'Generate'),
      })
    },
  })
  const root = createHostNode('root')
  const app = renderer.createApp(Harness)
  registerElementStubs(app)
  app.mount(root)
  return { app, reason, root }
}

function mountCanvasActionGate(initialReason = 'Select an episode') {
  const Harness = defineComponent({
    setup() {
      return () => h(CanvasActionGate, {
        reason: initialReason,
        label: 'Generate video',
        descriptionId: 'canvas-test-disabled-reason',
      }, {
        default: () => h('button', { type: 'button', disabled: true }, 'Generate'),
      })
    },
  })
  const root = createHostNode('root')
  const app = renderer.createApp(Harness)
  registerElementStubs(app)
  app.mount(root)
  return { app, root }
}

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
    generationStyle: 'documentary',
    generationStyleOptions: [{ label: 'Documentary', value: 'documentary' }],
    disabledReason: '',
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
  const Harness = defineComponent({
    setup() {
      return () => {
        const listeners = {}
        for (const [name, listener] of Object.entries(pipelineEventListeners)) {
          listeners[name] = (value) => listener(value, events)
        }
        return h(FilmCreatePipelinePanel, { ...props.value, ...listeners })
      }
    },
  })
  const root = createHostNode('root')
  const app = renderer.createApp(Harness)
  registerElementStubs(app)
  app.mount(root)
  return { app, events, props, root }
}

test('pipeline disclosure starts compact, toggles, and auto-opens for running work', async () => {
  const harness = mountPipeline({
    productionDisabledReason: '缺少视频模型',
    productionReadinessReason: '缺少视频模型',
    productionReadinessState: 'missing',
  })
  try {
    const [toggle] = findAll(
      harness.root,
      (node) => node.props['data-testid'] === 'film-pipeline-toggle',
    )
    const [details] = findAll(
      harness.root,
      (node) => node.props['data-testid'] === 'film-pipeline-details',
    )
    const [summary] = findAll(
      harness.root,
      (node) => node.props['data-testid'] === 'film-pipeline-summary',
    )

    assert.ok(toggle)
    assert.ok(details)
    assert.ok(summary)
    assert.notEqual(summary.style.display, 'none')
    assert.equal(findAll(harness.root, (node) => node.props.id === 'pipeline-title').length, 1)
    assert.equal(findAll(harness.root, (node) => node.props.class === 'pipeline-heading').length, 1)
    assert.match(textContent(summary), /当前阻断/)
    assert.match(textContent(summary), /前往 AI 配置补齐完整成片能力/)
    assert.equal(toggle.type, 'button')
    assert.equal(toggle.props['aria-controls'], 'film-pipeline-details')
    assert.equal(toggle.props['aria-expanded'], false)
    assert.equal(details.style.display, 'none')

    toggle.props.onClick()
    await nextTick()
    assert.equal(toggle.props['aria-expanded'], true)
    assert.notEqual(details.style.display, 'none')
    assert.equal(findAll(details, (node) => node.props.class === 'pipeline-heading').length, 0)
    assert.equal(findAll(details, (node) => node.props.class === 'pipeline-focus-kicker').length, 0)
    assert.equal(findAll(details, (node) => node.props.class === 'pipeline-focus-title').length, 0)
    assert.equal(findAll(details, (node) => node.props.class === 'pipeline-next-step').length, 0)

    toggle.props.onClick()
    await nextTick()
    assert.equal(toggle.props['aria-expanded'], false)

    harness.props.value = { ...harness.props.value, running: true }
    await nextTick()
    assert.equal(toggle.props['aria-expanded'], true)
    assert.notEqual(details.style.display, 'none')

    harness.props.value = { ...harness.props.value, running: false }
    await nextTick()
    assert.equal(toggle.props['aria-expanded'], true)
  } finally {
    harness.app.unmount()
  }
})

test('pipeline compact status exposes the next executable command', async () => {
  const harness = mountPipeline({
    productionDisabledReason: '缺少视频模型',
    productionReadinessState: 'missing',
    productionReadinessServiceType: 'video',
  })
  try {
    const getAction = () => findAll(harness.root, (node) => node.props['data-testid'] === 'film-pipeline-action')[0]
    let action = getAction()

    assert.ok(action)
    assert.equal(action.type, 'button')
    assert.match(textContent(action), /配置缺失服务/)
    action.props.onClick()
    assert.deepEqual(harness.events, [['open-ai-config', 'video']])

    harness.props.value = {
      ...harness.props.value,
      productionDisabledReason: '',
      productionReadinessState: 'ready',
    }
    await nextTick()

    action = getAction()
    assert.match(textContent(action), /一键生成成片/)
    action.props.onClick()
    assert.deepEqual(harness.events, [['open-ai-config', 'video'], ['start-one-click']])
  } finally {
    harness.app.unmount()
  }
})

test('ActionGate mounts a keyboard-focusable accessible reason and removes it when enabled', async () => {
  const harness = mountActionGate()
  try {
    const [gate] = findAll(harness.root, (node) => node.props.role === 'group')
    assert.ok(gate)
    assert.equal(gate.props.tabindex, '0')
    assert.equal(gate.props['aria-disabled'], 'true')
    assert.match(gate.props['aria-label'], /Generate video/)
    assert.match(gate.props['aria-label'], /Select an episode/)
    assert.equal(findByType(harness.root, 'tooltip')[0].props['data-content'], 'Select an episode')

    harness.reason.value = ''
    await nextTick()

    assert.equal(findAll(harness.root, (node) => node.props.role === 'group').length, 0)
    assert.equal(findByType(harness.root, 'tooltip').length, 0)
    assert.equal(buttonByText(harness.root, 'Generate').props.disabled, undefined)
  } finally {
    harness.app.unmount()
  }
})

test('CanvasActionGate renders a runtime aria-describedby relationship', () => {
  const harness = mountCanvasActionGate()
  try {
    const [gate] = findAll(harness.root, (node) => node.props.role === 'group')
    assert.ok(gate)
    assert.equal(gate.props['aria-describedby'], 'canvas-test-disabled-reason')
    const [reason] = findAll(harness.root, (node) => node.props.id === 'canvas-test-disabled-reason')
    assert.ok(reason)
    assert.equal(textContent(reason), 'Select an episode')
  } finally {
    harness.app.unmount()
  }
})

test('pipeline disabledReason produces accessible gates and disables both start buttons', () => {
  const harness = mountPipeline({ disabledReason: 'Select an episode first' })
  try {
    const gates = findAll(harness.root, (node) => node.props.role === 'group')
    assert.equal(gates.length, 2)
    for (const gate of gates) {
      assert.equal(gate.props.tabindex, '0')
      assert.equal(gate.props['aria-disabled'], 'true')
      assert.match(gate.props['aria-label'], /Select an episode first/)
      const [button] = findByType(gate, 'button')
      assert.equal(button.props.disabled, true)
    }
    assert.equal(buttonByText(harness.root, '一键生成成片').props.disabled, true)
    assert.equal(buttonByText(harness.root, '仅生成文本框架').props.disabled, true)
    assert.deepEqual(
      findByType(harness.root, 'tooltip').map((node) => node.props['data-content']),
      ['Select an episode first', 'Select an episode first'],
    )
  } finally {
    harness.app.unmount()
  }
})

test('production video gate does not disable the Draft text framework', () => {
  const harness = mountPipeline({
    productionDisabledReason: '缺少视频模型',
    draftDisabledReason: '',
  })
  try {
    assert.equal(buttonByText(harness.root, '一键生成成片').props.disabled, true)
    assert.notEqual(buttonByText(harness.root, '仅生成文本框架').props.disabled, true)
    assert.equal(findAll(harness.root, (node) => node.props.role === 'group').length, 1)
  } finally {
    harness.app.unmount()
  }
})

test('pipeline keeps compact guidance visible and full reasons beside the primary CTA', () => {
  const reason = '文本模型、素材图片、分镜图片、视频模型和语音合成配置均缺少生产凭据，需要逐项补齐并验证连接后才能开始完整成片生成。'
  const harness = mountPipeline({
    productionDisabledReason: reason,
    productionReadinessReason: reason,
    productionReadinessState: 'missing',
  })
  try {
    const [summary] = findAll(harness.root, (node) => node.props['data-testid'] === 'film-pipeline-summary')
    const [focus] = findAll(harness.root, (node) => node.props.class === 'pipeline-focus')
    assert.ok(summary)
    assert.ok(focus)
    assert.match(textContent(summary), /当前阻断/)
    assert.match(textContent(summary), /前往 AI 配置补齐完整成片能力/)
    assert.doesNotMatch(textContent(focus), /当前阻断|下一步|前往 AI 配置补齐完整成片能力/)
    assert.ok(findByType(focus, 'button').some((node) => textContent(node).trim() === '一键生成成片'))

    const [details] = findByType(focus, 'details')
    assert.ok(details)
    assert.match(textContent(details), /查看完整原因/)
    assert.match(textContent(details), new RegExp(reason))
  } finally {
    harness.app.unmount()
  }
})

test('pipeline distinguishes readiness failures from missing AI configuration', () => {
  const harness = mountPipeline({
    productionDisabledReason: '无法确认完整成片制作能力，请刷新后重试。',
    productionReadinessReason: '无法确认完整成片制作能力，请刷新后重试。',
    productionReadinessState: 'error',
  })
  try {
    assert.match(textContent(harness.root), /重试检查/)
    assert.doesNotMatch(textContent(harness.root), /前往 AI 配置/)
    buttonByText(harness.root, '重试检查').props.onClick()
    assert.deepEqual(harness.events, [['retry-readiness']])
  } finally {
    harness.app.unmount()
  }
})

test('pipeline keeps readiness checking non-actionable until the check finishes', () => {
  const harness = mountPipeline({
    productionDisabledReason: '正在检查完整成片所需的 AI 服务与本地合成能力。',
    productionReadinessReason: '正在检查完整成片所需的 AI 服务与本地合成能力。',
    productionReadinessState: 'checking',
  })
  try {
    assert.match(textContent(harness.root), /等待检查完成/)
    assert.doesNotMatch(textContent(harness.root), /前往 AI 配置|重试检查/)
  } finally {
    harness.app.unmount()
  }
})

test('pipeline settings emit update events and persistence intent', () => {
  const harness = mountPipeline()
  try {
    const selects = findByType(harness.root, 'select')
    assert.deepEqual(selects.map((select) => select.props.value), ['16:9', 5, 'zh'])

    selects[0].props.onChange({ target: { value: '9:16' } })
    selects[1].props.onChange({ target: { value: '8' } })
    selects[2].props.onChange({ target: { value: 'en' } })
    findAll(harness.root, (node) => node.props['data-style-picker'] === 'true')[0].props.onClick()

    assert.deepEqual(harness.events, [
      ['update:aspectRatio', '9:16'],
      ['save-settings', false],
      ['update:clipDuration', 8],
      ['save-settings', false],
      ['update:scriptLanguage', 'en'],
      ['save-settings', false],
      ['update:generationStyle', 'runtime-style'],
      ['save-settings', true],
    ])
  } finally {
    harness.app.unmount()
  }
})

test('pipeline forwards start, pause, resume, stop, and countdown skip commands', async () => {
  const harness = mountPipeline()
  try {
    const [toggle] = findAll(harness.root, (node) => node.props['data-testid'] === 'film-pipeline-toggle')
    const [details] = findAll(harness.root, (node) => node.props['data-testid'] === 'film-pipeline-details')
    toggle.props.onClick()
    await nextTick()
    assert.notEqual(details.style.display, 'none')
    buttonByText(details, '一键生成成片').props.onClick()
    buttonByText(details, '仅生成文本框架').props.onClick()

    harness.props.value = {
      ...harness.props.value,
      running: true,
      countdown: 5,
      countdownMessage: 'Waiting for the next stage',
    }
    await nextTick()
    buttonByText(harness.root, '暂停').props.onClick()
    buttonByText(harness.root, '停止').props.onClick()
    buttonByText(harness.root, '立即开始下一阶段').props.onClick()

    harness.props.value = { ...harness.props.value, paused: true }
    await nextTick()
    buttonByText(harness.root, '继续').props.onClick()

    assert.deepEqual(harness.events, [
      ['start-one-click'],
      ['start-text-framework'],
      ['pause'],
      ['cancel'],
      ['skip-countdown'],
      ['resume'],
    ])
  } finally {
    harness.app.unmount()
  }
})

test('pipeline disables both launch commands while start checks are pending', async () => {
  const harness = mountPipeline({ starting: true })
  try {
    const [toggle] = findAll(harness.root, (node) => node.props['data-testid'] === 'film-pipeline-toggle')
    toggle.props.onClick()
    await nextTick()

    assert.equal(buttonByText(harness.root, '一键生成成片').props.disabled, true)
    assert.equal(buttonByText(harness.root, '仅生成文本框架').props.disabled, true)
  } finally {
    harness.app.unmount()
  }
})

test('pipeline cancellation failure exposes retry without pause or resume commands', async () => {
  const harness = mountPipeline({ running: true, stopRequired: true })
  try {
    assert.match(textContent(harness.root), /全流程停止未完成/)
    assert.ok(buttonByText(harness.root, '重试停止'))
    assert.doesNotMatch(textContent(harness.root), /暂停|继续/)
  } finally {
    harness.app.unmount()
  }
})

test('pipeline renders live progress, active tasks, countdown, and error details', () => {
  const harness = mountPipeline({
    running: true,
    currentStep: '[步骤 2/5] Rendering storyboards',
    stepIndex: 2,
    stepTotal: 5,
    countdown: 7,
    countdownMessage: 'Waiting for provider capacity',
    activeTasks: new Set(['Character task', 'Scene task']),
    errorLog: [{ step: 'Image generation', message: 'Provider failed' }],
  })
  try {
    const [status] = findAll(harness.root, (node) => node.props['aria-live'] === 'polite')
    assert.ok(status)
    const statusText = textContent(status)
    assert.match(statusText, /2\/5/)
    assert.match(statusText, /Rendering storyboards/)
    assert.doesNotMatch(statusText, /\[步骤 2\/5\]/)
    assert.match(statusText, /Waiting for provider capacity/)
    assert.match(statusText, /Character task/)
    assert.match(statusText, /Scene task/)

    const [alert] = findAll(status, (node) => node.props.role === 'alert')
    assert.match(textContent(alert), /Image generation/)
    assert.match(textContent(alert), /Provider failed/)
    assert.equal(buttonByText(harness.root, '一键生成成片').props['data-loading'], true)
    assert.equal(buttonByText(harness.root, '仅生成文本框架').props['data-loading'], true)
  } finally {
    harness.app.unmount()
  }
})
test('pipeline compact action can add the first episode', async () => {
  const harness = mountPipeline({
    productionDisabledReason: '请先创建或选择剧集',
    draftDisabledReason: '请先创建或选择剧集',
    hasEpisode: false,
    productionReadinessState: 'missing',
    productionReadinessServiceType: 'video',
  })
  try {
    const [action] = findAll(harness.root, (node) => node.props['data-testid'] === 'film-pipeline-action')
    assert.ok(action)
    assert.match(textContent(action), /添加一集/)
    action.props.onClick()
    assert.deepEqual(harness.events, [['add-episode']])
  } finally {
    harness.app.unmount()
  }
})

test('FilmCreate 把视频配置交给独立面板并保留成片选项', () => {
  const panel = readFileSync(new URL('../src/components/filmCreate/FilmCreateVideoSettingsPanel.vue', import.meta.url), 'utf8')
  assert.match(filmCreateSource, /<FilmCreateVideoSettingsPanel/)
  assert.match(filmCreateSource, /v-model:resolution="videoResolution"/)
  assert.match(filmCreateSource, /@open-ai-config="openAiConfig"/)
  assert.match(panel, /aria-label="成片分辨率"/)
  assert.match(panel, /label="字幕"/)
  assert.match(panel, /label="对白烧录"/)
  assert.match(panel, /label="水印"/)
  assert.match(panel, /emit\('open-ai-config'\)/)
})

test('FilmCreate 把剧本工作台交给独立面板并保留空剧集入口', () => {
  const panel = readFileSync(new URL('../src/components/filmCreate/FilmCreateScriptWorkbench.vue', import.meta.url), 'utf8')
  assert.match(filmCreateSource, /<FilmCreateScriptWorkbench/)
  assert.match(filmCreateSource, /class="section card script-workbench-unified"/)
  assert.match(filmCreateSource, /v-model:story-input="storyInput"/)
  assert.match(filmCreateSource, /@generate-story="onGenerateStory"/)
  assert.match(filmCreateSource, /@add-episode="onAddEpisode"/)
  assert.match(filmCreateSource, /@go-to-drama="router\.push\('\/drama\/' \+ dramaId\)"/)
  assert.match(panel, /label="创作剧本"/)
  assert.match(panel, /label="选择剧本"/)
  assert.match(panel, /class="empty-tip film-episode-empty"/)
  assert.match(panel, /还没有剧集/)
  assert.match(panel, /从已有剧本中选择/)
  assert.match(panel, /emit\('generate-story'\)/)
  assert.match(panel, /emit\('open-select-script'\)/)
})

test('交付面板为下载和导出提供可见的禁用原因', () => {
  const panel = readFileSync(new URL('../src/components/filmCreate/FilmCreateDeliveryPanel.vue', import.meta.url), 'utf8')
  assert.match(panel, /<ActionGate :reason="downloadVideoDisabledReason" label="下载成片">/)
  assert.match(panel, /<ActionGate :reason="downloadSubtitleDisabledReason" label="下载字幕">/)
  assert.match(panel, /<ActionGate :reason="exportProjectDisabledReason" label="导出项目包">/)
  assert.match(panel, /请先合成成片后再下载/)
  assert.match(panel, /当前集还没有可下载的字幕/)
  assert.match(panel, /请先打开制作项目/)
})

test('FilmCreate 把资源管理交给独立面板并保留折叠与空状态', () => {
  const panel = readFileSync(new URL('../src/components/filmCreate/FilmCreateResourcePanel.vue', import.meta.url), 'utf8')
  assert.match(filmCreateSource, /<FilmCreateResourcePanel/)
  assert.match(filmCreateSource, /class="section card resource-panel"/)
  assert.match(filmCreateSource, /:prop-items="props"/)
  assert.match(filmCreateSource, /@generate-characters="onGenerateCharacters"/)
  assert.match(panel, /id="anchor-characters"/)
  assert.match(panel, /id="anchor-props"/)
  assert.match(panel, /id="anchor-scenes"/)
  assert.match(panel, /class="collapse-header(?: resource-block-header)?"/)
  assert.match(panel, /暂无角色/)
  assert.match(panel, /emit\('generate-characters'\)/)
})
