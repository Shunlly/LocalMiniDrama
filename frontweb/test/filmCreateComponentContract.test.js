import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { compileScript, parse } from '@vue/compiler-sfc'
import { createRenderer, defineComponent, h, nextTick, ref } from 'vue'

const vueUrl = import.meta.resolve('vue')
const actionGateUrl = new URL('../src/components/filmCreate/ActionGate.vue', import.meta.url)
const pipelinePanelUrl = new URL('../src/components/filmCreate/FilmCreatePipelinePanel.vue', import.meta.url)

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
  export const Setting = icon('Setting')
  export const VideoPlay = icon('VideoPlay')
`)

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

const compiledPipelinePanelUrl = compileSfc(
  pipelinePanelUrl,
  'film-pipeline-panel-contract',
  new Map([
    ['vue', vueUrl],
    ['@element-plus/icons-vue', iconStubUrl],
    ['@/components/StylePickerButton.vue', stylePickerStubUrl],
    ['@/components/filmCreate/ActionGate.vue', compiledActionGateUrl],
  ]),
)

const ActionGate = (await import(compiledActionGateUrl)).default
const FilmCreatePipelinePanel = (await import(compiledPipelinePanelUrl)).default

function createHostNode(type, text = '') {
  return { type, text, props: {}, children: [], parent: null }
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

const pipelineEventListeners = {
  'onUpdate:aspectRatio': (value, events) => events.push(['update:aspectRatio', value]),
  'onUpdate:clipDuration': (value, events) => events.push(['update:clipDuration', value]),
  'onUpdate:scriptLanguage': (value, events) => events.push(['update:scriptLanguage', value]),
  'onUpdate:generationStyle': (value, events) => events.push(['update:generationStyle', value]),
  onSaveSettings: (value, events) => events.push(['save-settings', value]),
  onStartOneClick: (_value, events) => events.push(['start-one-click']),
  onStartTextFramework: (_value, events) => events.push(['start-text-framework']),
  onPause: (_value, events) => events.push(['pause']),
  onResume: (_value, events) => events.push(['resume']),
  onSkipCountdown: (_value, events) => events.push(['skip-countdown']),
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

test('pipeline forwards start, pause, resume, and countdown skip commands', async () => {
  const harness = mountPipeline()
  try {
    buttonByText(harness.root, '一键生成成片').props.onClick()
    buttonByText(harness.root, '仅生成文本框架').props.onClick()

    harness.props.value = {
      ...harness.props.value,
      running: true,
      countdown: 5,
      countdownMessage: 'Waiting for the next stage',
    }
    await nextTick()
    buttonByText(harness.root, '暂停').props.onClick()
    buttonByText(harness.root, '立即开始下一阶段').props.onClick()

    harness.props.value = { ...harness.props.value, paused: true }
    await nextTick()
    buttonByText(harness.root, '继续').props.onClick()

    assert.deepEqual(harness.events, [
      ['start-one-click'],
      ['start-text-framework'],
      ['pause'],
      ['skip-countdown'],
      ['resume'],
    ])
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
