import test from 'node:test'
import assert from 'node:assert/strict'

import {
  getConfigWorkspaceKeyTarget,
  shouldApplyConfigWorkspaceRequest,
} from '../src/utils/aiConfigWorkspace.js'
import { useAiConfigWorkspaceView } from '../src/composables/useAiConfigWorkspaceView.js'

test('AI config workspace keyboard navigation follows the horizontal tab model', () => {
  assert.equal(getConfigWorkspaceKeyTarget('coverage', 'ArrowRight'), 'configs')
  assert.equal(getConfigWorkspaceKeyTarget('coverage', 'ArrowLeft'), 'configs')
  assert.equal(getConfigWorkspaceKeyTarget('configs', 'ArrowRight'), 'coverage')
  assert.equal(getConfigWorkspaceKeyTarget('configs', 'ArrowLeft'), 'coverage')
  assert.equal(getConfigWorkspaceKeyTarget('configs', 'Home'), 'coverage')
  assert.equal(getConfigWorkspaceKeyTarget('coverage', 'End'), 'configs')
  assert.equal(getConfigWorkspaceKeyTarget('coverage', 'ArrowDown'), '')
  assert.equal(getConfigWorkspaceKeyTarget('configs', 'ArrowUp'), '')
  assert.equal(getConfigWorkspaceKeyTarget('coverage', 'Enter'), '')
})

test('same-service navigation reopens config management after the user views coverage', () => {
  assert.equal(shouldApplyConfigWorkspaceRequest({
    requestedServiceType: 'video',
    activeServiceType: 'video',
    workspaceView: 'coverage',
  }), true)
  assert.equal(shouldApplyConfigWorkspaceRequest({
    requestedServiceType: 'video',
    activeServiceType: 'video',
    workspaceView: 'configs',
  }), false)
  assert.equal(shouldApplyConfigWorkspaceRequest({
    requestedServiceType: '',
    activeServiceType: '',
    workspaceView: 'coverage',
  }), false)
})

function refOf(value) {
  return { value }
}

function createWorkspaceViewHarness(overrides = {}) {
  const focused = []
  const configWorkspaceView = overrides.configWorkspaceView || refOf('coverage')
  const coverageWorkspaceModeRef = overrides.coverageWorkspaceModeRef || refOf({
    focus() { focused.push('coverage') },
  })
  const configsWorkspaceModeRef = overrides.configsWorkspaceModeRef || refOf({
    focus() { focused.push('configs') },
  })
  const api = useAiConfigWorkspaceView({
    configWorkspaceView,
    coverageWorkspaceModeRef,
    configsWorkspaceModeRef,
    nextTick: (fn) => fn(),
  })
  return { api, configWorkspaceView, focused }
}

test('selectConfigWorkspaceView 更新选中态，可选聚焦对应按钮', () => {
  const harness = createWorkspaceViewHarness()
  harness.api.selectConfigWorkspaceView('configs')
  assert.equal(harness.configWorkspaceView.value, 'configs')
  assert.deepEqual(harness.focused, [])

  harness.api.selectConfigWorkspaceView('coverage', { focus: true })
  assert.equal(harness.configWorkspaceView.value, 'coverage')
  assert.deepEqual(harness.focused, ['coverage'])

  harness.api.selectConfigWorkspaceView('configs', { focus: true })
  assert.equal(harness.configWorkspaceView.value, 'configs')
  assert.deepEqual(harness.focused, ['coverage', 'configs'])
})

test('onConfigWorkspaceKeydown 按左右方向键切换并聚焦', () => {
  const harness = createWorkspaceViewHarness()
  let prevented = 0
  harness.api.onConfigWorkspaceKeydown('coverage', {
    key: 'ArrowRight',
    preventDefault() { prevented += 1 },
  })
  assert.equal(prevented, 1)
  assert.equal(harness.configWorkspaceView.value, 'configs')
  assert.deepEqual(harness.focused, ['configs'])
})

test('onConfigWorkspaceKeydown 忽略非横向导航键', () => {
  const harness = createWorkspaceViewHarness()
  let prevented = 0
  harness.api.onConfigWorkspaceKeydown('coverage', {
    key: 'Enter',
    preventDefault() { prevented += 1 },
  })
  assert.equal(prevented, 0)
  assert.equal(harness.configWorkspaceView.value, 'coverage')
  assert.deepEqual(harness.focused, [])
})
