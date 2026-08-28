import test from 'node:test'
import assert from 'node:assert/strict'

import {
  getConfigWorkspaceKeyTarget,
  shouldApplyConfigWorkspaceRequest,
} from '../src/utils/aiConfigWorkspace.js'

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
