import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { defineComponent, h, nextTick } from 'vue'

import {
  buttonByAriaLabel,
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
const pageSource = readFileSync(pageUrl, 'utf8')
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
  'ai-config-return-replace-contract',
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

test('AI 配置返回走 router.replace(returnTo || 项目列表)，不用 push', () => {
  assert.match(pageSource, /router\.replace\(returnTo\.value \|\| \{ name: 'list' \}\)/)
  assert.doesNotMatch(pageSource, /router\.push\(returnTo\.value \|\| \{ name: 'list' \}\)/)
  assert.doesNotMatch(pageSource, /router\.replace\(route\.query\.returnTo/)
})

test('没有 returnTo 时返回按钮 replace 到命名 list 路由', async () => {
  const harness = mountAiConfig()
  try {
    await nextTick()
    const back = buttonByAriaLabel(harness.root, '返回项目列表')
    assert.ok(back, '缺少返回项目列表')
    click(back)
    await flushUi(nextTick)
    assert.deepEqual(harness.router.calls.slice(), [['replace', { name: 'list' }]])
  } finally {
    harness.app.unmount()
    resetVueRouterHarness()
  }
})

test('有 returnTo 时返回按钮 replace 到原地址，而不是 list', async () => {
  const harness = mountAiConfig({ returnTo: '/film/12' })
  try {
    await nextTick()
    const back = buttonByAriaLabel(harness.root, '返回原项目')
    assert.ok(back, '缺少返回原项目')
    click(back)
    await flushUi(nextTick)
    assert.deepEqual(harness.router.calls.slice(), [['replace', '/film/12']])
    assert.equal(harness.router.calls.some((item) => item[0] === 'replace' && item[1]?.name === 'list'), false)
  } finally {
    harness.app.unmount()
    resetVueRouterHarness()
  }
})
