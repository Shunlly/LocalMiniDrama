import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { parse } from '@vue/compiler-sfc'
import { defineComponent, h, nextTick, reactive } from 'vue'

import { DRAMA_DETAIL_RESOURCE_DIALOG_FILES } from './helpers/dramaDetailResourceDialogSources.js'
import {
  buttonByAriaLabel,
  buttonByText,
  click,
  compileIconStub,
  compileSfc,
  createHostRenderer,
  loadCompiledSfc,
  mountHarness,
  textContent,
} from './helpers/vueComponentHarness.js'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const imageEditorUrl = new URL('../src/components/dramaDetail/DramaDetailResourceImageEditor.vue', import.meta.url)
const characterDialogsUrl = new URL('../src/components/dramaDetail/DramaDetailCharacterEditDialogs.vue', import.meta.url)

const renderer = createHostRenderer()

const ElFormStub = defineComponent({
  name: 'ElFormStub',
  setup(_props, { slots }) {
    return () => h('form', { 'data-el': 'el-form' }, slots.default?.())
  },
})

const ElFormItemStub = defineComponent({
  name: 'ElFormItemStub',
  props: ['label'],
  setup(props, { slots }) {
    return () => h('div', { 'data-el': 'el-form-item', 'data-label': props.label || '' }, [
      props.label ? h('span', props.label) : null,
      slots.default?.(),
    ])
  },
})

const AccessibleDialogStub = defineComponent({
  name: 'AccessibleDialog',
  props: ['modelValue', 'title', 'width', 'closeOnPressEscape', 'beforeClose'],
  emits: ['update:modelValue', 'close'],
  setup(props, { slots }) {
    return () => h('dialog', {
      'data-title': props.title,
      'data-esc': props.closeOnPressEscape ? 'true' : 'false',
    }, [
      slots.default?.(),
      h('footer', {}, slots.footer?.()),
    ])
  },
})

function formStubs() {
  return {
    'el-form': ElFormStub,
    ElForm: ElFormStub,
    'el-form-item': ElFormItemStub,
    ElFormItem: ElFormItemStub,
    AccessibleDialog: AccessibleDialogStub,
  }
}

test('拆出的资源弹窗 SFC 都能编译', () => {
  for (const file of DRAMA_DETAIL_RESOURCE_DIALOG_FILES) {
    const parsed = parse(read(file), { filename: file.split('/').pop() })
    assert.deepEqual(parsed.errors, [])
  }
  const parent = read('../src/components/dramaDetail/DramaDetailResourceDialogs.vue')
  assert.match(parent, /<DramaDetailCharacterEditDialogs/)
  assert.match(parent, /<DramaDetailSceneEditDialogs/)
  assert.match(parent, /<DramaDetailPropEditDialogs/)
  assert.match(parent, /从素材库导入/)
  assert.match(parent, /<ImagePreviewDialog/)
  assert.match(parent, /title="资源图片预览"/)
  assert.match(parent, /if \(!visible\) previewUrl = null/)
  const page = read('../src/views/DramaDetail.vue')
  assert.match(page, /<DramaDetailResourceDialogs v-bind="resourceDialogsBindings"/)
  assert.doesNotMatch(page, /<ImagePreviewDialog/)
  assert.match(read('../src/components/dramaDetail/dramaDetailResourceDialogBindings.js'), /'previewUrl'/)
})

test('图片操作条无图时禁用预览并给出暂无图片', async () => {
  const ImageEditor = await loadCompiledSfc(
    imageEditorUrl,
    'drama-detail-resource-image-editor',
    new Map([['@element-plus/icons-vue', compileIconStub(['PictureFilled'])]]),
  )
  const events = []
  const form = reactive({ name: '阿宁', image_url: '', local_path: '' })
  const mounted = mountHarness(renderer, () => h(ImageEditor, {
    form,
    previewLabel: '预览制作角色图片',
    fallbackAlt: '制作角色图片',
    altKey: 'name',
    assetImageUrl: (item) => item?.image_url || '',
    onPreview: (url) => events.push(['preview', url]),
    onUpload: () => events.push(['upload']),
    onGenerate: () => events.push(['generate']),
  }), { components: formStubs() })
  try {
    const thumb = buttonByAriaLabel(mounted.root, '预览制作角色图片')
    assert.ok(thumb)
    assert.equal(thumb.props.disabled, true)
    assert.equal(thumb.props.title, '暂无图片')
    click(thumb)
    assert.deepEqual(events, [['preview', '']])
    const generate = buttonByText(mounted.root, 'AI 生成')
    assert.ok(generate)
    click(generate)
    assert.deepEqual(events, [['preview', ''], ['generate']])
  } finally {
    mounted.app.unmount()
  }
})

test('图片操作条上传和生图互斥并给出中文原因', async () => {
  const ImageEditor = await loadCompiledSfc(
    imageEditorUrl,
    'drama-detail-resource-image-editor-mutex',
    new Map([['@element-plus/icons-vue', compileIconStub(['PictureFilled'])]]),
  )

  async function mountWith(form) {
    return mountHarness(renderer, () => h(ImageEditor, {
      form,
      previewLabel: '预览道具库图片',
      fallbackAlt: '道具库图片',
      assetImageUrl: (item) => item?.image_url || '',
    }), { components: formStubs() })
  }

  const generating = await mountWith(reactive({
    name: '玉佩',
    image_url: 'https://cdn.example/prop.png',
    imgGenerating: true,
    imgUploading: false,
  }))
  try {
    const upload = buttonByText(generating.root, '上传图片')
    const generate = buttonByText(generating.root, 'AI 生成')
    assert.equal(upload.props.disabled, true)
    assert.equal(upload.props.title, '正在生成图片，请稍候')
    assert.equal(generate.props['data-loading'], true)
    const thumb = buttonByAriaLabel(generating.root, '预览道具库图片')
    assert.equal(thumb.props.disabled, false)
    assert.equal(thumb.props.title, undefined)
  } finally {
    generating.app.unmount()
  }

  const uploading = await mountWith(reactive({
    name: '玉佩',
    image_url: 'https://cdn.example/prop.png',
    imgGenerating: false,
    imgUploading: true,
  }))
  try {
    const upload = buttonByText(uploading.root, '上传图片')
    const generate = buttonByText(uploading.root, 'AI 生成')
    assert.equal(generate.props.disabled, true)
    assert.equal(generate.props.title, '正在上传图片，请稍候')
    assert.equal(upload.props['data-loading'], true)
  } finally {
    uploading.app.unmount()
  }
})

test('角色弹窗取消仍走离开确认，ESC 关闭也保留', async () => {
  const imageEditorModule = compileSfc(
    imageEditorUrl,
    'drama-detail-resource-image-editor-nested',
    new Map([['@element-plus/icons-vue', compileIconStub(['PictureFilled'])]]),
  )
  const CharacterDialogs = await loadCompiledSfc(
    characterDialogsUrl,
    'drama-detail-character-edit-dialogs',
    new Map([['./DramaDetailResourceImageEditor.vue', imageEditorModule]]),
  )
  const closes = []
  const form = reactive({ name: '阿宁', role: 'main', description: '', personality: '', appearance: '' })
  const mounted = mountHarness(renderer, () => h(CharacterDialogs, {
    editDramaCharVisible: true,
    editDramaCharForm: form,
    editCharVisible: false,
    editCharForm: null,
    editDramaCharSaving: false,
    editCharSaving: false,
    assetImageUrl: () => '',
    characterLibraryAPI: {},
    doGenerateLibImg() {},
    doUploadLibImg() {},
    generateDramaCharImg() {},
    loadCharList() {},
    openPreview() {},
    requestResourceEditorClose: (kind) => closes.push(kind),
    saveChar() {},
    saveDramaChar() {},
    uploadDramaCharImg() {},
  }), { components: formStubs() })
  try {
    await nextTick()
    assert.match(textContent(mounted.root), /制作角色名称|阿宁|角色类型/)
    const cancel = buttonByText(mounted.root, '取消')
    assert.ok(cancel, '制作角色弹窗必须有取消按钮')
    click(cancel)
    assert.deepEqual(closes, ['dramaChar'])
    const source = read('../src/components/dramaDetail/DramaDetailCharacterEditDialogs.vue')
    assert.match(source, /:close-on-press-escape="true"/)
    assert.match(source, /:before-close="\(done\) => requestResourceEditorClose\('dramaChar', done\)"/)
  } finally {
    mounted.app.unmount()
  }
})
