import test from 'node:test'
import assert from 'node:assert/strict'

import { h, nextTick, ref } from 'vue'

import {
  buttonByText,
  click,
  createHostRenderer,
  findByType,
  loadCompiledSfc,
  mountHarness,
  textContent,
  vueUrl,
} from './helpers/vueComponentHarness.js'
import {
  AccessibleDialogStub,
  createAlertStubWithDescription,
} from './helpers/accessibleDialogStub.js'

const dialogUrl = new URL('../src/components/aiConfig/AiConfigConnectionTestDialog.vue', import.meta.url)
const AiConfigConnectionTestDialog = await loadCompiledSfc(
  dialogUrl,
  'ai-config-connection-test-dialog-component',
  new Map([['vue', vueUrl]]),
)

const renderer = createHostRenderer()

function mountDialog(initial = {}) {
  const events = []
  const testVisible = ref(initial.testVisible ?? true)
  const props = {
    testResult: initial.testResult ?? null,
    testServiceType: initial.testServiceType ?? '',
    testError: initial.testError ?? '',
    testErrorDetail: initial.testErrorDetail ?? '',
    testResultAnnouncement: initial.testResultAnnouncement ?? '',
    testSuggestDiscoverModels: initial.testSuggestDiscoverModels ?? false,
    testingConfigId: initial.testingConfigId ?? null,
    restoreTestedCoverageCardFocus: () => events.push(['restore-focus']),
    retryConnectionTest: () => events.push(['retry']),
  }
  const mounted = mountHarness(renderer, () => h(AiConfigConnectionTestDialog, {
    ...props,
    testVisible: testVisible.value,
    'onUpdate:testVisible': (value) => { testVisible.value = value },
  }), {
    components: {
      AccessibleDialog: AccessibleDialogStub,
      ...createAlertStubWithDescription(),
    },
  })
  return { ...mounted, events, testVisible }
}

test('测试中展示正在测试，关闭会关掉对话框', async () => {
  const harness = mountDialog({
    testResult: null,
    testResultAnnouncement: '正在测试文本生成连接',
  })
  try {
    await nextTick()
    assert.match(textContent(harness.root), /测试连接/)
    assert.match(textContent(harness.root), /正在测试…/)
    assert.match(textContent(harness.root), /正在测试文本生成连接/)
    assert.equal(buttonByText(harness.root, '重试'), undefined)
    const close = buttonByText(harness.root, '关闭')
    assert.ok(close)
    assert.equal(close.props['aria-label'], '关闭连接测试')
    click(close)
    await nextTick()
    assert.equal(harness.testVisible.value, false)
  } finally {
    harness.app.unmount()
  }
})

test('连接成功按服务类型展示中文说明，失败展示连接失败和重试', async () => {
  const textSuccess = mountDialog({
    testResult: true,
    testServiceType: 'text',
    testSuggestDiscoverModels: true,
  })
  try {
    await nextTick()
    const alerts = findByType(textSuccess.root, 'alert')
    assert.ok(alerts.some((node) => textContent(node).includes('连接成功')))
    assert.match(textContent(textSuccess.root), /文本生成接口已正常响应/)
    assert.match(textContent(textSuccess.root), /也可以读取模型目录，不会自动覆盖已填写的模型列表/)
    assert.equal(buttonByText(textSuccess.root, '重试'), undefined)
  } finally {
    textSuccess.app.unmount()
  }

  const imageSuccess = mountDialog({
    testResult: true,
    testServiceType: 'storyboard_image',
  })
  try {
    await nextTick()
    assert.match(textContent(imageSuccess.root), /连接成功/)
    assert.match(textContent(imageSuccess.root), /连通性探针通过/)
    assert.match(textContent(imageSuccess.root), /测试不等同于真实生成验收/)
  } finally {
    imageSuccess.app.unmount()
  }

  const ocrSuccess = mountDialog({
    testResult: true,
    testServiceType: 'ocr',
  })
  try {
    await nextTick()
    assert.match(textContent(ocrSuccess.root), /图片识别接口已正常响应/)
  } finally {
    ocrSuccess.app.unmount()
  }

  const transcriptionSuccess = mountDialog({
    testResult: true,
    testServiceType: 'transcription',
  })
  try {
    await nextTick()
    assert.match(textContent(transcriptionSuccess.root), /语音转写接口已正常响应/)
  } finally {
    transcriptionSuccess.app.unmount()
  }

  const failed = mountDialog({
    testResult: false,
    testError: '连接失败：服务未就绪',
    testErrorDetail: '请检查接口地址后重试',
    testingConfigId: 11,
  })
  try {
    await nextTick()
    assert.match(textContent(failed.root), /连接失败：服务未就绪/)
    assert.match(textContent(failed.root), /请检查接口地址后重试/)
    const retry = buttonByText(failed.root, '重试')
    assert.ok(retry)
    assert.equal(retry.props['data-loading'], true)
    click(retry)
    assert.deepEqual(failed.events, [['retry']])
  } finally {
    failed.app.unmount()
  }
})
