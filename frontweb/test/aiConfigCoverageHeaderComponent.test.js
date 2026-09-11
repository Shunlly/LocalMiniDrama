import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { h, nextTick } from 'vue'

import {
  buttonByText,
  click,
  createHostRenderer,
  findByClass,
  hasClass,
  loadCompiledSfc,
  mountHarness,
  textContent,
  vueUrl,
} from './helpers/vueComponentHarness.js'

function readSource(url) {
  return readFileSync(url, 'utf8').replace(/\r\n?/g, '\n')
}

const headerUrl = new URL('../src/components/aiConfig/AiConfigCoverageHeader.vue', import.meta.url)
const headerSource = readSource(headerUrl)
const AiConfigCoverageHeader = await loadCompiledSfc(
  headerUrl,
  'ai-config-coverage-header-component',
  new Map([['vue', vueUrl]]),
)

const renderer = createHostRenderer()
const SUMMARY_CARDS = [
  { key: 'ready', label: '可用', value: '2/5', tone: 'warning' },
  { key: 'attention', label: '待补齐', value: 3, tone: 'warning' },
  { key: 'failed-tests', label: '测试失败', value: 1, tone: 'danger' },
  { key: 'untested', label: '待测试', value: 0, tone: 'success' },
]

function mountHeader(initial = {}) {
  const events = []
  const mounted = mountHarness(renderer, () => h(AiConfigCoverageHeader, {
    serviceCoverage: initial.serviceCoverage ?? { ready: false, readyCount: 2, totalCount: 5 },
    coverageSummaryCards: initial.coverageSummaryCards ?? SUMMARY_CARDS,
    configListPendingEmpty: Boolean(initial.configListPendingEmpty),
    configListFailedEmpty: Boolean(initial.configListFailedEmpty),
    loading: Boolean(initial.loading),
    retryConfigDependencies: () => events.push('retry'),
  }))
  return { ...mounted, events }
}

test('列表未就绪时表头不把五类服务标成已确认', async () => {
  assert.match(headerSource, /<h2 id="ai-service-coverage-title">AI 服务配置与验证<\/h2>/)
  assert.match(headerSource, /类可用/)
  assert.doesNotMatch(headerSource, /configWriteLocked/)
  assert.doesNotMatch(headerSource, /async function loadList\(/)
  assert.doesNotMatch(headerSource, /useAiConfigList/)

  const pending = mountHeader({ configListPendingEmpty: true })
  try {
    await nextTick()
    assert.match(textContent(pending.root), /AI 服务配置与验证/)
    assert.match(textContent(pending.root), /正在读取 AI 配置/)
    assert.doesNotMatch(textContent(pending.root), /类可用/)
    assert.equal(findByClass(pending.root, 'coverage-summary-card').length, 0)
    assert.equal(buttonByText(pending.root, '重试'), undefined)
  } finally {
    pending.app.unmount()
  }

  const failed = mountHeader({
    configListFailedEmpty: true,
    loading: true,
  })
  try {
    await nextTick()
    assert.match(textContent(failed.root), /暂时无法确认服务状态/)
    assert.match(textContent(failed.root), /配置列表还没有成功加载/)
    const retry = buttonByText(failed.root, '重试')
    assert.ok(retry)
    assert.equal(retry.props['aria-label'], '重新读取配置列表')
    assert.notEqual(retry.props.disabled, true)
    assert.equal(retry.props['data-loading'], true)
    click(retry)
    assert.deepEqual(failed.events, ['retry'])
  } finally {
    failed.app.unmount()
  }
})

test('列表就绪后展示类可用统计和汇总条，重试入口不再出现', async () => {
  const harness = mountHeader()
  try {
    await nextTick()
    assert.match(textContent(harness.root), /2\/5 类可用/)
    assert.match(textContent(harness.root), /每类服务可用需启用默认配置/)
    assert.match(textContent(harness.root), /连接测试结果来自后端记录或此设备保存的最近结果/)
    const cards = findByClass(harness.root, 'coverage-summary-card')
    assert.equal(cards.length, 4)
    assert.match(textContent(cards[0]), /可用/)
    assert.match(textContent(cards[1]), /待补齐/)
    assert.match(textContent(cards[2]), /测试失败/)
    assert.match(textContent(cards[3]), /待测试/)
    assert.equal(hasClass(cards[2], 'summary-danger'), true)
    assert.equal(buttonByText(harness.root, '重试'), undefined)
  } finally {
    harness.app.unmount()
  }
})
