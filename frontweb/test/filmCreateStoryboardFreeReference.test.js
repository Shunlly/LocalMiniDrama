import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { compileScript, parse } from '@vue/compiler-sfc'
import { createRenderer, defineComponent, h, nextTick } from 'vue'

const vueUrl = import.meta.resolve('vue')
const imageColumnUrl = new URL('../src/components/filmCreate/FilmCreateStoryboardImageColumn.vue', import.meta.url)
const imageColumnSource = readFileSync(imageColumnUrl, 'utf8')
const imageColumnCss = readFileSync(new URL('../src/components/filmCreate/FilmCreateStoryboardImageColumn.css', import.meta.url), 'utf8')
const templateSource = imageColumnSource.slice(
  imageColumnSource.indexOf('<template>'),
  imageColumnSource.indexOf('<script setup>'),
)
const scriptSource = imageColumnSource.slice(imageColumnSource.indexOf('<script setup>'))

const OPTIONAL_FREE_REF_PROPS = [
  'getSbFreeReferenceItems',
  'openGlobalMediaPicker',
  'onPromoteSbFreeReferenceImage',
  'onRemoveSbFreeReferenceImage',
]

function propLine(name) {
  const line = scriptSource.split('\n').find((item) => item.includes(`${name}:`))
  assert.ok(line, `应声明 ${name}`)
  return line
}

const panelSource = readFileSync(new URL('../src/components/filmCreate/FilmCreateStoryboardPanel.vue', import.meta.url), 'utf8') + '\n' + readFileSync(new URL('../src/components/filmCreate/FilmCreateStoryboardList.vue', import.meta.url), 'utf8')
const filmCreateSource = readFileSync(new URL('../src/views/FilmCreate.vue', import.meta.url), 'utf8')
const workspaceBindingsSource = readFileSync(new URL('../src/components/filmCreate/filmCreateWorkspaceBindings.js', import.meta.url), 'utf8')

test('制作页把自由参考图回调接到分镜图列', () => {
  assert.match(panelSource, /:get-sb-free-reference-items="getSbFreeReferenceItems"/)
  assert.match(panelSource, /:open-global-media-picker="openGlobalMediaPicker"/)
  assert.match(panelSource, /:on-promote-sb-free-reference-image="onPromoteSbFreeReferenceImage"/)
  assert.match(panelSource, /:on-remove-sb-free-reference-image="onRemoveSbFreeReferenceImage"/)
  assert.match(workspaceBindingsSource, /storyboardPanel: \{[\s\S]*getSbFreeReferenceItems/)
  assert.match(workspaceBindingsSource, /storyboardPanel: \{[\s\S]*openGlobalMediaPicker/)
})

test('ImageColumn 模板含自由参考图行内入口', () => {
  assert.match(templateSource, /自由参考图/)
  assert.match(templateSource, /添加自由参考图/)
  assert.match(templateSource, /当前分镜还没有从素材中心挂载自由参考图/)
  assert.match(templateSource, /预览/)
  assert.match(templateSource, /设为主参考/)
  assert.match(templateSource, /移除/)
  assert.match(templateSource, /openGlobalMediaPicker\(sb, 'reference'\)/)
  assert.match(templateSource, /onPromoteSbFreeReferenceImage\(sb, item\)/)
  assert.match(templateSource, /onRemoveSbFreeReferenceImage\(sb, index\)/)
  assert.match(templateSource, /:aria-label="`为分镜\$\{sb\.storyboard_number \|\| i \+ 1\}添加自由参考图`"/)
  assert.match(templateSource, /:aria-label="`预览自由参考图 \$\{item\.name \|\| index \+ 1\}`"/)
  assert.match(imageColumnCss, /\.sb-free-ref\s*\{/)
})

test('ImageColumn 自由参考图 props 全部可选且带安全默认值', () => {
  for (const name of OPTIONAL_FREE_REF_PROPS) {
    const line = propLine(name)
    assert.doesNotMatch(line, /required:\s*true/, `${name} 不能是 required`)
    assert.match(line, /type:\s*Function/)
    assert.match(line, /default:/)
  }
  assert.match(propLine('getSbFreeReferenceItems'), /default:\s*\(sb\)\s*=>/)
  assert.match(propLine('getSbFreeReferenceItems'), /reference_images/)
  assert.match(propLine('openGlobalMediaPicker'), /default:\s*\(\)\s*=>\s*\{\}/)
  assert.match(propLine('onPromoteSbFreeReferenceImage'), /default:\s*\(\)\s*=>\s*\{\}/)
  assert.match(propLine('onRemoveSbFreeReferenceImage'), /default:\s*\(\)\s*=>\s*\{\}/)
})

test('ImageColumn 含自由参考图入口后仍可独立编译', () => {
  const parsed = parse(imageColumnSource, { filename: 'FilmCreateStoryboardImageColumn.vue' })
  assert.deepEqual(parsed.errors, [])
  assert.doesNotThrow(() => compileScript(parsed.descriptor, { id: 'storyboard-image-column-free-ref' }))
})

function dataModule(source) {
  return `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
}

function compileSfc(componentUrl, id, replacements = new Map()) {
  const source = readFileSync(componentUrl, 'utf8')
  const { descriptor, errors } = parse(source, { filename: componentUrl.pathname })
  assert.deepEqual(errors, [])
  let compiledSource = compileScript(descriptor, { id, inlineTemplate: true }).content
  compiledSource = compiledSource
    .replaceAll("from 'vue'", `from ${JSON.stringify(vueUrl)}`)
    .replaceAll('from "vue"', `from ${JSON.stringify(vueUrl)}`)
  for (const [specifier, resolved] of replacements) {
    compiledSource = compiledSource
      .replaceAll(`from '${specifier}'`, `from '${resolved}'`)
      .replaceAll(`from "${specifier}"`, `from '${resolved}'`)
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
  export const InfoFilled = icon('InfoFilled')
  export const MagicStick = icon('MagicStick')
  export const QuestionFilled = icon('QuestionFilled')
  export const Refresh = icon('Refresh')
  export const ZoomIn = icon('ZoomIn')
`)

const editorStubUrl = dataModule(`
  import { defineComponent, h } from ${JSON.stringify(vueUrl)}
  export default defineComponent({
    name: 'UniversalSegmentOmniAtEditorStub',
    setup() { return () => h('div', { 'data-el': 'universal-editor' }) },
  })
`)

const actionGateStubUrl = dataModule(`
  import { defineComponent, h } from ${JSON.stringify(vueUrl)}
  export default defineComponent({
    name: 'ActionGateStub',
    props: {
      reason: { type: String, default: '' },
      label: { type: String, default: '' },
    },
    setup(props, { slots }) {
      return () => h('span', [
        slots.default?.(),
        props.reason ? h('span', { 'data-testid': 'action-gate-reason' }, props.reason) : null,
      ])
    },
  })
`)

const userFacingErrorUrl = dataModule(`
  export function toUserFacingError(error, fallback = '操作失败') {
    const text = typeof error === 'string' ? error : String(error?.message || '')
    return /[\u4e00-\u9fff]/.test(text) ? text : fallback
  }
  export function isUserFacingAbort() { return false }
`)

const compiledImageColumnUrl = compileSfc(imageColumnUrl, 'storyboard-image-column-free-ref-runtime', new Map([
  ['@element-plus/icons-vue', iconStubUrl],
  ['@/components/UniversalSegmentOmniAtEditor.vue', editorStubUrl],
  ['@/components/filmCreate/ActionGate.vue', actionGateStubUrl],
  ['@/utils/userFacingError', userFacingErrorUrl],
]))

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

function collectText(node) {
  if (!node) return ''
  if (node.type === '#text' || node.type === '#static') return node.text || ''
  return (node.children || []).map(collectText).join('')
}

function findAll(node, predicate, matches = []) {
  if (predicate(node)) matches.push(node)
  for (const child of node.children || []) findAll(child, predicate, matches)
  return matches
}

function stubEl(name, tag = 'div') {
  return defineComponent({
    name,
    inheritAttrs: false,
    setup(_props, { slots, attrs }) {
      return () => h(tag, { ...attrs, 'data-el': name }, slots.default?.())
    },
  })
}

const ElButton = defineComponent({
  name: 'ElButton',
  props: {
    type: String,
    size: String,
    loading: Boolean,
    disabled: Boolean,
    plain: Boolean,
    link: Boolean,
  },
  setup(props, { slots, attrs }) {
    return () => h('button', {
      type: 'button',
      disabled: Boolean(props.disabled || props.loading),
      'data-el': 'ElButton',
      'data-link': props.link ? 'true' : 'false',
      ...attrs,
    }, slots.default?.())
  },
})

const ElTag = defineComponent({
  name: 'ElTag',
  props: { type: String, size: String, effect: String },
  setup(_props, { slots, attrs }) {
    return () => h('span', { 'data-el': 'ElTag', ...attrs }, slots.default?.())
  },
})

const ElTooltip = defineComponent({
  name: 'ElTooltip',
  setup(_props, { slots }) {
    return () => slots.default?.()
  },
})

const ElIcon = stubEl('ElIcon', 'span')
const ElInput = stubEl('ElInput', 'textarea')
const ElCheckbox = stubEl('ElCheckbox', 'input')
const ElDropdown = stubEl('ElDropdown')
const ElDropdownMenu = stubEl('ElDropdownMenu')
const ElDropdownItem = stubEl('ElDropdownItem')

function noop() {}

function baseImageColumnProps() {
  return {
    sb: { id: 7, storyboard_number: 2 },
    i: 1,
    uploadingSbImageSlot: () => null,
    assetImageUrl: (item) => item?.image_url || item?.url || '',
    canUsePrevTailAsFirst: () => false,
    getSbFirstImage: () => null,
    getSbImage: () => null,
    getSbLastImage: () => null,
    getSbLocalImage: () => null,
    getSbUniversalOmniRefSlots: () => [],
    getStripItems: () => [],
    hasSbDraftImagePlaceholder: () => false,
    hasSbFirstLastPair: () => false,
    hasSbImage: () => false,
    historyImageLabel: () => '历史图',
    isSbUniversalMode: () => false,
    onGenerateSbFrameImage: noop,
    onGenerateSbFramePair: noop,
    onGenerateSbImage: noop,
    onLastFrameLayoutLockChange: noop,
    onRemoveSbHistoryImage: noop,
    onSaveUniversalSegmentField: noop,
    onSbImageDragLeave: noop,
    onSbImageDragOver: noop,
    onSbImageDrop: noop,
    onSelectStripItem: noop,
    onStripItemClick: noop,
    onUniversalSegmentPromptMenu: noop,
    onUploadSbImageClick: noop,
    onUpscaleSbImage: noop,
    onUsePrevTailAsFirst: noop,
    openImagePreview: noop,
    sbUniversalSegmentTrimmed: () => '',
    showSbFramePromptPreview: noop,
    storyboardImageUrl: () => '',
    stripItemTitle: () => '',
  }
}

async function mountImageColumn(props) {
  const FilmCreateStoryboardImageColumn = (await import(compiledImageColumnUrl)).default
  const root = createHostNode('root')
  const app = renderer.createApp(FilmCreateStoryboardImageColumn, props)
  app.component('ElButton', ElButton)
  app.component('ElTag', ElTag)
  app.component('ElTooltip', ElTooltip)
  app.component('ElIcon', ElIcon)
  app.component('ElInput', ElInput)
  app.component('ElCheckbox', ElCheckbox)
  app.component('ElDropdown', ElDropdown)
  app.component('ElDropdownMenu', ElDropdownMenu)
  app.component('ElDropdownItem', ElDropdownItem)
  app.mount(root)
  await nextTick()
  return { app, root }
}

function buttonByText(root, text) {
  const buttons = findAll(root, (node) => node.type === 'button' && collectText(node).includes(text))
  assert.ok(buttons.length, `应找到按钮「${text}」`)
  return buttons[0]
}

test('ImageColumn 缺少自由参考图 props 时仍渲染空状态，不会抛错', async () => {
  const { app, root } = await mountImageColumn(baseImageColumnProps())
  try {
    const text = collectText(root)
    assert.match(text, /自由参考图/)
    assert.match(text, /添加自由参考图/)
    assert.match(text, /当前分镜还没有从素材中心挂载自由参考图/)
    assert.doesNotMatch(text, /设为主参考/)
    const addButton = buttonByText(root, '添加自由参考图')
    assert.equal(addButton.props['aria-label'], '为分镜2添加自由参考图')
    assert.doesNotThrow(() => addButton.props.onClick())
  } finally {
    app.unmount()
  }
})

test('ImageColumn 有自由参考图时显示缩略图、预览、设为主参考和移除', async () => {
  const items = [
    { name: '海报', image_url: 'https://cdn.test/a.png', asset_id: 11 },
    { name: '夜景', image_url: 'https://cdn.test/b.png', asset_id: 12 },
  ]
  const calls = {
    preview: [],
    picker: [],
    promote: [],
    remove: [],
  }
  const { app, root } = await mountImageColumn({
    ...baseImageColumnProps(),
    getSbFreeReferenceItems: () => items,
    openGlobalMediaPicker: (sb, mode) => { calls.picker.push([sb.id, mode]) },
    openImagePreview: (url) => { calls.preview.push(url) },
    onPromoteSbFreeReferenceImage: (sb, item) => { calls.promote.push([sb.id, item.name]) },
    onRemoveSbFreeReferenceImage: (sb, index) => { calls.remove.push([sb.id, index]) },
  })
  try {
    const text = collectText(root)
    assert.match(text, /海报/)
    assert.match(text, /夜景/)
    assert.match(text, /主参考/)
    assert.doesNotMatch(text, /当前分镜还没有从素材中心挂载自由参考图/)
    const thumbs = findAll(root, (node) => node.type === 'button' && node.props.class === 'sb-free-ref-thumb')
    assert.equal(thumbs.length, 2)
    assert.equal(thumbs[0].props['aria-label'], '预览自由参考图 海报')
    thumbs[1].props.onClick()
    buttonByText(root, '预览').props.onClick()
    buttonByText(root, '设为主参考').props.onClick()
    buttonByText(root, '移除').props.onClick()
    buttonByText(root, '添加自由参考图').props.onClick()
    assert.deepEqual(calls.preview, ['https://cdn.test/b.png', 'https://cdn.test/a.png'])
    assert.deepEqual(calls.promote, [[7, '夜景']])
    assert.deepEqual(calls.remove, [[7, 0]])
    assert.deepEqual(calls.picker, [[7, 'reference']])
  } finally {
    app.unmount()
  }
})

test('ImageColumn 自由参考图 getter 返回非数组时按空列表处理', async () => {
  const { app, root } = await mountImageColumn({
    ...baseImageColumnProps(),
    getSbFreeReferenceItems: () => null,
  })
  try {
    assert.match(collectText(root), /当前分镜还没有从素材中心挂载自由参考图/)
  } finally {
    app.unmount()
  }
})

test('ImageColumn 未传入 getter 时仍能展示分镜自带的自由参考图', async () => {
  const { app, root } = await mountImageColumn({
    ...baseImageColumnProps(),
    sb: {
      id: 7,
      storyboard_number: 2,
      reference_images: [
        { name: '海报', image_url: 'https://cdn.test/a.png' },
      ],
    },
  })
  try {
    const text = collectText(root)
    assert.match(text, /海报/)
    assert.doesNotMatch(text, /当前分镜还没有从素材中心挂载自由参考图/)
    const thumbs = findAll(root, (node) => node.type === 'button' && node.props.class === 'sb-free-ref-thumb')
    assert.equal(thumbs.length, 1)
    assert.equal(thumbs[0].props['aria-label'], '预览自由参考图 海报')
  } finally {
    app.unmount()
  }
})
