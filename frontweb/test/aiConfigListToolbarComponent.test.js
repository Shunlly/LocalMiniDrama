import test from 'node:test'
import assert from 'node:assert/strict'

import { defineComponent, h, nextTick, ref } from 'vue'

import {
  buttonByText,
  click,
  compileIconStub,
  createHostRenderer,
  findAll,
  findByClass,
  loadCompiledSfc,
  mountHarness,
  textContent,
  vueUrl,
} from './helpers/vueComponentHarness.js'

const toolbarUrl = new URL('../src/components/aiConfig/AiConfigListToolbar.vue', import.meta.url)
const iconStubUrl = compileIconStub(['Plus', 'Download', 'Upload', 'MagicStick', 'Delete', 'Key'])
const labelsUrl = new URL('../src/utils/aiConfigLabels.js', import.meta.url).href
const AiConfigListToolbar = await loadCompiledSfc(
  toolbarUrl,
  'ai-config-list-toolbar-component',
  new Map([
    ['vue', vueUrl],
    ['@element-plus/icons-vue', iconStubUrl],
    ['@/utils/aiConfigLabels.js', labelsUrl],
  ]),
)

const renderer = createHostRenderer()
const WRITE_LOCK_REASON = '配置列表尚未就绪，成功加载前不能修改'

const ElAlertWithTitleSlot = defineComponent({
  name: 'ElAlertWithTitleSlot',
  props: ['type', 'title', 'closable', 'showIcon'],
  setup(props, { slots, attrs }) {
    return () => h('alert', {
      ...attrs,
      'data-type': props.type || '',
      role: props.type === 'error' ? 'alert' : 'status',
    }, slots.title?.() || props.title || '')
  },
})

function fileInput(root) {
  return findAll(root, (node) => node.type === 'input' && node.props?.type === 'file')[0]
}

function mountToolbar(initial = {}) {
  const events = []
  const importFileRef = ref(null)
  const mounted = mountHarness(renderer, () => h(AiConfigListToolbar, {
    vendorLock: initial.vendorLock ?? { enabled: false },
    configWriteLocked: Boolean(initial.configWriteLocked),
    configWriteLockReason: initial.configWriteLockReason ?? '',
    selectedRows: initial.selectedRows ?? [],
    batchDeleting: Boolean(initial.batchDeleting),
    activeServiceFilter: initial.activeServiceFilter ?? '',
    filteredCount: initial.filteredCount ?? 0,
    openAdd: () => events.push('open-add'),
    exportConfigs: () => events.push('export'),
    triggerImport: () => events.push('trigger-import'),
    importConfigs: () => events.push('import'),
    openOneKeyVolc: () => events.push('one-key-volc'),
    openOneKeyAgnes: () => events.push('one-key-agnes'),
    openOneKeyTongyi: () => events.push('one-key-tongyi'),
    onBatchDelete: () => events.push('batch-delete'),
    openBulkKey: () => events.push('bulk-key'),
    clearServiceFilter: () => events.push('clear-filter'),
    importFileRef: importFileRef.value,
    'onUpdate:importFileRef': (value) => { importFileRef.value = value },
  }), {
    components: {
      ElAlert: ElAlertWithTitleSlot,
      'el-alert': ElAlertWithTitleSlot,
    },
  })
  return { ...mounted, events, importFileRef }
}

test('写锁时添加导入一键配置都展示中文原因', async () => {
  const harness = mountToolbar({
    configWriteLocked: true,
    configWriteLockReason: WRITE_LOCK_REASON,
    selectedRows: [{ id: 1 }],
    batchDeleting: true,
    activeServiceFilter: 'text',
    filteredCount: 3,
  })
  try {
    await nextTick()
    const add = buttonByText(harness.root, '添加配置')
    const imported = buttonByText(harness.root, '导入配置')
    const volc = buttonByText(harness.root, '一键配置火山')
    const agnes = buttonByText(harness.root, '一键配置 Agnes')
    const tongyi = findAll(harness.root, (node) => node.type === 'button' && /\u4e00\u952e\u914d\u7f6e\u901a\u4e49/.test(textContent(node)))[0]
    const removed = findAll(harness.root, (node) => node.type === 'button' && /\u5220\u9664\u9009\u4e2d/.test(textContent(node)))[0]
    assert.ok(add)
    assert.ok(imported)
    assert.ok(volc)
    assert.ok(agnes)
    assert.ok(tongyi)
    assert.ok(removed)
    for (const button of [add, imported, volc, agnes, tongyi, removed]) {
      assert.equal(button.props.disabled, true)
      assert.equal(button.props.title, WRITE_LOCK_REASON)
    }
    assert.equal(removed.props['data-loading'], true)
    const exported = buttonByText(harness.root, '导出配置')
    assert.ok(exported)
    assert.notEqual(exported.props.disabled, true)
    click(exported)
    assert.deepEqual(harness.events, ['export'])
    assert.equal(fileInput(harness.root).props.disabled, true)
    assert.match(textContent(findByClass(harness.root, 'config-filter-bar')[0]), /当前只看：/)
    assert.match(textContent(harness.root), /文本/)
    assert.match(textContent(harness.root), /3 条/)
    const clearFilter = buttonByText(harness.root, '查看全部配置')
    assert.equal(clearFilter.props['aria-label'], '清除当前服务筛选，查看全部配置')
    click(clearFilter)
    assert.deepEqual(harness.events, ['export', 'clear-filter'])
    assert.match(textContent(harness.root), /不推荐/)
  } finally {
    harness.app.unmount()
  }
})

test('未锁定时添加导入一键配置可点', async () => {
  const harness = mountToolbar()
  try {
    await nextTick()
    click(buttonByText(harness.root, '添加配置'))
    click(buttonByText(harness.root, '导入配置'))
    click(buttonByText(harness.root, '一键配置火山'))
    click(buttonByText(harness.root, '一键配置 Agnes'))
    const tongyi = findAll(harness.root, (node) => node.type === 'button' && textContent(node).includes('一键配置通义'))[0]
    click(tongyi)
    assert.deepEqual(harness.events, ['open-add', 'trigger-import', 'one-key-volc', 'one-key-agnes', 'one-key-tongyi'])
    assert.equal(buttonByText(harness.root, '一键换密钥'), undefined)
    assert.equal(fileInput(harness.root).props.disabled, false)
    assert.equal(findByClass(harness.root, 'config-filter-bar').length, 0)
  } finally {
    harness.app.unmount()
  }
})

test('厂商锁定模式只保留导出和一键换密钥', async () => {
  const harness = mountToolbar({
    vendorLock: { enabled: true },
    configWriteLocked: true,
    configWriteLockReason: WRITE_LOCK_REASON,
  })
  try {
    await nextTick()
    assert.match(textContent(harness.root), /厂商锁定模式/)
    assert.match(textContent(harness.root), /API 密钥/)
    assert.match(textContent(harness.root), /默认模型/)
    assert.equal(buttonByText(harness.root, '添加配置'), undefined)
    assert.equal(buttonByText(harness.root, '一键配置火山'), undefined)
    const bulk = buttonByText(harness.root, '一键换密钥')
    assert.ok(bulk)
    assert.equal(bulk.props.disabled, true)
    assert.equal(bulk.props.title, WRITE_LOCK_REASON)
    click(buttonByText(harness.root, '导出配置'))
    assert.deepEqual(harness.events, ['export'])
  } finally {
    harness.app.unmount()
  }
})

test('删除选中和通义按钮的可见文案都在读屏名里', async () => {
  const firstId = 41
  const secondId = 52
  assert.notEqual(firstId, secondId)
  const harness = mountToolbar({
    selectedRows: [{ id: firstId }, { id: secondId }],
  })
  try {
    await nextTick()
    const removed = findAll(harness.root, (node) => node.type === 'button' && /删除选中/.test(textContent(node)))[0]
    assert.ok(removed)
    assert.equal(textContent(removed).replace(/\s+/g, ' ').trim(), '删除选中 2 项配置')
    assert.equal(removed.props['aria-label'], '删除选中 2 项配置')
    const tongyi = findAll(harness.root, (node) => node.type === 'button' && textContent(node).includes('一键配置通义'))[0]
    assert.ok(tongyi)
    assert.equal(textContent(tongyi).replace(/\s+/g, ' ').trim(), '一键配置通义（不推荐）')
    assert.equal(tongyi.props['aria-label'], '一键配置通义（不推荐）')
  } finally {
    harness.app.unmount()
  }
})
