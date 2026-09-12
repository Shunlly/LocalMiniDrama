import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { compileScript, parse } from '@vue/compiler-sfc'
import { createRenderer, defineComponent, h, nextTick, ref, watch } from 'vue'

import { ElMessageBox } from '../src/utils/elementPlusFeedback.js'

const vueUrl = import.meta.resolve('vue')
const characterDialogUrl = new URL('../src/components/filmCreate/FilmCreateCharacterEditDialog.vue', import.meta.url)
const elementPlusFeedbackUrl = new URL('../src/utils/elementPlusFeedback.js', import.meta.url).href
const resourceDialogsUrl = new URL('../src/components/filmCreate/FilmCreateResourceDialogs.vue', import.meta.url)
const filmCreateUrl = new URL('../src/views/FilmCreate.vue', import.meta.url)

const characterDialogSource = readFileSync(characterDialogUrl, 'utf8')
const resourceDialogsSource = readFileSync(resourceDialogsUrl, 'utf8')
const filmCreateSource = readFileSync(filmCreateUrl, 'utf8')

function dataModule(source) {
  return `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
}

function compileSfc(componentUrl, id, replacements = new Map()) {
  const source = readFileSync(componentUrl, 'utf8')
  const parsed = parse(source, { filename: componentUrl.pathname })
  assert.deepEqual(parsed.errors, [])
  let compiledSource = compileScript(parsed.descriptor, { id, inlineTemplate: true }).content
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
    beforeClose: { type: Function, default: undefined },
  },
  emits: ['update:modelValue', 'close'],
  setup(props, { slots, emit }) {
    watch(() => props.modelValue, (visible, wasVisible) => {
      if (wasVisible && !visible) emit('close')
    })
    return () => {
      if (!props.modelValue) return null
      return h('div', {
        'data-dialog': 'character-edit',
        'data-title': props.title,
        beforeClose: props.beforeClose,
      }, [
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
    title: String,
  },
  setup(props, { slots, attrs }) {
    return () => h('button', {
      type: 'button',
      disabled: Boolean(props.disabled || props.loading),
      title: props.title || undefined,
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
  const FilmCreateCharacterEditDialog = (await import(compileSfc(characterDialogUrl, 'character-edit-dialog', new Map([
    ['./ActionGate.vue', actionGateStubUrl],
    ['@/utils/elementPlusFeedback.js', elementPlusFeedbackUrl],
  ])))).default
  const showEditCharacter = ref(props.showEditCharacter)
  const addCharRefImage = ref(props.addCharRefImage)
  const passedProps = { ...props }
  const onUpdateShowEditCharacter = passedProps['onUpdate:showEditCharacter']
  const onUpdateAddCharRefImage = passedProps['onUpdate:addCharRefImage']
  delete passedProps.showEditCharacter
  delete passedProps.addCharRefImage
  delete passedProps['onUpdate:showEditCharacter']
  delete passedProps['onUpdate:addCharRefImage']
  const Harness = defineComponent({
    setup() {
      return () => h(FilmCreateCharacterEditDialog, {
        ...passedProps,
        showEditCharacter: showEditCharacter.value,
        'onUpdate:showEditCharacter': (value) => {
          showEditCharacter.value = value
          onUpdateShowEditCharacter?.(value)
        },
        addCharRefImage: addCharRefImage.value,
        'onUpdate:addCharRefImage': (value) => {
          addCharRefImage.value = value
          onUpdateAddCharRefImage?.(value)
        },
      })
    },
  })
  const root = createHostNode('root')
  const app = renderer.createApp(Harness)
  app.component('AccessibleDialog', AccessibleDialogStub)
  app.component('ElButton', ElButton)
  app.component('ElInput', ElInput)
  app.component('ElForm', ElForm)
  app.component('ElFormItem', ElFormItem)
  app.component('ElSelect', ElSelect)
  app.component('ElOption', ElOption)
  app.mount(root)
  await nextTick()
  return { app, root, showEditCharacter, addCharRefImage }
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

const CHARACTER_EDIT_UNSAVED_CLOSE_MESSAGE = '角色编辑还没有保存，关闭会丢失这些修改。'

function stubConfirm(impl) {
  const calls = []
  const previousConfirm = ElMessageBox.confirm
  ElMessageBox.confirm = async (message, title, options) => {
    calls.push(message)
    assert.equal(title, '未保存的修改')
    assert.equal(options?.confirmButtonText, '放弃修改')
    assert.equal(options?.cancelButtonText, '继续编辑')
    const result = typeof impl === 'function' ? impl(message, title, options) : impl
    if (result === false) throw new Error('cancel')
    return result
  }
  return {
    calls,
    restore() {
      ElMessageBox.confirm = previousConfirm
    },
  }
}

function findDialog(root) {
  return findAll(root, (node) => node.props && node.props['data-dialog'] === 'character-edit')[0]
}

function findCancelButton(root) {
  return findAll(root, (node) => node.type === 'button' && collectText(node).includes('取消'))[0]
}

async function mountCharacterDialogHarness({
  form,
  addCharRefImage: initialRef = null,
  onCloseCharDialog = noop,
} = {}) {
  const FilmCreateCharacterEditDialog = (await import(compileSfc(characterDialogUrl, 'character-edit-dialog-harness', new Map([
    ['./ActionGate.vue', actionGateStubUrl],
    ['@/utils/elementPlusFeedback.js', elementPlusFeedbackUrl],
  ])))).default
  const showEditCharacter = ref(true)
  const addCharRefImage = ref(initialRef)
  const editCharacterForm = ref(form)
  const Harness = defineComponent({
    setup() {
      return () => h(FilmCreateCharacterEditDialog, {
        ...baseHandlers(),
        onCloseCharDialog,
        showEditCharacter: showEditCharacter.value,
        'onUpdate:showEditCharacter': (value) => { showEditCharacter.value = value },
        addCharRefImage: addCharRefImage.value,
        'onUpdate:addCharRefImage': (value) => { addCharRefImage.value = value },
        editCharacterForm: editCharacterForm.value,
      })
    },
  })
  const root = createHostNode('root')
  const app = renderer.createApp(Harness)
  app.component('AccessibleDialog', AccessibleDialogStub)
  app.component('ElButton', ElButton)
  app.component('ElInput', ElInput)
  app.component('ElForm', ElForm)
  app.component('ElFormItem', ElFormItem)
  app.component('ElSelect', ElSelect)
  app.component('ElOption', ElOption)
  app.mount(root)
  await nextTick()
  return { app, root, showEditCharacter, addCharRefImage, editCharacterForm }
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

  const workspaceDialogsSource = readFileSync(new URL('../src/components/filmCreate/FilmCreateWorkspaceDialogs.vue', import.meta.url), 'utf8')
  assert.match(filmCreateSource, /<FilmCreateWorkspaceDialogs/)
  assert.match(workspaceDialogsSource, /<FilmCreateResourceDialogs/)
  assert.match(filmCreateSource, /showEditCharacter/)
  assert.match(filmCreateSource, /editCharacterForm/)
  assert.match(filmCreateSource, /doGenerateCharacterPrompt/)
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
  assert.match(characterDialogSource, /请先填写角色名称/)
  assert.match(characterDialogSource, /AI 正在生成提示词，请稍候/)
  assert.match(characterDialogSource, /正在提取特征描述，请稍候/)
  assert.match(characterDialogSource, /正在从参考图提取描述，请稍候/)
  assert.match(characterDialogSource, /正在从主图提取描述，请稍候/)
  assert.match(characterDialogSource, /请先填写角色外貌描述/)
  assert.match(characterDialogSource, /角色编辑还没有保存，关闭会丢失这些修改。/)
  assert.match(characterDialogSource, /:before-close="handleCharDialogBeforeClose"/)
  assert.match(characterDialogSource, /ElMessageBox.confirm/)
  assert.match(characterDialogSource, /未保存的修改/)
  assert.match(characterDialogSource, /放弃修改/)
  assert.match(characterDialogSource, /继续编辑/)
  assert.doesNotMatch(characterDialogSource, /window\.confirm/)
  assert.match(characterDialogSource, /@click="requestCloseCharDialog"/)
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
    assert.equal(submit.props.title, '请先填写角色名称')

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
    assert.equal(generateButton.props.title, 'AI 正在生成提示词，请稍候')
    const saveWhileGenerating = findAll(generating.root, (node) => node.type === 'button' && collectText(node).includes('保存'))[0]
    assert.equal(saveWhileGenerating.props.disabled, false)
    assert.equal(saveWhileGenerating.props.title, undefined)
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
    assert.equal(extractAnchors.props.title, '请先填写角色外貌描述')
    assert.match(collectText(missingAppearance.root), /请先填写角色外貌描述/)
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
    assert.equal(save.props.title, undefined)
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

test('禁用的保存、提取和生成按钮给出中文原因', async () => {
  const blankName = await mountCharacterDialog({
    ...baseHandlers(),
    showEditCharacter: true,
    addCharRefImage: null,
    editCharacterForm: {
      name: '   ',
      role: '',
      appearance: '',
      description: '',
    },
  })
  try {
    const submit = findAll(blankName.root, (node) => node.type === 'button' && collectText(node).includes('添加'))[0]
    assert.equal(submit.props.disabled, true)
    assert.equal(submit.props.title, '请先填写角色名称')
  } finally {
    blankName.app.unmount()
  }

  const missingForm = await mountCharacterDialog({
    ...baseHandlers(),
    showEditCharacter: true,
    addCharRefImage: null,
    editCharacterForm: null,
  })
  try {
    const submit = findAll(missingForm.root, (node) => node.type === 'button' && (collectText(node).includes('添加') || collectText(node).includes('保存')))[0]
    assert.equal(submit.props.disabled, true)
    assert.equal(submit.props.title, '请先填写角色名称')
  } finally {
    missingForm.app.unmount()
  }

  const extractingNewRef = await mountCharacterDialog({
    ...baseHandlers(),
    showEditCharacter: true,
    addCharRefImage: { dataUrl: 'data:image/png;base64,aaa', filename: 'ref.png' },
    extractingCharAppearance: true,
    editCharacterForm: {
      name: '李华',
      appearance: '短发',
      description: '',
    },
  })
  try {
    const extractRef = findAll(extractingNewRef.root, (node) => node.type === 'button' && collectText(node).includes('提取特征描述'))[0]
    assert.equal(extractRef.props.disabled, true)
    assert.equal(extractRef.props.title, '正在提取特征描述，请稍候')
    const add = findAll(extractingNewRef.root, (node) => node.type === 'button' && collectText(node).includes('添加'))[0]
    assert.equal(add.props.disabled, false)
    assert.equal(add.props.title, undefined)
  } finally {
    extractingNewRef.app.unmount()
  }

  const extractingSavedRef = await mountCharacterDialog({
    ...baseHandlers(),
    showEditCharacter: true,
    addCharRefImage: null,
    extractingCharAppearance: true,
    editCharacterForm: {
      id: 4,
      name: '李华',
      appearance: '短发',
      description: '',
      ref_image: 'chars/ref.png',
    },
  })
  try {
    const extractSaved = findAll(extractingSavedRef.root, (node) => node.type === 'button' && collectText(node).includes('从参考图提取描述'))[0]
    assert.equal(extractSaved.props.disabled, true)
    assert.equal(extractSaved.props.title, '正在从参考图提取描述，请稍候')
  } finally {
    extractingSavedRef.app.unmount()
  }

  const extractingMain = await mountCharacterDialog({
    ...baseHandlers(),
    showEditCharacter: true,
    addCharRefImage: null,
    extractingCharAppearance: true,
    editCharacterForm: {
      id: 5,
      name: '李华',
      appearance: '',
      description: '',
      image_url: '/static/char.png',
    },
  })
  try {
    const extractMain = findAll(extractingMain.root, (node) => node.type === 'button' && collectText(node).includes('从主图提取描述'))[0]
    assert.equal(extractMain.props.disabled, true)
    assert.equal(extractMain.props.title, '正在从主图提取描述，请稍候')
    const extractAnchors = findAll(extractingMain.root, (node) => node.type === 'button' && collectText(node).includes('提炼视觉锚点'))[0]
    assert.equal(extractAnchors.props.disabled, true)
    assert.equal(extractAnchors.props.title, '请先填写角色外貌描述')
  } finally {
    extractingMain.app.unmount()
  }
})


test('无未保存修改时取消和 before-close 都直接关闭', async () => {
  const confirm = stubConfirm(() => {
    assert.fail('无修改关闭不应弹出确认')
  })
  const showEditCharacter = ref(true)
  const closeCalls = []
  const { app, root } = await mountCharacterDialog({
    ...baseHandlers(),
    onCloseCharDialog: () => { closeCalls.push('close') },
    showEditCharacter: showEditCharacter.value,
    'onUpdate:showEditCharacter': (value) => { showEditCharacter.value = value },
    addCharRefImage: null,
    editCharacterForm: {
      name: '李华',
      role: 'main',
      appearance: '短发',
      description: '',
    },
  })
  try {
    await findCancelButton(root).props.onClick()
    await nextTick()
    assert.equal(showEditCharacter.value, false)
    assert.deepEqual(confirm.calls, [])
    assert.ok(closeCalls.length >= 1, '关闭后应走原 onCloseCharDialog 清理草稿')
    assert.ok(closeCalls.every((item) => item === 'close'))
  } finally {
    confirm.restore()
    app.unmount()
  }

  const confirmBeforeClose = stubConfirm(() => {
    assert.fail('无修改关闭不应弹出确认')
  })
  let allowed = false
  const opened = await mountCharacterDialog({
    ...baseHandlers(),
    showEditCharacter: true,
    addCharRefImage: null,
    editCharacterForm: {
      name: '李华',
      role: 'main',
      appearance: '短发',
      description: '',
    },
  })
  try {
    const dialog = findDialog(opened.root)
    assert.equal(typeof dialog.props.beforeClose, 'function')
    await dialog.props.beforeClose(() => { allowed = true })
    assert.equal(allowed, true)
    assert.deepEqual(confirmBeforeClose.calls, [])
  } finally {
    confirmBeforeClose.restore()
    opened.app.unmount()
  }
})

test('有未保存修改时关闭需中文确认，取消确认则保持打开', async () => {
  const confirm = stubConfirm(false)
  const showEditCharacter = ref(true)
  const closeCalls = []
  const form = {
    name: '李华',
    role: 'main',
    appearance: '短发',
    description: '',
  }
  const { app, root } = await mountCharacterDialog({
    ...baseHandlers(),
    onCloseCharDialog: () => { closeCalls.push('close') },
    showEditCharacter: showEditCharacter.value,
    'onUpdate:showEditCharacter': (value) => { showEditCharacter.value = value },
    addCharRefImage: null,
    editCharacterForm: form,
  })
  try {
    form.name = '李华改'
    await findCancelButton(root).props.onClick()
    await nextTick()
    assert.deepEqual(confirm.calls, [CHARACTER_EDIT_UNSAVED_CLOSE_MESSAGE])
    assert.equal(showEditCharacter.value, true)
    assert.deepEqual(closeCalls, [])
    assert.ok(findDialog(root), '拒绝确认后弹窗应保持打开')
    assert.equal(form.name, '李华改')
    await findCancelButton(root).props.onClick()
    await nextTick()
    assert.deepEqual(confirm.calls, [CHARACTER_EDIT_UNSAVED_CLOSE_MESSAGE, CHARACTER_EDIT_UNSAVED_CLOSE_MESSAGE])
    assert.equal(showEditCharacter.value, true)
    assert.deepEqual(closeCalls, [])
  } finally {
    confirm.restore()
    app.unmount()
  }
})

test('有未保存修改时确认关闭会丢掉草稿', async () => {
  const confirm = stubConfirm(true)
  const showEditCharacter = ref(true)
  const closeCalls = []
  const form = {
    name: '李华',
    role: 'main',
    appearance: '短发',
    description: '',
  }
  const { app, root } = await mountCharacterDialog({
    ...baseHandlers(),
    onCloseCharDialog: () => { closeCalls.push('close') },
    showEditCharacter: showEditCharacter.value,
    'onUpdate:showEditCharacter': (value) => { showEditCharacter.value = value },
    addCharRefImage: null,
    editCharacterForm: form,
  })
  try {
    form.appearance = '长发'
    await findCancelButton(root).props.onClick()
    await nextTick()
    assert.deepEqual(confirm.calls, [CHARACTER_EDIT_UNSAVED_CLOSE_MESSAGE])
    assert.equal(showEditCharacter.value, false)
    assert.ok(closeCalls.length >= 1, '关闭后应走原 onCloseCharDialog 清理草稿')
    assert.ok(closeCalls.every((item) => item === 'close'))
  } finally {
    confirm.restore()
    app.unmount()
  }
})

test('改回原值后关闭不再确认', async () => {
  const confirm = stubConfirm(() => {
    assert.fail('改回原值后关闭不应弹出确认')
  })
  const showEditCharacter = ref(true)
  const form = {
    name: '李华',
    role: 'main',
    appearance: '短发',
    description: '',
  }
  const { app, root } = await mountCharacterDialog({
    ...baseHandlers(),
    showEditCharacter: showEditCharacter.value,
    'onUpdate:showEditCharacter': (value) => { showEditCharacter.value = value },
    addCharRefImage: null,
    editCharacterForm: form,
  })
  try {
    form.name = '李华改'
    form.name = '李华'
    await findCancelButton(root).props.onClick()
    await nextTick()
    assert.equal(showEditCharacter.value, false)
    assert.deepEqual(confirm.calls, [])
  } finally {
    confirm.restore()
    app.unmount()
  }
})

test('有未保存修改时 before-close 同样要中文确认', async () => {
  const form = {
    id: 3,
    name: '李华',
    role: 'main',
    appearance: '短发',
    description: '',
    polished_prompt: '提示词',
    stages: '',
  }
  const declined = stubConfirm(false)
  const mounted = await mountCharacterDialog({
    ...baseHandlers(),
    showEditCharacter: true,
    addCharRefImage: null,
    editCharacterForm: form,
  })
  try {
    form.polished_prompt = '改过的提示词'
    let allowed = false
    await findDialog(mounted.root).props.beforeClose(() => { allowed = true })
    assert.equal(allowed, false)
    assert.deepEqual(declined.calls, [CHARACTER_EDIT_UNSAVED_CLOSE_MESSAGE])
  } finally {
    declined.restore()
    mounted.app.unmount()
  }

  const accepted = stubConfirm(true)
  const form2 = {
    id: 3,
    name: '李华',
    role: 'main',
    appearance: '短发',
    description: '',
    polished_prompt: '提示词',
    stages: '',
  }
  const mounted2 = await mountCharacterDialog({
    ...baseHandlers(),
    showEditCharacter: true,
    addCharRefImage: null,
    editCharacterForm: form2,
  })
  try {
    form2.stages = '[{"episode_range":[1,3],"appearance":"白衣"}]'
    let allowed = false
    await findDialog(mounted2.root).props.beforeClose(() => { allowed = true })
    assert.equal(allowed, true)
    assert.deepEqual(accepted.calls, [CHARACTER_EDIT_UNSAVED_CLOSE_MESSAGE])
  } finally {
    accepted.restore()
    mounted2.app.unmount()
  }
})

test('未保存的角色参考图关闭时也要确认', async () => {
  const confirm = stubConfirm(false)
  const closeCalls = []
  const harness = await mountCharacterDialogHarness({
    form: { name: '李华', role: 'main', appearance: '短发', description: '' },
    onCloseCharDialog: () => { closeCalls.push('close') },
  })
  try {
    harness.addCharRefImage.value = { dataUrl: 'data:image/png;base64,aaa', filename: 'ref.png' }
    await nextTick()
    await findCancelButton(harness.root).props.onClick()
    await nextTick()
    assert.deepEqual(confirm.calls, [CHARACTER_EDIT_UNSAVED_CLOSE_MESSAGE])
    assert.equal(harness.showEditCharacter.value, true)
    assert.deepEqual(closeCalls, [])
    assert.equal(harness.addCharRefImage.value.filename, 'ref.png')
  } finally {
    confirm.restore()
    harness.app.unmount()
  }
})

test('before-close 同步 confirm 取消不关闭，确认才关闭', async () => {
  const calls = []
  const previousConfirm = ElMessageBox.confirm
  const form = {
    name: '李华',
    role: 'main',
    appearance: '短发',
    description: '',
  }
  ElMessageBox.confirm = (message, title, options) => {
    calls.push(message)
    assert.equal(title, '未保存的修改')
    assert.equal(options?.confirmButtonText, '放弃修改')
    assert.equal(options?.cancelButtonText, '继续编辑')
    return false
  }
  const mounted = await mountCharacterDialog({
    ...baseHandlers(),
    showEditCharacter: true,
    addCharRefImage: null,
    editCharacterForm: form,
  })
  try {
    form.name = '李华改'
    let allowed = false
    await findDialog(mounted.root).props.beforeClose(() => { allowed = true })
    assert.equal(allowed, false)
    assert.deepEqual(calls, [CHARACTER_EDIT_UNSAVED_CLOSE_MESSAGE])
    assert.ok(findDialog(mounted.root), '同步取消后弹窗应保持打开')
    assert.equal(form.name, '李华改')

    ElMessageBox.confirm = (message, title, options) => {
      calls.push(message)
      assert.equal(title, '未保存的修改')
      assert.equal(options?.confirmButtonText, '放弃修改')
      assert.equal(options?.cancelButtonText, '继续编辑')
      return true
    }
    await findDialog(mounted.root).props.beforeClose(() => { allowed = true })
    assert.equal(allowed, true)
    assert.deepEqual(calls, [CHARACTER_EDIT_UNSAVED_CLOSE_MESSAGE, CHARACTER_EDIT_UNSAVED_CLOSE_MESSAGE])
  } finally {
    ElMessageBox.confirm = previousConfirm
    mounted.app.unmount()
  }
})

test('before-close 异步确认必须等用户选择再关闭，取消后脏保护仍在', async () => {
  const pending = []
  const confirm = stubConfirm(() => new Promise((resolve, reject) => {
    pending.push({ resolve, reject })
  }))
  const form = {
    name: '李华',
    role: 'main',
    appearance: '短发',
    description: '',
  }
  const mounted = await mountCharacterDialog({
    ...baseHandlers(),
    showEditCharacter: true,
    addCharRefImage: null,
    editCharacterForm: form,
  })
  try {
    form.appearance = '长发'
    let allowed = false
    const first = findDialog(mounted.root).props.beforeClose(() => { allowed = true })
    assert.equal(pending.length, 1)
    await Promise.resolve()
    assert.equal(allowed, false, '用户尚未选择时不能调用 done')
    pending[0].reject(new Error('cancel'))
    await first
    assert.equal(allowed, false)
    assert.ok(findDialog(mounted.root), '异步取消后弹窗应保持打开')
    assert.equal(form.appearance, '长发')

    const second = findDialog(mounted.root).props.beforeClose(() => { allowed = true })
    assert.equal(pending.length, 2)
    await Promise.resolve()
    assert.equal(allowed, false, '第二次确认未完成前也不能调用 done')
    pending[1].resolve('confirm')
    await second
    assert.equal(allowed, true)
    assert.deepEqual(confirm.calls, [CHARACTER_EDIT_UNSAVED_CLOSE_MESSAGE, CHARACTER_EDIT_UNSAVED_CLOSE_MESSAGE])
  } finally {
    confirm.restore()
    mounted.app.unmount()
  }
})
