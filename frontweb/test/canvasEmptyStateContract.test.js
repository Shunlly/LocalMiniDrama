import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { compileScript, parse } from '@vue/compiler-sfc'
import { createRenderer, defineComponent, h, nextTick, ref } from 'vue'

const componentUrl = new URL('../src/components/dramaCanvas/CanvasEmptyState.vue', import.meta.url)
const componentSource = readFileSync(componentUrl, 'utf8')
const canvasSource = readFileSync(new URL('../src/views/DramaCanvas.vue', import.meta.url), 'utf8')
const { descriptor } = parse(componentSource, { filename: componentUrl.pathname })
let compiledSource = compileScript(descriptor, {
  id: 'canvas-empty-state-contract',
  inlineTemplate: true,
}).content

const importReplacements = new Map([
  ['vue', import.meta.resolve('vue')],
  ['@element-plus/icons-vue', import.meta.resolve('@element-plus/icons-vue')],
  ['@/utils/canvasUiState', new URL('../src/utils/canvasUiState.js', import.meta.url).href],
])

for (const [specifier, resolved] of importReplacements) {
  compiledSource = compiledSource
    .replaceAll(`from '${specifier}'`, `from '${resolved}'`)
    .replaceAll(`from "${specifier}"`, `from "${resolved}"`)
}

const CanvasEmptyState = (await import(
  `data:text/javascript;base64,${Buffer.from(compiledSource).toString('base64')}`
)).default

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

const ElSelectStub = defineComponent({
  props: ['modelValue'],
  emits: ['update:modelValue'],
  setup(props, { attrs, emit, slots }) {
    return () => h('select', {
      ...attrs,
      value: props.modelValue,
      onChange: (event) => emit('update:modelValue', event.target.value),
    }, slots.default?.())
  },
})

const ElOptionStub = defineComponent({
  props: ['label', 'value'],
  setup(props) {
    return () => h('option', { value: props.value }, props.label)
  },
})

const ElButtonStub = defineComponent({
  props: ['disabled', 'nativeType'],
  setup(props, { attrs, slots }) {
    return () => h('button', {
      ...attrs,
      disabled: props.disabled,
      type: props.nativeType || 'button',
    }, slots.default?.())
  },
})

const ElIconStub = defineComponent({
  setup(_props, { slots }) {
    return () => h('span', {}, slots.default?.())
  },
})

function findAll(node, type, matches = []) {
  if (node.type === type) matches.push(node)
  for (const child of node.children || []) findAll(child, type, matches)
  return matches
}

function textContent(node) {
  return `${node.text || ''}${(node.children || []).map(textContent).join('')}`
}

function mountEmptyState({ initialEpisodes = [], initialSelectedEpisodeId = null } = {}) {
  const episodes = ref(initialEpisodes)
  const selectedEpisodeId = ref(initialSelectedEpisodeId)
  const mode = ref('select-episode')
  const confirmations = []
  const creations = []
  const Harness = defineComponent({
    setup() {
      return () => h(CanvasEmptyState, {
        mode: mode.value,
        episodes: episodes.value,
        selectedEpisodeId: selectedEpisodeId.value,
        onConfirmEpisode: (episodeId) => confirmations.push(episodeId),
        onCreateEpisode: () => creations.push(true),
      })
    },
  })
  const root = createHostNode('root')
  const app = renderer.createApp(Harness)
  app.component('el-select', ElSelectStub)
  app.component('el-option', ElOptionStub)
  app.component('el-button', ElButtonStub)
  app.component('el-icon', ElIconStub)
  app.mount(root)
  return { app, confirmations, creations, episodes, mode, root, selectedEpisodeId }
}

function submitForm(root) {
  const [form] = findAll(root, 'form')
  form.props.onSubmit({ preventDefault() {} })
}

test('episode selection stays local until form confirmation', async () => {
  const harness = mountEmptyState({
    initialEpisodes: [{ id: 11, title: '第 1 集' }, { id: 12, title: '第 2 集' }],
  })
  try {
    const [select] = findAll(harness.root, 'select')
    assert.equal(select.props.value, null)

    select.props.onChange({ target: { value: '12' } })
    await nextTick()

    assert.equal(harness.selectedEpisodeId.value, null)
    assert.equal(findAll(harness.root, 'select')[0].props.value, 12)
    assert.deepEqual(harness.confirmations, [])

    submitForm(harness.root)
    await nextTick()
    assert.deepEqual(harness.confirmations, [12])
  } finally {
    harness.app.unmount()
  }
})

test('prop and option updates reconcile the local episode draft', async () => {
  const harness = mountEmptyState({
    initialEpisodes: [{ id: 11 }, { id: 12 }, { id: 13 }],
  })
  try {
    harness.selectedEpisodeId.value = '11'
    await nextTick()
    assert.equal(findAll(harness.root, 'select')[0].props.value, 11)

    findAll(harness.root, 'select')[0].props.onChange({ target: { value: '12' } })
    harness.episodes.value = [{ id: 11 }, { id: 12 }, { id: 13 }, { id: 14 }]
    await nextTick()
    assert.equal(findAll(harness.root, 'select')[0].props.value, 12)

    harness.selectedEpisodeId.value = 13
    harness.episodes.value = [{ id: 11 }, { id: 13 }]
    await nextTick()
    assert.equal(findAll(harness.root, 'select')[0].props.value, 13)

    harness.selectedEpisodeId.value = null
    harness.episodes.value = [{ id: 11 }]
    await nextTick()
    assert.equal(findAll(harness.root, 'select').length, 0)
    assert.match(textContent(harness.root), /第\s*集|11/)

    submitForm(harness.root)
    assert.deepEqual(harness.confirmations, [11])
  } finally {
    harness.app.unmount()
  }
})

test('no episode options expose creation without a dead confirm action', async () => {
  const harness = mountEmptyState()
  try {
    const buttons = findAll(harness.root, 'button')
    assert.equal(findAll(harness.root, 'select').length, 0)
    assert.match(textContent(harness.root), /暂无可选剧集/)
    assert.equal(buttons.some((button) => button.props.type === 'submit'), false)

    submitForm(harness.root)
    assert.deepEqual(harness.confirmations, [])

    const createButton = buttons.find((button) => /新建第一集/.test(textContent(button)))
    createButton.props.onClick()
    await nextTick()
    assert.deepEqual(harness.creations, [true])
  } finally {
    harness.app.unmount()
  }
})

test('parent only commits a validated confirmation event', () => {
  assert.doesNotMatch(componentSource, /update:selectedEpisodeId/)
  assert.doesNotMatch(canvasSource, /@update:selected-episode-id=/)
  assert.match(canvasSource, /@confirm-episode="confirmEpisodeSelection"/)
  assert.match(canvasSource, /const episodeId = resolveCanvasEpisodeId\(drama\.value\?\.episodes, value\)/)
  assert.match(canvasSource, /async function requestEpisodeFilterChange\([\s\S]*?router\.replace\(\{ query \}\)/)
  assert.match(canvasSource, /async function confirmEpisodeSelection\([\s\S]*?await requestEpisodeFilterChange\(episodeId\)/)
})
