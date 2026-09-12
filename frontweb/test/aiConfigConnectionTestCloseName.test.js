import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { h, nextTick, ref } from 'vue'

import {
  buttonByAriaLabel,
  buttonByText,
  click,
  createHostRenderer,
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
const dialogSource = readFileSync(dialogUrl, 'utf8')
const AiConfigConnectionTestDialog = await loadCompiledSfc(
  dialogUrl,
  'ai-config-connection-test-close-name',
  new Map([['vue', vueUrl]]),
)

const renderer = createHostRenderer()

function mountDialog(initial = {}) {
  const testVisible = ref(initial.testVisible ?? true)
  const mounted = mountHarness(renderer, () => h(AiConfigConnectionTestDialog, {
    testResult: initial.testResult ?? null,
    testServiceType: initial.testServiceType ?? 'text',
    testError: initial.testError ?? '',
    testErrorDetail: initial.testErrorDetail ?? '',
    testResultAnnouncement: initial.testResultAnnouncement ?? '',
    testSuggestDiscoverModels: false,
    testingConfigId: initial.testingConfigId ?? null,
    restoreTestedCoverageCardFocus: () => {},
    retryConnectionTest: () => {},
    testVisible: testVisible.value,
    'onUpdate:testVisible': (value) => { testVisible.value = value },
  }), {
    components: {
      AccessibleDialog: AccessibleDialogStub,
      ...createAlertStubWithDescription(),
    },
  })
  return { ...mounted, testVisible }
}

test('连接测试关闭按钮读屏名是关闭连接测试，可见文案仍是关闭', async () => {
  assert.match(dialogSource, /aria-label="关闭连接测试"/)
  assert.match(dialogSource, />关闭<\/el-button>/)
  assert.doesNotMatch(dialogSource, /aria-label="关闭"/)

  const testing = mountDialog({ testResult: null })
  try {
    await nextTick()
    const close = buttonByAriaLabel(testing.root, '关闭连接测试')
    assert.ok(close, '缺少读屏名为关闭连接测试的按钮')
    assert.equal(buttonByText(testing.root, '关闭'), close)
    assert.equal(close.props['aria-label'], '关闭连接测试')
    assert.match(textContent(close), /^关闭$/)
    assert.equal(buttonByAriaLabel(testing.root, '关闭'), undefined)
    click(close)
    await nextTick()
    assert.equal(testing.testVisible.value, false)
  } finally {
    testing.app.unmount()
  }

  const failed = mountDialog({
    testResult: false,
    testError: '连接失败：服务未就绪',
    testingConfigId: 8,
  })
  try {
    await nextTick()
    const close = buttonByAriaLabel(failed.root, '关闭连接测试')
    const retry = buttonByAriaLabel(failed.root, '正在重试连接')
    assert.ok(close, '失败态也必须保留关闭连接测试')
    assert.ok(retry, '失败态应有重试连接测试')
    assert.notEqual(close, retry)
    assert.equal(close.props['aria-label'], '关闭连接测试')
  } finally {
    failed.app.unmount()
  }
})
