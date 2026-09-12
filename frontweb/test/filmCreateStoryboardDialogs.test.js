import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { compileScript, parse } from '@vue/compiler-sfc'
import { defineComponent, h, nextTick, ref, watch } from 'vue'

import {
  buttonByText,
  click,
  compileSfc,
  createHostRenderer,
  findAll,
  findByType,
  mountHarness,
  textContent,
} from './helpers/vueComponentHarness.js'

const DRAMA_ID = 11
const EPISODE_ID = 22
const STORYBOARD_ID = 77
assert.notEqual(DRAMA_ID, EPISODE_ID)
assert.notEqual(STORYBOARD_ID, DRAMA_ID)
assert.notEqual(STORYBOARD_ID, EPISODE_ID)

const DIALOG_FILES = [
  'FilmCreateStoryboardDialogs.vue',
  'FilmCreateStoryboardPromptDialog.vue',
  'FilmCreateStoryboardFramePromptDialog.vue',
  'FilmCreateStoryboardVideoParamsDialog.vue',
  'FilmCreateStoryboardFreeReferencePreview.vue',
]

function readDialog(name) {
  return readFileSync(new URL(`../src/components/filmCreate/${name}`, import.meta.url), 'utf8')
}

function dialogUrl(name) {
  return new URL(`../src/components/filmCreate/${name}`, import.meta.url)
}

const renderer = createHostRenderer()

const AccessibleDialogStub = defineComponent({
  name: 'AccessibleDialog',
  props: {
    modelValue: { type: Boolean, default: false },
    title: { type: String, default: '' },
    width: { type: [String, Number], default: '' },
    destroyOnClose: { type: Boolean, default: false },
  },
  emits: ['update:modelValue', 'close'],
  setup(props, { slots, emit }) {
    watch(() => props.modelValue, (visible, wasVisible) => {
      if (wasVisible && !visible) emit('close')
    }, { flush: 'sync' })
    return () => {
      if (!props.modelValue) return null
      return h('div', {
        'data-dialog': 'storyboard',
        'data-title': props.title,
      }, [
        h('strong', props.title),
        slots.default?.(),
        h('div', { 'data-dialog-footer': 'true' }, slots.footer?.()),
      ])
    }
  },
})

function stubEl(name, tag = 'div') {
  return defineComponent({
    name,
    inheritAttrs: false,
    props: ['label', 'gutter', 'span', 'labelPosition', 'labelWidth', 'size', 'type', 'rows', 'readonly'],
    setup(props, { slots, attrs }) {
      return () => h(tag, { ...attrs, 'data-el': name, 'data-label': props.label || '' }, slots.default?.())
    },
  })
}

const extraStubs = {
  AccessibleDialog: AccessibleDialogStub,
  'el-form': stubEl('ElForm', 'form'),
  ElForm: stubEl('ElForm', 'form'),
  'el-form-item': stubEl('ElFormItem'),
  ElFormItem: stubEl('ElFormItem'),
  'el-row': stubEl('ElRow'),
  ElRow: stubEl('ElRow'),
  'el-col': stubEl('ElCol'),
  ElCol: stubEl('ElCol'),
  'el-option-group': stubEl('ElOptionGroup', 'optgroup'),
  ElOptionGroup: stubEl('ElOptionGroup', 'optgroup'),
}

function noop() {}

function requiredFns(overrides = {}) {
  return {
    angleToPromptFragment: () => ({ label: '' }),
    assetImageUrl: (item) => item?.image_url || item?.url || '',
    canSplitSbByAudio: () => false,
    getSbFreeReferenceItems: () => [],
    getSbGridImages: () => [],
    onPolishSbPrompt: noop,
    onPromoteSbFreeReferenceImage: noop,
    onRegenerateLayoutDescription: noop,
    onRemoveSbFreeReferenceImage: noop,
    onSaveSbPromptDialog: noop,
    onSaveVideoParams: noop,
    onSplitSbByAudio: noop,
    onVideoParamsDialogClosed: noop,
    openGlobalMediaPicker: noop,
    openImagePreview: noop,
    regenerateEditingFramePrompt: noop,
    saveEditingFramePrompt: noop,
    setSbCreationModeId: noop,
    ...overrides,
  }
}

function byAriaLabel(root, label) {
  return findAll(root, (node) => node.props?.['aria-label'] === label)
}

function mountComponent(component, initialProps) {
  const props = ref({ ...initialProps })
  for (const key of Object.keys(initialProps)) {
    props.value[`onUpdate:${key}`] = (value) => {
      props.value[key] = value
    }
  }
  const mounted = mountHarness(renderer, () => h(component, { ...props.value }), { components: extraStubs })
  return { ...mounted, props }
}

const previewModuleUrl = compileSfc(dialogUrl('FilmCreateStoryboardFreeReferencePreview.vue'), 'sb-free-reference-preview')
const promptModuleUrl = compileSfc(dialogUrl('FilmCreateStoryboardPromptDialog.vue'), 'sb-prompt-dialog')
const frameModuleUrl = compileSfc(dialogUrl('FilmCreateStoryboardFramePromptDialog.vue'), 'sb-frame-prompt-dialog')
const videoModuleUrl = compileSfc(
  dialogUrl('FilmCreateStoryboardVideoParamsDialog.vue'),
  'sb-video-params-dialog',
  new Map([['./FilmCreateStoryboardFreeReferencePreview.vue', previewModuleUrl]]),
)
const parentModuleUrl = compileSfc(
  dialogUrl('FilmCreateStoryboardDialogs.vue'),
  'sb-dialogs-parent',
  new Map([
    ['./FilmCreateStoryboardPromptDialog.vue', promptModuleUrl],
    ['./FilmCreateStoryboardFramePromptDialog.vue', frameModuleUrl],
    ['./FilmCreateStoryboardVideoParamsDialog.vue', videoModuleUrl],
  ]),
)

const FilmCreateStoryboardFreeReferencePreview = (await import(previewModuleUrl)).default
const FilmCreateStoryboardPromptDialog = (await import(promptModuleUrl)).default
const FilmCreateStoryboardFramePromptDialog = (await import(frameModuleUrl)).default
const FilmCreateStoryboardVideoParamsDialog = (await import(videoModuleUrl)).default
const FilmCreateStoryboardDialogs = (await import(parentModuleUrl)).default

test('分镜弹窗子组件都可以独立编译', () => {
  for (const name of DIALOG_FILES) {
    const source = readDialog(name)
    const parsed = parse(source, { filename: name })
    assert.deepEqual(parsed.errors, [], name)
    assert.doesNotThrow(() => compileScript(parsed.descriptor, { id: name }), name)
  }
})

test('父组件只编排提示词、配置、预览子组件，不改空剧本生成分镜语义', () => {
  const parent = readDialog('FilmCreateStoryboardDialogs.vue')
  const all = DIALOG_FILES.map(readDialog).join('\n')
  assert.match(parent, /<FilmCreateStoryboardPromptDialog/)
  assert.match(parent, /<FilmCreateStoryboardFramePromptDialog/)
  assert.match(parent, /<FilmCreateStoryboardVideoParamsDialog/)
  assert.match(
    parent,
    /<FilmCreateStoryboardFramePromptDialog[\s\S]*:editing-frame-prompt-regenerating="editingFramePromptRegenerating"/,
  )
  assert.doesNotMatch(parent, /<FilmCreateStoryboardVideoParamsDialog[\s\S]*editing-frame-prompt-regenerating/)
  assert.doesNotMatch(parent, /<AccessibleDialog/)
  assert.doesNotMatch(parent, /<FilmCreateStoryboardFreeReferencePreview/)
  assert.match(readDialog('FilmCreateStoryboardVideoParamsDialog.vue'), /<FilmCreateStoryboardFreeReferencePreview/)
  assert.doesNotMatch(all, /storyboardActionDisabledReason/)
  assert.doesNotMatch(all, /当前集还没有剧本/)
  assert.doesNotMatch(all, /onGenerateStoryboard/)
  assert.doesNotMatch(all, /from 'element-plus'/)
  assert.doesNotMatch(all, /ElMessage/)
})

test('提示词弹窗按字段保存，关闭时清掉分镜目标而不是项目 id', async () => {
  const calls = []
  const harness = mountComponent(FilmCreateStoryboardPromptDialog, {
    showSbPromptDialog: true,
    sbPromptTarget: { id: STORYBOARD_ID, storyboard_number: 3 },
    sbPromptImageText: '原始',
    sbPromptPolishedText: '',
    sbPromptVideoText: '视频',
    onPolishSbPrompt: () => calls.push('polish'),
    onSaveSbPromptDialog: () => calls.push('save'),
  })
  try {
    await nextTick()
    assert.match(textContent(harness.root), /图片提示词/)
    assert.equal(byAriaLabel(harness.root, '原始图片提示词').length, 1)
    assert.equal(byAriaLabel(harness.root, '通用优化提示词').length, 1)
    assert.equal(byAriaLabel(harness.root, '视频提示词').length, 1)
    click(buttonByText(harness.root, '立即生成'))
    click(buttonByText(harness.root, '保存'))
    assert.deepEqual(calls, ['polish', 'save'])
    click(buttonByText(harness.root, '取消'))
    await nextTick()
    assert.equal(harness.props.value.showSbPromptDialog, false)
    assert.equal(harness.props.value.sbPromptTarget, null)
    assert.notEqual(STORYBOARD_ID, DRAMA_ID)
  } finally {
    harness.app.unmount()
  }
})

test('首尾帧提示词弹窗展示布局锚点，保存和重新生成走原回调', async () => {
  const calls = []
  const harness = mountComponent(FilmCreateStoryboardFramePromptDialog, {
    showFramePromptEditor: true,
    editingFramePromptSlot: 'last',
    editingFramePromptText: '尾帧提示词',
    editingFramePromptSb: { id: STORYBOARD_ID, layout_description: '女主站左，男主站右' },
    regenerateEditingFramePrompt: () => calls.push('regen'),
    saveEditingFramePrompt: () => calls.push('save'),
  })
  try {
    await nextTick()
    assert.match(textContent(harness.root), /尾帧图生提示词/)
    assert.match(textContent(harness.root), /女主站左，男主站右/)
    assert.equal(byAriaLabel(harness.root, '尾帧图生提示词').length, 1)
    click(buttonByText(harness.root, '重新生成'))
    click(buttonByText(harness.root, '保存'))
    assert.deepEqual(calls, ['regen', 'save'])
  } finally {
    harness.app.unmount()
  }
})

test('参考图预览可打开图片预览、设主参考和素材选择，不误用项目 id', async () => {
  const calls = { preview: [], promote: [], remove: [], picker: [] }
  const target = { id: STORYBOARD_ID, storyboard_number: 3 }
  const items = [
    { name: '主图', image_url: '/static/a.png', source_drama_title: '本剧' },
    { name: '海报', image_url: '/static/b.png', source_drama_title: '其他剧' },
  ]
  const harness = mountComponent(FilmCreateStoryboardFreeReferencePreview, {
    videoParamsTarget: target,
    assetImageUrl: (item) => item.image_url,
    getSbFreeReferenceItems: (current) => {
      assert.equal(current.id, STORYBOARD_ID)
      assert.notEqual(current.id, DRAMA_ID)
      return items
    },
    openImagePreview: (url) => calls.preview.push(url),
    onPromoteSbFreeReferenceImage: (current, item) => calls.promote.push([current.id, item.name]),
    onRemoveSbFreeReferenceImage: (current, index) => calls.remove.push([current.id, index]),
    openGlobalMediaPicker: (current, mode) => calls.picker.push([current.id, mode]),
  })
  try {
    await nextTick()
    assert.match(textContent(harness.root), /主参考/)
    click(findByType(harness.root, 'button').find((node) => node.props['aria-label'] === '预览自由参考图 海报'))
    click(buttonByText(harness.root, '设为主参考'))
    click(buttonByText(harness.root, '移除'))
    click(buttonByText(harness.root, '设为视频主参考'))
    click(buttonByText(harness.root, '添加自由参考图'))
    assert.deepEqual(calls.preview, ['/static/b.png'])
    assert.deepEqual(calls.promote, [[STORYBOARD_ID, '海报']])
    assert.deepEqual(calls.remove, [[STORYBOARD_ID, 0]])
    assert.deepEqual(calls.picker, [[STORYBOARD_ID, 'reference-primary'], [STORYBOARD_ID, 'reference']])
  } finally {
    harness.app.unmount()
  }
})

test('视频参数弹窗按分镜 id 读写字段，关闭时回调原处理函数', async () => {
  const calls = []
  const sbTitle = { [STORYBOARD_ID]: '第三镜', [DRAMA_ID]: '项目名', [EPISODE_ID]: '剧集名' }
  const harness = mountComponent(FilmCreateStoryboardVideoParamsDialog, {
    ...requiredFns({
      onSaveVideoParams: () => calls.push('save'),
      onVideoParamsDialogClosed: () => calls.push('closed'),
      canSplitSbByAudio: (target) => target.id === STORYBOARD_ID,
      onSplitSbByAudio: (target) => calls.push(['split', target.id]),
    }),
    showVideoParamsDialog: true,
    videoParamsTarget: { id: STORYBOARD_ID, storyboard_number: 3, video_prompt: '旧视频提示词' },
    sbTitle,
    sbCreationMode: { [STORYBOARD_ID]: 'classic' },
    sbAction: { [STORYBOARD_ID]: '推门' },
    sbDialogue: {},
    sbNarration: {},
    sbResult: {},
    sbLocation: {},
    sbTime: {},
    sbDuration: {},
    sbShotType: {},
    sbMovement: {},
    sbAtmosphere: {},
    sbAngleH: {},
    sbAngleS: {},
    sbAngleV: {},
    sbLighting: {},
    sbDof: {},
    sbLayoutDescription: {},
    sbVideoReferenceImageId: {},
  })
  try {
    await nextTick()
    const titleInput = byAriaLabel(harness.root, '分镜3标题')[0]
    assert.ok(titleInput)
    assert.equal(titleInput.props.value, '第三镜')
    assert.match(textContent(harness.root), /按对白拆镜/)
    click(buttonByText(harness.root, '按对白拆镜'))
    click(buttonByText(harness.root, '保存并更新'))
    click(buttonByText(harness.root, '取消'))
    await nextTick()
    assert.equal(harness.props.value.showVideoParamsDialog, false)
    assert.deepEqual(calls, [['split', STORYBOARD_ID], 'save', 'closed'])
    assert.notEqual(sbTitle[DRAMA_ID], sbTitle[STORYBOARD_ID])
  } finally {
    harness.app.unmount()
  }
})

test('父组件把提示词弹窗状态透传给子组件', async () => {
  const harness = mountComponent(FilmCreateStoryboardDialogs, {
    ...requiredFns(),
    showSbPromptDialog: true,
    sbPromptTarget: { id: STORYBOARD_ID, storyboard_number: 4 },
    sbPromptImageText: '图',
    sbPromptPolishedText: '润色',
    sbPromptVideoText: '视频',
    showFramePromptEditor: false,
    showVideoParamsDialog: false,
    editingFramePromptText: '',
    editingFramePromptSb: null,
    editingFramePromptSlot: 'first',
    videoParamsTarget: null,
  })
  try {
    await nextTick()
    assert.match(textContent(harness.root), /编辑提示词/)
    assert.equal(byAriaLabel(harness.root, '原始图片提示词').length, 1)
    assert.ok(buttonByText(harness.root, '重新生成'))
  } finally {
    harness.app.unmount()
  }
})
