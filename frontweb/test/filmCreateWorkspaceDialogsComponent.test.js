import test from 'node:test'
import assert from 'node:assert/strict'

import { h, nextTick, ref } from 'vue'

import {
  buttonByAriaLabel,
  buttonByText,
  click,
  compileIconStub,
  compileSfc,
  createHostRenderer,
  dataModule,
  findAll,
  hasClass,
  loadCompiledSfc,
  mountHarness,
  textContent,
  vueUrl,
} from './helpers/vueComponentHarness.js'
import { AccessibleDialogStub } from './helpers/accessibleDialogStub.js'

const workspaceUrl = new URL('../src/components/filmCreate/FilmCreateWorkspaceDialogs.vue', import.meta.url)
const aiConfigDialogUrl = new URL('../src/components/filmCreate/FilmCreateAiConfigDialog.vue', import.meta.url)
const imagePreviewUrl = new URL('../src/components/ImagePreviewDialog.vue', import.meta.url)
const mediaUrl = new URL('../src/utils/mediaUrl.js', import.meta.url)
const iconStubUrl = compileIconStub(['ArrowLeft'])

const resourceDialogsStubUrl = dataModule(`
  import { defineComponent, h } from ${JSON.stringify(vueUrl)}
  export default defineComponent({
    name: 'FilmCreateResourceDialogsStub',
    setup() {
      return () => h('div', { 'data-resource-dialogs': 'true' }, '资源对话框')
    },
  })
`)
const storyboardDialogsStubUrl = dataModule(`
  import { defineComponent, h } from ${JSON.stringify(vueUrl)}
  export default defineComponent({
    name: 'FilmCreateStoryboardDialogsStub',
    setup() {
      return () => h('div', { 'data-storyboard-dialogs': 'true' }, '分镜对话框')
    },
  })
`)
const novelImportStubUrl = dataModule(`
  import { defineComponent, h } from ${JSON.stringify(vueUrl)}
  export default defineComponent({
    name: 'FilmCreateNovelImportDialogStub',
    props: ['visible', 'mode', 'text', 'maxChapters', 'aiSummarize', 'fileName', 'importing'],
    emits: ['update:visible', 'update:mode', 'update:text', 'update:maxChapters', 'update:aiSummarize', 'reset', 'file-change', 'import'],
    setup(props, { emit }) {
      return () => props.visible
        ? h('dialog', { 'data-title': '导入小说/长文', role: 'dialog' }, [
            h('strong', '导入小说/长文'),
            props.fileName ? h('p', \`已选择：\${props.fileName}\`) : h('p', '还没有选择文件'),
            h('button', { type: 'button', onClick: () => emit('import') }, '开始导入'),
          ])
        : null
    },
  })
`)
const mediaPickerStubUrl = dataModule(`
  import { defineComponent, h } from ${JSON.stringify(vueUrl)}
  export default defineComponent({
    name: 'GlobalMediaPickerDialogStub',
    props: ['modelValue', 'title', 'accept', 'context'],
    emits: ['update:modelValue', 'select', 'open-library'],
    setup(props, { emit }) {
      return () => props.modelValue
        ? h('dialog', { 'data-title': props.title || '', role: 'dialog' }, [
            h('strong', props.title || '选择素材'),
            h('button', { type: 'button', onClick: () => emit('select', { id: 1 }) }, '选择素材'),
            h('button', { type: 'button', onClick: () => emit('open-library') }, '前往素材中心'),
          ])
        : null
    },
  })
`)
const aiConfigContentStubUrl = dataModule(`
  import { defineComponent, h } from ${JSON.stringify(vueUrl)}
  export default defineComponent({
    name: 'AIConfigContentStub',
    setup(_props, { expose }) {
      expose({
        async requestClose() { return true },
        hasUnsavedChanges() { return false },
      })
      return () => h('div', { 'data-ai-config-content': 'true' }, 'AI 配置内容')
    },
  })
`)

const compiledAiConfigDialogUrl = compileSfc(
  aiConfigDialogUrl,
  'film-create-ai-config-dialog',
  new Map([
    ['vue', vueUrl],
    ['@element-plus/icons-vue', iconStubUrl],
    ['@/components/AIConfigContent.vue', aiConfigContentStubUrl],
  ]),
)
const compiledImagePreviewUrl = compileSfc(
  imagePreviewUrl,
  'image-preview-dialog',
  new Map([
    ['vue', vueUrl],
    ['@/utils/mediaUrl.js', mediaUrl.href],
  ]),
)
const FilmCreateWorkspaceDialogs = await loadCompiledSfc(
  workspaceUrl,
  'film-create-workspace-dialogs-component',
  new Map([
    ['vue', vueUrl],
    ['@/components/filmCreate/FilmCreateAiConfigDialog.vue', compiledAiConfigDialogUrl],
    ['@/components/filmCreate/FilmCreateNovelImportDialog.vue', novelImportStubUrl],
    ['@/components/filmCreate/FilmCreateResourceDialogs.vue', resourceDialogsStubUrl],
    ['@/components/filmCreate/FilmCreateStoryboardDialogs.vue', storyboardDialogsStubUrl],
    ['@/components/GlobalMediaPickerDialog.vue', mediaPickerStubUrl],
    ['@/components/ImagePreviewDialog.vue', compiledImagePreviewUrl],
  ]),
)

const renderer = createHostRenderer()

function dialogByTitle(root, title) {
  return findAll(root, (node) => node.type === 'dialog' && node.props?.['data-title'] === title)[0]
}

function assertAiConfigLogosHaveBrandPrefix(root) {
  const logos = findAll(root, (node) => hasClass(node, 'logo'))
  for (const logo of logos) {
    const name = String(logo.props?.['aria-label'] || textContent(logo) || '')
    assert.match(name, /^本地短剧助手，/, 'AI 配置返回若出现 Logo，accessible name 必须带品牌前缀')
  }
}

function mountWorkspace(initial = {}) {
  const events = []
  const visible = ref(initial.visible ?? false)
  const showAiConfig = ref(initial.modelValue ?? false)
  const showPicker = ref(initial.showGlobalMediaPicker ?? false)
  const props = {
    resourceDialogs: {},
    storyboardDialogs: {},
    fileName: initial.fileName ?? '',
    importing: false,
    initialServiceType: '',
    previewImageUrl: initial.previewImageUrl ?? '',
    globalMediaPickerTitle: initial.globalMediaPickerTitle ?? '选择参考图',
    globalMediaPickerAccept: 'image',
    globalMediaPickerContext: { dramaId: 11 },
    mode: 'text',
    text: '',
    maxChapters: 10,
    aiSummarize: false,
  }
  const mounted = mountHarness(renderer, () => h(FilmCreateWorkspaceDialogs, {
    ...props,
    visible: visible.value,
    modelValue: showAiConfig.value,
    showGlobalMediaPicker: showPicker.value,
    'onUpdate:visible': (value) => { visible.value = value },
    'onUpdate:modelValue': (value) => { showAiConfig.value = value },
    'onUpdate:showGlobalMediaPicker': (value) => { showPicker.value = value },
    onReset: () => events.push(['reset']),
    onFileChange: (value) => events.push(['file-change', value]),
    onImport: () => events.push(['import']),
    onBack: () => events.push(['back']),
    onConfigurationChanged: () => events.push(['configuration-changed']),
    onCloseImagePreview: () => events.push(['close-image-preview']),
    onSelect: (value) => events.push(['select', value]),
    onOpenLibrary: () => events.push(['open-library']),
  }), {
    components: {
      AccessibleDialog: AccessibleDialogStub,
    },
  })
  return { ...mounted, events, visible, showAiConfig, showPicker }
}

test('工作区始终挂上资源和分镜对话框，打开小说导入可见中文标题', async () => {
  const harness = mountWorkspace({
    visible: true,
    fileName: '雨巷.txt',
  })
  try {
    await nextTick()
    assert.match(textContent(harness.root), /资源对话框/)
    assert.match(textContent(harness.root), /分镜对话框/)
    const novel = dialogByTitle(harness.root, '导入小说/长文')
    assert.ok(novel)
    assert.match(textContent(novel), /导入小说\/长文/)
    assert.match(textContent(novel), /已选择：雨巷.txt/)
    click(buttonByText(novel, '开始导入'))
    assert.deepEqual(harness.events, [['import']])
  } finally {
    harness.app.unmount()
  }
})

test('AI 配置工作区返回按钮是返回制作；若出现 Logo 必须带品牌前缀', async () => {
  const harness = mountWorkspace({ modelValue: true })
  try {
    await nextTick()
    assert.ok(dialogByTitle(harness.root, 'AI 配置'))
    const back = buttonByText(harness.root, '返回制作')
    assert.ok(back)
    assert.equal(textContent(back).replace(/\s+/g, ' ').trim(), '返回制作')
    assert.equal(buttonByText(harness.root, '返回剧集'), undefined)
    assert.equal(buttonByText(harness.root, '返回剧集管理'), undefined)
    assert.equal(buttonByAriaLabel(harness.root, '返回剧集管理'), undefined)
    assertAiConfigLogosHaveBrandPrefix(harness.root)
    click(back)
    assert.deepEqual(harness.events, [['back']])
    assert.match(textContent(harness.root), /AI 配置内容/)
  } finally {
    harness.app.unmount()
  }
})

test('图片预览标题是制作资源图片预览，素材选择标题按传入值展示', async () => {
  const preview = mountWorkspace({ previewImageUrl: '/static/preview.png' })
  try {
    await nextTick()
    const dialog = dialogByTitle(preview.root, '制作资源图片预览')
    assert.ok(dialog)
    assert.match(textContent(dialog), /正在验证图片…/)
    click(buttonByText(dialog, '关闭预览'))
    await nextTick()
    assert.deepEqual(preview.events, [['close-image-preview']])
  } finally {
    preview.app.unmount()
  }

  const picker = mountWorkspace({
    showGlobalMediaPicker: true,
    globalMediaPickerTitle: '选择分镜参考图',
  })
  try {
    await nextTick()
    const dialog = dialogByTitle(picker.root, '选择分镜参考图')
    assert.ok(dialog)
    click(buttonByText(dialog, '选择素材'))
    click(buttonByText(dialog, '前往素材中心'))
    assert.deepEqual(picker.events, [
      ['select', { id: 1 }],
      ['open-library'],
    ])
  } finally {
    picker.app.unmount()
  }
})
