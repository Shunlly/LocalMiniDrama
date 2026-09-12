import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { h, nextTick, ref } from 'vue'

import {
  click,
  createHostRenderer,
  dataModule,
  findByClass,
  findByTestId,
  loadCompiledSfc,
  mountHarness,
  textContent,
  vueUrl,
} from './helpers/vueComponentHarness.js'

function readSource(url) {
  return readFileSync(url, 'utf8').replace(/\r\n?/g, '\n')
}

const panelUrl = new URL('../src/components/aiConfig/AiConfigConfigsPanel.vue', import.meta.url)
const panelSource = readSource(panelUrl)
const vueSource = readSource(new URL('../src/components/AIConfigContent.vue', import.meta.url))

const toolbarStub = dataModule(`
  import { defineComponent, h } from ${JSON.stringify(vueUrl)}
  export default defineComponent({
    name: 'AiConfigListToolbar',
    inheritAttrs: false,
    setup(_props, { attrs }) {
      return () => h('div', {
        'data-testid': 'configs-toolbar',
        'data-filter': String(attrs.activeServiceFilter || ''),
      }, '工具栏')
    },
  })
`)

const tableStub = dataModule(`
  import { defineComponent, h } from ${JSON.stringify(vueUrl)}
  export default defineComponent({
    name: 'AiConfigListTable',
    inheritAttrs: false,
    props: {
      openTest: { type: Function, default: () => {} },
    },
    setup(props) {
      return () => h('div', { 'data-testid': 'configs-table' }, [
        h('button', {
          type: 'button',
          'data-testid': 'configs-table-test',
          onClick: () => props.openTest({ id: 41, name: '本地文本' }),
        }, '测试配置'),
      ])
    },
  })
`)

const AiConfigConfigsPanel = await loadCompiledSfc(
  panelUrl,
  'ai-config-configs-panel-component',
  new Map([
    ['vue', vueUrl],
    ['@/components/aiConfig/AiConfigListToolbar.vue', toolbarStub],
    ['@/components/aiConfig/AiConfigListTable.vue', tableStub],
  ]),
)

const renderer = createHostRenderer()
const TEXT_CONFIG_ID = 41

function noop() {}

function mountPanel(initial = {}) {
  const events = { test: [] }
  const importFileRef = ref(null)
  const configListSectionRef = ref(null)
  const mounted = mountHarness(renderer, () => h(AiConfigConfigsPanel, {
    configWorkspaceView: initial.configWorkspaceView ?? 'configs',
    vendorLock: initial.vendorLock ?? { enabled: false },
    configWriteLocked: Boolean(initial.configWriteLocked),
    configWriteLockReason: initial.configWriteLockReason ?? '',
    selectedRows: initial.selectedRows ?? [],
    batchDeleting: Boolean(initial.batchDeleting),
    activeServiceFilter: initial.activeServiceFilter ?? '',
    filteredCount: initial.filteredCount ?? 0,
    openAdd: noop,
    exportConfigs: noop,
    triggerImport: noop,
    importConfigs: noop,
    openOneKeyVolc: noop,
    openOneKeyAgnes: noop,
    openOneKeyTongyi: noop,
    onBatchDelete: noop,
    openBulkKey: noop,
    clearServiceFilter: noop,
    loading: Boolean(initial.loading),
    vendorLockLoading: Boolean(initial.vendorLockLoading),
    rows: initial.rows ?? [],
    configEmptyTitle: initial.configEmptyTitle ?? '还没有 AI 服务配置',
    configEmptyDescription: initial.configEmptyDescription ?? '',
    configListFailedEmpty: Boolean(initial.configListFailedEmpty),
    configListPendingEmpty: Boolean(initial.configListPendingEmpty),
    isConfigRowSelectable: () => true,
    onSelectionChange: noop,
    openTest: (row) => events.test.push(row),
    onRowEdit: noop,
    onDelete: noop,
    retryConfigDependencies: noop,
    openAddForService: noop,
    importFileRef: importFileRef.value,
    'onUpdate:importFileRef': (value) => { importFileRef.value = value },
    configListSectionRef: configListSectionRef.value,
    'onUpdate:configListSectionRef': (value) => { configListSectionRef.value = value },
  }))
  return { ...mounted, events, importFileRef, configListSectionRef }
}

test('配置管理面板是纯展示，openTest 仍由页面传入', () => {
  assert.match(vueSource, /<AiConfigConfigsPanel/)
  assert.match(vueSource, /:open-test="openTest"/)
  assert.match(vueSource, /async function loadList\(\)/)
  assert.match(vueSource, /async function openTest\(row\)/)
  assert.match(panelSource, /id="ai-config-configs-panel"/)
  assert.match(panelSource, /role="tabpanel"/)
  assert.match(panelSource, /tabindex="-1"/)
  assert.match(panelSource, /图片识别和语音转写属于扩展能力，不计入上方五类基础生成服务/)
  assert.match(panelSource, /:open-test="openTest"/)
  assert.doesNotMatch(panelSource, /async function loadList\(/)
  assert.doesNotMatch(panelSource, /async function openTest\(/)
  assert.doesNotMatch(panelSource, /useAiConfigList/)
  assert.doesNotMatch(panelSource, /aiAPI\./)
})

test('可见时保留列表滚动锚点，测试按钮走页面传入的 openTest', async () => {
  const harness = mountPanel({
    rows: [{ id: TEXT_CONFIG_ID, name: '本地文本' }],
  })
  try {
    await nextTick()
    const rootPanel = harness.root.children[0]
    assert.equal(rootPanel.props.id, 'ai-config-configs-panel')
    assert.equal(rootPanel.props.role, 'tabpanel')
    assert.equal(String(rootPanel.props.tabindex), '-1')
    assert.notEqual(rootPanel.style.display, 'none')
    assert.match(textContent(findByClass(harness.root, 'default-tip')[0]), /五类基础生成服务/)
    assert.ok(findByClass(harness.root, 'config-list-section')[0])
    assert.ok(harness.configListSectionRef.value)
    click(findByTestId(harness.root, 'configs-table-test')[0])
    assert.equal(harness.events.test[0].id, TEXT_CONFIG_ID)
    assert.equal(harness.events.test[0].name, '本地文本')
  } finally {
    harness.app.unmount()
  }

  const hidden = mountPanel({ configWorkspaceView: 'coverage' })
  try {
    await nextTick()
    assert.equal(hidden.root.children[0].style.display, 'none')
  } finally {
    hidden.app.unmount()
  }
})
