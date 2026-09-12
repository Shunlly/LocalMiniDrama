import test from 'node:test'
import assert from 'node:assert/strict'

import { defineComponent, h, nextTick, reactive, ref } from 'vue'

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
import { AccessibleDialogStub } from './helpers/accessibleDialogStub.js'

const dialogUrl = new URL('../src/components/aiConfig/AiConfigFormDialog.vue', import.meta.url)
const labelsUrl = new URL('../src/utils/aiConfigLabels.js', import.meta.url).href
const iconStubUrl = compileIconStub(['QuestionFilled'])
const helpStubUrl = dataModule(`
  import { defineComponent, h } from ${JSON.stringify(vueUrl)}
  export default defineComponent({
    name: 'AiConfigPresetHelpStub',
    setup() {
      return () => h('div', { 'data-testid': 'ai-config-preset-help-stub' }, '接口规范帮助内容')
    },
  })
`)

function compileSection(fileName, extra = []) {
  return compileSfc(
    new URL(`../src/components/aiConfig/${fileName}`, import.meta.url),
    `ai-config-form-${fileName}`,
    new Map([
      ['vue', vueUrl],
      ['@element-plus/icons-vue', iconStubUrl],
      ['@/utils/aiConfigLabels.js', labelsUrl],
      ...extra,
    ]),
  )
}

const compiledModelList = compileSection('AiConfigModelListSection.vue')
const compiledLock = compileSection('AiConfigFormLockSection.vue')
const compiledBasic = compileSection('AiConfigFormBasicSection.vue')
const compiledVendor = compileSection('AiConfigFormVendorSection.vue')
const compiledEndpoint = compileSection('AiConfigFormEndpointSection.vue', [
  ['@/components/aiConfig/AiConfigPresetHelpCollapse.vue', helpStubUrl],
])
const compiledModel = compileSection('AiConfigFormModelSection.vue', [
  ['@/components/aiConfig/AiConfigModelListSection.vue', compiledModelList],
])
const compiledPolicy = compileSection('AiConfigFormPolicySection.vue')
const AiConfigFormDialog = await loadCompiledSfc(
  dialogUrl,
  'ai-config-form-dialog-lock-mode-component',
  new Map([
    ['vue', vueUrl],
    ['@element-plus/icons-vue', iconStubUrl],
    ['@/utils/aiConfigLabels.js', labelsUrl],
    ['@/components/aiConfig/AiConfigFormLockSection.vue', compiledLock],
    ['@/components/aiConfig/AiConfigFormBasicSection.vue', compiledBasic],
    ['@/components/aiConfig/AiConfigFormVendorSection.vue', compiledVendor],
    ['@/components/aiConfig/AiConfigFormEndpointSection.vue', compiledEndpoint],
    ['@/components/aiConfig/AiConfigFormModelSection.vue', compiledModel],
    ['@/components/aiConfig/AiConfigFormPolicySection.vue', compiledPolicy],
  ]),
)

const renderer = createHostRenderer()
const WRITE_LOCK_REASON = '配置列表尚未就绪'

const ElFormStub = defineComponent({
  name: 'ElFormStub',
  setup(_props, { slots, attrs }) {
    return () => h('form', { ...attrs }, slots.default?.())
  },
})

const ElFormItemStub = defineComponent({
  name: 'ElFormItemStub',
  props: ['label', 'prop'],
  setup(props, { slots }) {
    return () => h('div', { 'data-el': 'el-form-item', 'data-prop': props.prop || '' }, [
      slots.label?.() || (props.label ? h('span', props.label) : null),
      slots.default?.(),
    ])
  },
})

const ElSwitchStub = defineComponent({
  name: 'ElSwitchStub',
  props: ['modelValue', 'disabled'],
  setup(props, { attrs }) {
    return () => h('input', {
      ...attrs,
      type: 'checkbox',
      role: 'switch',
      checked: Boolean(props.modelValue),
      disabled: Boolean(props.disabled),
    })
  },
})

const ElDescriptionsStub = defineComponent({
  name: 'ElDescriptionsStub',
  setup(_props, { slots }) {
    return () => h('dl', { 'data-el': 'el-descriptions' }, slots.default?.())
  },
})

const ElDescriptionsItemStub = defineComponent({
  name: 'ElDescriptionsItemStub',
  props: ['label'],
  setup(props, { slots }) {
    return () => h('div', { 'data-label': props.label || '' }, [
      props.label,
      slots.default?.(),
    ])
  },
})

function passthroughStub(name) {
  return defineComponent({
    name,
    setup(_props, { slots }) {
      return () => h('div', { 'data-el': name }, slots.default?.())
    },
  })
}

const ElCollapseStub = passthroughStub('ElCollapseStub')
const ElCollapseItemStub = passthroughStub('ElCollapseItemStub')
const ElOptionGroupStub = passthroughStub('ElOptionGroupStub')

function fieldByName(root, name) {
  return findAll(root, (node) => node.props?.['data-ai-config-field'] === name)[0]
}

function sampleForm(overrides = {}) {
  return {
    name: '锁定文本配置',
    service_type: 'text',
    provider: 'deepseek',
    api_key: 'sk-lock',
    default_model: 'deepseek-v4-flash',
    is_default: true,
    ...overrides,
  }
}

function noop() {}

function mountDialog(initial = {}) {
  const events = []
  const dialogVisible = ref(initial.dialogVisible ?? true)
  const form = reactive(sampleForm(initial.form))
  const vendorLock = initial.vendorLock ?? { enabled: true }
  const mounted = mountHarness(renderer, () => h(AiConfigFormDialog, {
    vendorLock,
    editingId: initial.editingId === undefined ? null : initial.editingId,
    configValidationSummary: initial.configValidationSummary ?? [],
    configWriteLocked: Boolean(initial.configWriteLocked),
    configWriteLockReason: initial.configWriteLockReason ?? '',
    saving: Boolean(initial.saving),
    defaultModelRules: initial.defaultModelRules ?? [],
    rules: initial.rules ?? {},
    formModelList: initial.formModelList ?? ['deepseek-v4-flash', 'deepseek-v4-pro'],
    isDefaultModelUnavailable: Boolean(initial.isDefaultModelUnavailable),
    isComfyUiForm: Boolean(initial.isComfyUiForm),
    isDeepSeekOfficialForm: Boolean(initial.isDeepSeekOfficialForm),
    availableProviderOptions: initial.availableProviderOptions ?? [],
    endpointPreviewInfo: initial.endpointPreviewInfo ?? null,
    jimeng2AssetsLoading: false,
    availableModels: initial.availableModels ?? [],
    discoverModelsLoading: false,
    discoverModelsDisabled: false,
    discoverModelsDisabledReason: '',
    providerModelEmptyHint: '',
    canConfigureLocalHttp: Boolean(initial.canConfigureLocalHttp),
    confirmConfigDialogClose: () => events.push(['confirm-close']),
    handleConfigDialogClosed: () => events.push(['closed']),
    requestConfigDialogClose: () => events.push(['request-close']),
    submit: () => events.push(['submit']),
    handleConfigFieldValidated: noop,
    isConfigFieldInvalid: initial.isConfigFieldInvalid ?? (() => false),
    configFieldDescriptionId: (prop) => `ai-config-${prop}-desc`,
    configFieldDescription: (prop) => `${prop} 说明`,
    onServiceTypeChange: (...args) => events.push(['service-type', ...args]),
    onProviderChange: (...args) => events.push(['provider', ...args]),
    onDefaultModelChange: (...args) => events.push(['default-model', ...args]),
    openJimeng2MaterialAssetsDialog: () => events.push(['open-assets']),
    setModelListInputRef: noop,
    discoverModelsFromService: () => events.push(['discover-models']),
    onPresetModelSelect: noop,
    dialogVisible: dialogVisible.value,
    'onUpdate:dialogVisible': (value) => {
      dialogVisible.value = value
    },
    form,
    'onUpdate:form': (value) => {
      Object.assign(form, value || {})
    },
  }), {
    components: {
      AccessibleDialog: AccessibleDialogStub,
      ElForm: ElFormStub,
      'el-form': ElFormStub,
      ElFormItem: ElFormItemStub,
      'el-form-item': ElFormItemStub,
      ElSwitch: ElSwitchStub,
      'el-switch': ElSwitchStub,
      ElDescriptions: ElDescriptionsStub,
      'el-descriptions': ElDescriptionsStub,
      ElDescriptionsItem: ElDescriptionsItemStub,
      'el-descriptions-item': ElDescriptionsItemStub,
      ElCollapse: ElCollapseStub,
      'el-collapse': ElCollapseStub,
      ElCollapseItem: ElCollapseItemStub,
      'el-collapse-item': ElCollapseItemStub,
      ElOptionGroup: ElOptionGroupStub,
      'el-option-group': ElOptionGroupStub,
    },
  })
  return { ...mounted, events, dialogVisible, form }
}

test('锁定模式标题是修改密钥和默认模型，只渲染 api_key 与 default_model', async () => {
  const harness = mountDialog()
  try {
    await nextTick()
    const dialog = findAll(harness.root, (node) => node.type === 'dialog')[0]
    assert.ok(dialog)
    assert.equal(dialog.props['data-title'], '修改 API 密钥 / 默认模型')
    const text = textContent(harness.root)
    assert.match(text, /锁定文本配置/)
    assert.match(text, /文本/)
    assert.match(text, /deepseek/)
    assert.match(text, /API 密钥/)
    assert.match(text, /默认模型/)
    assert.match(text, /锁定模式下不能新增模型列表/)
    assert.ok(fieldByName(harness.root, 'api_key'), '缺少锁定模式密钥字段')
    assert.ok(fieldByName(harness.root, 'default_model'), '缺少锁定模式默认模型字段')
    assert.equal(fieldByName(harness.root, 'service_type'), undefined)
    assert.equal(fieldByName(harness.root, 'provider'), undefined)
    assert.doesNotMatch(text, /基础信息/)
    assert.doesNotMatch(text, /厂商与认证/)
    assert.equal(findAll(harness.root, (node) => node.props?.['data-testid'] === 'ai-config-preset-help-stub').length, 0)
    assert.equal(fieldByName(harness.root, 'api_key').props.placeholder, '输入你的 API 密钥')
    assert.equal(fieldByName(harness.root, 'default_model').props['aria-label'], '默认模型')
    assert.match(textContent(fieldByName(harness.root, 'default_model')), /deepseek-v4-flash/)
    assert.match(textContent(fieldByName(harness.root, 'default_model')), /deepseek-v4-pro/)
  } finally {
    harness.app.unmount()
  }
})

test('锁定模式下即梦密钥占位和失效默认模型都走中文提示', async () => {
  const jimeng = mountDialog({
    form: {
      name: '即梦锁定配置',
      service_type: 'image',
      provider: 'jimeng_ai_api',
      api_key: '',
      default_model: 'old-model',
    },
    formModelList: ['keep-model'],
    isDefaultModelUnavailable: true,
  })
  try {
    await nextTick()
    assert.notEqual('old-model', 'keep-model')
    assert.equal(fieldByName(jimeng.root, 'api_key').props.placeholder, '即梦 Session，多个用英文逗号分隔')
    const model = fieldByName(jimeng.root, 'default_model')
    assert.ok(model)
    assert.match(textContent(model), /old-model（已失效）/)
    assert.match(textContent(model), /keep-model/)
    assert.match(textContent(jimeng.root), /当前默认模型已不在模型列表中，请显式选择有效模型后保存/)
    assert.doesNotMatch(textContent(jimeng.root), /锁定模式下不能新增模型列表/)
    assert.equal(fieldByName(jimeng.root, 'service_type'), undefined)
  } finally {
    jimeng.app.unmount()
  }
})

test('锁定模式写锁禁用保存并展示中文原因，取消仍交给页面', async () => {
  const harness = mountDialog({
    configWriteLocked: true,
    configWriteLockReason: WRITE_LOCK_REASON,
  })
  try {
    await nextTick()
    const save = buttonByAriaLabel(harness.root, '保存配置')
    assert.ok(save)
    assert.equal(save.props.disabled, true)
    assert.equal(save.props.title, WRITE_LOCK_REASON)
    const switches = findAll(harness.root, (node) => node.props?.role === 'switch')
    assert.ok(switches.length >= 1)
    assert.equal(switches[0].props.disabled, true)
    click(buttonByText(harness.root, '取消'))
    assert.deepEqual(harness.events, [['request-close']])
  } finally {
    harness.app.unmount()
  }
})

test('普通模式仍渲染完整表单，不会误用锁定标题', async () => {
  const harness = mountDialog({
    vendorLock: { enabled: false },
    editingId: null,
  })
  try {
    await nextTick()
    const dialog = findAll(harness.root, (node) => node.type === 'dialog')[0]
    assert.ok(dialog)
    assert.equal(dialog.props['data-title'], '添加配置')
    assert.match(textContent(harness.root), /基础信息/)
    assert.match(textContent(harness.root), /厂商与认证/)
    assert.match(textContent(harness.root), /调用策略/)
    assert.match(textContent(harness.root), /维护该厂商可用模型/)
    assert.ok(fieldByName(harness.root, 'service_type'))
    assert.ok(fieldByName(harness.root, 'provider'))
    assert.ok(fieldByName(harness.root, 'api_key'))
    assert.ok(fieldByName(harness.root, 'default_model'))
    assert.ok(buttonByText(harness.root, '从服务读取模型'))
    assert.doesNotMatch(textContent(harness.root), /锁定模式下不能新增模型列表/)
  } finally {
    harness.app.unmount()
  }
})

test('普通模式校验摘要展示中文字段，即梦2认证隐藏模型分区', async () => {
  const harness = mountDialog({
    vendorLock: { enabled: false },
    form: {
      name: '即梦2认证',
      service_type: 'jimeng2_character_auth',
      provider: 'jimeng2',
      api_key: '',
      default_model: '',
    },
    configValidationSummary: [
      { prop: 'api_key', label: 'API 密钥', message: '请输入 API 密钥' },
    ],
  })
  try {
    await nextTick()
    const text = textContent(harness.root)
    assert.match(text, /无法保存，请检查以下字段：/)
    assert.match(text, /API 密钥：请输入 API 密钥/)
    assert.match(text, /令牌（Token）/)
    assert.match(text, /列出素材/)
    assert.doesNotMatch(text, /维护该厂商可用模型/)
    assert.match(text, /03/)
    assert.ok(fieldByName(harness.root, 'service_type'))
    assert.equal(fieldByName(harness.root, 'default_model'), undefined)
  } finally {
    harness.app.unmount()
  }
})
