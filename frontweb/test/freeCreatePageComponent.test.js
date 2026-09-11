import test from 'node:test'
import assert from 'node:assert/strict'

import { defineComponent, h, nextTick, ref } from 'vue'

import {
  buttonByAriaLabel,
  buttonByText,
  click,
  compileIconStub,
  compileSfc,
  createHostRenderer,
  dataModule,
  loadCompiledSfc,
  mountHarness,
  textContent,
  vueUrl,
} from './helpers/vueComponentHarness.js'
import {
  compileVueRouterStub,
  ensureWindowShim,
  installVueRouterHarness,
  resetVueRouterHarness,
} from './helpers/vueRouterHarness.js'

ensureWindowShim()

const pageUrl = new URL('../src/views/FreeCreate.vue', import.meta.url)
const iconStubUrl = compileIconStub([
  'ArrowLeft',
  'CircleCheck',
  'CircleClose',
  'Loading',
  'Picture',
  'VideoCamera',
  'Warning',
])
const routerStubUrl = compileVueRouterStub()
const previewStubUrl = dataModule(`
  import { defineComponent, h } from ${JSON.stringify(vueUrl)}
  export default defineComponent({
    name: 'ImagePreviewDialogStub',
    props: ['modelValue', 'src', 'alt'],
    setup(props) {
      return () => props.modelValue ? h('preview', { src: props.src, alt: props.alt }) : null
    },
  })
`)
const workspaceStubUrl = dataModule(`
  export function useFreeCreateWorkspace() {
    return globalThis.__freeCreateWorkspace
  }
`)

const childReplacements = new Map([
  ['vue', vueUrl],
  ['@element-plus/icons-vue', iconStubUrl],
])
function compileChild(name, id) {
  return compileSfc(new URL(`../src/components/freeCreate/${name}`, import.meta.url), id, childReplacements)
}

const FreeCreatePage = await loadCompiledSfc(
  pageUrl,
  'free-create-page-component',
  new Map([
    ['vue', vueUrl],
    ['vue-router', routerStubUrl],
    ['@/components/ImagePreviewDialog.vue', previewStubUrl],
    ['@/components/freeCreate/FreeCreateHeader.vue', compileChild('FreeCreateHeader.vue', 'free-create-header')],
    ['@/components/freeCreate/FreeCreateInputPanel.vue', compileChild('FreeCreateInputPanel.vue', 'free-create-input')],
    ['@/components/freeCreate/FreeCreateResultPanel.vue', compileChild('FreeCreateResultPanel.vue', 'free-create-result')],
    ['@/composables/useFreeCreateWorkspace.js', workspaceStubUrl],
  ]),
)

const renderer = createHostRenderer()
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

function noop() {}

function createWorkspace(overrides = {}) {
  const events = []
  const leaveCalls = []
  const state = {
    mode: ref(overrides.mode || 'image'),
    prompt: ref(overrides.prompt || ''),
    style: ref(''),
    aspectRatio: ref('16:9'),
    duration: ref(5),
    generating: ref(Boolean(overrides.generating)),
    cancelling: ref(Boolean(overrides.cancelling)),
    results: ref(overrides.results || []),
    showImagePreview: ref(false),
    previewImage: ref({ src: '', alt: '生成图片预览' }),
    refImageDataUrl: ref(null),
    refImageFileName: ref('参考图'),
    refImageUploadStatus: ref(overrides.refImageUploadStatus || 'idle'),
    generationCapability: ref(overrides.generationCapability || {
      ready: true,
      status: 'ready',
      issue: '',
      message: '图片服务已就绪',
    }),
    activeServiceLabel: ref('图片'),
    aspectRatioOptions: ref([{ value: '16:9', label: '16:9' }]),
    refImageTriggerLabel: ref('上传视频参考图'),
    refImageUploadMessage: ref(''),
    generateDisabled: ref(Boolean(overrides.generateDisabled)),
    generateDisabledReason: ref(overrides.generateDisabledReason || ''),
    resultBusyDisabledReason: ref(overrides.resultBusyDisabledReason || ''),
    emptyResultCopy: ref(overrides.emptyResultCopy || '填写提示词后，生成结果会显示在这里'),
    goBack: () => events.push('go-back'),
    loadServiceConfigs: () => events.push('load-service-configs'),
    openAiConfig: () => events.push('open-ai-config'),
    generate: () => events.push('generate'),
    triggerRefImageUpload: noop,
    onRefImageDrop: noop,
    onRefImageChange: noop,
    retryRefImageUpload: noop,
    clearRefImage: () => events.push('clear-ref-image'),
    clearResults: () => events.push('clear-results'),
    cancelGeneration: () => events.push('cancel-generation'),
    retryGeneration: (item) => events.push(['retry-generation', item]),
    downloadItem: noop,
    resultImageAlt: (item, index) => `第 ${index + 1} 张生成图片`,
    canRetryItem: (item) => item?.status === 'failed' || item?.status === 'cancelled',
    openImagePreview: noop,
    saveItemDisabledReason: (item) => item?.assetId ? '已保存到素材中心' : '',
    saveItemAriaLabel: (item) => item?.assetId ? '已保存到全局素材中心' : '保存到全局素材中心',
    saveItemToAssets: (item) => events.push(['save-item', item]),
    confirmFreeCreateLeave: async () => {
      leaveCalls.push('confirm')
      return overrides.leaveAllowed !== false
    },
    handleBeforeUnload: noop,
    mount: async () => {},
    unmount: () => events.push('unmount'),
    events,
    leaveCalls,
  }
  globalThis.__freeCreateWorkspace = state
  return state
}

function mountPage(overrides = {}) {
  const workspace = createWorkspace(overrides)
  const router = installVueRouterHarness({
    name: 'free-create',
    fullPath: '/free-create',
  })
  const mounted = mountHarness(renderer, () => h(FreeCreatePage), {
    components: {
      'el-tabs': ElTabsStub,
      ElTabs: ElTabsStub,
      'el-tab-pane': ElTabPaneStub,
      ElTabPane: ElTabPaneStub,
    },
  })
  return { ...mounted, workspace, router }
}

test('空结果区展示中文说明，配置失败时可重新检查', async () => {
  const harness = mountPage({
    emptyResultCopy: '暂时无法读取图片服务配置，因此还不能生成。',
    generationCapability: {
      ready: false,
      status: 'error',
      issue: '',
      message: '无法读取图片服务配置',
    },
  })
  try {
    await nextTick()
    assert.match(textContent(harness.root), /暂时无法读取图片服务配置，因此还不能生成。/)
    const retry = buttonByText(harness.root, '重新检查服务')
    assert.ok(retry)
    click(retry)
    assert.deepEqual(harness.workspace.events, ['load-service-configs'])
  } finally {
    harness.app.unmount()
    resetVueRouterHarness()
    delete globalThis.__freeCreateWorkspace
  }
})

test('服务未就绪的空结果下一步可前往 AI 配置', async () => {
  const harness = mountPage({
    emptyResultCopy: '请先配置可用的图片服务，生成结果会显示在这里',
    generationCapability: {
      ready: false,
      status: 'missing',
      issue: 'missing_config',
      message: '尚未配置可用的图片服务',
    },
  })
  try {
    await nextTick()
    assert.equal(buttonByText(harness.root, '重新检查服务'), undefined)
    const config = buttonByText(harness.root, '前往 AI 配置')
    assert.ok(config)
    assert.equal(config.props['aria-label'], '前往 AI 配置')
    click(config)
    assert.deepEqual(harness.workspace.events, ['open-ai-config'])
  } finally {
    harness.app.unmount()
    resetVueRouterHarness()
    delete globalThis.__freeCreateWorkspace
  }
})

test('生成中可以取消，取消按钮读屏名称是取消生成', async () => {
  const harness = mountPage({
    generating: true,
    results: [{ type: 'image', prompt: '灯塔', status: 'processing', url: null }],
  })
  try {
    await nextTick()
    const cancel = buttonByAriaLabel(harness.root, '取消生成')
    assert.ok(cancel)
    assert.match(textContent(cancel), /取消生成/)
    click(cancel)
    assert.deepEqual(harness.workspace.events, ['cancel-generation'])
  } finally {
    harness.app.unmount()
    resetVueRouterHarness()
    delete globalThis.__freeCreateWorkspace
  }
})

test('失败和取消结果都可以重试', async () => {
  const failed = { type: 'image', prompt: '灯塔', status: 'failed', url: null, error: '生成失败，请稍后重试' }
  const cancelled = { type: 'image', prompt: '港口', status: 'cancelled', url: null, error: '生成已取消' }
  const harness = mountPage({ results: [failed, cancelled] })
  try {
    await nextTick()
    assert.match(textContent(harness.root), /生成失败，请稍后重试/)
    assert.match(textContent(harness.root), /生成已取消/)
    const retries = []
    const visit = (node) => {
      if (node.type === 'button' && textContent(node).replace(/\s+/g, ' ').trim() === '重试') retries.push(node)
      for (const child of node.children || []) visit(child)
    }
    visit(harness.root)
    assert.equal(retries.length, 2)
    click(retries[0])
    click(retries[1])
    assert.equal(harness.workspace.events.length, 2)
    assert.equal(harness.workspace.events[0][0], 'retry-generation')
    assert.equal(harness.workspace.events[1][0], 'retry-generation')
  } finally {
    harness.app.unmount()
    resetVueRouterHarness()
    delete globalThis.__freeCreateWorkspace
  }
})

test('离开守卫在参考图上传中会先走离开确认', async () => {
  const harness = mountPage({ refImageUploadStatus: 'uploading', leaveAllowed: false })
  try {
    await nextTick()
    const allowed = await harness.router.leaveGuards[0]()
    assert.equal(allowed, false)
    assert.deepEqual(harness.workspace.leaveCalls, ['confirm'])
  } finally {
    harness.app.unmount()
    resetVueRouterHarness()
    delete globalThis.__freeCreateWorkspace
  }
})

test('生成成功后可以把结果保存到素材中心', async () => {
  const item = {
    type: 'image',
    prompt: '灯塔',
    status: 'completed',
    url: '/static/library/images/a.png',
    localPath: 'library/images/a.png',
  }
  const harness = mountPage({ results: [item] })
  try {
    await nextTick()
    const save = buttonByText(harness.root, '保存到素材中心')
    assert.ok(save)
    click(save)
    assert.equal(harness.workspace.events[0][0], 'save-item')
  } finally {
    harness.app.unmount()
    resetVueRouterHarness()
    delete globalThis.__freeCreateWorkspace
  }
})
