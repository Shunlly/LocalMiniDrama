import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { defineComponent, h, nextTick } from 'vue'

import {
  buttonByAriaLabel,
  buttonByText,
  compileIconStub,
  compileSfc,
  createHostRenderer,
  findByClass,
  findByType,
  loadCompiledSfc,
  mountHarness,
  textContent,
  vueUrl,
} from './helpers/vueComponentHarness.js'
import {
  CANVAS_STORYBOARD_PANEL_FILES,
  readCanvasStoryboardPanelSource,
} from './helpers/canvasStoryboardPanelSource.js'

const panelDir = new URL('../src/components/dramaCanvas/', import.meta.url)
const parentSource = readFileSync(new URL('./CanvasStoryboardPanel.vue', panelDir), 'utf8')
const toolbarSource = readFileSync(new URL('./CanvasDesktopToolbar.vue', panelDir), 'utf8')
const panelUiSource = readCanvasStoryboardPanelSource()

const iconStubUrl = compileIconStub(['Close', 'Upload', 'MagicStick', 'Refresh'])
const compiledActionGateUrl = compileSfc(
  new URL('./CanvasActionGate.vue', panelDir),
  'storyboard-panel-action-gate',
)

const ElFormItemStub = defineComponent({
  name: 'ElFormItemStub',
  props: ['label'],
  setup(props, { slots }) {
    return () => h('label-item', { 'data-label': props.label }, [
      h('span', { 'data-form-label': props.label }, props.label || ''),
      slots.default?.(),
    ])
  },
})

const Header = await loadCompiledSfc(
  new URL('./CanvasStoryboardPanelHeader.vue', panelDir),
  'storyboard-panel-header',
)
const Relations = await loadCompiledSfc(
  new URL('./CanvasStoryboardPanelRelations.vue', panelDir),
  'storyboard-panel-relations',
  new Map([
    ['@/utils/canvasEntityIds', new URL('../src/utils/canvasEntityIds.js', import.meta.url).href],
  ]),
)
const References = await loadCompiledSfc(
  new URL('./CanvasStoryboardPanelReferences.vue', panelDir),
  'storyboard-panel-references',
  new Map([
    ['@element-plus/icons-vue', iconStubUrl],
    ['@/composables/useCanvasReferenceDisplay', new URL('../src/composables/useCanvasReferenceDisplay.js', import.meta.url).href],
  ]),
)
const Frames = await loadCompiledSfc(
  new URL('./CanvasStoryboardPanelFrames.vue', panelDir),
  'storyboard-panel-frames',
)
const Actions = await loadCompiledSfc(
  new URL('./CanvasStoryboardPanelActions.vue', panelDir),
  'storyboard-panel-actions',
  new Map([
    ['@element-plus/icons-vue', iconStubUrl],
    ['./CanvasActionGate.vue', compiledActionGateUrl],
  ]),
)

const renderer = createHostRenderer()
const extraStubs = {
  'el-form-item': ElFormItemStub,
  ElFormItem: ElFormItemStub,
}

function controlLabel(name) {
  return `分镜1${name}`
}

function mountChild(component, props) {
  return mountHarness(renderer, () => h(component, props), { components: extraStubs })
}

test('父面板接线到工具条/关联/参考图/首尾帧/操作栏子组件', () => {
  for (const name of CANVAS_STORYBOARD_PANEL_FILES.slice(1)) {
    const tag = name.replace(/\.vue$/, '')
    assert.match(parentSource, new RegExp(`import ${tag} from '\\./${tag}\\.vue'`))
    assert.match(parentSource, new RegExp(`<${tag}[\\s>]`))
  }
  assert.doesNotMatch(parentSource, /class="reference-row"/)
  assert.doesNotMatch(parentSource, /class="panel-actions"/)
  assert.doesNotMatch(parentSource, /class="frame-preview-row"/)
})

test('本面板不含 AI 分镜按钮；工具条仍保留完整无障碍名', () => {
  assert.doesNotMatch(panelUiSource, /AI 生成分镜/)
  assert.doesNotMatch(panelUiSource, />\s*AI 分镜\s*</)
  assert.match(toolbarSource, /aria-label="AI 生成分镜"/)
  assert.match(toolbarSource, />\s*AI 分镜\s*</)
})

test('分镜头栏显示编号、收起和列表详情，并可刷新未知配音', async () => {
  const events = []
  const harness = mountChild(Header, {
    storyboard: { id: 11, storyboard_number: 2 },
    busyLabel: '生图中…',
    audioOutcomeUnknown: true,
    openListMode: () => events.push('list'),
    closePanel: () => events.push('close'),
    refreshAfterUnknownAudio: () => events.push('refresh'),
  })
  try {
    const text = textContent(harness.root)
    assert.match(text, /分镜 #2/)
    assert.match(text, /生图中…/)
    assert.match(text, /上一次配音结果待确认/)
    const closeButton = buttonByAriaLabel(harness.root, '收起面板')
    const listButton = buttonByAriaLabel(harness.root, '打开列表详情')
    const refreshButton = buttonByText(harness.root, '刷新分镜状态')
    assert.ok(closeButton)
    assert.ok(listButton)
    assert.ok(refreshButton)
    assert.equal(buttonByAriaLabel(harness.root, 'AI 生成分镜'), undefined)
    closeButton.props.onClick({ stopPropagation() {} })
    listButton.props.onClick({ stopPropagation() {} })
    refreshButton.props.onClick({ stopPropagation() {} })
    await nextTick()
    assert.deepEqual(events, ['close', 'list', 'refresh'])
  } finally {
    harness.app.unmount()
  }
})

test('参考图空态给出中文下一步，满 10 张时禁用上传并说明原因', async () => {
  const empty = mountChild(References, {
    referenceSlots: [],
    referenceDisplaySlots: [],
    uploadingReference: false,
    storyboardControlLabel: controlLabel,
    onReferenceFiles: () => {},
    removeFreeReference: () => {},
  })
  try {
    const emptyNode = findByClass(empty.root, 'reference-empty')[0]
    assert.ok(emptyNode)
    assert.equal(emptyNode.props.role, 'status')
    assert.match(textContent(emptyNode), /尚未加入参考图/)
    assert.match(textContent(emptyNode), /也可上传自由参考图/)
  } finally {
    empty.app.unmount()
  }

  const fullSlots = Array.from({ length: 10 }, (_, index) => ({
    kind: 'free',
    index,
    freeIndex: index,
    url: `/static/${index}.png`,
    name: `ref-${index}`,
  }))
  const full = mountChild(References, {
    referenceSlots: fullSlots,
    referenceDisplaySlots: fullSlots,
    uploadingReference: false,
    storyboardControlLabel: controlLabel,
    onReferenceFiles: () => {},
    removeFreeReference: () => {},
  })
  try {
    const upload = buttonByAriaLabel(full.root, '分镜1上传自由参考图')
    assert.ok(upload)
    assert.equal(upload.props.disabled, true)
    assert.equal(upload.props.title, '每个分镜最多保存 10 张自由参考图')
  } finally {
    full.app.unmount()
  }
})

test('首尾帧空态显示暂无首帧和暂无尾帧', () => {
  const harness = mountChild(Frames, {
    firstFrameUrl: '',
    lastFrameUrl: '',
    storyboardControlLabel: controlLabel,
  })
  try {
    const text = textContent(harness.root)
    assert.match(text, /暂无首帧/)
    assert.match(text, /暂无尾帧/)
    const section = findByType(harness.root, 'section')[0]
    assert.equal(section.props['aria-label'], '首尾帧')
  } finally {
    harness.app.unmount()
  }
})

test('操作栏经典模式可生图，首尾帧模式露出生成首帧/尾帧，禁用视频带中文原因', async () => {
  const events = []
  const classic = mountChild(Actions, {
    saving: false,
    busyStep: '',
    isUniversal: false,
    useFirstLast: false,
    universalSegmentText: '',
    videoAction: { reason: '', serviceType: 'video' },
    ttsAction: { reason: '', serviceType: 'tts' },
    videoReasonId: 'video-reason-1',
    ttsReasonId: 'tts-reason-1',
    audioActionDisabledReason: '',
    saveFields: () => events.push('save'),
    polishPrompt: () => events.push('polish'),
    runUniversalPrompt: (mode) => events.push(['universal', mode]),
    runStep: (step) => events.push(['step', step]),
    deleteStoryboard: () => events.push('delete'),
  })
  try {
    const text = textContent(classic.root)
    assert.match(text, /保存/)
    assert.match(text, /润色/)
    assert.match(text, /生图/)
    assert.match(text, /生视频/)
    assert.match(text, /配音/)
    assert.match(text, /删除/)
    assert.doesNotMatch(text, /AI 分镜/)
    assert.equal(buttonByText(classic.root, '生成首帧'), undefined)
    buttonByText(classic.root, '生图').props.onClick({ stopPropagation() {} })
    await nextTick()
    assert.deepEqual(events, [['step', 'image']])
  } finally {
    classic.app.unmount()
  }

  const frames = mountChild(Actions, {
    saving: false,
    busyStep: '',
    isUniversal: false,
    useFirstLast: true,
    universalSegmentText: '',
    videoAction: { reason: '当前集还没有剧本，请先编写或导入剧本', serviceType: 'video' },
    ttsAction: { reason: '当前集还没有剧本，请先编写或导入剧本', serviceType: 'tts' },
    videoReasonId: 'video-reason-2',
    ttsReasonId: 'tts-reason-2',
    audioActionDisabledReason: '当前集还没有剧本，请先编写或导入剧本',
    saveFields: () => {},
    polishPrompt: () => {},
    runUniversalPrompt: () => {},
    runStep: () => {},
    deleteStoryboard: () => {},
  })
  try {
    assert.ok(buttonByText(frames.root, '生成首帧'))
    assert.ok(buttonByText(frames.root, '生成尾帧'))
    assert.equal(buttonByText(frames.root, '生图'), undefined)
    const videoButton = buttonByText(frames.root, '生视频')
    assert.equal(videoButton.props.disabled, true)
    assert.equal(videoButton.props.title, '当前集还没有剧本，请先编写或导入剧本')
    const audioButton = buttonByText(frames.root, '配音')
    assert.equal(audioButton.props.disabled, true)
    assert.equal(audioButton.props.title, '当前集还没有剧本，请先编写或导入剧本')
  } finally {
    frames.app.unmount()
  }
})

test('关联选择器使用分镜编号作为无障碍名前缀', () => {
  const harness = mountChild(Relations, {
    characterIds: [],
    sceneId: null,
    propIds: [],
    'onUpdate:characterIds': () => {},
    'onUpdate:sceneId': () => {},
    'onUpdate:propIds': () => {},
    characters: [{ id: 1, name: '小明' }],
    scenes: [{ id: 2, location: '教室' }],
    propsList: [{ id: 3, name: '雨伞' }],
    storyboardControlLabel: controlLabel,
    onSelectVisibleChange: () => {},
    onRelationChange: () => {},
    createAsset: () => {},
  })
  try {
    const selects = findByType(harness.root, 'select')
    assert.equal(selects[0].props['aria-label'], '分镜1角色')
    assert.equal(selects[1].props['aria-label'], '分镜1场景')
    assert.equal(selects[2].props['aria-label'], '分镜1道具')
    assert.ok(buttonByAriaLabel(harness.root, '分镜1添加角色'))
    assert.ok(buttonByAriaLabel(harness.root, '分镜1添加场景'))
    assert.ok(buttonByAriaLabel(harness.root, '分镜1添加道具'))
  } finally {
    harness.app.unmount()
  }
})
