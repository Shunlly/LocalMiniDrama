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
import { AccessibleDialogStub, createAlertStubWithDescription } from './helpers/accessibleDialogStub.js'

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
    `ai-config-section-${fileName}`,
    new Map([
      ['vue', vueUrl],
      ['@element-plus/icons-vue', iconStubUrl],
      ['@/utils/aiConfigLabels.js', labelsUrl],
      ...extra,
    ]),
  )
}

const AiConfigFormBasicSection = await loadCompiledSfc(
  new URL('../src/components/aiConfig/AiConfigFormBasicSection.vue', import.meta.url),
  'ai-config-form-basic-section-component',
  new Map([
    ['vue', vueUrl],
    ['@element-plus/icons-vue', iconStubUrl],
  ]),
)
const AiConfigFormVendorSection = await loadCompiledSfc(
  new URL('../src/components/aiConfig/AiConfigFormVendorSection.vue', import.meta.url),
  'ai-config-form-vendor-section-component',
  new Map([
    ['vue', vueUrl],
    ['@element-plus/icons-vue', iconStubUrl],
    ['@/utils/aiConfigLabels.js', labelsUrl],
  ]),
)
const AiConfigFormEndpointSection = await loadCompiledSfc(
  new URL('../src/components/aiConfig/AiConfigFormEndpointSection.vue', import.meta.url),
  'ai-config-form-endpoint-section-component',
  new Map([
    ['vue', vueUrl],
    ['@element-plus/icons-vue', iconStubUrl],
    ['@/utils/aiConfigLabels.js', labelsUrl],
    ['@/components/aiConfig/AiConfigPresetHelpCollapse.vue', helpStubUrl],
  ]),
)
const compiledModelList = compileSection('AiConfigModelListSection.vue')
const AiConfigFormModelSection = await loadCompiledSfc(
  new URL('../src/components/aiConfig/AiConfigFormModelSection.vue', import.meta.url),
  'ai-config-form-model-section-component',
  new Map([
    ['vue', vueUrl],
    ['@element-plus/icons-vue', iconStubUrl],
    ['@/components/aiConfig/AiConfigModelListSection.vue', compiledModelList],
  ]),
)
const AiConfigFormPolicySection = await loadCompiledSfc(
  new URL('../src/components/aiConfig/AiConfigFormPolicySection.vue', import.meta.url),
  'ai-config-form-policy-section-component',
  new Map([
    ['vue', vueUrl],
    ['@element-plus/icons-vue', iconStubUrl],
  ]),
)
const AiConfigFormLockSection = await loadCompiledSfc(
  new URL('../src/components/aiConfig/AiConfigFormLockSection.vue', import.meta.url),
  'ai-config-form-lock-section-component',
  new Map([
    ['vue', vueUrl],
    ['@element-plus/icons-vue', iconStubUrl],
    ['@/utils/aiConfigLabels.js', labelsUrl],
  ]),
)

const renderer = createHostRenderer()

const ElFormItemStub = defineComponent({
  name: 'ElFormItemStub',
  props: ['label', 'prop'],
  setup(props, { slots }) {
    return () => h('div', { 'data-el': 'el-form-item', 'data-prop': props.prop || '', 'data-label': props.label || '' }, [
      slots.label?.() || (props.label ? h('span', props.label) : null),
      slots.default?.(),
    ])
  },
})

const ElSelectStub = defineComponent({
  name: 'ElSelectStub',
  props: ['modelValue', 'disabled', 'placeholder'],
  emits: ['update:modelValue', 'change'],
  setup(props, { attrs, emit, slots }) {
    return () => h('select', {
      ...attrs,
      value: props.modelValue,
      disabled: Boolean(props.disabled),
      placeholder: props.placeholder,
      onChange: (event) => {
        const value = event?.target?.value ?? event
        emit('update:modelValue', value)
        emit('change', value)
      },
    }, slots.default?.())
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

const ElCollapseStub = defineComponent({
  name: 'ElCollapseStub',
  setup(_props, { slots }) {
    return () => h('div', { 'data-el': 'el-collapse' }, slots.default?.())
  },
})

const ElCollapseItemStub = defineComponent({
  name: 'ElCollapseItemStub',
  setup(_props, { slots }) {
    return () => h('div', { 'data-el': 'el-collapse-item' }, [
      slots.title?.(),
      slots.default?.(),
    ])
  },
})

const ElOptionGroupStub = defineComponent({
  name: 'ElOptionGroupStub',
  props: ['label'],
  setup(props, { slots }) {
    return () => h('optgroup', { label: props.label || '' }, slots.default?.())
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

const ElFormStub = defineComponent({
  name: 'ElFormStub',
  setup(_props, { slots, attrs }) {
    return () => h('form', { ...attrs }, slots.default?.())
  },
})

const extraComponents = {
  AccessibleDialog: AccessibleDialogStub,
  ElForm: ElFormStub,
  'el-form': ElFormStub,
  ElFormItem: ElFormItemStub,
  'el-form-item': ElFormItemStub,
  ElSelect: ElSelectStub,
  'el-select': ElSelectStub,
  ElSwitch: ElSwitchStub,
  'el-switch': ElSwitchStub,
  ElCollapse: ElCollapseStub,
  'el-collapse': ElCollapseStub,
  ElCollapseItem: ElCollapseItemStub,
  'el-collapse-item': ElCollapseItemStub,
  ElOptionGroup: ElOptionGroupStub,
  'el-option-group': ElOptionGroupStub,
  ElDescriptions: ElDescriptionsStub,
  'el-descriptions': ElDescriptionsStub,
  ElDescriptionsItem: ElDescriptionsItemStub,
  'el-descriptions-item': ElDescriptionsItemStub,
  ...createAlertStubWithDescription(),
}

function fieldByName(root, name) {
  return findAll(root, (node) => node.props?.['data-ai-config-field'] === name)[0]
}

function optionLabels(root) {
  return findAll(root, (node) => node.type === 'option').map((node) => textContent(node))
}

function noop() {}

function a11y() {
  return {
    isConfigFieldInvalid: () => false,
    configFieldDescriptionId: (prop) => `ai-config-${prop}-desc`,
    configFieldDescription: (prop) => `${prop} 说明`,
  }
}

function changeSelect(node, value) {
  node.props.onChange?.({ target: { value } })
}

test('基础信息区编辑时禁用服务类型，切换类型会通知页面', async () => {
  const events = []
  const form = reactive({
    name: '文本配置',
    service_type: 'text',
  })
  const harness = mountHarness(renderer, () => h(AiConfigFormBasicSection, {
    form,
    editingId: 12,
    ...a11y(),
    onServiceTypeChange: (value) => events.push(value),
  }), { components: extraComponents })
  try {
    await nextTick()
    assert.match(textContent(harness.root), /基础信息/)
    const serviceType = fieldByName(harness.root, 'service_type')
    assert.ok(serviceType)
    assert.equal(serviceType.props.disabled, true)
    assert.equal(serviceType.props['aria-label'], '服务类型')
    const labels = optionLabels(harness.root).join('\n')
    assert.match(labels, /图片识别 OCR/)
    assert.match(labels, /语音转写/)
    assert.match(labels, /即梦2角色认证/)
    changeSelect(serviceType, 'ocr')
    assert.equal(form.service_type, 'ocr')
    assert.deepEqual(events, ['ocr'])
    assert.notEqual(12, 'ocr')
  } finally {
    harness.app.unmount()
  }
})

test('厂商区按服务类型切换即梦2、可灵和 TTS 字段', async () => {
  const events = []
  const form = reactive({
    service_type: 'jimeng2_character_auth',
    provider: 'jimeng2',
    api_key: '',
    api_protocol: 'openai',
    voice_id: '',
    group_id: '',
    kling_access_key: '',
    kling_secret_key: '',
    kling_secret_key_base64: false,
  })
  const harness = mountHarness(renderer, () => h(AiConfigFormVendorSection, {
    form,
    availableProviderOptions: [
      { id: 'deepseek', name: 'DeepSeek' },
      { id: '__custom__', name: '自定义' },
    ],
    jimeng2AssetsLoading: true,
    bindApiKeyInputRef: noop,
    ...a11y(),
    onProviderChange: (value) => events.push(['provider', value]),
    openJimeng2MaterialAssetsDialog: () => events.push(['open-assets']),
  }), { components: extraComponents })
  try {
    await nextTick()
    assert.match(textContent(harness.root), /厂商与认证/)
    assert.match(textContent(harness.root), /自动带入中文名称、接口地址（Base URL）和常用模型/)
    assert.doesNotMatch(textContent(harness.root), /自动带入中文名称、Base URL 和常用模型/)
    assert.match(textContent(harness.root), /令牌（Token）/)
    assert.match(textContent(harness.root), /列出素材/)
    assert.match(textContent(harness.root), /素材登记接口/)
    assert.equal(fieldByName(harness.root, 'api_key').props.placeholder, '请输入 Bearer 令牌')
    assert.equal(fieldByName(harness.root, 'provider').props['aria-label'], '厂商')
    const listed = buttonByText(harness.root, '列出素材')
    assert.ok(listed)
    assert.equal(listed.props['data-loading'], true)
    click(listed)
    assert.deepEqual(events, [['open-assets']])
    assert.equal(findAll(harness.root, (node) => node.props?.['aria-label'] === '声音 ID').length, 0)
    assert.equal(findAll(harness.root, (node) => node.props?.placeholder === '可灵开放平台 AccessKey（与 SecretKey 成对，可不填上方 API 密钥）').length, 0)

    form.service_type = 'tts'
    await nextTick()
    assert.match(textContent(harness.root), /API 密钥/)
    assert.doesNotMatch(textContent(harness.root), /\bAPI Key\b/)
    assert.ok(findAll(harness.root, (node) => node.props?.['aria-label'] === '声音 ID')[0])
    assert.ok(findAll(harness.root, (node) => node.props?.placeholder === 'MiniMax GroupId，如 1234567890')[0])
    assert.equal(findAll(harness.root, (node) => node.type === 'button' && textContent(node).includes('列出素材')).length, 0)

    form.service_type = 'video'
    form.api_protocol = 'kling_omni'
    await nextTick()
    assert.ok(findAll(harness.root, (node) => node.props?.placeholder === '可灵开放平台 AccessKey（与 SecretKey 成对，可不填上方 API 密钥）')[0])
    assert.ok(findAll(harness.root, (node) => node.props?.placeholder === '可灵开放平台 SecretKey')[0])
    assert.equal(findAll(harness.root, (node) => node.props?.['aria-label'] === '声音 ID').length, 0)
  } finally {
    harness.app.unmount()
  }
})

test('高级接口区可打开规范说明，并按类型展示本地 HTTP、工作流和预览', async () => {
  const form = reactive({
    service_type: 'image',
    api_protocol: 'fal',
    base_url: 'https://example.com',
    endpoint: '',
    query_endpoint: '',
    allow_local_http: false,
    comfy_workflow_json: '',
  })
  const showProtocolHelp = ref(false)
  const advancedFormSections = ref([])
  const harness = mountHarness(renderer, () => h(AiConfigFormEndpointSection, {
    form,
    isComfyUiForm: true,
    canConfigureLocalHttp: true,
    endpointPreviewInfo: {
      submit: 'https://example.com/fal-ai/nano-banana',
      query: '',
      isAuto: true,
    },
    bindWorkflowInputRef: noop,
    ...a11y(),
    advancedFormSections: advancedFormSections.value,
    'onUpdate:advancedFormSections': (value) => {
      advancedFormSections.value = value
    },
    showProtocolHelp: showProtocolHelp.value,
    'onUpdate:showProtocolHelp': (value) => {
      showProtocolHelp.value = value
    },
  }), { components: extraComponents })
  try {
    await nextTick()
    assert.match(textContent(harness.root), /高级接口设置/)
    assert.match(textContent(harness.root), /接口地址（Base URL）、接口规范及自定义端点/)
    assert.doesNotMatch(textContent(harness.root), /Base URL、接口规范及自定义端点/)
    assert.match(textContent(harness.root), /本地 HTTP/)
    assert.match(textContent(harness.root), /工作流 JSON/)
    assert.match(textContent(harness.root), /系统将使用以下接口地址/)
    assert.match(textContent(harness.root), /https:\/\/example.com\/fal-ai\/nano-banana/)
    const labels = optionLabels(harness.root).join('\n')
    assert.match(labels, /Fal\.ai/)
    assert.match(labels, /Replicate/)
    assert.ok(fieldByName(harness.root, 'api_protocol'))
    assert.ok(fieldByName(harness.root, 'comfy_workflow_json'))
    const help = buttonByAriaLabel(harness.root, '查看接口规范说明')
    assert.ok(help)
    click(help)
    await nextTick()
    assert.equal(showProtocolHelp.value, true)
    assert.match(textContent(harness.root), /接口规范说明/)
    assert.match(textContent(harness.root), /接口规范帮助内容/)

    form.service_type = 'ocr'
    await nextTick()
    assert.equal(fieldByName(harness.root, 'api_protocol'), undefined)
    assert.equal(fieldByName(harness.root, 'endpoint'), undefined)
    assert.ok(fieldByName(harness.root, 'base_url'))
  } finally {
    harness.app.unmount()
  }
})

test('模型区失效默认模型和 DeepSeek 思考模式都走中文提示', async () => {
  const events = []
  const form = reactive({
    modelText: 'keep-model',
    default_model: 'old-model',
    deepseek_thinking: 'enabled',
    deepseek_reasoning_effort: 'high',
  })
  const presetModelPick = ref('')
  const harness = mountHarness(renderer, () => h(AiConfigFormModelSection, {
    form,
    availableModels: ['keep-model'],
    discoverModelsLoading: false,
    discoverModelsDisabled: true,
    discoverModelsDisabledReason: '请先填写 API 密钥后再读取模型',
    providerModelEmptyHint: '',
    formModelList: ['keep-model'],
    isDefaultModelUnavailable: true,
    isDeepSeekOfficialForm: true,
    ...a11y(),
    setModelListInputRef: noop,
    discoverModelsFromService: () => events.push('discover'),
    onPresetModelSelect: noop,
    onDefaultModelChange: (value) => events.push(['default', value]),
    presetModelPick: presetModelPick.value,
    'onUpdate:presetModelPick': (value) => {
      presetModelPick.value = value
    },
  }), { components: extraComponents })
  try {
    await nextTick()
    assert.notEqual('old-model', 'keep-model')
    assert.match(textContent(harness.root), /维护该厂商可用模型/)
    assert.match(textContent(harness.root), /当前默认模型已不在模型列表中，请显式选择有效模型后保存/)
    assert.match(textContent(harness.root), /old-model（已失效）/)
    assert.match(textContent(harness.root), /思考模式/)
    assert.match(textContent(harness.root), /关闭思考/)
    assert.match(textContent(harness.root), /请先填写 API 密钥后再读取模型/)
    const discover = buttonByText(harness.root, '从服务读取模型')
    assert.ok(discover)
    assert.equal(discover.props.disabled, true)
    const defaultModel = fieldByName(harness.root, 'default_model')
    assert.equal(defaultModel.props['aria-label'], '默认模型')
    changeSelect(defaultModel, 'keep-model')
    assert.equal(form.default_model, 'keep-model')
    assert.deepEqual(events, [['default', 'keep-model']])
  } finally {
    harness.app.unmount()
  }
})

test('调用策略按服务类型展示单价，写锁禁用默认开关', async () => {
  const form = reactive({
    service_type: 'text',
    pricing_input_per_million_tokens: 1,
    pricing_output_per_million_tokens: 2,
    pricing_per_image: 0,
    pricing_per_second: 0,
    pricing_per_1000_characters: 0,
    priority: 10,
    is_default: true,
  })
  const harness = mountHarness(renderer, () => h(AiConfigFormPolicySection, {
    form,
    configWriteLocked: true,
  }), { components: extraComponents })
  try {
    await nextTick()
    assert.match(textContent(harness.root), /调用策略/)
    assert.match(textContent(harness.root), /输入单价/)
    assert.match(textContent(harness.root), /输出单价/)
    assert.match(textContent(harness.root), /04/)
    const lockedSwitch = findAll(harness.root, (node) => node.props?.role === 'switch')[0]
    assert.ok(lockedSwitch)
    assert.equal(lockedSwitch.props.disabled, true)

    form.service_type = 'image'
    await nextTick()
    assert.match(textContent(harness.root), /图片单价/)
    assert.doesNotMatch(textContent(harness.root), /输入单价/)

    form.service_type = 'ocr'
    await nextTick()
    assert.doesNotMatch(textContent(harness.root), /图片单价/)
    assert.doesNotMatch(textContent(harness.root), /语音单价/)

    form.service_type = 'jimeng2_character_auth'
    await nextTick()
    assert.match(textContent(harness.root), /03/)
    assert.doesNotMatch(textContent(harness.root), /输入单价/)
  } finally {
    harness.app.unmount()
  }
})

test('锁定分区只保留密钥和默认模型，不出现完整表单分区标题', async () => {
  const form = reactive({
    name: '锁定文本配置',
    service_type: 'text',
    provider: 'deepseek',
    api_key: 'sk-lock',
    default_model: 'deepseek-v4-flash',
    is_default: true,
  })
  const harness = mountHarness(renderer, () => h(AiConfigFormLockSection, {
    form,
    configWriteLocked: false,
    defaultModelRules: [],
    formModelList: ['deepseek-v4-flash', 'deepseek-v4-pro'],
    isDefaultModelUnavailable: false,
    bindFormRef: noop,
    bindApiKeyInputRef: noop,
    handleConfigFieldValidated: noop,
    ...a11y(),
  }), { components: extraComponents })
  try {
    await nextTick()
    const text = textContent(harness.root)
    assert.match(text, /锁定文本配置/)
    assert.match(text, /锁定模式下不能新增模型列表/)
    assert.match(text, /API 密钥/)
    assert.doesNotMatch(text, /\bAPI Key\b/)
    assert.ok(fieldByName(harness.root, 'api_key'))
    assert.ok(fieldByName(harness.root, 'default_model'))
    assert.equal(fieldByName(harness.root, 'service_type'), undefined)
    assert.equal(fieldByName(harness.root, 'provider'), undefined)
    assert.doesNotMatch(text, /基础信息/)
    assert.doesNotMatch(text, /厂商与认证/)
  } finally {
    harness.app.unmount()
  }
})
