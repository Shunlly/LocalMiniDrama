import test from 'node:test'
import assert from 'node:assert/strict'

import { defineComponent, h, nextTick, reactive } from 'vue'

import {
  buttonByAriaLabel,
  buttonByText,
  click,
  compileIconStub,
  createHostRenderer,
  findAll,
  loadCompiledSfc,
  mountHarness,
  textContent,
  vueUrl,
} from './helpers/vueComponentHarness.js'

const editorUrl = new URL('../src/components/dramaDetail/DramaDetailResourceImageEditor.vue', import.meta.url)
const iconStubUrl = compileIconStub(['PictureFilled'])
const DramaDetailResourceImageEditor = await loadCompiledSfc(
  editorUrl,
  'drama-detail-resource-image-editor',
  new Map([
    ['vue', vueUrl],
    ['@element-plus/icons-vue', iconStubUrl],
  ]),
)
const renderer = createHostRenderer()
const ElFormItemStub = defineComponent({
  name: 'ElFormItemStub',
  setup(_props, { slots }) {
    return () => h('div', { 'data-el': 'el-form-item' }, slots.default?.())
  },
})
const CHAR_ID = 101
const OTHER_ID = 202
assert.notEqual(CHAR_ID, OTHER_ID)

function mountEditor(initial = {}) {
  const events = []
  const form = reactive({
    id: CHAR_ID,
    name: '林深',
    image_url: initial.imageUrl ?? '',
    local_path: initial.localPath ?? '',
    imgUploading: Boolean(initial.uploading),
    imgGenerating: Boolean(initial.generating),
  })
  const mounted = mountHarness(renderer, () => h(DramaDetailResourceImageEditor, {
    form,
    previewLabel: '预览角色图片',
    fallbackAlt: '角色图片',
    altKey: 'name',
    assetImageUrl: (entry) => entry?.image_url || (entry?.local_path ? `/static/${entry.local_path}` : ''),
    onPreview: (url) => events.push(['preview', url]),
    onUpload: (event) => events.push(['upload', event?.target?.files?.[0]?.name || '']),
    onGenerate: () => events.push(['generate']),
  }), {
    components: {
      ElFormItem: ElFormItemStub,
      'el-form-item': ElFormItemStub,
    },
  })
  return { ...mounted, events, form }
}

test('没有图片时预览改为空态占位，AI 生成仍交给页面', async () => {
  const harness = mountEditor()
  try {
    await nextTick()
    assert.equal(buttonByAriaLabel(harness.root, '预览角色图片'), undefined)
    const empty = findAll(harness.root, (node) => node.props?.['aria-label'] === '暂无图片')[0]
    assert.ok(empty, '缺少暂无图片占位')
    assert.equal(empty.props.role, 'img')
    assert.equal(empty.props.disabled, undefined)
    click(buttonByText(harness.root, 'AI 生成'))
    assert.deepEqual(harness.events, [['generate']])
  } finally {
    harness.app.unmount()
  }
})

test('已有图片可预览；上传中禁用生成，生成中禁用上传', async () => {
  const ready = mountEditor({ imageUrl: '/static/char.png' })
  try {
    await nextTick()
    const preview = buttonByAriaLabel(ready.root, '预览角色图片')
    assert.notEqual(preview.props.disabled, true)
    click(preview)
    assert.deepEqual(ready.events, [['preview', '/static/char.png']])
  } finally {
    ready.app.unmount()
  }

  const uploading = mountEditor({ imageUrl: '/static/char.png', uploading: true })
  try {
    await nextTick()
    const generate = buttonByText(uploading.root, 'AI 生成')
    assert.equal(generate.props.disabled, true)
    assert.equal(generate.props.title, '正在上传图片，请稍候')
    assert.equal(generate.props['aria-describedby'], 'resource-image-generate-reason-101')
    const generateWrap = findAll(uploading.root, (node) => node.props?.['aria-label'] === 'AI 生成图片不可用：正在上传图片，请稍候')[0]
    assert.ok(generateWrap, '缺少生成禁用原因读屏')
    assert.equal(generateWrap.props.tabindex, 0)
    assert.deepEqual(uploading.events, [])
  } finally {
    uploading.app.unmount()
  }

  const generating = mountEditor({ imageUrl: '/static/char.png', generating: true })
  try {
    await nextTick()
    const upload = buttonByText(generating.root, '上传图片')
    assert.equal(upload.props.disabled, true)
    assert.equal(upload.props.title, '正在生成图片，请稍候')
    assert.equal(upload.props['aria-describedby'], 'resource-image-upload-reason-101')
    const uploadWrap = findAll(generating.root, (node) => node.props?.['aria-label'] === '上传图片不可用：正在生成图片，请稍候')[0]
    assert.ok(uploadWrap, '缺少上传禁用原因读屏')
    assert.equal(uploadWrap.props.tabindex, 0)
  } finally {
    generating.app.unmount()
  }
})
