import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { defineComponent, h, inject, nextTick, provide, ref } from 'vue'

import {
  buttonByText,
  click,
  compileSfc,
  createHostRenderer,
  findAll,
  loadCompiledSfc,
  mountHarness,
  textContent,
  vueUrl,
} from './helpers/vueComponentHarness.js'
import {
  AccessibleDialogStub,
  createFormStubs,
} from './helpers/accessibleDialogStub.js'

const GROUP_A_ID = 'group-alpha-11'
const GROUP_B_ID = 'group-beta-22'
const ASSET_A_ID = 'asset-alpha-31'
const ASSET_B_ID = 'asset-beta-42'
const VIDEO_A_ID = 101
const VIDEO_B_ID = 202
assert.notEqual(GROUP_A_ID, GROUP_B_ID)
assert.notEqual(ASSET_A_ID, ASSET_B_ID)
assert.notEqual(GROUP_A_ID, ASSET_A_ID)
assert.notEqual(VIDEO_A_ID, VIDEO_B_ID)

const LOCK_REASON = '配置尚未就绪，暂时不能修改资产'
const REFRESH_GROUPS_REASON = '正在刷新资产组，请稍候'
const REFRESH_ASSETS_REASON = '正在刷新资产列表，请稍候'
const SUBMIT_REASON = '正在提交资产请求，请稍候'
const FILTER_PLACEHOLDER = '组编号，或左侧点选一行'

const filterUrl = new URL('../src/components/sd2/Sd2AssetFilter.vue', import.meta.url)
const groupUrl = new URL('../src/components/sd2/Sd2AssetGroupList.vue', import.meta.url)
const listUrl = new URL('../src/components/sd2/Sd2AssetList.vue', import.meta.url)
const dialogsUrl = new URL('../src/components/sd2/Sd2AssetDialogs.vue', import.meta.url)
const introUrl = new URL('../src/components/sd2/Sd2AssetIntro.vue', import.meta.url)
const formUrl = new URL('../src/components/sd2/Sd2AssetConnectionForm.vue', import.meta.url)
const lastResponseUrl = new URL('../src/components/sd2/Sd2AssetLastResponse.vue', import.meta.url)

function readSource(url) {
  return readFileSync(url, 'utf8').replace(/\r\n?/g, '\n')
}

const filterCompiled = compileSfc(filterUrl, 'sd2-asset-filter-component')
const Sd2AssetFilter = (await import(filterCompiled)).default
const Sd2AssetGroupList = await loadCompiledSfc(groupUrl, 'sd2-asset-group-list-component', new Map([['vue', vueUrl]]))
const Sd2AssetList = await loadCompiledSfc(listUrl, 'sd2-asset-list-component', new Map([
  ['vue', vueUrl],
  ['./Sd2AssetFilter.vue', filterCompiled],
]))
const Sd2AssetDialogs = await loadCompiledSfc(dialogsUrl, 'sd2-asset-dialogs-component', new Map([['vue', vueUrl]]))
const Sd2AssetIntro = await loadCompiledSfc(introUrl, 'sd2-asset-intro-component', new Map([['vue', vueUrl]]))
const Sd2AssetConnectionForm = await loadCompiledSfc(formUrl, 'sd2-asset-connection-form-component', new Map([['vue', vueUrl]]))
const Sd2AssetLastResponse = await loadCompiledSfc(lastResponseUrl, 'sd2-asset-last-response-component', new Map([['vue', vueUrl]]))

const renderer = createHostRenderer()
const TABLE_ROW_KEY = 'sd2-asset-table-row'

function createTableStubs() {
  const ElTableStub = defineComponent({
    name: 'ElTableStub',
    inheritAttrs: false,
    props: ['data', 'stripe', 'size', 'highlightCurrentRow', 'maxHeight'],
    setup(props, { slots, attrs }) {
      return () => {
        const rows = Array.isArray(props.data) ? props.data : []
        return h('div', { class: 'el-table', 'data-el-table': 'true' }, rows.map((row, index) => (
          h(defineComponent({
            name: 'ElTableRowStub',
            setup() {
              provide(TABLE_ROW_KEY, row)
              return () => h('div', {
                class: 'el-table__row',
                'data-row-id': row.Id,
                onClick: () => attrs.onCurrentChange?.(row),
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

function buttonIn(node, label) {
  return findAll(node, (item) => item.type === 'button' && textContent(item).replace(/\s+/g, ' ').trim() === label)[0]
}

function rowById(root, id) {
  return findAll(root, (node) => node.props?.['data-row-id'] === id)[0]
}

function inputByPlaceholder(root, placeholder) {
  return findAll(root, (node) => node.type === 'input' && node.props?.placeholder === placeholder)[0]
}

function dialogByTitle(root, title) {
  return findAll(root, (node) => node.type === 'dialog' && node.props?.['data-title'] === title)[0]
}

function setInput(node, value) {
  node.props.onInput?.({ target: { value } })
}

function handlers(names) {
  const events = []
  const props = {}
  for (const name of names) {
    props[name] = (...args) => { events.push([name, ...args]) }
  }
  return { events, props }
}

function mountFilter(initial = '') {
  const assetGroupIdInput = ref(initial)
  const mounted = mountHarness(renderer, () => h(Sd2AssetFilter, {
    modelValue: assetGroupIdInput.value,
    'onUpdate:modelValue': (value) => { assetGroupIdInput.value = value },
  }))
  return { ...mounted, assetGroupIdInput }
}

function mountGroupList(initial = {}) {
  const { events, props } = handlers(['refreshGroups', 'openCreateGroup', 'getGroupDetail', 'openEditGroup', 'deleteGroup', 'onGroupRowChange'])
  const mounted = mountHarness(renderer, () => h(Sd2AssetGroupList, {
    groupRows: initial.groupRows ?? [],
    loadingGroups: Boolean(initial.loadingGroups),
    mutationLocked: Boolean(initial.mutationLocked),
    mutationLockReason: initial.mutationLocked ? LOCK_REASON : undefined,
    refreshGroupsLockReason: initial.loadingGroups ? REFRESH_GROUPS_REASON : undefined,
    ...props,
  }), { components: createTableStubs() })
  return { ...mounted, events }
}

function mountAssetList(initial = {}) {
  const assetGroupIdInput = ref(initial.assetGroupIdInput ?? '')
  const { events, props } = handlers(['refreshAssets', 'openCreateAsset', 'getAssetDetail', 'openEditAsset', 'deleteAsset'])
  const mounted = mountHarness(renderer, () => h(Sd2AssetList, {
    assetGroupIdInput: assetGroupIdInput.value,
    'onUpdate:assetGroupIdInput': (value) => { assetGroupIdInput.value = value },
    assetRows: initial.assetRows ?? [],
    loadingAssets: Boolean(initial.loadingAssets),
    mutationLocked: Boolean(initial.mutationLocked),
    mutationLockReason: initial.mutationLocked ? LOCK_REASON : undefined,
    refreshAssetsLockReason: initial.loadingAssets ? REFRESH_ASSETS_REASON : undefined,
    ...props,
  }), { components: createTableStubs() })
  return { ...mounted, events, assetGroupIdInput }
}

function mountDialogs(initial = {}) {
  const { events, props } = handlers(['submitCreateGroup', 'submitUpdateGroup', 'submitCreateAsset', 'submitUpdateAsset'])
  const state = {
    dlgGroupCreate: ref(Boolean(initial.dlgGroupCreate)),
    formGroupName: ref(initial.formGroupName ?? ''),
    formGroupExtraJson: ref(initial.formGroupExtraJson ?? ''),
    dlgGroupEdit: ref(Boolean(initial.dlgGroupEdit)),
    editGroupId: ref(initial.editGroupId ?? ''),
    editGroupName: ref(initial.editGroupName ?? ''),
    editGroupFullJson: ref(initial.editGroupFullJson ?? ''),
    dlgAssetCreate: ref(Boolean(initial.dlgAssetCreate)),
    formAssetGroupId: ref(initial.formAssetGroupId ?? ''),
    formAssetName: ref(initial.formAssetName ?? ''),
    formAssetType: ref(initial.formAssetType ?? 'Image'),
    formAssetModel: ref(initial.formAssetModel ?? ''),
    formAssetUrl: ref(initial.formAssetUrl ?? ''),
    dlgAssetEdit: ref(Boolean(initial.dlgAssetEdit)),
    editAssetId: ref(initial.editAssetId ?? ''),
    editAssetName: ref(initial.editAssetName ?? ''),
    editAssetFullJson: ref(initial.editAssetFullJson ?? ''),
    dlgDetail: ref(Boolean(initial.dlgDetail)),
    detailJson: ref(initial.detailJson ?? ''),
  }
  const mounted = mountHarness(renderer, () => h(Sd2AssetDialogs, {
    dlgGroupCreate: state.dlgGroupCreate.value,
    'onUpdate:dlgGroupCreate': (value) => { state.dlgGroupCreate.value = value },
    formGroupName: state.formGroupName.value,
    'onUpdate:formGroupName': (value) => { state.formGroupName.value = value },
    formGroupExtraJson: state.formGroupExtraJson.value,
    'onUpdate:formGroupExtraJson': (value) => { state.formGroupExtraJson.value = value },
    dlgGroupEdit: state.dlgGroupEdit.value,
    'onUpdate:dlgGroupEdit': (value) => { state.dlgGroupEdit.value = value },
    editGroupId: state.editGroupId.value,
    'onUpdate:editGroupId': (value) => { state.editGroupId.value = value },
    editGroupName: state.editGroupName.value,
    'onUpdate:editGroupName': (value) => { state.editGroupName.value = value },
    editGroupFullJson: state.editGroupFullJson.value,
    'onUpdate:editGroupFullJson': (value) => { state.editGroupFullJson.value = value },
    dlgAssetCreate: state.dlgAssetCreate.value,
    'onUpdate:dlgAssetCreate': (value) => { state.dlgAssetCreate.value = value },
    formAssetGroupId: state.formAssetGroupId.value,
    'onUpdate:formAssetGroupId': (value) => { state.formAssetGroupId.value = value },
    formAssetName: state.formAssetName.value,
    'onUpdate:formAssetName': (value) => { state.formAssetName.value = value },
    formAssetType: state.formAssetType.value,
    'onUpdate:formAssetType': (value) => { state.formAssetType.value = value },
    formAssetModel: state.formAssetModel.value,
    'onUpdate:formAssetModel': (value) => { state.formAssetModel.value = value },
    formAssetUrl: state.formAssetUrl.value,
    'onUpdate:formAssetUrl': (value) => { state.formAssetUrl.value = value },
    dlgAssetEdit: state.dlgAssetEdit.value,
    'onUpdate:dlgAssetEdit': (value) => { state.dlgAssetEdit.value = value },
    editAssetId: state.editAssetId.value,
    'onUpdate:editAssetId': (value) => { state.editAssetId.value = value },
    editAssetName: state.editAssetName.value,
    'onUpdate:editAssetName': (value) => { state.editAssetName.value = value },
    editAssetFullJson: state.editAssetFullJson.value,
    'onUpdate:editAssetFullJson': (value) => { state.editAssetFullJson.value = value },
    dlgDetail: state.dlgDetail.value,
    'onUpdate:dlgDetail': (value) => { state.dlgDetail.value = value },
    detailJson: state.detailJson.value,
    'onUpdate:detailJson': (value) => { state.detailJson.value = value },
    dlgLoading: Boolean(initial.dlgLoading),
    submitLockReason: initial.submitLockReason,
    ...props,
  }), {
    components: {
      AccessibleDialog: AccessibleDialogStub,
      ...createFormStubs(),
    },
  })
  return { ...mounted, events, state }
}

test('\u5b50\u7ec4\u4ef6\u4e0d\u62bd AI \u914d\u7f6e loadList / openTest\uff0c\u4e5f\u4e0d\u76f4\u63a5\u8c03 aiAPI', () => {
  for (const [name, source] of [
    ['filter', readSource(filterUrl)],
    ['groupList', readSource(groupUrl)],
    ['assetList', readSource(listUrl)],
    ['dialogs', readSource(dialogsUrl)],
    ['intro', readSource(introUrl)],
    ['connectionForm', readSource(formUrl)],
    ['lastResponse', readSource(lastResponseUrl)],
  ]) {
    assert.doesNotMatch(source, /async function loadList\(/, `${name} \u4e0d\u5e94\u62bd loadList`)
    assert.doesNotMatch(source, /async function openTest\(/, `${name} \u4e0d\u5e94\u62bd openTest`)
    assert.doesNotMatch(source, /aiAPI\./, `${name} \u4e0d\u5e94\u8c03 aiAPI`)
    assert.doesNotMatch(source, /from ['"]element-plus['"]/)
  }
})

test('\u7ec4\u7f16\u53f7\u7b5b\u9009\u4f1a\u5199\u56de\u7236\u7ea7\uff0c\u800c\u4e0d\u81ea\u5df1\u53bb\u62c9\u5217\u8868', async () => {
  const harness = mountFilter('')
  try {
    await nextTick()
    const input = inputByPlaceholder(harness.root, FILTER_PLACEHOLDER)
    assert.ok(input, '\u7f3a\u5c11\u7ec4\u7f16\u53f7\u7b5b\u9009\u8f93\u5165')
    setInput(input, GROUP_A_ID)
    await nextTick()
    assert.equal(harness.assetGroupIdInput.value, GROUP_A_ID)
    assert.notEqual(harness.assetGroupIdInput.value, GROUP_B_ID)
  } finally {
    harness.app.unmount()
  }
})

test('\u8d44\u4ea7\u7ec4\u5217\u8868\u70b9\u9009\u548c\u8be6\u60c5\u8d70\u5bf9\u5e94\u884c\uff0c\u5199\u9501\u65f6\u7f16\u8f91\u5220\u9664\u7981\u7528\u5e76\u7ed9\u51fa\u4e2d\u6587\u539f\u56e0', async () => {
  const rowA = { Id: GROUP_A_ID, Name: 'A-group' }
  const rowB = { Id: GROUP_B_ID, Name: 'B-group' }
  const harness = mountGroupList({
    groupRows: [rowA, rowB],
    mutationLocked: true,
    loadingGroups: true,
  })
  try {
    await nextTick()
    assert.match(textContent(harness.root), /资产组/)
    assert.match(textContent(harness.root), new RegExp(GROUP_A_ID))
    assert.match(textContent(harness.root), new RegExp(GROUP_B_ID))
    const refresh = buttonByText(harness.root, '刷新资产组列表')
    const created = buttonByText(harness.root, '新建资产组')
    assert.equal(refresh.props.disabled, true)
    assert.equal(refresh.props.title, REFRESH_GROUPS_REASON)
    assert.equal(created.props.disabled, true)
    assert.equal(created.props.title, LOCK_REASON)

    const rowNode = rowById(harness.root, GROUP_A_ID)
    const otherRow = rowById(harness.root, GROUP_B_ID)
    const detailButton = buttonIn(rowNode, '详情')
    const editButton = buttonIn(rowNode, '编辑')
    const deleteButton = buttonIn(rowNode, '删除')
    assert.equal(editButton.props.disabled, true)
    assert.equal(editButton.props.title, LOCK_REASON)
    assert.equal(deleteButton.props.disabled, true)
    assert.equal(deleteButton.props.title, LOCK_REASON)
    assert.notEqual(detailButton.props.disabled, true)
    click(detailButton)
    click(rowNode)
    assert.equal(harness.events[0][0], 'getGroupDetail')
    assert.equal(harness.events[0][1].Id, GROUP_A_ID)
    assert.notEqual(harness.events[0][1].Id, GROUP_B_ID)
    assert.equal(harness.events[1][0], 'onGroupRowChange')
    assert.equal(harness.events[1][1].Id, GROUP_A_ID)
    assert.notEqual(buttonIn(otherRow, '详情').props.disabled, true)
  } finally {
    harness.app.unmount()
  }
})

test('\u8d44\u4ea7\u5217\u8868\u628a Image \u663e\u793a\u6210\u56fe\u7247\uff0c\u5199\u9501\u65f6\u4ecd\u53ef\u770b\u8be6\u60c5', async () => {
  const rowA = { Id: ASSET_A_ID, Name: 'poster', AssetType: 'Image' }
  const rowB = { Id: ASSET_B_ID, Name: 'clip', AssetType: 'Video' }
  const harness = mountAssetList({
    assetRows: [rowA, rowB],
    mutationLocked: true,
    loadingAssets: true,
    assetGroupIdInput: GROUP_B_ID,
  })
  try {
    await nextTick()
    assert.match(textContent(harness.root), /资产（需组编号）/)
    assert.match(textContent(rowById(harness.root, ASSET_A_ID)), /图片/)
    assert.match(textContent(rowById(harness.root, ASSET_B_ID)), /视频/)
    assert.doesNotMatch(textContent(rowById(harness.root, ASSET_A_ID)), />Image</)
    const refresh = buttonByText(harness.root, '刷新资产列表')
    const created = buttonByText(harness.root, '新建资产')
    assert.equal(refresh.props.disabled, true)
    assert.equal(refresh.props.title, REFRESH_ASSETS_REASON)
    assert.equal(created.props.disabled, true)
    assert.equal(created.props.title, LOCK_REASON)
    const input = inputByPlaceholder(harness.root, FILTER_PLACEHOLDER)
    assert.equal(input.props.value, GROUP_B_ID)
    setInput(input, GROUP_A_ID)
    await nextTick()
    assert.equal(harness.assetGroupIdInput.value, GROUP_A_ID)
    assert.notEqual(harness.assetGroupIdInput.value, GROUP_B_ID)
    click(buttonIn(rowById(harness.root, ASSET_A_ID), '详情'))
    assert.equal(harness.events[0][0], 'getAssetDetail')
    assert.equal(harness.events[0][1].Id, ASSET_A_ID)
    assert.notEqual(harness.events[0][1].Id, ASSET_B_ID)
    const editButton = buttonIn(rowById(harness.root, ASSET_A_ID), '编辑')
    assert.equal(editButton.props.disabled, true)
    assert.equal(editButton.props.title, LOCK_REASON)
  } finally {
    harness.app.unmount()
  }
})

test('\u521b\u5efa\u8d44\u4ea7\u7ec4\u5bf9\u8bdd\u6846\u63d0\u4ea4\u548c\u53d6\u6d88\u8d70\u7236\u7ea7\uff0c\u5199\u9501\u7ed9\u51fa\u4e2d\u6587\u539f\u56e0', async () => {
  const locked = mountDialogs({
    dlgGroupCreate: true,
    dlgLoading: true,
    submitLockReason: LOCK_REASON,
  })
  try {
    await nextTick()
    const dialog = dialogByTitle(locked.root, '创建资产组')
    assert.ok(dialog)
    const submitButton = buttonIn(dialog, '提交')
    const cancelButton = buttonIn(dialog, '取消')
    assert.equal(submitButton.props.disabled, true)
    assert.equal(submitButton.props.title, LOCK_REASON)
    assert.equal(cancelButton.props.disabled, true)
    assert.equal(cancelButton.props.title, SUBMIT_REASON)
  } finally {
    locked.app.unmount()
  }

  const harness = mountDialogs({ dlgGroupCreate: true })
  try {
    await nextTick()
    const dialog = dialogByTitle(harness.root, '创建资产组')
    click(buttonIn(dialog, '提交'))
    assert.equal(harness.events.length, 1)
    assert.equal(harness.events[0][0], 'submitCreateGroup')
    click(buttonIn(dialog, '取消'))
    await nextTick()
    assert.equal(harness.state.dlgGroupCreate.value, false)
  } finally {
    harness.app.unmount()
  }
})

test('\u521b\u5efa\u8d44\u4ea7\u5bf9\u8bdd\u6846\u7c7b\u578b\u9009\u9879\u662f\u56fe\u7247\u89c6\u9891\u97f3\u9891\uff0c\u6807\u8bc6\u4e0d\u53ef\u6539', async () => {
  const createHarness = mountDialogs({
    dlgAssetCreate: true,
    formAssetGroupId: GROUP_A_ID,
    formAssetType: 'Image',
  })
  try {
    await nextTick()
    const dialog = dialogByTitle(createHarness.root, '创建资产')
    assert.ok(dialog)
    assert.match(textContent(dialog), /图片/)
    assert.match(textContent(dialog), /视频/)
    assert.match(textContent(dialog), /音频/)
    assert.doesNotMatch(textContent(dialog), /<option[^>]*>Image</)
    const options = findAll(dialog, (node) => node.type === 'option')
    assert.deepEqual(options.map((node) => node.props.value), ['Image', 'Video', 'Audio'])
    click(buttonIn(dialog, '提交'))
    assert.equal(createHarness.events.length, 1)
    assert.equal(createHarness.events[0][0], 'submitCreateAsset')
  } finally {
    createHarness.app.unmount()
  }

  const editHarness = mountDialogs({
    dlgAssetEdit: true,
    editAssetId: ASSET_A_ID,
    dlgGroupEdit: true,
    editGroupId: GROUP_A_ID,
  })
  try {
    await nextTick()
    const groupDialog = dialogByTitle(editHarness.root, '更新资产组')
    const assetDialog = dialogByTitle(editHarness.root, '更新资产')
    assert.match(textContent(groupDialog), /按官方文档填写需更新的字段；以下为常用名称修改。/)
    const groupIdInput = findAll(groupDialog, (node) => node.type === 'input' && node.props.title === '已保存的资产组标识不能修改')[0]
    const assetIdInput = findAll(assetDialog, (node) => node.type === 'input' && node.props.title === '已保存的资产标识不能修改')[0]
    assert.ok(groupIdInput)
    assert.ok(assetIdInput)
    assert.equal(groupIdInput.props.title, '已保存的资产组标识不能修改')
    assert.equal(assetIdInput.props.title, '已保存的资产标识不能修改')
    assert.equal(groupIdInput.props.value, GROUP_A_ID)
    assert.equal(assetIdInput.props.value, ASSET_A_ID)
    assert.notEqual(groupIdInput.props.value, assetIdInput.props.value)
  } finally {
    editHarness.app.unmount()
  }
})
const SAVE_REASON = '正在保存到 AI 配置，请稍候'

function inputByAriaLabel(root, label) {
  return findAll(root, (node) => node.type === 'input' && node.props?.['aria-label'] === label)[0]
}

function selectByAriaLabel(root, label) {
  return findAll(root, (node) => node.type === 'select' && node.props?.['aria-label'] === label)[0]
}

const ElAlertWithTitleSlot = defineComponent({
  name: 'ElAlertStub',
  props: ['type', 'title', 'showIcon', 'closable'],
  setup(props, { slots }) {
    return () => h('alert', {
      'data-type': props.type || '',
      role: props.type === 'error' ? 'alert' : 'status',
    }, [slots.title?.() || props.title || '', slots.default?.()])
  },
})

const ChangeableSelectStub = defineComponent({
  name: 'ElSelectStub',
  inheritAttrs: false,
  props: ['modelValue', 'filterable', 'clearable', 'placeholder'],
  emits: ['update:modelValue', 'change'],
  setup(props, { emit, slots, attrs }) {
    return () => h('select', {
      value: props.modelValue ?? '',
      placeholder: props.placeholder,
      'aria-label': attrs['aria-label'],
      onChange: (event) => {
        const raw = event?.target ? event.target.value : event
        emit('update:modelValue', raw)
        emit('change', raw)
      },
    }, slots.default?.())
  },
})

function mountIntro() {
  return mountHarness(renderer, () => h(Sd2AssetIntro), {
    components: {
      ElAlert: ElAlertWithTitleSlot,
      'el-alert': ElAlertWithTitleSlot,
    },
  })
}

function mountLastResponse(initial = '') {
  const lastRawJson = ref(initial)
  const mounted = mountHarness(renderer, () => h(Sd2AssetLastResponse, {
    modelValue: lastRawJson.value,
    'onUpdate:modelValue': (value) => { lastRawJson.value = value },
  }))
  return { ...mounted, lastRawJson }
}

function mountConnectionForm(initial = {}) {
  const { events, props } = handlers(['saveToAiConfig', 'onFillFromSaved'])
  const state = {
    baseUrl: ref(initial.baseUrl ?? ''),
    apiKey: ref(initial.apiKey ?? ''),
    pathMode: ref(initial.pathMode ?? 'open_api_query'),
    apiVersion: ref(initial.apiVersion ?? '2024-01-01'),
    projectName: ref(initial.projectName ?? ''),
    authMode: ref(initial.authMode ?? 'volc_sign'),
    accessKeyId: ref(initial.accessKeyId ?? ''),
    secretAccessKey: ref(initial.secretAccessKey ?? ''),
    signRegion: ref(initial.signRegion ?? ''),
    billingModel: ref(initial.billingModel ?? ''),
    fillConfigId: ref(initial.fillConfigId ?? null),
    assetGroupIdForCert: ref(initial.assetGroupIdForCert ?? ''),
  }
  const mounted = mountHarness(renderer, () => h(Sd2AssetConnectionForm, {
    baseUrl: state.baseUrl.value,
    'onUpdate:baseUrl': (value) => { state.baseUrl.value = value },
    apiKey: state.apiKey.value,
    'onUpdate:apiKey': (value) => { state.apiKey.value = value },
    pathMode: state.pathMode.value,
    'onUpdate:pathMode': (value) => { state.pathMode.value = value },
    apiVersion: state.apiVersion.value,
    'onUpdate:apiVersion': (value) => { state.apiVersion.value = value },
    projectName: state.projectName.value,
    'onUpdate:projectName': (value) => { state.projectName.value = value },
    authMode: state.authMode.value,
    'onUpdate:authMode': (value) => { state.authMode.value = value },
    accessKeyId: state.accessKeyId.value,
    'onUpdate:accessKeyId': (value) => { state.accessKeyId.value = value },
    secretAccessKey: state.secretAccessKey.value,
    'onUpdate:secretAccessKey': (value) => { state.secretAccessKey.value = value },
    signRegion: state.signRegion.value,
    'onUpdate:signRegion': (value) => { state.signRegion.value = value },
    billingModel: state.billingModel.value,
    'onUpdate:billingModel': (value) => { state.billingModel.value = value },
    fillConfigId: state.fillConfigId.value,
    'onUpdate:fillConfigId': (value) => { state.fillConfigId.value = value },
    assetGroupIdForCert: state.assetGroupIdForCert.value,
    'onUpdate:assetGroupIdForCert': (value) => { state.assetGroupIdForCert.value = value },
    videoLikeConfigs: initial.videoLikeConfigs ?? [],
    savedConfigId: initial.savedConfigId ?? null,
    savingConfig: Boolean(initial.savingConfig),
    saveLockReason: initial.saveLockReason,
    ...props,
  }), {
    components: {
      ...createFormStubs(),
      ElSelect: ChangeableSelectStub,
      'el-select': ChangeableSelectStub,
    },
  })
  return { ...mounted, events, state }
}

test('说明文案走认证资产库，不抽 AI 配置 loadList / openTest', async () => {
  const harness = mountIntro()
  try {
    await nextTick()
    const visible = textContent(harness.root)
    assert.match(visible, /私有资产库/)
    assert.match(visible, /保存到 AI 配置/)
    assert.match(visible, /创作页「认证资产」将优先使用/)
    assert.match(visible, /创建资产组/)
    assert.doesNotMatch(visible, /SD2\s*认证/)
    const links = findAll(harness.root, (node) => node.type === 'a')
    assert.ok(links.some((node) => String(node.props?.href || '').includes('2318270')))
  } finally {
    harness.app.unmount()
  }
})

test('最近一次响应只展示调试 JSON，不自己发请求', async () => {
  const payloadA = '{"Id":"asset-alpha-31"}'
  const payloadB = '{"Id":"asset-beta-42"}'
  assert.notEqual(payloadA, payloadB)
  const harness = mountLastResponse(payloadA)
  try {
    await nextTick()
    assert.match(textContent(harness.root), /最近一次响应（调试）/)
    const input = inputByAriaLabel(harness.root, '最近一次响应（调试）')
    assert.ok(input, '缺少最近一次响应输入')
    assert.equal(input.props.value, payloadA)
    assert.notEqual(input.props.value, payloadB)
    assert.equal(input.props['aria-label'], '最近一次响应（调试）')
  } finally {
    harness.app.unmount()
  }
})

test('连接表单鉴权与路径切换走父级绑定，写锁给出中文原因', async () => {
  const locked = mountConnectionForm({
    authMode: 'volc_sign',
    pathMode: 'open_api_query',
    saveLockReason: SAVE_REASON,
    savingConfig: true,
    savedConfigId: VIDEO_A_ID,
  })
  try {
    await nextTick()
    assert.match(textContent(locked.root), /访问密钥 ID/)
    assert.match(textContent(locked.root), /工程 \/ 项目名/)
    assert.doesNotMatch(textContent(locked.root), /推理用 ARK \/ 中转 API 密钥/)
    assert.match(textContent(locked.root), new RegExp(`已关联配置 #${VIDEO_A_ID}`))
    assert.doesNotMatch(textContent(locked.root), new RegExp(`已关联配置 #${VIDEO_B_ID}`))
    const saveButton = buttonByText(locked.root, '保存到 AI 配置')
    assert.equal(saveButton.props.disabled, true)
    assert.equal(saveButton.props.title, SAVE_REASON)
  } finally {
    locked.app.unmount()
  }

  const harness = mountConnectionForm({
    authMode: 'volc_sign',
    pathMode: 'open_api_query',
  })
  try {
    await nextTick()
    const radios = findAll(harness.root, (node) => node.type === 'radio-group')[0]
    radios.props.onSelect('bearer')
    await nextTick()
    assert.equal(harness.state.authMode.value, 'bearer')
    assert.notEqual(harness.state.authMode.value, 'volc_sign')
    assert.match(textContent(harness.root), /API 密钥/)
    assert.doesNotMatch(textContent(harness.root), /访问密钥 ID/)

    const pathSelect = selectByAriaLabel(harness.root, '路径模式')
    pathSelect.props.onChange('flat')
    await nextTick()
    assert.equal(harness.state.pathMode.value, 'flat')
    assert.notEqual(harness.state.pathMode.value, 'open_api_query')
    assert.doesNotMatch(textContent(harness.root), /工程 \/ 项目名/)

    click(buttonByText(harness.root, '保存到 AI 配置'))
    assert.equal(harness.events.length, 1)
    assert.equal(harness.events[0][0], 'saveToAiConfig')
  } finally {
    harness.app.unmount()
  }
})

test('从配置填入只提交选中的视频配置编号，组编号写回父级', async () => {
  const configs = [
    { id: VIDEO_A_ID, name: '火山A', base_url: 'https://ark.example/a' },
    { id: VIDEO_B_ID, name: '火山B', base_url: 'https://volces.com/b' },
  ]
  const harness = mountConnectionForm({
    videoLikeConfigs: configs,
    assetGroupIdForCert: GROUP_B_ID,
  })
  try {
    await nextTick()
    const options = findAll(harness.root, (node) => node.type === 'option')
    const values = options.map((node) => node.props.value)
    assert.ok(values.includes(VIDEO_A_ID))
    assert.ok(values.includes(VIDEO_B_ID))
    assert.equal(values.filter((value) => value === VIDEO_A_ID || value === VIDEO_B_ID).length, 2)
    const fillSelect = selectByAriaLabel(harness.root, '从配置填入')
    fillSelect.props.onChange(VIDEO_A_ID)
    await nextTick()
    assert.equal(harness.events.length, 1)
    assert.equal(harness.events[0][0], 'onFillFromSaved')
    assert.equal(harness.events[0][1], VIDEO_A_ID)
    assert.notEqual(harness.events[0][1], VIDEO_B_ID)

    const groupInput = inputByAriaLabel(harness.root, '默认资产组编号')
    assert.equal(groupInput.props.value, GROUP_B_ID)
    setInput(groupInput, GROUP_A_ID)
    await nextTick()
    assert.equal(harness.state.assetGroupIdForCert.value, GROUP_A_ID)
    assert.notEqual(harness.state.assetGroupIdForCert.value, GROUP_B_ID)
  } finally {
    harness.app.unmount()
  }
})
