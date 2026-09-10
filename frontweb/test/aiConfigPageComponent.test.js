import test from 'node:test'
import assert from 'node:assert/strict'

import { defineComponent, h, nextTick } from 'vue'

import {
  buttonByAriaLabel,
  buttonByText,
  click,
  compileIconStub,
  createHostRenderer,
  dataModule,
  flushUi,
  loadCompiledSfc,
  mountHarness,
  vueUrl,
} from './helpers/vueComponentHarness.js'
import {
  compileVueRouterStub,
  ensureWindowShim,
  installVueRouterHarness,
  resetVueRouterHarness,
} from './helpers/vueRouterHarness.js'

ensureWindowShim()

const pageUrl = new URL('../src/views/AiConfig.vue', import.meta.url)
const iconStubUrl = compileIconStub(['ArrowLeft'])
const routerStubUrl = compileVueRouterStub()
const contentStubUrl = dataModule(`
  import { defineComponent, h } from ${JSON.stringify(vueUrl)}
  export default defineComponent({
    name: 'AIConfigContentStub',
    setup(_props, { expose }) {
      expose({
        async requestClose() { return true },
        hasUnsavedChanges() { return false },
      })
      return () => h('div', { 'data-ai-config-content': 'true' })
    },
  })
`)
const AiConfigPage = await loadCompiledSfc(
  pageUrl,
  'ai-config-page-component',
  new Map([
    ['vue', vueUrl],
    ['vue-router', routerStubUrl],
    ['@element-plus/icons-vue', iconStubUrl],
    ['@/components/AIConfigContent.vue', contentStubUrl],
  ]),
)

const renderer = createHostRenderer()

function mountAiConfig(query = {}) {
  const router = installVueRouterHarness({
    name: 'ai-config',
    fullPath: '/ai-config',
    query,
    meta: {
      normalizeReturnTo: (value) => {
        const raw = Array.isArray(value) ? value[0] : value
        return typeof raw === 'string' ? raw : ''
      },
    },
  })
  const mounted = mountHarness(renderer, () => h(AiConfigPage), {
    components: {
      AIConfigContent: defineComponent({
        name: 'UnusedGlobalContent',
        setup() { return () => null },
      }),
    },
  })
  return { ...mounted, router }
}

test('无返回地址时，logo 与返回按钮的 accessible name 不相同', async () => {
  const harness = mountAiConfig()
  try {
    await nextTick()
    const logo = buttonByAriaLabel(harness.root, '本地短剧助手，返回项目列表')
    const back = buttonByAriaLabel(harness.root, '返回项目列表')
    assert.ok(logo, '缺少带产品名前缀的 logo 返回')
    assert.ok(back, '缺少返回项目列表按钮')
    assert.notEqual(logo.props['aria-label'], back.props['aria-label'])
    assert.equal(buttonByText(harness.root, '返回项目列表'), back)
    assert.match(logo.props.class, /logo/)
  } finally {
    harness.app.unmount()
    resetVueRouterHarness()
  }
})

test('返回原项目时，logo 读屏名称仍带产品前缀', async () => {
  const harness = mountAiConfig({ returnTo: '/film/12' })
  try {
    await nextTick()
    const logo = buttonByAriaLabel(harness.root, '本地短剧助手，返回原项目')
    const back = buttonByAriaLabel(harness.root, '返回原项目')
    assert.ok(logo)
    assert.ok(back)
    assert.notEqual(logo.props['aria-label'], back.props['aria-label'])
    assert.equal(buttonByText(harness.root, '返回原项目'), back)
    assert.equal(buttonByAriaLabel(harness.root, '返回项目列表'), undefined)
  } finally {
    harness.app.unmount()
    resetVueRouterHarness()
  }
})

test('返回自由创作时，logo 与按钮名称也不相同', async () => {
  const harness = mountAiConfig({ returnTo: '/free-create' })
  try {
    await nextTick()
    const logo = buttonByAriaLabel(harness.root, '本地短剧助手，返回自由创作')
    const back = buttonByAriaLabel(harness.root, '返回自由创作')
    assert.ok(logo)
    assert.ok(back)
    assert.notEqual(logo.props['aria-label'], back.props['aria-label'])
    click(back)
    await flushUi(nextTick)
    assert.deepEqual(harness.router.calls.slice(), [['replace', '/free-create']])
  } finally {
    harness.app.unmount()
    resetVueRouterHarness()
  }
})
