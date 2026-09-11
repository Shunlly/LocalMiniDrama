import test from 'node:test'
import assert from 'node:assert/strict'

import { defineComponent, h, nextTick, reactive } from 'vue'

import {
  buttonByText,
  click,
  compileIconStub,
  createHostRenderer,
  loadCompiledSfc,
  mountHarness,
  textContent,
  vueUrl,
} from './helpers/vueComponentHarness.js'

const sectionUrl = new URL('../src/components/aiConfig/AiConfigModelListSection.vue', import.meta.url)
const iconStubUrl = compileIconStub(['QuestionFilled'])
const AiConfigModelListSection = await loadCompiledSfc(
  sectionUrl,
  'ai-config-model-list-section-component',
  new Map([
    ['vue', vueUrl],
    ['@element-plus/icons-vue', iconStubUrl],
  ]),
)
const renderer = createHostRenderer()
const ElFormItemStub = defineComponent({
  name: 'ElFormItemStub',
  setup(_props, { slots }) {
    return () => h('div', { 'data-el': 'el-form-item' }, [slots.label?.(), slots.default?.()])
  },
})

function a11y() {
  return {
    isConfigFieldInvalid: () => false,
    configFieldDescriptionId: (name) => `desc-${name}`,
    configFieldDescription: () => '模型列表说明',
  }
}

function mountSection(initial = {}) {
  const events = []
  const form = reactive({ modelText: initial.modelText ?? 'keep-model' })
  const mounted = mountHarness(renderer, () => h(AiConfigModelListSection, {
    form,
    presetModelPick: initial.presetModelPick ?? '',
    availableModels: initial.availableModels ?? ['keep-model', 'new-model'],
    discoverModelsLoading: Boolean(initial.loading),
    discoverModelsDisabled: Boolean(initial.disabled),
    discoverModelsDisabledReason: initial.disabledReason ?? '',
    providerModelEmptyHint: initial.emptyHint ?? '',
    ...a11y(),
    setModelListInputRef: () => {},
    discoverModelsFromService: () => events.push('discover'),
    onPresetModelSelect: (value) => events.push(['preset', value]),
    'onUpdate:presetModelPick': (value) => events.push(['pick', value]),
  }), {
    components: {
      ElFormItem: ElFormItemStub,
      'el-form-item': ElFormItemStub,
    },
  })
  return { ...mounted, events, form }
}

test('模型列表可从服务读取；禁用时展示中文原因且不会发起请求', async () => {
  const ready = mountSection()
  try {
    await nextTick()
    assert.match(textContent(ready.root), /模型列表/)
    const discover = buttonByText(ready.root, '从服务读取模型')
    assert.ok(discover)
    assert.notEqual(discover.props.disabled, true)
    click(discover)
    assert.deepEqual(ready.events, ['discover'])
  } finally {
    ready.app.unmount()
  }

  const locked = mountSection({
    disabled: true,
    disabledReason: '请先填写 API 密钥后再读取模型',
    emptyHint: '当前厂商没有可追加的预设模型',
  })
  try {
    await nextTick()
    const discover = buttonByText(locked.root, '从服务读取模型')
    assert.equal(discover.props.disabled, true)
    assert.match(textContent(locked.root), /请先填写 API 密钥后再读取模型/)
    assert.match(textContent(locked.root), /当前厂商没有可追加的预设模型/)
  } finally {
    locked.app.unmount()
  }
})

test('读取中展示中文进度，不和禁用原因同时出现', async () => {
  const harness = mountSection({
    loading: true,
    disabledReason: '请先填写 API 密钥后再读取模型',
  })
  try {
    await nextTick()
    assert.match(textContent(harness.root), /正在从服务读取模型/)
    assert.doesNotMatch(textContent(harness.root), /请先填写 API 密钥后再读取模型/)
    const discover = buttonByText(harness.root, '从服务读取模型')
    assert.equal(discover.props['data-loading'], true)
  } finally {
    harness.app.unmount()
  }
})

test('模型列表空态给出下一步，不发起读取请求', async () => {
  const harness = mountSection({
    availableModels: [],
    emptyHint: '下一步：直接输入模型名；填好接口地址和密钥后也可点「从服务读取模型」。',
  })
  try {
    await nextTick()
    assert.match(textContent(harness.root), /下一步：直接输入模型名/)
    assert.match(textContent(harness.root), /从服务读取模型/)
    assert.deepEqual(harness.events, [])
  } finally {
    harness.app.unmount()
  }
})

