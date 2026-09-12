import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { defineComponent, h, nextTick } from 'vue'

import {
  buttonByAriaLabel,
  buttonByText,
  click,
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

const iconStubUrl = compileIconStub(['Close', 'Upload', 'FolderOpened', 'MagicStick', 'Refresh'])
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
const Form = await loadCompiledSfc(
  new URL('./CanvasStoryboardPanelForm.vue', panelDir),
  'storyboard-panel-form',
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
const ElFormStub = defineComponent({
  name: 'ElFormStub',
  setup(_props, { slots }) {
    return () => h('form', {}, slots.default?.())
  },
})

const ElDropdownItemStub = defineComponent({
  name: 'ElDropdownItemStub',
  inheritAttrs: false,
  props: {
    command: { default: undefined },
    disabled: { type: Boolean, default: false },
    title: { type: String, default: '' },
  },
  setup(props, { attrs, slots }) {
    return () => h('button', {
      type: 'button',
      disabled: Boolean(props.disabled),
      title: props.title || undefined,
      'aria-label': attrs['aria-label'],
      'data-command': props.command,
      onClick: (event) => {
        if (props.disabled) return
        const handler = attrs.onClick
        if (Array.isArray(handler)) {
          for (const fn of handler) fn?.(event)
          return
        }
        handler?.(event)
      },
    }, slots.default?.())
  },
})

const extraStubs = {
  'el-form': ElFormStub,
  ElForm: ElFormStub,
  'el-form-item': ElFormItemStub,
  ElFormItem: ElFormItemStub,
  'el-dropdown-item': ElDropdownItemStub,
  ElDropdownItem: ElDropdownItemStub,
}

function structureTrigger(root) {
  return buttonByAriaLabel(root, '分镜结构：上移、下移、前插、后插、追加')
}

async function openStructureMenu(root) {
  const trigger = buttonByText(root, '分镜结构')
  assert.ok(trigger)
  assert.equal(trigger.props['aria-label'], '分镜结构：上移、下移、前插、后插、追加')
  click(trigger)
  await nextTick()
  return trigger
}

function controlLabel(name) {
  return `分镜1${name}`
}

function inputByAria(root, label) {
  return findByType(root, 'input').find((node) => node.props?.['aria-label'] === label)
}

function formFixture(overrides = {}) {
  return {
    title: '开场',
    shot_type: '特写',
    duration: 5,
    action: '推门',
    dialogue: '你好',
    image_prompt: '雨夜',
    video_prompt: '推进',
    universal_segment_text: '',
    video_reference_image_id: '',
    ...overrides,
  }
}

function mountChild(component, props) {
  return mountHarness(renderer, () => h(component, props), { components: extraStubs })
}

test('父面板接线到表单/工具条/关联/参考图/首尾帧/操作栏子组件', () => {
  for (const name of CANVAS_STORYBOARD_PANEL_FILES.slice(1)) {
    const tag = name.replace(/\.vue$/, '')
    assert.match(parentSource, new RegExp(`import ${tag} from '\\./${tag}\\.vue'`))
    assert.match(parentSource, new RegExp(`<${tag}[\\s>]`))
  }
  assert.doesNotMatch(parentSource, /class="reference-row"/)
  assert.doesNotMatch(parentSource, /class="panel-actions"/)
  assert.doesNotMatch(parentSource, /class="frame-preview-row"/)
  assert.doesNotMatch(parentSource, /class="meta-row"/)
  assert.doesNotMatch(parentSource, /class="text-row-2"/)
  assert.doesNotMatch(parentSource, /class="panel-form compact-form"/)
})

test('参考图条和关联行在窄屏换行，不把上传按钮裁掉', () => {
  const referenceRow = panelUiSource.match(/\.reference-row \{[\s\S]*?\}/)?.[0] || ''
  assert.match(panelUiSource, /\.reference-row \{[\s\S]*?max-width: 100%;[\s\S]*?flex-wrap: wrap;/)
  assert.match(panelUiSource, /\.reference-list \{[\s\S]*?flex-wrap: wrap;[\s\S]*?min-width: 0;/)
  assert.match(panelUiSource, /\.relation-row \{[\s\S]*?flex-wrap: wrap;/)
  assert.match(panelUiSource, /\.inline-add-row \{[\s\S]*?flex-wrap: wrap;/)
  assert.match(panelUiSource, /\.reference-empty \{[\s\S]*?overflow-wrap: anywhere;/)
  assert.match(panelUiSource, /\.sb-panel \{[\s\S]*?max-width: 100%;/)
  assert.match(panelUiSource, /\.panel-actions \{[\s\S]*?max-width: 100%;/)
  assert.match(referenceRow, /flex-wrap: wrap;/)
  assert.doesNotMatch(referenceRow, /overflow:\s*hidden/)
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
    assert.equal(emptyNode.props['aria-live'], 'polite')
    assert.match(textContent(emptyNode), /尚未加入参考图/)
    assert.match(textContent(emptyNode), /也可从素材中心添加或上传自由参考图/)
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
    assert.ok(buttonByAriaLabel(full.root, '分镜1从素材中心添加自由参考图'))
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
  const projectId = 11
  const episodeId = 22
  const storyboardId = 33
  assert.notEqual(projectId, episodeId)
  assert.notEqual(episodeId, storyboardId)
  assert.notEqual(projectId, storyboardId)
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
    canMoveUp: true,
    canMoveDown: true,
    moveStoryboardUp: () => events.push({ action: 'up', storyboardId, episodeId, projectId }),
    moveStoryboardDown: () => events.push({ action: 'down', storyboardId, episodeId, projectId }),
    insertStoryboardBefore: () => events.push({ action: 'before', storyboardId, episodeId, projectId }),
    insertStoryboardAfter: () => events.push({ action: 'after', storyboardId, episodeId, projectId }),
    appendStoryboard: () => events.push({ action: 'append', episodeId, projectId, storyboardId }),
  })
  try {
    const text = textContent(classic.root)
    assert.match(text, /保存/)
    assert.match(text, /润色/)
    assert.match(text, /生图/)
    assert.match(text, /生视频/)
    assert.match(text, /配音/)
    assert.match(text, /旁白/)
    assert.match(text, /删除/)
    assert.match(text, /分镜结构/)
    assert.doesNotMatch(text, /AI 分镜/)
    assert.ok(buttonByText(classic.root, '保存'))
    assert.ok(buttonByText(classic.root, '润色'))
    assert.ok(buttonByText(classic.root, '生图'))
    assert.ok(buttonByText(classic.root, '生视频'))
    assert.ok(buttonByText(classic.root, '配音'))
    assert.ok(buttonByText(classic.root, '旁白'))
    assert.ok(buttonByText(classic.root, '删除'))
    assert.ok(buttonByText(classic.root, '分镜结构'))
    assert.ok(structureTrigger(classic.root))
    assert.equal(buttonByText(classic.root, '上移'), undefined)
    assert.equal(buttonByText(classic.root, '下移'), undefined)
    assert.equal(buttonByText(classic.root, '前插'), undefined)
    assert.equal(buttonByText(classic.root, '后插'), undefined)
    assert.equal(buttonByText(classic.root, '追加'), undefined)
    assert.equal(buttonByText(classic.root, '生成首帧'), undefined)

    await openStructureMenu(classic.root)
    const opened = textContent(classic.root)
    assert.match(opened, /上移/)
    assert.match(opened, /下移/)
    assert.match(opened, /前插/)
    assert.match(opened, /后插/)
    assert.match(opened, /追加/)
    assert.ok(buttonByText(classic.root, '保存'))
    assert.ok(buttonByText(classic.root, '润色'))
    assert.ok(buttonByText(classic.root, '生图'))
    assert.ok(buttonByText(classic.root, '生视频'))
    assert.ok(buttonByText(classic.root, '配音'))
    assert.ok(buttonByText(classic.root, '旁白'))
    assert.ok(buttonByText(classic.root, '删除'))

    for (const label of ['上移', '下移', '前插', '后插', '追加']) {
      const item = buttonByText(classic.root, label)
      assert.ok(item, `打开菜单后应能找到${label}`)
      click(item)
      await nextTick()
    }
    assert.deepEqual(events, [
      { action: 'up', storyboardId, episodeId, projectId },
      { action: 'down', storyboardId, episodeId, projectId },
      { action: 'before', storyboardId, episodeId, projectId },
      { action: 'after', storyboardId, episodeId, projectId },
      { action: 'append', episodeId, projectId, storyboardId },
    ])
    assert.notEqual(events[0].storyboardId, events[0].episodeId)
    assert.notEqual(events[0].storyboardId, events[0].projectId)
    assert.notEqual(events[4].episodeId, events[4].storyboardId)
    assert.notEqual(events[4].episodeId, events[4].projectId)
    events.length = 0

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
    assert.match(textContent(harness.root), /添加角色/)
    assert.match(textContent(harness.root), /添加场景/)
    assert.match(textContent(harness.root), /添加道具/)
    assert.doesNotMatch(textContent(harness.root), /\+角色|\+场景|\+道具/)
    const addCharacter = buttonByAriaLabel(harness.root, '分镜1添加角色')
    assert.ok(String(addCharacter.props['aria-label']).includes('添加角色'))
  } finally {
    harness.app.unmount()
  }
})

test('经典表单显示标题景别时长和提示词，标题失焦会保存元数据', async () => {
  const events = []
  const harness = mountChild(Form, {
    form: formFixture(),
    isUniversal: false,
    gridImages: [],
    storyboardControlLabel: controlLabel,
    saveMeta: () => events.push('saveMeta'),
  })
  try {
    const text = textContent(harness.root)
    assert.match(text, /标题/)
    assert.match(text, /景别/)
    assert.match(text, /时长/)
    assert.match(text, /动作/)
    assert.match(text, /对白/)
    assert.match(text, /旁白/)
    assert.match(text, /生图词/)
    assert.match(text, /视频词/)
    assert.doesNotMatch(text, /全能词/)
    assert.doesNotMatch(text, /AI 分镜/)
    assert.equal(inputByAria(harness.root, '分镜1标题')?.props.placeholder, '分镜标题')
    assert.equal(inputByAria(harness.root, '分镜1景别')?.props.placeholder, '特写')
    assert.equal(inputByAria(harness.root, '分镜1动作')?.props.placeholder, '画面动作')
    assert.equal(inputByAria(harness.root, '分镜1对白')?.props.placeholder, '角色对白')
    assert.equal(inputByAria(harness.root, '分镜1解说旁白')?.props.placeholder, '解说旁白')
    assert.equal(inputByAria(harness.root, '分镜1生图词')?.props.placeholder, '图片提示词')
    assert.equal(inputByAria(harness.root, '分镜1视频词')?.props.placeholder, '视频提示词')
    const duration = inputByAria(harness.root, '分镜1时长')
    assert.ok(duration)
    assert.equal(duration.props.min, 1)
    assert.equal(duration.props.max, 120)
    assert.equal(findByType(harness.root, 'select').length, 0)
    inputByAria(harness.root, '分镜1标题').props.onBlur({ stopPropagation() {} })
    await nextTick()
    assert.deepEqual(events, ['saveMeta'])
  } finally {
    harness.app.unmount()
  }
})

test('全能表单改显示全能词，有宫格时露出视频参考图选择', () => {
  const harness = mountChild(Form, {
    form: formFixture({ universal_segment_text: '片段', video_prompt: '推进' }),
    isUniversal: true,
    gridImages: [
      { id: 8, frame_type: 'nine_grid' },
      { id: 9, frame_type: 'quad_grid' },
    ],
    storyboardControlLabel: controlLabel,
    saveMeta: () => {},
  })
  try {
    const text = textContent(harness.root)
    assert.match(text, /全能词/)
    assert.match(text, /视频词/)
    assert.match(text, /旁白/)
    assert.match(text, /宫格/)
    assert.match(text, /九宫格 #8/)
    assert.match(text, /四宫格 #9/)
    assert.doesNotMatch(text, /动作/)
    assert.doesNotMatch(text, /对白/)
    assert.doesNotMatch(text, /生图词/)
    assert.doesNotMatch(text, /AI 分镜/)
    assert.equal(inputByAria(harness.root, '分镜1全能词')?.props.placeholder, '全能模式片段描述')
    assert.equal(inputByAria(harness.root, '分镜1视频词')?.props.placeholder, '生视频提示词')
    const select = findByType(harness.root, 'select')[0]
    assert.ok(select)
    assert.equal(select.props['aria-label'], '分镜1视频参考图')
    assert.equal(select.props.placeholder, '视频使用主图/首帧')
  } finally {
    harness.app.unmount()
  }
})
