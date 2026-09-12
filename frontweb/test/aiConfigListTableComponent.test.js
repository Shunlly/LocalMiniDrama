import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { defineComponent, h, inject, nextTick, provide } from 'vue'

import { configActionLabel } from '../src/utils/aiConfigLabels.js'
import {
  buttonByAriaLabel,
  buttonByText,
  click,
  compileIconStub,
  createHostRenderer,
  findByClass,
  loadCompiledSfc,
  mountHarness,
  textContent,
  vueUrl,
} from './helpers/vueComponentHarness.js'

function readSource(url) {
  return readFileSync(url, 'utf8').replace(/\r\n?/g, '\n')
}

const tableUrl = new URL('../src/components/aiConfig/AiConfigListTable.vue', import.meta.url)
const tableSource = readSource(tableUrl)
const iconStubUrl = compileIconStub([
  'ChatDotRound',
  'Document',
  'Film',
  'Folder',
  'Headset',
  'Key',
  'MagicStick',
  'Microphone',
  'Picture',
  'Plus',
  'VideoCamera',
])
const AiConfigListTable = await loadCompiledSfc(
  tableUrl,
  'ai-config-list-table-component',
  new Map([
    ['vue', vueUrl],
    ['@element-plus/icons-vue', iconStubUrl],
  ]),
)

const renderer = createHostRenderer()
const TEXT_CONFIG_ID = 41
const IMAGE_CONFIG_ID = 52
assert.notEqual(TEXT_CONFIG_ID, IMAGE_CONFIG_ID)

const TABLE_ROW_KEY = 'ai-config-list-table-row'

function createTableStubs() {
  const ElTableStub = defineComponent({
    name: 'ElTableStub',
    inheritAttrs: false,
    props: ['data', 'stripe'],
    setup(props, { slots, attrs }) {
      return () => {
        const rows = Array.isArray(props.data) ? props.data : []
        if (!rows.length) {
          return h('div', { class: 'el-table', 'data-el-table': 'true', ...attrs }, [
            h('div', { class: 'el-table-empty' }, slots.empty?.()),
          ])
        }
        return h('div', { class: 'el-table', 'data-el-table': 'true', ...attrs }, rows.map((row, index) => (
          h(defineComponent({
            name: 'ElTableRowStub',
            setup() {
              provide(TABLE_ROW_KEY, row)
              return () => h('div', {
                class: 'el-table__row',
                'data-row-index': String(index),
              }, slots.default?.({ row }))
            },
          }))
        )))
      }
    },
  })

  const ElTableColumnStub = defineComponent({
    name: 'ElTableColumnStub',
    inheritAttrs: false,
    props: {
      type: String,
      prop: String,
      label: String,
      width: [String, Number],
      minWidth: [String, Number],
      fixed: [String, Boolean],
      selectable: Function,
      showOverflowTooltip: Boolean,
    },
    setup(props, { slots }) {
      const row = inject(TABLE_ROW_KEY, null)
      return () => {
        if (!row) return null
        if (props.type === 'selection') {
          const enabled = typeof props.selectable === 'function' ? Boolean(props.selectable(row)) : true
          return h('input', {
            type: 'checkbox',
            class: 'el-table-selection',
            disabled: !enabled,
          })
        }
        if (slots.default) {
          return h('div', {
            class: 'el-table-cell',
            'data-column': props.prop || props.label || '',
          }, slots.default({ row }))
        }
        return h('div', {
          class: 'el-table-cell',
          'data-column': props.prop || '',
        }, String(row[props.prop] ?? ''))
      }
    },
  })

  return {
    'el-table': ElTableStub,
    ElTable: ElTableStub,
    'el-table-column': ElTableColumnStub,
    ElTableColumn: ElTableColumnStub,
  }
}

function sampleRow(overrides = {}) {
  return {
    id: TEXT_CONFIG_ID,
    name: '本地文本',
    provider: 'ollama',
    base_url: 'http://127.0.0.1:11434',
    default_model: 'qwen3',
    service_type: 'text',
    is_default: true,
    ...overrides,
  }
}

function mountTable(initial = {}) {
  const events = {
    selection: [],
    test: [],
    edit: [],
    delete: [],
    retry: 0,
    add: [],
    clear: 0,
  }
  const props = {
    loading: false,
    vendorLockLoading: false,
    rows: initial.rows ?? [sampleRow()],
    vendorLock: initial.vendorLock ?? { enabled: false },
    configWriteLocked: false,
    configWriteLockReason: '',
    configEmptyTitle: '还没有 AI 服务配置',
    configEmptyDescription: '先添加文本、图片或视频厂商，生成流程会自动使用默认配置。',
    configListFailedEmpty: false,
    configListPendingEmpty: false,
    activeServiceFilter: '',
    isConfigRowSelectable: () => !props.configWriteLocked,
    onSelectionChange: (rows) => events.selection.push(rows),
    openTest: (row) => events.test.push(row),
    onRowEdit: (row) => events.edit.push(row),
    onDelete: (row) => events.delete.push(row),
    retryConfigDependencies: () => { events.retry += 1 },
    openAddForService: (type) => events.add.push(type),
    clearServiceFilter: () => { events.clear += 1 },
    ...initial.props,
  }
  const mounted = mountHarness(renderer, () => h(AiConfigListTable, props), {
    components: createTableStubs(),
  })
  return { ...mounted, events, props }
}

test('列表表格源码是纯展示，不抽取 loadList/openTest', () => {
  assert.match(tableSource, /@click="openTest\(row\)"/)
  assert.match(tableSource, /:aria-label="configActionLabel\('测试', row\)"/)
  assert.match(tableSource, /:disabled="configWriteLocked"/)
  assert.match(tableSource, /:title="configWriteLocked \? configWriteLockReason : undefined"/)
  assert.doesNotMatch(tableSource, /async function loadList\(/)
  assert.doesNotMatch(tableSource, /async function openTest\(/)
  assert.doesNotMatch(tableSource, /useAiConfigList/)
  assert.doesNotMatch(tableSource, /from '@\/composables\/useAiConfigList/)
  assert.doesNotMatch(tableSource, /function formatJimeng2AssetCreatedAt/)
  assert.doesNotMatch(tableSource, /aiAPI\./)
})

test('普通行展示中文类型和操作，测试走 openTest 而不是写操作', async () => {
  const row = sampleRow()
  const harness = mountTable({ rows: [row] })
  try {
    await nextTick()
    assert.match(textContent(harness.root), /本地文本/)
    assert.match(textContent(harness.root), /ollama/)
    assert.match(textContent(harness.root), /文本/)
    const testButton = buttonByAriaLabel(harness.root, configActionLabel('测试', row))
    const editButton = buttonByAriaLabel(harness.root, configActionLabel('编辑', row))
    const deleteButton = buttonByAriaLabel(harness.root, configActionLabel('删除', row))
    assert.ok(testButton)
    assert.ok(editButton)
    assert.ok(deleteButton)
    click(testButton)
    assert.equal(harness.events.test[0], row)
    assert.deepEqual(harness.events.edit, [])
    assert.deepEqual(harness.events.delete, [])
  } finally {
    harness.app.unmount()
  }
})

test('写锁时编辑删除禁用并给出中文原因，测试仍可点', async () => {
  const row = sampleRow({ id: IMAGE_CONFIG_ID, name: '火山图片', service_type: 'image' })
  const harness = mountTable({
    rows: [row],
    props: {
      configWriteLocked: true,
      configWriteLockReason: '配置列表尚未就绪',
    },
  })
  try {
    await nextTick()
    const testButton = buttonByAriaLabel(harness.root, configActionLabel('测试', row))
    const editButton = buttonByAriaLabel(harness.root, configActionLabel('编辑', row))
    const deleteButton = buttonByAriaLabel(harness.root, configActionLabel('删除', row))
    assert.equal(testButton.props.disabled, false)
    assert.equal(editButton.props.disabled, true)
    assert.equal(editButton.props.title, '配置列表尚未就绪')
    assert.equal(deleteButton.props.disabled, true)
    assert.equal(deleteButton.props.title, '配置列表尚未就绪')
    click(testButton)
    assert.equal(harness.events.test[0], row)
    assert.deepEqual(harness.events.edit, [])
    assert.deepEqual(harness.events.delete, [])
  } finally {
    harness.app.unmount()
  }
})

test('厂商锁定隐藏勾选和删除，编辑入口改成修改密钥', async () => {
  const row = sampleRow()
  const harness = mountTable({
    rows: [row],
    vendorLock: { enabled: true },
  })
  try {
    await nextTick()
    assert.equal(findByClass(harness.root, 'el-table-selection').length, 0)
    assert.ok(buttonByAriaLabel(harness.root, configActionLabel('修改密钥', row)))
    assert.equal(buttonByAriaLabel(harness.root, configActionLabel('编辑', row)), undefined)
    assert.equal(buttonByAriaLabel(harness.root, configActionLabel('删除', row)), undefined)
  } finally {
    harness.app.unmount()
  }
})

test('失败空态只给重试，写锁空态禁用添加并保留查看全部', async () => {
  const failed = mountTable({
    rows: [],
    props: {
      configListFailedEmpty: true,
      configEmptyTitle: '暂时无法读取配置列表',
      configEmptyDescription: '请点击重试后再查看或添加配置。',
    },
  })
  try {
    await nextTick()
    assert.match(textContent(failed.root), /暂时无法读取配置列表/)
    const emptyState = findByClass(failed.root, 'config-empty-state')[0]
    assert.equal(emptyState.props.role, 'alert')
    assert.equal(emptyState.props['aria-live'], 'assertive')
    const retry = buttonByText(failed.root, '重试')
    assert.equal(retry.props['aria-label'], '重新读取配置列表')
    click(retry)
    assert.equal(failed.events.retry, 1)
    assert.equal(buttonByText(failed.root, '添加第一个配置'), undefined)
    assert.equal(buttonByText(failed.root, '查看全部'), undefined)
  } finally {
    failed.app.unmount()
  }

  const filtered = mountTable({
    rows: [],
    props: {
      activeServiceFilter: 'text',
      configWriteLocked: true,
      configWriteLockReason: '配置列表尚未就绪',
      configEmptyTitle: '暂无文本配置',
      configEmptyDescription: '添加一个配置并设为默认，即可用于对应生成环节。',
    },
  })
  try {
    await nextTick()
    const addButton = buttonByText(filtered.root, '添加文本配置')
    assert.ok(addButton)
    assert.equal(addButton.props.disabled, true)
    assert.equal(addButton.props.title, '配置列表尚未就绪')
    assert.equal(addButton.props['aria-label'], '配置列表尚未就绪')
    const clearButton = buttonByText(filtered.root, '查看全部')
    assert.equal(clearButton.props['aria-label'], '清除当前服务筛选，查看全部配置')
    click(clearButton)
    assert.equal(filtered.events.clear, 1)
    assert.deepEqual(filtered.events.add, [])
  } finally {
    filtered.app.unmount()
  }
})

test('读取中的空态是 status 区域，不给添加或查看全部', async () => {
  assert.match(tableSource, /aria-label="AI 服务配置列表"/)
  assert.match(tableSource, /:role="configListFailedEmpty \? 'alert' : 'status'"/)
  const pending = mountTable({
    rows: [],
    props: {
      configListPendingEmpty: true,
      activeServiceFilter: 'text',
      configEmptyTitle: '正在读取配置列表',
      configEmptyDescription: '正在从本地服务读取已保存的厂商配置。',
    },
  })
  try {
    await nextTick()
    const table = findByClass(pending.root, 'el-table')[0]
    assert.equal(table.props['aria-label'], 'AI 服务配置列表')
    assert.equal(table.props['aria-busy'], true)
    const emptyState = findByClass(pending.root, 'config-empty-state')[0]
    assert.equal(emptyState.props.role, 'status')
    assert.equal(emptyState.props['aria-live'], 'polite')
    assert.equal(emptyState.props['aria-busy'], true)
    assert.match(textContent(pending.root), /正在读取配置列表/)
    assert.equal(buttonByText(pending.root, '添加文本配置'), undefined)
    assert.equal(buttonByText(pending.root, '查看全部'), undefined)
    assert.equal(buttonByText(pending.root, '重试'), undefined)
  } finally {
    pending.app.unmount()
  }
})

test('厂商锁定空态给出下一步，不展示添加按钮', async () => {
  const harness = mountTable({
    rows: [],
    vendorLock: { enabled: true },
    props: {
      configEmptyTitle: '还没有 AI 服务配置',
      configEmptyDescription: '下一步：点击下方「添加第一个配置」。',
    },
  })
  try {
    await nextTick()
    assert.match(textContent(harness.root), /当前由管理员统一配置/)
    assert.doesNotMatch(textContent(harness.root), /添加第一个配置/)
    assert.equal(buttonByText(harness.root, '添加第一个配置'), undefined)
  } finally {
    harness.app.unmount()
  }
})
