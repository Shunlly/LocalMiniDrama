import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { defineComponent, h, nextTick, ref } from 'vue'

import {
  buttonByAriaLabel,
  buttonByText,
  click,
  compileIconStub,
  createHostRenderer,
  findByClass,
  findByTestId,
  findByType,
  loadCompiledSfc,
  mountHarness,
  textContent,
  vueUrl,
} from './helpers/vueComponentHarness.js'

const headerUrl = new URL('../src/components/freeCreate/FreeCreateHeader.vue', import.meta.url)
const inputUrl = new URL('../src/components/freeCreate/FreeCreateInputPanel.vue', import.meta.url)
const resultUrl = new URL('../src/components/freeCreate/FreeCreateResultPanel.vue', import.meta.url)
const resultSource = readFileSync(resultUrl, 'utf8')

const iconStubUrl = compileIconStub([
  'ArrowLeft',
  'CircleCheck',
  'CircleClose',
  'Loading',
  'Picture',
  'VideoCamera',
  'Warning',
])

const ElTabsStub = defineComponent({
  name: 'ElTabsStub',
  props: ['modelValue'],
  setup(props, { slots }) {
    return () => h('div', { class: 'mode-tabs', 'data-mode': props.modelValue }, slots.default?.())
  },
})

const ElTabPaneStub = defineComponent({
  name: 'ElTabPaneStub',
  props: ['name'],
  setup(props, { slots }) {
    return () => h('div', { 'data-tab': props.name }, [slots.label?.(), slots.default?.()])
  },
})

const extraStubs = {
  'el-tabs': ElTabsStub,
  ElTabs: ElTabsStub,
  'el-tab-pane': ElTabPaneStub,
  ElTabPane: ElTabPaneStub,
}

const FreeCreateHeader = await loadCompiledSfc(
  headerUrl,
  'free-create-header-component',
  new Map([
    ['vue', vueUrl],
    ['@element-plus/icons-vue', iconStubUrl],
  ]),
)

const FreeCreateInputPanel = await loadCompiledSfc(
  inputUrl,
  'free-create-input-panel-component',
  new Map([
    ['vue', vueUrl],
    ['@element-plus/icons-vue', iconStubUrl],
  ]),
)

const FreeCreateResultPanel = await loadCompiledSfc(
  resultUrl,
  'free-create-result-panel-component',
  new Map([
    ['vue', vueUrl],
    ['@element-plus/icons-vue', iconStubUrl],
  ]),
)

const renderer = createHostRenderer()

function readyCapability(serviceLabel = '图片') {
  return {
    ready: true,
    status: 'ready',
    issue: '',
    message: `${serviceLabel}服务已就绪`,
  }
}

function mountHeader() {
  const events = []
  const mounted = mountHarness(renderer, () => h(FreeCreateHeader, {
    onGoBack: () => events.push('go-back'),
  }))
  return { ...mounted, events }
}

function mountInput(initial = {}) {
  const props = ref({
    mode: 'image',
    prompt: '',
    style: '',
    aspectRatio: '16:9',
    duration: 5,
    generationCapability: readyCapability(),
    activeServiceLabel: '图片',
    aspectRatioOptions: [
      { value: '16:9', label: '16:9' },
      { value: '9:16', label: '9:16' },
    ],
    refImageUploadStatus: 'idle',
    refImageDataUrl: null,
    refImageFileName: '参考图',
    refImageTriggerLabel: '上传视频参考图',
    refImageUploadMessage: '',
    generating: false,
    generateDisabled: false,
    generateDisabledReason: '',
    resultBusyDisabledReason: '',
    ...initial,
  })
  const events = []
  const mounted = mountHarness(renderer, () => h(FreeCreateInputPanel, {
    ...props.value,
    'onUpdate:mode': (value) => { props.value = { ...props.value, mode: value } },
    'onUpdate:prompt': (value) => { props.value = { ...props.value, prompt: value } },
    'onUpdate:style': (value) => { props.value = { ...props.value, style: value } },
    'onUpdate:aspectRatio': (value) => { props.value = { ...props.value, aspectRatio: value } },
    'onUpdate:duration': (value) => { props.value = { ...props.value, duration: value } },
    onLoadServiceConfigs: () => events.push('load-service-configs'),
    onOpenAiConfig: () => events.push('open-ai-config'),
    onGenerate: () => events.push('generate'),
    onTriggerRefImageUpload: () => events.push('trigger-ref-image-upload'),
    onRefImageDrop: () => events.push('ref-image-drop'),
    onRefImageChange: () => events.push('ref-image-change'),
    onRetryRefImageUpload: () => events.push('retry-ref-image-upload'),
    onClearRefImage: () => events.push('clear-ref-image'),
  }), { components: extraStubs })
  return { ...mounted, events, props }
}

function mountResult(initial = {}) {
  const props = ref({
    results: [],
    generating: false,
    cancelling: false,
    mode: 'image',
    emptyResultCopy: '填写提示词后，生成结果会显示在这里',
    generationCapability: readyCapability(),
    resultBusyDisabledReason: '',
    resultImageAlt: (item, index) => `第 ${index + 1} 张生成图片`,
    canRetryItem: (item) => item?.status === 'failed' || item?.status === 'cancelled',
    ...initial,
  })
  const events = []
  const mounted = mountHarness(renderer, () => h(FreeCreateResultPanel, {
    ...props.value,
    onClearResults: () => events.push('clear-results'),
    onLoadServiceConfigs: () => events.push('load-service-configs'),
    onCancelGeneration: () => events.push('cancel-generation'),
    onRetryGeneration: (item) => events.push(['retry-generation', item]),
    onDownloadItem: (item) => events.push(['download-item', item]),
    onPreviewImage: (item, idx) => events.push(['preview-image', item, idx]),
    onSaveItem: (item) => events.push(['save-item', item]),
    onOpenAiConfig: () => events.push('open-ai-config'),
    onFocusPrompt: () => events.push('focus-prompt'),
  }))
  return { ...mounted, events, props }
}

test('页头返回按钮读屏名称是返回项目首页，并通知页面返回', () => {
  const harness = mountHeader()
  try {
    const back = buttonByAriaLabel(harness.root, '返回项目首页')
    assert.ok(back)
    assert.equal(buttonByText(harness.root, '返回项目首页'), back)
    assert.equal(back.props['aria-label'], '返回项目首页')
    assert.match(textContent(back), /返回项目首页/)
    assert.equal(buttonByText(harness.root, '项目首页'), undefined)
    assert.equal(buttonByAriaLabel(harness.root, '返回项目列表'), undefined)
    assert.match(textContent(harness.root), /自由创作/)
    assert.match(textContent(harness.root), /不绑定剧集，直接输入文字生成图片或视频/)
    const [title] = findByType(harness.root, 'h1')
    assert.ok(title)
    assert.match(textContent(title), /自由创作/)
    click(back)
    assert.deepEqual(harness.events, ['go-back'])
  } finally {
    harness.app.unmount()
  }
})

test('提示词为空或参考图上传中时，生成按钮带中文禁用 title 和可见原因', async () => {
  const emptyPrompt = mountInput({
    generateDisabled: true,
    generateDisabledReason: '请先填写提示词',
  })
  try {
    const generate = buttonByText(emptyPrompt.root, '生成图片')
    assert.ok(generate)
    assert.equal(generate.props.disabled, true)
    assert.equal(generate.props['aria-label'], '生成图片')
    assert.equal(generate.props.title, '请先填写提示词')
    const reason = findByTestId(emptyPrompt.root, 'generate-disabled-reason')[0]
    assert.ok(reason)
    assert.equal(textContent(reason).trim(), '请先填写提示词')
    const wrapper = findByClass(emptyPrompt.root, 'generate-action')[0]
    assert.equal(wrapper.props['aria-label'], '生成图片不可用：请先填写提示词')
  } finally {
    emptyPrompt.app.unmount()
  }

  const uploading = mountInput({
    mode: 'video',
    activeServiceLabel: '视频',
    generationCapability: readyCapability('视频'),
    refImageUploadStatus: 'uploading',
    refImageFileName: 'frame.png',
    refImageTriggerLabel: '视频参考图正在上传',
    generateDisabled: true,
    generateDisabledReason: '参考图正在上传，请等待上传完成',
  })
  try {
    await nextTick()
    const generate = buttonByText(uploading.root, '生成视频')
    assert.ok(generate)
    assert.equal(generate.props.disabled, true)
    assert.equal(generate.props.title, '参考图正在上传，请等待上传完成')
    assert.equal(
      textContent(findByTestId(uploading.root, 'generate-disabled-reason')[0]).trim(),
      '参考图正在上传，请等待上传完成',
    )
    const trigger = findByClass(uploading.root, 'ref-image-trigger')[0]
    assert.ok(trigger)
    assert.equal(trigger.props.disabled, true)
    assert.equal(trigger.props.title, '正在上传参考图，请稍候')
    assert.equal(trigger.props['aria-label'], '视频参考图正在上传')
  } finally {
    uploading.app.unmount()
  }
})

test('结果区在生成或取消中禁用操作，并给出中文原因', async () => {
  const item = {
    type: 'image',
    prompt: '一座灯塔',
    status: 'failed',
    url: null,
    error: '生成失败，请稍后重试',
  }
  const harness = mountResult({
    results: [item],
    generating: true,
    cancelling: true,
    resultBusyDisabledReason: '正在取消生成，请稍候',
  })
  try {
    await nextTick()
    const clear = buttonByText(harness.root, '取消并清空')
    assert.ok(clear)
    assert.equal(clear.props.disabled, true)
    assert.equal(clear.props.title, '正在取消生成，请稍候')
    const cancel = findByType(harness.root, 'button').find((node) => {
      const label = textContent(node).replace(/\s+/g, ' ').trim()
      return label.includes('取消生成') && !label.includes('取消并清空')
    })
    assert.ok(cancel)
    assert.equal(cancel.props.disabled, true)
    assert.equal(cancel.props.title, '正在取消生成，请稍候')
    const retry = buttonByText(harness.root, '重试')
    assert.ok(retry)
    assert.equal(retry.props.disabled, true)
    assert.equal(retry.props.title, '正在取消生成，请稍候')
    const [tip] = findByClass(harness.root, 'generating-tip')
    assert.ok(tip)
    assert.equal(tip.props.role, 'status')
    assert.equal(tip.props['aria-live'], 'polite')
    assert.equal(tip.props['aria-atomic'], 'true')
  } finally {
    harness.app.unmount()
  }
})

test('结果空态展示中文说明，失败时可重新检查服务', () => {
  assert.doesNotMatch(resultSource, /status === 'error'"[\s\S]{0,180}type="primary"[\s\S]{0,120}重新检查服务/)
  assert.match(resultSource, /!generationCapability.ready[\s\S]{0,180}type="primary"[\s\S]{0,80}前往 AI 配置/)
  const harness = mountResult({
    emptyResultCopy: '暂时无法读取图片服务配置，因此还不能生成。',
    generationCapability: {
      ready: false,
      status: 'error',
      issue: '',
      message: '无法读取图片服务配置',
    },
  })
  try {
    assert.match(textContent(harness.root), /暂时无法读取图片服务配置，因此还不能生成。/)
    const [empty] = findByClass(harness.root, 'empty-result')
    assert.ok(empty)
    assert.equal(empty.props.role, 'status')
    assert.equal(empty.props['aria-live'], 'polite')
    assert.equal(empty.props['aria-atomic'], 'true')
    const [icon] = findByClass(harness.root, 'empty-icon')
    assert.ok(icon)
    assert.equal(icon.props['aria-hidden'], 'true')
    const [actions] = findByClass(harness.root, 'empty-result-actions')
    assert.equal(actions.props.role, 'group')
    assert.equal(actions.props['aria-label'], '空结果下一步')
    const retry = buttonByText(harness.root, '重新检查服务')
    assert.ok(retry)
    assert.notEqual(retry.props.type, 'primary')
    click(retry)
    assert.deepEqual(harness.events, ['load-service-configs'])
    const config = buttonByText(harness.root, '前往 AI 配置')
    assert.ok(config)
    assert.equal(config.props['aria-label'], '前往 AI 配置')
  } finally {
    harness.app.unmount()
  }
})

test('服务就绪的空结果下一步是去填写提示词', () => {
  const harness = mountResult()
  try {
    assert.match(textContent(harness.root), /填写提示词后，生成结果会显示在这里/)
    const next = buttonByAriaLabel(harness.root, '去填写提示词')
    assert.ok(next)
    assert.equal(buttonByText(harness.root, '去填写提示词'), next)
    assert.equal(next.props['aria-label'], '去填写提示词')
    assert.equal(buttonByText(harness.root, '前往 AI 配置'), undefined)
    click(next)
    assert.deepEqual(harness.events, ['focus-prompt'])
  } finally {
    harness.app.unmount()
  }
})

test('输入区失败下一步的可见文案和读屏名对齐', () => {
  const harness = mountInput({
    generationCapability: {
      ready: false,
      status: 'error',
      issue: '',
      message: '无法读取图片服务配置',
    },
  })
  try {
    const retry = buttonByAriaLabel(harness.root, '重新检查生成能力')
    const config = buttonByAriaLabel(harness.root, '前往 AI 配置')
    assert.ok(retry)
    assert.ok(config)
    assert.equal(buttonByText(harness.root, '重新检查生成能力'), retry)
    assert.equal(buttonByText(harness.root, '前往 AI 配置'), config)
    assert.match(textContent(retry), /重新检查生成能力/)
    assert.match(textContent(config), /前往 AI 配置/)
    click(retry)
    click(config)
    assert.deepEqual(harness.events, ['load-service-configs', 'open-ai-config'])
  } finally {
    harness.app.unmount()
  }
})

test('上传中可以取消上传，失败空态给出中文原因', async () => {
  const uploading = mountInput({
    mode: 'video',
    activeServiceLabel: '视频',
    generationCapability: readyCapability('视频'),
    refImageUploadStatus: 'uploading',
    refImageFileName: 'frame.png',
    refImageTriggerLabel: '视频参考图正在上传',
    refImageUploadMessage: '参考图上传中：frame.png',
    generateDisabled: true,
    generateDisabledReason: '参考图正在上传，请等待上传完成',
  })
  try {
    await nextTick()
    const cancelUpload = buttonByText(uploading.root, '取消上传')
    assert.ok(cancelUpload)
    click(cancelUpload)
    assert.deepEqual(uploading.events, ['clear-ref-image'])
  } finally {
    uploading.app.unmount()
  }
})

test('取消后的结果展示中文说明并可以重试', async () => {
  const item = {
    type: 'image',
    prompt: '港口夜景',
    status: 'cancelled',
    url: null,
    error: '生成已取消',
  }
  const harness = mountResult({ results: [item] })
  try {
    await nextTick()
    assert.match(textContent(harness.root), /生成已取消/)
    const retry = buttonByText(harness.root, '重试')
    assert.ok(retry)
    click(retry)
    assert.equal(harness.events[0][0], 'retry-generation')
  } finally {
    harness.app.unmount()
  }
})


test('生成成功后可以保存到素材中心，并给出中文无障碍名称', async () => {
  const item = {
    type: 'image',
    prompt: '一座灯塔',
    status: 'completed',
    url: '/static/library/images/a.png',
    localPath: 'library/images/a.png',
  }
  const harness = mountResult({
    results: [item],
    saveItemDisabledReason: () => '',
    saveItemAriaLabel: () => '保存到全局素材中心',
  })
  try {
    await nextTick()
    const save = buttonByText(harness.root, '保存到素材中心')
    assert.ok(save)
    assert.equal(save.props['aria-label'], '保存到全局素材中心')
    click(save)
    assert.equal(harness.events[0][0], 'save-item')
  } finally {
    harness.app.unmount()
  }
})

test('保存失败后按钮改为重试保存，读屏名称仍是中文', async () => {
  const item = {
    type: 'image',
    prompt: '灯塔',
    status: 'completed',
    url: '/static/library/images/a.png',
    assetSaveError: '保存到素材中心失败，请稍后重试',
  }
  const harness = mountResult({
    results: [item],
    saveItemDisabledReason: () => '',
    saveItemAriaLabel: () => '重试保存到全局素材中心',
  })
  try {
    await nextTick()
    const retry = buttonByText(harness.root, '重试保存')
    assert.ok(retry)
    assert.equal(retry.props['aria-label'], '重试保存到全局素材中心')
    assert.equal(buttonByText(harness.root, '保存到素材中心'), undefined)
    click(retry)
    assert.equal(harness.events[0][0], 'save-item')
  } finally {
    harness.app.unmount()
  }
})

test('已保存结果展示已保存，失败时给出中文原因', async () => {
  const item = {
    type: 'image',
    prompt: '港口',
    status: 'completed',
    url: '/static/library/images/port.png',
    assetId: 77,
    assetSaveError: '素材保存失败：返回结果不属于当前项目',
  }
  const harness = mountResult({
    results: [item],
    saveItemDisabledReason: () => '已保存到素材中心',
    saveItemAriaLabel: () => '已保存到全局素材中心',
  })
  try {
    await nextTick()
    const saved = buttonByText(harness.root, '已保存')
    assert.ok(saved)
    assert.equal(saved.props.disabled, true)
    assert.match(textContent(harness.root), /素材保存失败：返回结果不属于当前项目/)
  } finally {
    harness.app.unmount()
  }
})
