import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { compileScript, parse } from '@vue/compiler-sfc'
import { createRenderer, defineComponent, h, nextTick, ref } from 'vue'

const vueUrl = import.meta.resolve('vue')
const characterDialogUrl = new URL('../src/components/filmCreate/FilmCreateCharacterEditDialog.vue', import.meta.url)
const resourceDialogsUrl = new URL('../src/components/filmCreate/FilmCreateResourceDialogs.vue', import.meta.url)
const filmCreateUrl = new URL('../src/views/FilmCreate.vue', import.meta.url)

const characterDialogSource = readFileSync(characterDialogUrl, 'utf8')
const resourceDialogsSource = readFileSync(resourceDialogsUrl, 'utf8')
const filmCreateSource = readFileSync(filmCreateUrl, 'utf8')

function dataModule(source) {
  return `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
}

function compileSfc(componentUrl, id) {
  const source = readFileSync(componentUrl, 'utf8')
  const parsed = parse(source, { filename: componentUrl.pathname })
  assert.deepEqual(parsed.errors, [])
  let compiledSource = compileScript(parsed.descriptor, { id, inlineTemplate: true }).content
  compiledSource = compiledSource
    .replaceAll("from 'vue'", `from ${JSON.stringify(vueUrl)}`)
    .replaceAll('from "vue"', `from ${JSON.stringify(vueUrl)}`)
  return dataModule(compiledSource)
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

const AccessibleDialogStub = defineComponent({
  name: 'AccessibleDialog',
  props: {
    modelValue: { type: Boolean, default: false },
    title: { type: String, default: '' },
    width: { type: [String, Number], default: '' },
  },
  emits: ['update:modelValue', 'close'],
  setup(props, { slots }) {
    return () => {
      if (!props.modelValue) return null
      return h('div', { 'data-dialog': 'character-edit', 'data-title': props.title }, [
        slots.default?.(),
        slots.footer?.(),
      ])
    }
  },
})

const ElButton = defineComponent({
  name: 'ElButton',
  props: {
    type: String,
    size: String,
    loading: Boolean,
    disabled: Boolean,
  },
  setup(props, { slots, attrs }) {
    return () => h('button', {
      type: 'button',
      disabled: Boolean(props.disabled || props.loading),
      'data-loading': props.loading ? 'true' : 'false',
      ...attrs,
    }, slots.default?.())
  },
})

const ElInput = defineComponent({
  name: 'ElInput',
  props: {
    modelValue: { default: '' },
    placeholder: String,
    disabled: Boolean,
    type: String,
    rows: [Number, String],
    autosize: [Boolean, Object],
    value: { default: undefined },
  },
  setup(props, { attrs }) {
    return () => h('textarea', {
      'data-el': 'el-input',
      'aria-label': attrs['aria-label'],
      placeholder: props.placeholder,
      disabled: props.disabled,
      value: props.modelValue ?? props.value ?? '',
    })
  },
})

const ElForm = stubEl('ElForm')
const ElFormItem = defineComponent({
  name: 'ElFormItem',
  props: { label: String, required: Boolean },
  setup(props, { slots }) {
    return () => h('div', { 'data-el': 'el-form-item', 'data-label': props.label || '' }, [
      props.label ? h('span', props.label) : slots.label?.(),
      slots.default?.(),
    ])
  },
})
const ElSelect = stubEl('ElSelect', 'select')
const ElOption = stubEl('ElOption', 'option')

async function mountCharacterDialog(props) {
  const FilmCreateCharacterEditDialog = (await import(compileSfc(characterDialogUrl, 'character-edit-dialog'))).default
  const root = createHostNode('root')
  const app = renderer.createApp(FilmCreateCharacterEditDialog, props)
  app.component('AccessibleDialog', AccessibleDialogStub)
  app.component('ElButton', ElButton)
  app.component('ElInput', ElInput)
  app.component('ElForm', ElForm)
  app.component('ElFormItem', ElFormItem)
  app.component('ElSelect', ElSelect)
  app.component('ElOption', ElOption)
  app.mount(root)
  await nextTick()
  return { app, root }
}

function noop() {}

function baseHandlers() {
  return {
    assetImageUrl: (item) => item?.image_url || '',
    clearCharRefImage: noop,
    doExtractCharFromImage: noop,
    doExtractFromRef: noop,
    doGenerateCharacterPrompt: noop,
    extractIdentityAnchors: noop,
    onCloseCharDialog: noop,
    onRefImageDrop: noop,
    onRefImageFileChange: noop,
    submitEditCharacter: noop,
  }
}

test('角色弹窗已从资源弹窗集合抽出，制作页仍走原入口', () => {
  const parsedParent = parse(resourceDialogsSource, { filename: 'FilmCreateResourceDialogs.vue' })
  assert.deepEqual(parsedParent.errors, [])
  assert.doesNotThrow(() => compileScript(parsedParent.descriptor, { id: 'resource-dialogs-after-character-extract' }))

  assert.match(resourceDialogsSource, /import FilmCreateCharacterEditDialog from '\.\/FilmCreateCharacterEditDialog\.vue'/)
  assert.match(resourceDialogsSource, /<FilmCreateCharacterEditDialog/)
  assert.match(resourceDialogsSource, /v-model:show-edit-character="showEditCharacter"/)
  assert.match(resourceDialogsSource, /v-model:add-char-ref-image="addCharRefImage"/)
  assert.match(resourceDialogsSource, /:edit-character-form="editCharacterForm"/)
  assert.match(resourceDialogsSource, /:do-generate-character-prompt="doGenerateCharacterPrompt"/)
  assert.match(resourceDialogsSource, /:on-close-char-dialog="onCloseCharDialog"/)
  assert.match(resourceDialogsSource, /:submit-edit-character="submitEditCharacter"/)
  assert.doesNotMatch(resourceDialogsSource, /aria-label="角色名称"/)
  assert.doesNotMatch(resourceDialogsSource, /aria-label="选择角色参考图"/)

  assert.match(filmCreateSource, /<FilmCreateResourceDialogs/)
  assert.match(filmCreateSource, /v-model:show-edit-character="showEditCharacter"/)
  assert.match(filmCreateSource, /:edit-character-form="editCharacterForm"/)
  assert.match(filmCreateSource, /:do-generate-character-prompt="doGenerateCharacterPrompt"/)
  assert.doesNotMatch(filmCreateSource, /<FilmCreateCharacterEditDialog/)
})

test('抽出的角色弹窗保留上传、生成、空态和取消文案', () => {
  const parsed = parse(characterDialogSource, { filename: 'FilmCreateCharacterEditDialog.vue' })
  assert.deepEqual(parsed.errors, [])
  assert.doesNotThrow(() => compileScript(parsed.descriptor, { id: 'character-edit-dialog-source' }))

  assert.match(characterDialogSource, /<AccessibleDialog v-model="showEditCharacter"/)
  assert.match(characterDialogSource, /:title="editCharacterForm\?\.id \? '编辑角色' : '添加角色'"/)
  assert.match(characterDialogSource, /aria-label="选择角色参考图"/)
  assert.match(characterDialogSource, /点击或拖入参考图/)
  assert.match(characterDialogSource, /aria-label="角色名称"/)
  assert.match(characterDialogSource, /doGenerateCharacterPrompt/)
  assert.match(characterDialogSource, /AI 正在生成提示词，请稍候…/)
  assert.match(characterDialogSource, /暂无锚点，点击「提炼视觉锚点」自动提炼/)
  assert.match(characterDialogSource, /角色信息还没有准备好。请点「取消」关闭后，再从角色列表重新打开。/)
  assert.match(characterDialogSource, />取消<\/el-button>/)
  assert.match(characterDialogSource, /ref="addCharRefFileInput"/)
  assert.match(characterDialogSource, /@change="onRefImageFileChange\('character', \$event\)"/)
})

test('打开角色弹窗后可取消，空表单会禁用提交', async () => {
  const showEditCharacter = ref(true)
  const addCharRefImage = ref(null)
  const editCharacterForm = ref({
    name: '',
    role: '',
    appearance: '',
    description: '',
    polished_prompt: '',
  })
  const { app, root } = await mountCharacterDialog({
    ...baseHandlers(),
    showEditCharacter: showEditCharacter.value,
    'onUpdate:showEditCharacter': (value) => { showEditCharacter.value = value },
    addCharRefImage: addCharRefImage.value,
    'onUpdate:addCharRefImage': (value) => { addCharRefImage.value = value },
    editCharacterForm: editCharacterForm.value,
  })
  try {
    const dialog = findAll(root, (node) => node.props && node.props['data-dialog'] === 'character-edit')[0]
    assert.ok(dialog, '角色弹窗应当打开')
    assert.equal(dialog.props['data-title'], '添加角色')
    assert.match(collectText(dialog), /名称/)
    const nameInput = findAll(dialog, (node) => node.props && node.props['aria-label'] === '角色名称')[0]
    assert.ok(nameInput, '角色名称输入框应有可访问名称')

    const submit = findAll(dialog, (node) => node.type === 'button' && collectText(node).includes('添加'))[0]
    assert.equal(submit.props.disabled, true)

    const cancel = findAll(dialog, (node) => node.type === 'button' && collectText(node).includes('取消'))[0]
    cancel.props.onClick()
    await nextTick()
    assert.equal(showEditCharacter.value, false)
  } finally {
    app.unmount()
  }
})

test('缺少角色表单时给出可理解空态，生成中提示请等待', async () => {
  const { app, root } = await mountCharacterDialog({
    ...baseHandlers(),
    showEditCharacter: true,
    addCharRefImage: null,
    editCharacterForm: null,
  })
  try {
    const text = collectText(root)
    assert.match(text, /角色信息还没有准备好/)
    assert.match(text, /取消/)
    assert.doesNotMatch(text, /角色名称/)
  } finally {
    app.unmount()
  }

  const generating = await mountCharacterDialog({
    ...baseHandlers(),
    showEditCharacter: true,
    addCharRefImage: null,
    editCharacterForm: {
      id: 9,
      name: '李华',
      appearance: '短发',
      description: '',
      polished_prompt: '',
    },
    editCharacterPromptGenerating: true,
  })
  try {
    const promptInput = findAll(generating.root, (node) => node.props && node.props['aria-label'] === '角色图生提示词')[0]
    assert.ok(promptInput)
    assert.equal(promptInput.props.placeholder, 'AI 正在生成提示词，请稍候…')
    assert.equal(promptInput.props.disabled, true)
    const generateButton = findAll(generating.root, (node) => node.type === 'button' && collectText(node).includes('重新生成提示词'))[0]
    assert.equal(generateButton.props.disabled, true)
    assert.equal(generateButton.props['data-loading'], 'true')
  } finally {
    generating.app.unmount()
  }

  const missingAppearance = await mountCharacterDialog({
    ...baseHandlers(),
    showEditCharacter: true,
    addCharRefImage: null,
    editCharacterForm: {
      id: 9,
      name: '李华',
      appearance: '',
      description: '',
      polished_prompt: '',
    },
  })
  try {
    const extractAnchors = findAll(missingAppearance.root, (node) => node.type === 'button' && collectText(node).includes('提炼视觉锚点'))[0]
    assert.equal(extractAnchors.props.disabled, true)
    assert.match(collectText(missingAppearance.root), /暂无锚点，点击「提炼视觉锚点」自动提炼/)
  } finally {
    missingAppearance.app.unmount()
  }
})

test('参考图提取、提示词生成和视觉锚点都接到原回调', async () => {
  const calls = []
  const addCharRefImage = ref({ dataUrl: 'data:image/png;base64,aaa', filename: 'ref.png' })
  const { app, root } = await mountCharacterDialog({
    assetImageUrl: (item) => item.image_url,
    clearCharRefImage: () => calls.push('clear'),
    doExtractCharFromImage: () => calls.push('extract-saved'),
    doExtractFromRef: (kind) => calls.push(`extract-ref:${kind}`),
    doGenerateCharacterPrompt: () => calls.push('generate-prompt'),
    extractIdentityAnchors: () => calls.push('extract-anchors'),
    onCloseCharDialog: () => calls.push('close'),
    onRefImageDrop: noop,
    onRefImageFileChange: noop,
    submitEditCharacter: () => calls.push('submit'),
    showEditCharacter: true,
    addCharRefImage: addCharRefImage.value,
    'onUpdate:addCharRefImage': (value) => {
      addCharRefImage.value = value
      calls.push(`ref-image:${value ? 'set' : 'cleared'}`)
    },
    editCharacterForm: {
      id: 3,
      name: '李华',
      appearance: '白衬衫',
      description: '学生',
      polished_prompt: '旧提示词',
      identity_anchors: '',
      image_url: '/static/char.png',
    },
  })
  try {
    const extractRef = findAll(root, (node) => node.type === 'button' && collectText(node).includes('提取特征描述'))[0]
    extractRef.props.onClick()
    const removeRef = findAll(root, (node) => node.type === 'button' && collectText(node).includes('移除'))[0]
    removeRef.props.onClick()
    assert.equal(addCharRefImage.value, null)

    const generatePrompt = findAll(root, (node) => node.type === 'button' && collectText(node).includes('重新生成提示词'))[0]
    generatePrompt.props.onClick()
    const extractAnchors = findAll(root, (node) => node.type === 'button' && collectText(node).includes('提炼视觉锚点'))[0]
    extractAnchors.props.onClick()
    const save = findAll(root, (node) => node.type === 'button' && collectText(node).includes('保存'))[0]
    assert.equal(save.props.disabled, false)
    save.props.onClick()
    assert.deepEqual(calls, [
      'extract-ref:character',
      'ref-image:cleared',
      'generate-prompt',
      'extract-anchors',
      'submit',
    ])
    assert.match(collectText(root), /暂无锚点，点击「提炼视觉锚点」自动提炼/)
  } finally {
    app.unmount()
  }
})
