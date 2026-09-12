import test from 'node:test'
import assert from 'node:assert/strict'

import { defineComponent, h, inject, nextTick, provide, ref } from 'vue'

import { AccessibleDialogStub, createFormStubs } from './helpers/accessibleDialogStub.js'
import {
  buttonByAriaLabel,
  buttonByText,
  click,
  compileIconStub,
  compileSfc,
  createHostRenderer,
  dataModule,
  findAll,
  loadCompiledSfc,
  mountHarness,
  textContent,
  vueUrl,
} from './helpers/vueComponentHarness.js'
import { SCENE_MODEL_PREDEFINED_KEYS } from '../src/components/sceneModelMap/sceneModelMapCatalog.js'

const tableUrl = new URL('../src/components/sceneModelMap/SceneModelMapTable.vue', import.meta.url)
const formUrl = new URL('../src/components/sceneModelMap/SceneModelMapForm.vue', import.meta.url)
const parentUrl = new URL('../src/components/SceneModelMap.vue', import.meta.url)
const catalogUrl = new URL('../src/components/sceneModelMap/sceneModelMapCatalog.js', import.meta.url).href
const iconStubUrl = compileIconStub(['Plus'])

const SceneModelMapTable = await loadCompiledSfc(tableUrl, 'scene-model-map-table', new Map([
  ['vue', vueUrl],
  ['./sceneModelMapCatalog.js', catalogUrl],
]))
const SceneModelMapForm = await loadCompiledSfc(formUrl, 'scene-model-map-form', new Map([
  ['vue', vueUrl],
  ['./sceneModelMapCatalog.js', catalogUrl],
]))

const renderer = createHostRenderer()
const TABLE_ROW_KEY = 'scene-model-map-row'
const TEXT_CONFIG_ID = 41
const IMAGE_CONFIG_ID = 77
assert.notEqual(TEXT_CONFIG_ID, IMAGE_CONFIG_ID)

function createTableStubs() {
  const ElTableStub = defineComponent({
    name: 'ElTableStub',
    inheritAttrs: false,
    props: ['data', 'stripe'],
    setup(props, { slots, attrs }) {
      return () => {
        const rows = Array.isArray(props.data) ? props.data : []
        return h('div', { class: 'el-table', ...attrs }, rows.map((row, index) => (
          h(defineComponent({
            name: 'ElTableRowStub',
            setup() {
              provide(TABLE_ROW_KEY, row)
              return () => h('div', { class: 'el-table__row', 'data-row-index': String(index) }, slots.default?.({ row }))
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
      showOverflowTooltip: Boolean,
    },
    setup(props, { slots }) {
      const row = inject(TABLE_ROW_KEY, null)
      return () => {
        if (!row) return null
        if (slots.default) {
          return h('div', { class: 'el-table-cell', 'data-column': props.prop || props.label || '' }, slots.default({ row }))
        }
        return h('div', { class: 'el-table-cell', 'data-column': props.prop || '' }, String(row[props.prop] ?? ''))
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

const ElEmptyStub = defineComponent({
  name: 'ElEmptyStub',
  props: ['description'],
  setup(props, { slots }) {
    return () => h('empty', { role: 'status', 'data-description': props.description || '' }, [
      h('p', {}, props.description || ''),
      slots.default?.(),
    ])
  },
})
const ElAlertStub = defineComponent({
  name: 'ElAlertStub',
  props: ['type', 'title', 'showIcon', 'closable'],
  setup(props, { slots }) {
    return () => h('alert', { role: 'alert' }, [h('strong', {}, props.title || ''), slots.default?.()])
  },
})

test('表格展示绑定配置可用性，写锁时编辑删除带中文原因', async () => {
  const events = []
  const harness = mountHarness(renderer, () => h(SceneModelMapTable, {
    list: [
      { key: 'image_polish', service_type: 'text', config_id: null, config_name: null, model_override: '' },
      {
        key: 'story_generation',
        service_type: 'text',
        config_id: TEXT_CONFIG_ID,
        config_name: '文本模型',
        config_missing: false,
        config_inactive: false,
        config_type_mismatch: true,
        model_override: 'gpt-4o',
      },
    ],
    loading: false,
    writeLocked: true,
    writeLockReason: '场景模型映射加载失败，成功重试前不能添加',
    onEdit: (row) => events.push(['edit', row.key]),
    onDelete: (row) => events.push(['delete', row.key]),
  }), { components: createTableStubs() })
  try {
    await nextTick()
    assert.match(textContent(harness.root), /分镜图提示词润色/)
    assert.match(textContent(harness.root), /使用默认配置/)
    assert.match(textContent(harness.root), /服务类型不匹配/)
    const edit = buttonByAriaLabel(harness.root, '编辑场景「分镜图提示词润色」的模型映射')
    const remove = buttonByAriaLabel(harness.root, '删除场景「分镜图提示词润色」的模型映射')
    assert.equal(edit.props.disabled, true)
    assert.equal(edit.props.title, '场景模型映射加载失败，成功重试前不能添加')
    assert.equal(remove.props.disabled, true)
    click(edit)
    click(remove)
    assert.deepEqual(events, [['edit', 'image_polish'], ['delete', 'image_polish']])
  } finally {
    harness.app.unmount()
  }
})

test('表单控件都有中文可访问名称，自定义场景键不会点到非语义节点', async () => {
  const form = ref({
    key: 'image_polish',
    description: '',
    service_type: 'text',
    config_id: null,
    model_override: '',
  })
  const events = []
  const harness = mountHarness(renderer, () => h(SceneModelMapForm, {
    form: form.value,
    'onUpdate:form': (value) => { form.value = value },
    editingKey: null,
    filteredConfigs: [{ id: TEXT_CONFIG_ID, name: '文本模型', provider: 'openai', is_active: true }],
    selectedConfigModels: [],
    modelOverrideDisabledReason: '请先选择 AI 配置',
    onKeyChange: (key) => events.push(['key', key]),
    onConfigChange: (id) => events.push(['config', id]),
  }), { components: createFormStubs() })
  try {
    await nextTick()
    const named = findAll(harness.root, (node) => node.props && node.props['aria-label'])
    const labels = named.map((node) => node.props['aria-label'])
    assert.ok(labels.includes('场景键'))
    assert.ok(labels.includes('服务类型'))
    assert.ok(labels.includes('AI 配置'))
    assert.ok(labels.includes('模型覆盖'))
    assert.ok(labels.includes('场景描述'))
    assert.match(textContent(harness.root), /选择后会自动设置对应的服务类型/)
    assert.match(textContent(harness.root), /请先选择 AI 配置/)
    assert.ok(SCENE_MODEL_PREDEFINED_KEYS.length > 0)
    const clickableDivs = findAll(harness.root, (node) => ['div', 'span', 'p'].includes(node.type) && node.props.onClick)
    assert.equal(clickableDivs.length, 0)
    assert.deepEqual(events, [])
  } finally {
    harness.app.unmount()
  }
})

test('页面加载失败显示重试且不显示空列表，成功后才允许添加', async () => {
  const apiState = {
    listMaps: async () => [],
    listConfigs: async () => [],
  }
  globalThis.__sceneModelMapApiState = apiState
  const mapApiUrl = dataModule(`
    const apiState = globalThis.__sceneModelMapApiState
    export const sceneModelMapAPI = {
      list: () => apiState.listMaps(),
      create: async () => {},
      update: async () => {},
      delete: async () => {},
    }
  `)
  const aiApiUrl = dataModule(`
    const apiState = globalThis.__sceneModelMapApiState
    export const aiAPI = { list: () => apiState.listConfigs() }
  `)
  const feedbackUrl = dataModule(`
    export const ElMessage = { error() {}, success() {}, warning() {} }
    export const ElMessageBox = { async confirm() {} }
  `)
  const userFacingUrl = dataModule(`
    export function toUserFacingError(err, fallback) { return err?.message || fallback }
    export function isUserFacingAbort() { return false }
  `)
  const modelSelectionUrl = dataModule(`
    export function getSelectableModels() { return [] }
  `)
  const tableCompiled = compileSfc(tableUrl, 'scene-model-map-table-parent', new Map([
    ['vue', vueUrl],
    ['./sceneModelMapCatalog.js', catalogUrl],
  ]))
  const formCompiled = compileSfc(formUrl, 'scene-model-map-form-parent', new Map([
    ['vue', vueUrl],
    ['./sceneModelMapCatalog.js', catalogUrl],
  ]))
  const SceneModelMap = await loadCompiledSfc(parentUrl, 'scene-model-map-page', new Map([
    ['vue', vueUrl],
    ['@element-plus/icons-vue', iconStubUrl],
    ['@/utils/elementPlusFeedback.js', feedbackUrl],
    ['@/utils/userFacingError', userFacingUrl],
    ['@/api/sceneModelMap', mapApiUrl],
    ['@/api/ai', aiApiUrl],
    ['@/utils/modelSelection', modelSelectionUrl],
    ['./sceneModelMap/SceneModelMapTable.vue', tableCompiled],
    ['./sceneModelMap/SceneModelMapForm.vue', formCompiled],
    ['./sceneModelMap/sceneModelMapCatalog.js', catalogUrl],
  ]))

  apiState.listMaps = async () => { throw new Error('加载场景模型映射失败') }
  const failed = mountHarness(renderer, () => h(SceneModelMap), {
    components: {
      ...createTableStubs(),
      ...createFormStubs(),
      AccessibleDialog: AccessibleDialogStub,
      'el-empty': ElEmptyStub,
      ElEmpty: ElEmptyStub,
      'el-alert': ElAlertStub,
      ElAlert: ElAlertStub,
    },
  })
  try {
    await nextTick()
    await Promise.resolve()
    await nextTick()
    assert.match(textContent(failed.root), /加载场景模型映射失败/)
    assert.ok(buttonByAriaLabel(failed.root, '重新加载场景模型映射'))
    assert.equal(textContent(failed.root).includes('暂无场景模型映射配置'), false)
    const add = buttonByAriaLabel(failed.root, '添加业务场景配置')
    assert.equal(add.props.disabled, true)
    assert.equal(add.props.title, '场景模型映射加载失败，成功重试前不能添加')
  } finally {
    failed.app.unmount()
  }

  apiState.listMaps = async () => []
  apiState.listConfigs = async () => []
  const empty = mountHarness(renderer, () => h(SceneModelMap), {
    components: {
      ...createTableStubs(),
      ...createFormStubs(),
      AccessibleDialog: AccessibleDialogStub,
      'el-empty': ElEmptyStub,
      ElEmpty: ElEmptyStub,
      'el-alert': ElAlertStub,
      ElAlert: ElAlertStub,
    },
  })
  try {
    await nextTick()
    await Promise.resolve()
    await nextTick()
    assert.match(textContent(empty.root), /暂无场景模型映射配置/)
    const add = buttonByText(empty.root, '添加业务场景配置') || buttonByAriaLabel(empty.root, '添加业务场景配置')
    assert.ok(add)
    assert.equal(add.props.disabled, false)
  } finally {
    empty.app.unmount()
  }
})
