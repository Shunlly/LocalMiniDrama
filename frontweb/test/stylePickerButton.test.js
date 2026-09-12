import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { compileScript, parse } from '@vue/compiler-sfc'
import { createRenderer, defineComponent, h, nextTick, ref } from 'vue'

const componentUrl = new URL('../src/components/StylePickerButton.vue', import.meta.url)
const componentSource = readFileSync(componentUrl, 'utf8')

function dataModule(code) {
  return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
}

async function compileStylePickerButton() {
  const { descriptor, errors } = parse(componentSource, { filename: componentUrl.pathname })
  assert.deepEqual(errors, [])
  let compiledSource = compileScript(descriptor, {
    id: 'style-picker-button-empty-search',
    inlineTemplate: true,
  }).content
  for (const [specifier, resolved] of [
    ['vue', import.meta.resolve('vue')],
    ['@element-plus/icons-vue', import.meta.resolve('@element-plus/icons-vue')],
  ]) {
    compiledSource = compiledSource
      .replaceAll(`from '${specifier}'`, `from '${resolved}'`)
      .replaceAll(`from "${specifier}"`, `from "${resolved}"`)
  }
  return (await import(dataModule(compiledSource))).default
}

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
  setScopeId() {},
  cloneNode(node) {
    return { ...node, props: { ...node.props }, children: [...node.children] }
  },
  insertStaticContent(content, parent, anchor) {
    const node = createHostNode('#static', content)
    insertHostNode(node, parent, anchor)
    return [node, node]
  },
})

const AccessibleDialogStub = defineComponent({
  name: 'AccessibleDialog',
  inheritAttrs: false,
  props: {
    modelValue: Boolean,
    title: String,
    width: String,
    appendToBody: Boolean,
    destroyOnClose: Boolean,
  },
  setup(props, { attrs, slots }) {
    return () => h('div', {
      ...attrs,
      role: 'dialog',
      'data-open': props.modelValue,
      'data-title': props.title,
    }, [slots.default?.(), slots.footer?.()])
  },
})

const ElButtonStub = defineComponent({
  name: 'ElButton',
  inheritAttrs: false,
  props: {
    type: String,
    size: String,
    disabled: Boolean,
  },
  setup(props, { attrs, slots }) {
    return () => h('button', {
      type: 'button',
      ...attrs,
      disabled: props.disabled,
      'data-el': 'el-button',
      'data-type': props.type || '',
      'data-size': props.size || '',
    }, slots.default?.())
  },
})

const ElInputStub = defineComponent({
  name: 'ElInput',
  inheritAttrs: false,
  props: {
    modelValue: { type: String, default: '' },
    placeholder: String,
    clearable: [Boolean, String],
  },
  emits: ['update:modelValue'],
  setup(props, { attrs, emit, slots }) {
    return () => h('div', { 'data-el': 'el-input' }, [
      slots.prefix?.(),
      h('input', {
        ...attrs,
        value: props.modelValue,
        placeholder: props.placeholder,
        onInput: (event) => emit('update:modelValue', event?.target?.value ?? event),
      }),
    ])
  },
})

const ElIconStub = defineComponent({
  name: 'ElIcon',
  setup(_props, { slots }) {
    return () => h('span', { 'data-el': 'el-icon' }, slots.default?.())
  },
})

function findAll(node, predicate, matches = []) {
  if (predicate(node)) matches.push(node)
  for (const child of node.children || []) findAll(child, predicate, matches)
  return matches
}

function textContent(node) {
  if (!node || node.type === '#comment') return ''
  return `${node.text || ''}${(node.children || []).map(textContent).join('')}`
}

function styleItemLabels(root) {
  return findAll(root, (node) => node.type === 'span' && String(node.props.class || '').includes('spd-name'))
    .map((node) => textContent(node).trim())
}

function styleItems(root) {
  return findAll(root, (node) => node.type === 'button' && String(node.props.class || '').includes('spd-item'))
}

const sampleOptions = [
  {
    label: '写实',
    options: [{ value: 'realistic', label: '写实摄影', color: '#111111' }],
  },
  {
    label: '动漫',
    options: [{ value: 'anime', label: '日式动漫', color: '#222222' }],
  },
]

async function mountPicker() {
  const StylePickerButton = await compileStylePickerButton()
  const modelValue = ref('anime')
  const changes = []
  const Harness = defineComponent({
    setup() {
      return () => h(StylePickerButton, {
        modelValue: modelValue.value,
        options: sampleOptions,
        'onUpdate:modelValue': (value) => {
          modelValue.value = value
        },
        onChange: (value) => {
          changes.push(value)
        },
      })
    },
  })
  const root = createHostNode('root')
  const app = renderer.createApp(Harness)
  app.component('AccessibleDialog', AccessibleDialogStub)
  app.component('accessible-dialog', AccessibleDialogStub)
  app.component('el-button', ElButtonStub)
  app.component('el-input', ElInputStub)
  app.component('el-icon', ElIconStub)
  app.mount(root)
  await nextTick()
  return { app, root, modelValue, changes }
}

function searchInput(root) {
  const [input] = findAll(root, (node) => node.type === 'input' && node.props['aria-label'] === '搜索风格名称')
  assert.ok(input, '应渲染风格搜索输入框')
  return input
}

function clearSearchButton(root) {
  const [button] = findAll(root, (node) => (
    node.type === 'button' && node.props['aria-label'] === '清除风格搜索'
  ))
  return button || null
}

async function typeSearch(root, value) {
  const input = searchInput(root)
  input.props.onInput({ target: { value } })
  await nextTick()
}

test('风格选择器搜索空态提供清除搜索下一步', () => {
  assert.match(componentSource, /v-if="filteredGroups\.length === 0"/)
  assert.match(componentSource, /class="spd-empty"/)
  assert.match(componentSource, /没有匹配的风格/)
  assert.match(componentSource, /aria-label="清除风格搜索"/)
  assert.match(componentSource, />清除风格搜索</)
  assert.match(componentSource, /@click="search = ''"/)
  assert.match(componentSource, /placeholder="搜索风格名称\.\.\."/)
  assert.match(componentSource, /\sclearable\s/)
  assert.match(
    componentSource,
    /o\.label\.toLowerCase\(\)\.includes\(kw\) \|\| o\.value\.toLowerCase\(\)\.includes\(kw\)/,
  )
  assert.match(componentSource, /function select\(opt\) \{/)
  assert.match(componentSource, /function clearSelection\(\) \{/)
  assert.doesNotMatch(componentSource, /@click="search = ''"[\s\S]{0,80}clearSelection/)
})

test('点击清除搜索会清空关键词并恢复风格列表，且不改当前选择', async () => {
  const harness = await mountPicker()
  try {
    assert.deepEqual(styleItemLabels(harness.root), ['写实摄影', '日式动漫'])
    assert.equal(clearSearchButton(harness.root), null)

    await typeSearch(harness.root, 'zzz-no-style')
    assert.match(textContent(harness.root), /没有匹配的风格/)
    assert.equal(styleItemLabels(harness.root).length, 0)
    const clearButton = clearSearchButton(harness.root)
    assert.ok(clearButton, '空态应提供清除搜索按钮')
    assert.match(textContent(clearButton), /清除风格搜索/)
    assert.equal(searchInput(harness.root).props.value, 'zzz-no-style')

    assert.equal(typeof clearButton.props.onClick, 'function')
    clearButton.props.onClick()
    await nextTick()

    assert.equal(searchInput(harness.root).props.value, '')
    assert.equal(clearSearchButton(harness.root), null)
    assert.doesNotMatch(textContent(harness.root), /没有匹配的风格/)
    const restored = styleItems(harness.root)
    assert.deepEqual(styleItemLabels(harness.root), ['写实摄影', '日式动漫'])
    const selected = restored.find((node) => String(node.props.class || '').includes('is-active'))
    assert.ok(selected)
    assert.match(textContent(selected), /日式动漫/)
    assert.equal(harness.modelValue.value, 'anime')
    assert.deepEqual(harness.changes, [])
  } finally {
    harness.app.unmount()
  }
})
