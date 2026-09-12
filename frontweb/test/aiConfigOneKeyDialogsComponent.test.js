import test from 'node:test'
import assert from 'node:assert/strict'

import { h, nextTick, ref } from 'vue'

import {
  buttonByText,
  click,
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

const dialogsUrl = new URL('../src/components/aiConfig/AiConfigOneKeyDialogs.vue', import.meta.url)
const labelsUrl = new URL('../src/utils/aiConfigLabels.js', import.meta.url).href
const AiConfigOneKeyDialogs = await loadCompiledSfc(
  dialogsUrl,
  'ai-config-one-key-dialogs-component',
  new Map([
    ['vue', vueUrl],
    ['@/utils/aiConfigLabels.js', labelsUrl],
  ]),
)

const renderer = createHostRenderer()
const KEY_INPUT_LABELS = ['通义密钥', '火山引擎密钥', 'Agnes 密钥']

function inputByAriaLabel(root, label) {
  return findAll(root, (node) => node.type === 'input' && node.props?.['aria-label'] === label)[0]
}

function dialogByTitle(root, title) {
  return findAll(root, (node) => node.type === 'dialog' && node.props?.['data-title'] === title)[0]
}

function submitButton(root, title) {
  return buttonByText(dialogByTitle(root, title), '确定，一键创建配置')
}

function mountDialogs(initial = {}) {
  const events = []
  const oneKeyTongyiVisible = ref(initial.oneKeyTongyiVisible ?? false)
  const oneKeyTongyiKey = ref(initial.oneKeyTongyiKey ?? '')
  const oneKeyVolcVisible = ref(initial.oneKeyVolcVisible ?? false)
  const oneKeyVolcKey = ref(initial.oneKeyVolcKey ?? '')
  const oneKeyAgnesVisible = ref(initial.oneKeyAgnesVisible ?? false)
  const oneKeyAgnesKey = ref(initial.oneKeyAgnesKey ?? '')
  const props = {
    configWriteLocked: false,
    configWriteLockReason: '',
    oneKeyTongyiSaving: false,
    oneKeyVolcSaving: false,
    oneKeyAgnesSaving: false,
    confirmOneKeyTongyiClose: () => events.push(['confirm-close', 'tongyi']),
    confirmOneKeyVolcClose: () => events.push(['confirm-close', 'volc']),
    confirmOneKeyAgnesClose: () => events.push(['confirm-close', 'agnes']),
    requestOneKeyTongyiClose: () => events.push(['request-close', 'tongyi']),
    requestOneKeyVolcClose: () => events.push(['request-close', 'volc']),
    requestOneKeyAgnesClose: () => events.push(['request-close', 'agnes']),
    submitOneKeyTongyi: () => events.push(['submit', 'tongyi']),
    submitOneKeyVolc: () => events.push(['submit', 'volc']),
    submitOneKeyAgnes: () => events.push(['submit', 'agnes']),
    ...initial.props,
  }
  const mounted = mountHarness(renderer, () => h(AiConfigOneKeyDialogs, {
    ...props,
    oneKeyTongyiVisible: oneKeyTongyiVisible.value,
    oneKeyTongyiKey: oneKeyTongyiKey.value,
    oneKeyVolcVisible: oneKeyVolcVisible.value,
    oneKeyVolcKey: oneKeyVolcKey.value,
    oneKeyAgnesVisible: oneKeyAgnesVisible.value,
    oneKeyAgnesKey: oneKeyAgnesKey.value,
    'onUpdate:oneKeyTongyiVisible': (value) => { oneKeyTongyiVisible.value = value },
    'onUpdate:oneKeyTongyiKey': (value) => { oneKeyTongyiKey.value = value },
    'onUpdate:oneKeyVolcVisible': (value) => { oneKeyVolcVisible.value = value },
    'onUpdate:oneKeyVolcKey': (value) => { oneKeyVolcKey.value = value },
    'onUpdate:oneKeyAgnesVisible': (value) => { oneKeyAgnesVisible.value = value },
    'onUpdate:oneKeyAgnesKey': (value) => { oneKeyAgnesKey.value = value },
  }), {
    components: {
      AccessibleDialog: AccessibleDialogStub,
      ...createFormStubs(),
    },
  })
  return {
    ...mounted,
    events,
    oneKeyTongyiVisible,
    oneKeyTongyiKey,
    oneKeyVolcVisible,
    oneKeyVolcKey,
    oneKeyAgnesVisible,
    oneKeyAgnesKey,
  }
}

test('三个一键配置密钥输入的 aria-label 必须是通义密钥、火山引擎密钥、Agnes 密钥', async () => {
  const harness = mountDialogs({
    oneKeyTongyiVisible: true,
    oneKeyVolcVisible: true,
    oneKeyAgnesVisible: true,
  })
  try {
    await nextTick()
    assert.ok(dialogByTitle(harness.root, '一键配置通义千问 / 万象（不推荐）'))
    assert.ok(dialogByTitle(harness.root, '一键配置火山引擎（方舟）'))
    assert.ok(dialogByTitle(harness.root, '一键配置 Agnes AI'))
    for (const label of KEY_INPUT_LABELS) {
      const input = inputByAriaLabel(harness.root, label)
      assert.ok(input, `缺少密钥输入：${label}`)
      assert.equal(input.props['aria-label'], label)
      assert.equal(input.props.type, 'password')
      assert.ok(input.props['show-password'] === '' || input.props['show-password'] === true)
      assert.equal(input.props['show-password-on'], undefined)
    }
    assert.equal(inputByAriaLabel(harness.root, '通义 API Key'), undefined)
    assert.equal(inputByAriaLabel(harness.root, 'DashScope 密钥'), undefined)
    assert.match(textContent(dialogByTitle(harness.root, '一键配置通义千问 / 万象（不推荐）')), /将自动创建以下配置/)
    assert.match(textContent(dialogByTitle(harness.root, '一键配置火山引擎（方舟）')), /如何申请 API 密钥/)
    assert.doesNotMatch(textContent(dialogByTitle(harness.root, '一键配置火山引擎（方舟）')), /如何申请 API Key/)
    assert.match(textContent(dialogByTitle(harness.root, '一键配置 Agnes AI')), /设置 → API 密钥/)
    assert.doesNotMatch(textContent(dialogByTitle(harness.root, '一键配置 Agnes AI')), /Settings → API Keys/)
    assert.match(textContent(dialogByTitle(harness.root, '一键配置 Agnes AI')), /Agnes 图片 2\.1 Flash（agnes-image-2\.1-flash）/)
    assert.doesNotMatch(textContent(dialogByTitle(harness.root, '一键配置 Agnes AI')), /Agnes Image 2\.1 Flash/)
    assert.match(textContent(dialogByTitle(harness.root, '一键配置 Agnes AI')), /将自动创建以下配置/)
  } finally {
    harness.app.unmount()
  }
})

test('空密钥禁用一键创建并提示请先填写密钥，有密钥后可以提交', async () => {
  const harness = mountDialogs({
    oneKeyTongyiVisible: true,
    oneKeyTongyiKey: '   ',
  })
  try {
    await nextTick()
    const submit = submitButton(harness.root, '一键配置通义千问 / 万象（不推荐）')
    assert.ok(submit)
    assert.equal(submit.props.disabled, true)
    assert.equal(submit.props.title, '请先填写密钥')

    harness.oneKeyTongyiKey.value = 'sk-test'
    await nextTick()
    const enabled = submitButton(harness.root, '一键配置通义千问 / 万象（不推荐）')
    assert.notEqual(enabled.props.disabled, true)
    assert.equal(enabled.props.title, undefined)
    click(enabled)
    assert.deepEqual(harness.events, [['submit', 'tongyi']])
  } finally {
    harness.app.unmount()
  }
})

test('写锁时禁用原因优先于空密钥，取消走关闭入口', async () => {
  const harness = mountDialogs({
    oneKeyVolcVisible: true,
    oneKeyVolcKey: 'sk-volc',
    oneKeyAgnesVisible: true,
    oneKeyAgnesKey: '',
    props: {
      configWriteLocked: true,
      configWriteLockReason: '配置列表尚未就绪',
    },
  })
  try {
    await nextTick()
    const volcSubmit = submitButton(harness.root, '一键配置火山引擎（方舟）')
    const agnesSubmit = submitButton(harness.root, '一键配置 Agnes AI')
    assert.equal(volcSubmit.props.disabled, true)
    assert.equal(agnesSubmit.props.disabled, true)
    assert.equal(volcSubmit.props.title, '配置列表尚未就绪')
    assert.equal(agnesSubmit.props.title, '配置列表尚未就绪')
    click(buttonByText(dialogByTitle(harness.root, '一键配置火山引擎（方舟）'), '取消'))
    assert.deepEqual(harness.events, [['request-close', 'volc']])
  } finally {
    harness.app.unmount()
  }
})
