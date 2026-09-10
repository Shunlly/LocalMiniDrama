import test from 'node:test'
import assert from 'node:assert/strict'

import { h, ref } from 'vue'

import { useAiConfigCoverage } from '../src/composables/useAiConfigCoverage.js'
import { buildAiServiceCoverage, getAiServiceCoverageActions } from '../src/utils/aiConfigCoverage.js'
import {
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

const coverageCardUrl = new URL('../src/components/aiConfig/AiConfigCoverageCard.vue', import.meta.url)
const iconStubUrl = compileIconStub([
  'ChatDotRound',
  'Document',
  'Film',
  'Headset',
  'Microphone',
  'Picture',
  'VideoCamera',
])
const AiConfigCoverageCard = await loadCompiledSfc(
  coverageCardUrl,
  'ai-config-coverage-card-component',
  new Map([
    ['vue', vueUrl],
    ['@element-plus/icons-vue', iconStubUrl],
  ]),
)

const renderer = createHostRenderer()
const TEXT_CONFIG_ID = 10

function createCoverageApi({ vendorLocked = false, writesLocked = false, testingId = null } = {}) {
  const vendorLock = ref({ enabled: vendorLocked })
  const configWriteLocked = ref(writesLocked)
  const testingConfigId = ref(testingId)
  const api = useAiConfigCoverage({
    vendorLock,
    configWriteLocked,
    testingConfigId,
    canAutoOpenMissingService: ref(false),
    configWorkspaceView: ref('coverage'),
    activeServiceFilter: ref(''),
    serviceCoverage: ref({ services: [] }),
    coverageWorkspaceModeRef: ref(null),
    configListSectionRef: ref(null),
    selectConfigWorkspaceView() {},
    normalizeInitialServiceType: (value) => value,
    openAddForService() {},
    async openEdit() {},
    async openTest() {},
    abortConnectionTest() {},
  })
  return { api, vendorLock, configWriteLocked, testingConfigId }
}

function coverageItem(configs, session = {}) {
  return buildAiServiceCoverage(configs, session).services.find((item) => item.type === 'text')
}

function mountCard({ item, selected = false, api, events }) {
  const cardEvents = events || { select: [], action: [] }
  const mounted = mountHarness(renderer, () => h(AiConfigCoverageCard, {
    item,
    selected,
    compact: false,
    coverageActions: api.coverageActions,
    isCoverageActionTesting: api.isCoverageActionTesting,
    isCoverageActionDisabled: api.isCoverageActionDisabled,
    setCoverageCardRef: api.setCoverageCardRef,
    onSelect: (value) => cardEvents.select.push(value),
    onAction: (current, action) => cardEvents.action.push([current.type, action]),
  }))
  return { ...mounted, events: cardEvents }
}

test('未配置服务不渲染操作按钮，选择入口仍可用', () => {
  const { api } = createCoverageApi()
  const item = coverageItem([])
  const harness = mountCard({ item, api })
  try {
    assert.match(textContent(harness.root), /文本生成/)
    assert.match(textContent(harness.root), /未配置/)
    assert.match(textContent(harness.root), /尚无测试记录/)
    assert.equal(findByClass(harness.root, 'coverage-actions')[0].children.filter((node) => node.type === 'button').length, 0)
    click(findByClass(harness.root, 'coverage-select')[0])
    assert.equal(harness.events.select.length, 1)
    assert.equal(harness.events.select[0].type, 'text')
    assert.deepEqual(harness.events.action, [])
  } finally {
    harness.app.unmount()
  }
})

test('未测试配置展示立即测试，点击走真实 action 入口', () => {
  const { api } = createCoverageApi()
  const item = coverageItem([
    {
      id: TEXT_CONFIG_ID,
      service_type: 'text',
      name: '本地文本',
      provider: 'ollama',
      default_model: 'qwen3',
      is_active: true,
      is_default: true,
    },
  ])
  const harness = mountCard({ item, api })
  try {
    const testButton = buttonByText(harness.root, '立即测试')
    assert.ok(testButton)
    assert.equal(testButton.props['aria-label'], '立即测试')
    assert.notEqual(testButton.props.disabled, true)
    assert.equal(testButton.props.title, undefined)
    click(testButton)
    assert.equal(harness.events.action.length, 1)
    assert.equal(harness.events.action[0][0], 'text')
    assert.equal(harness.events.action[0][1].action, 'test')
    assert.equal(harness.events.action[0][1].label, '立即测试')
  } finally {
    harness.app.unmount()
  }
})

test('测试进行中和写锁会禁用操作按钮并给出中文原因', async () => {
  const testing = createCoverageApi({ testingId: TEXT_CONFIG_ID })
  const testingItem = coverageItem([
    {
      id: TEXT_CONFIG_ID,
      service_type: 'text',
      name: '本地文本',
      provider: 'ollama',
      default_model: 'qwen3',
      is_active: true,
      is_default: true,
    },
  ])
  const testingCard = mountCard({ item: testingItem, api: testing.api })
  try {
    const testButton = buttonByText(testingCard.root, '立即测试')
    assert.ok(testButton)
    assert.equal(testButton.props.disabled, true)
    assert.equal(testButton.props['aria-busy'], true)
    assert.equal(testButton.props['data-loading'], true)
    assert.equal(testButton.props.title, '正在测试连接，请稍候')
  } finally {
    testingCard.app.unmount()
  }

  const locked = createCoverageApi({ writesLocked: true })
  const lockedItem = coverageItem([
    {
      id: TEXT_CONFIG_ID,
      service_type: 'text',
      name: '本地文本',
      is_active: true,
      is_default: false,
    },
  ])
  assert.deepEqual(locked.api.coverageActions(lockedItem), [])
  const lockedCard = mountCard({ item: lockedItem, api: locked.api })
  try {
    assert.equal(buttonByText(lockedCard.root, '补齐默认'), undefined)
    assert.equal(buttonByText(lockedCard.root, '添加默认'), undefined)
    assert.equal(findByClass(lockedCard.root, 'coverage-actions')[0].children.filter((node) => node.type === 'button').length, 0)
  } finally {
    lockedCard.app.unmount()
  }

  const editing = createCoverageApi({ writesLocked: true })
  const editItem = coverageItem([
    {
      id: TEXT_CONFIG_ID,
      service_type: 'text',
      name: '本地文本',
      is_active: true,
      is_default: false,
    },
  ])
  assert.equal(editing.api.coverageActions(editItem).length, 0)
  const editCard = mountHarness(renderer, () => h(AiConfigCoverageCard, {
    item: editItem,
    selected: false,
    compact: false,
    coverageActions: (current) => getAiServiceCoverageActions(current, { vendorLocked: false, writesLocked: false }),
    isCoverageActionTesting: editing.api.isCoverageActionTesting,
    isCoverageActionDisabled: editing.api.isCoverageActionDisabled,
    setCoverageCardRef: editing.api.setCoverageCardRef,
    onSelect() {},
    onAction() {},
  }))
  try {
    const fixDefault = buttonByText(editCard.root, '补齐默认')
    assert.ok(fixDefault)
    assert.equal(fixDefault.props.disabled, true)
    assert.equal(fixDefault.props.title, '配置尚未就绪或正在保存，暂时不能修改')
  } finally {
    editCard.app.unmount()
  }
})

test('连接失败展示重新测试，厂商锁定时不再提供编辑入口', () => {
  const { api } = createCoverageApi()
  const failedItem = coverageItem([
    {
      id: TEXT_CONFIG_ID,
      service_type: 'text',
      name: '本地文本',
      provider: 'ollama',
      default_model: 'qwen3',
      is_active: true,
      is_default: true,
      last_test_status: 'failed',
    },
  ])
  const failedCard = mountCard({ item: failedItem, api })
  try {
    const retry = buttonByText(failedCard.root, '重新测试')
    assert.ok(retry)
    click(retry)
    assert.equal(failedCard.events.action[0][1].action, 'test')
    assert.match(textContent(failedCard.root), /最近测试失败/)
  } finally {
    failedCard.app.unmount()
  }

  const vendorLocked = createCoverageApi({ vendorLocked: true })
  const vendorItem = coverageItem([
    {
      id: TEXT_CONFIG_ID,
      service_type: 'text',
      name: '本地文本',
      is_active: true,
      is_default: false,
    },
  ])
  const vendorCard = mountCard({ item: vendorItem, api: vendorLocked.api })
  try {
    assert.deepEqual(vendorLocked.api.coverageActions(vendorItem), [])
    assert.equal(findByClass(vendorCard.root, 'coverage-actions')[0].children.filter((node) => node.type === 'button').length, 0)
  } finally {
    vendorCard.app.unmount()
  }
})