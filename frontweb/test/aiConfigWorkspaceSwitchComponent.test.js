import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { h, nextTick, ref } from 'vue'

import {
  click,
  createHostRenderer,
  findByTestId,
  hasClass,
  loadCompiledSfc,
  mountHarness,
  textContent,
  vueUrl,
} from './helpers/vueComponentHarness.js'

function readSource(url) {
  return readFileSync(url, 'utf8').replace(/\r\n?/g, '\n')
}

const switchUrl = new URL('../src/components/aiConfig/AiConfigWorkspaceSwitch.vue', import.meta.url)
const switchSource = readSource(switchUrl)
const AiConfigWorkspaceSwitch = await loadCompiledSfc(
  switchUrl,
  'ai-config-workspace-switch-component',
  new Map([['vue', vueUrl]]),
)

const renderer = createHostRenderer()

function keydown(node, key) {
  const event = {
    key,
    preventDefault() { event.prevented = true },
    stopPropagation() {},
  }
  node.props.onKeydown?.(event)
  return event
}

function mountSwitch(view = 'coverage') {
  const events = []
  const coverageWorkspaceModeRef = ref(null)
  const configsWorkspaceModeRef = ref(null)
  const mounted = mountHarness(renderer, () => h(AiConfigWorkspaceSwitch, {
    configWorkspaceView: view,
    selectConfigWorkspaceView: (nextView) => events.push(['select', nextView]),
    onConfigWorkspaceKeydown: (currentView, event) => events.push(['keydown', currentView, event.key]),
    coverageWorkspaceModeRef: coverageWorkspaceModeRef.value,
    'onUpdate:coverageWorkspaceModeRef': (value) => { coverageWorkspaceModeRef.value = value },
    configsWorkspaceModeRef: configsWorkspaceModeRef.value,
    'onUpdate:configsWorkspaceModeRef': (value) => { configsWorkspaceModeRef.value = value },
  }))
  return { ...mounted, events, coverageWorkspaceModeRef, configsWorkspaceModeRef }
}

test('工作区切换按选中态暴露 tab 语义和焦点环', async () => {
  assert.match(switchSource, /role="tablist" aria-label="AI 配置工作区"/)
  assert.match(switchSource, /\.config-workspace-mode:focus-visible/)
  assert.doesNotMatch(switchSource, /async function loadList\(/)
  assert.doesNotMatch(switchSource, /async function openTest\(/)
  assert.doesNotMatch(switchSource, /useAiConfigList/)

  const harness = mountSwitch('coverage')
  try {
    await nextTick()
    const coverage = findByTestId(harness.root, 'ai-config-mode-coverage')[0]
    const configs = findByTestId(harness.root, 'ai-config-mode-configs')[0]
    assert.ok(coverage)
    assert.ok(configs)
    assert.match(textContent(coverage), /服务状态/)
    assert.match(textContent(configs), /配置管理/)
    assert.equal(coverage.props.role, 'tab')
    assert.equal(coverage.props['aria-selected'], true)
    assert.equal(coverage.props.tabindex, 0)
    assert.equal(configs.props['aria-selected'], false)
    assert.equal(configs.props.tabindex, -1)
    assert.equal(hasClass(coverage, 'active'), true)
    assert.equal(hasClass(configs, 'active'), false)
    assert.ok(harness.coverageWorkspaceModeRef.value)
    assert.ok(harness.configsWorkspaceModeRef.value)
  } finally {
    harness.app.unmount()
  }
})

test('点击和方向键都走页面传入的工作区切换入口', async () => {
  const harness = mountSwitch('coverage')
  try {
    await nextTick()
    const coverage = findByTestId(harness.root, 'ai-config-mode-coverage')[0]
    const configs = findByTestId(harness.root, 'ai-config-mode-configs')[0]
    click(configs)
    const event = keydown(coverage, 'ArrowRight')
    assert.deepEqual(harness.events, [
      ['select', 'configs'],
      ['keydown', 'coverage', 'ArrowRight'],
    ])
    assert.equal(event.prevented, undefined)
  } finally {
    harness.app.unmount()
  }
})