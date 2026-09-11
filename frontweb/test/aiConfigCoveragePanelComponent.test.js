import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { h, nextTick } from 'vue'

import {
  click,
  createHostRenderer,
  dataModule,
  findByTestId,
  loadCompiledSfc,
  mountHarness,
  vueUrl,
} from './helpers/vueComponentHarness.js'

function readSource(url) {
  return readFileSync(url, 'utf8').replace(/\r\n?/g, '\n')
}

const panelUrl = new URL('../src/components/aiConfig/AiConfigCoveragePanel.vue', import.meta.url)
const panelSource = readSource(panelUrl)
const vueSource = readSource(new URL('../src/components/AIConfigContent.vue', import.meta.url))

function stubChild(name, testId) {
  return dataModule(`
    import { defineComponent, h } from ${JSON.stringify(vueUrl)}
    export default defineComponent({
      name: ${JSON.stringify(name)},
      inheritAttrs: false,
      emits: ['select', 'action'],
      setup(_props, { emit, attrs }) {
        return () => h('div', {
          'data-testid': ${JSON.stringify(testId)},
          'data-pending': String(Boolean(attrs.configListPendingEmpty)),
          'data-failed': String(Boolean(attrs.configListFailedEmpty)),
        }, [
          h('button', {
            type: 'button',
            'data-testid': ${JSON.stringify(testId + '-select')},
            onClick: () => emit('select', { type: 'text', state: 'configured' }),
          }, '选择服务'),
          h('button', {
            type: 'button',
            'data-testid': ${JSON.stringify(testId + '-action')},
            onClick: () => emit('action', { type: 'text' }, { action: 'test' }),
          }, '测试服务'),
        ])
      },
    })
  `)
}

const AiConfigCoveragePanel = await loadCompiledSfc(
  panelUrl,
  'ai-config-coverage-panel-component',
  new Map([
    ['vue', vueUrl],
    ['@/components/aiConfig/AiConfigCoverageHeader.vue', stubChild('AiConfigCoverageHeader', 'coverage-header')],
    ['@/components/aiConfig/AiConfigCoverageCards.vue', stubChild('AiConfigCoverageCards', 'coverage-cards')],
  ]),
)

const renderer = createHostRenderer()

function mountPanel(initial = {}) {
  const events = { select: [], action: [] }
  const mounted = mountHarness(renderer, () => h(AiConfigCoveragePanel, {
    configWorkspaceView: initial.configWorkspaceView ?? 'coverage',
    serviceCoverage: initial.serviceCoverage ?? { ready: false, readyCount: 0, totalCount: 5 },
    coverageSummaryCards: initial.coverageSummaryCards ?? [],
    configListPendingEmpty: Boolean(initial.configListPendingEmpty),
    configListFailedEmpty: Boolean(initial.configListFailedEmpty),
    loading: Boolean(initial.loading),
    retryConfigDependencies: () => events.retry = (events.retry || 0) + 1,
    orderedCoverageServices: initial.orderedCoverageServices ?? [],
    orderedExtractionCoverageServices: initial.orderedExtractionCoverageServices ?? [],
    activeServiceFilter: initial.activeServiceFilter ?? '',
    coverageActions: () => [],
    isCoverageActionTesting: () => false,
    isCoverageActionDisabled: () => false,
    setCoverageCardRef() {},
    onSelect: (item) => events.select.push(item),
    onAction: (item, action) => events.action.push([item, action]),
  }))
  return { ...mounted, events }
}

test('服务状态面板是纯展示，loadList/openTest 仍留在页面', () => {
  assert.match(vueSource, /<AiConfigCoveragePanel/)
  assert.match(vueSource, /async function loadList\(\)/)
  assert.match(vueSource, /async function openTest\(row\)/)
  assert.match(vueSource, /@select="onCoverageSelect"/)
  assert.match(vueSource, /@action="onCoverageAction"/)
  assert.match(panelSource, /id="ai-config-coverage-panel"/)
  assert.match(panelSource, /role="tabpanel"/)
  assert.match(panelSource, /tabindex="-1"/)
  assert.match(panelSource, /v-if="!configListPendingEmpty && !configListFailedEmpty"/)
  assert.doesNotMatch(panelSource, /async function loadList\(/)
  assert.doesNotMatch(panelSource, /async function openTest\(/)
  assert.doesNotMatch(panelSource, /useAiConfigList/)
  assert.doesNotMatch(panelSource, /aiAPI\./)
})

test('列表未就绪时不渲染服务卡片，就绪后选择和动作回到页面入口', async () => {
  const pending = mountPanel({ configListPendingEmpty: true })
  try {
    await nextTick()
    const rootPanel = pending.root.children[0]
    assert.equal(rootPanel.props.id, 'ai-config-coverage-panel')
    assert.equal(rootPanel.props.role, 'tabpanel')
    assert.equal(String(rootPanel.props.tabindex), '-1')
    assert.notEqual(rootPanel.style.display, 'none')
    assert.ok(findByTestId(pending.root, 'coverage-header')[0])
    assert.equal(findByTestId(pending.root, 'coverage-cards').length, 0)
  } finally {
    pending.app.unmount()
  }

  const ready = mountPanel()
  try {
    await nextTick()
    assert.ok(findByTestId(ready.root, 'coverage-cards')[0])
    click(findByTestId(ready.root, 'coverage-cards-select')[0])
    click(findByTestId(ready.root, 'coverage-cards-action')[0])
    assert.equal(ready.events.select[0].type, 'text')
    assert.equal(ready.events.action[0][1].action, 'test')
  } finally {
    ready.app.unmount()
  }

  const hidden = mountPanel({ configWorkspaceView: 'configs' })
  try {
    await nextTick()
    assert.equal(hidden.root.children[0].style.display, 'none')
  } finally {
    hidden.app.unmount()
  }
})
